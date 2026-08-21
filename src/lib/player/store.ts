import type {
  LyricLine,
  PlayerCatalog,
  PlayerExpand,
  PlayMode,
  PlayerSnapshot,
  PlayerTrack,
} from './types';
import { neteaseSongToTrack, parseNeteaseLyrics, type NeteaseSong } from './netease';
import {
  announcePause,
  announcePlay,
  createRoom,
  enqueueTrack,
  joinRoom,
  leaveRoom,
  partyId,
  reorderQueue as partyReorder,
  sendChat,
  roomPosition,
  type PartyRoom,
  type PartyTrack,
} from './party';
import {
  isTrackLiked,
  likedTracksAsPlayerTracks,
  LIKED_COLLECTION_ID,
  listLikedTracks,
  toggleLikedTrack,
} from './likes';

const STORAGE_KEY = 'yuxi-player-v1';
const NETEASE_COLLECTION_ID = 'netease-current';
const SEARCH_COLLECTION_ID = 'netease-search';

type Listener = () => void;

function toPartyTrack(track: PlayerTrack): PartyTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist ?? '',
    coverUrl: track.coverUrl,
    duration: track.duration,
  };
}

function tsToSec(s: string): number {
  // Supports SRT "HH:MM:SS.mmm", "MM:SS.mmm", commas as decimal separators.
  const raw = String(s).trim().replace(',', '.');
  const parts = raw.split(':').map((part) => part.trim());
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const sec = parseFloat(parts[2]) || 0;
    return h * 3600 + m * 60 + sec;
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10) || 0;
    const sec = parseFloat(parts[1]) || 0;
    return m * 60 + sec;
  }
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function parseSRT(text: string): { start: number; end: number; en: string; cn: string }[] {
  const blocks = text.trim().split(/\n\n+/);
  const lines: { start: number; end: number; en: string; cn: string }[] = [];
  for (const block of blocks) {
    const r = block.split('\n');
    let ts = -1;
    for (let i = 0; i < r.length; i++) if (r[i].includes('-->')) { ts = i; break; }
    if (ts < 0 || ts + 1 >= r.length) continue;
    const p = r[ts].split(' --> ');
    const start = tsToSec(p[0].trim());
    const end = tsToSec(p[1].trim());
    const body = r.slice(ts + 1).map((x) => x.trim()).filter(Boolean);
    if (!body.length) continue;
    lines.push({ start, end, en: body[0], cn: body[1] || '' });
  }
  return lines;
}

function parseLRC(text: string): { start: number; text: string }[] {
  const raw: { start: number; text: string }[] = [];
  const re = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const t = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
    const body = (m[3] || '').trim();
    if (body) raw.push({ start: t, text: body });
  }
  return raw;
}

function splitText(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

function attachWords(
  line: { start: number; end: number; en: string; cn: string },
  wordData: { word: string; start: number; end: number }[],
): LyricLine {
  const display = splitText(line.en);
  const candidates = wordData.filter((wd) => {
    const mid = (wd.start + wd.end) / 2;
    return mid >= line.start - 0.35 && mid <= line.end + 0.45;
  });
  let ci = 0;
  const words: LyricLine['words'] = [];
  const nonSpaceCount = display.filter((t) => !/^\s+$/.test(t)).length || 1;
  let nonIdx = 0;
  for (const token of display) {
    if (/^\s+$/.test(token)) {
      words.push({ text: token, start: null, end: null, space: true });
      continue;
    }
    let start: number | null = null;
    let end: number | null = null;
    if (ci < candidates.length) {
      start = candidates[ci].start;
      end = candidates[ci].end;
      ci++;
    } else {
      const frac = nonIdx / nonSpaceCount;
      const dur = Math.max(0.05, line.end - line.start);
      start = line.start + frac * dur;
      end = line.start + Math.min(1, (nonIdx + 1) / nonSpaceCount) * dur;
    }
    words.push({ text: token, start, end, space: false });
    nonIdx++;
  }
  return { ...line, words };
}

class YuxiPlayer {
  private audio: HTMLAudioElement | null = null;
  private catalog: PlayerCatalog | null = null;
  private listeners = new Set<Listener>();
  private queue: string[] = [];
  private index = -1;
  private playing = false;
  private expand: PlayerExpand = 'mini';
  private playMode: PlayMode = 'sequence';
  private volume = 0.85;
  private currentTime = 0;
  private duration = 0;
  private lyrics: LyricLine[] = [];
  private lyricsTrackId: string | null = null;
  private lyricsLoading = false;
  private ready = false;
  /** True while user is dragging the progress bar. */
  private seeking = false;
  /**
   * Target time that must stick on the element. While set, timeupdate must
   * NOT clobber UI with a stale 0 from a mid-seek media element (the post-
   * track-switch snap-to-zero bug).
   */
  private pendingSeek: { t: number; gen: number; play: boolean; publish: boolean } | null = null;
  /** Bumps on every track media swap — stale lyrics/seek retries bail out. */
  private mediaGen = 0;
  private seekRetryCleanup: (() => void) | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedTrackId: string | null = null;
  private searchResults: PlayerTrack[] = [];
  private partyRoom: PartyRoom | null = null;
  private partyTimer: ReturnType<typeof setInterval> | null = null;
  private partySyncing = false;
  private partyStateWriteChain: Promise<void> = Promise.resolve();
  private partyStatePending = 0;
  private partyPollPending = false;
  private partyIntentSeq = 0;
  private preloadPool: HTMLAudioElement[] = [];
  private preloadId: string | null = null;

  async init() {
    if (typeof window === 'undefined') return;
    if (this.ready) return;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.volume = this.volume;
    this.audio.addEventListener('timeupdate', () => {
      if (!this.audio) return;
      // User is scrubbing — UI is driven by ProgressBar dragTime only.
      if (this.seeking) return;

      // A committed seek is still settling on the element (common right after
      // a track switch). Keep the optimistic UI time; re-apply if needed.
      if (this.pendingSeek && this.pendingSeek.gen === this.mediaGen) {
        const target = this.pendingSeek.t;
        const actual = this.audio.currentTime || 0;
        if (Math.abs(actual - target) > 0.35) {
          // Element hasn't accepted the seek yet — re-apply, don't snap UI to 0.
          try {
            this.audio.currentTime = target;
          } catch {
            /* not ready */
          }
          this.currentTime = target;
          const d = this.audio.duration;
          if (Number.isFinite(d) && d > 0) this.duration = d;
          this.emit();
          return;
        }
        // Seek stuck — clear pending.
        this.pendingSeek = null;
      }

      this.currentTime = this.audio.currentTime || 0;
      const d = this.audio.duration;
      if (Number.isFinite(d) && d > 0) this.duration = d;
      this.emit();
      this.schedulePersist();
    });
    this.audio.addEventListener('seeked', () => {
      if (!this.audio || this.seeking) return;
      if (this.pendingSeek && this.pendingSeek.gen === this.mediaGen) {
        const target = this.pendingSeek.t;
        const actual = this.audio.currentTime || 0;
        if (Math.abs(actual - target) <= 0.75) {
          this.pendingSeek = null;
        }
      }
      this.currentTime = this.audio.currentTime || 0;
      this.emit();
    });
    this.audio.addEventListener('loadedmetadata', () => {
      if (!this.audio) return;
      const d = this.audio.duration;
      if (Number.isFinite(d) && d > 0) this.duration = d;
      this.flushPendingSeek();
      this.emit();
    });
    this.audio.addEventListener('canplay', () => {
      this.flushPendingSeek();
    });
    this.audio.addEventListener('durationchange', () => {
      if (!this.audio) return;
      const d = this.audio.duration;
      if (Number.isFinite(d) && d > 0) this.duration = d;
      this.emit();
    });
    this.audio.addEventListener('ended', () => {
      if (this.playMode === 'repeat-one') { this.seek(0, { play: true }); return; }
      if (this.playMode === 'stop') { this.pause(); this.seek(0, { play: false }); return; }
      this.next(true);
    });
    this.audio.addEventListener('play', () => {
      this.playing = true;
      this.emit();
    });
    this.audio.addEventListener('pause', () => {
      this.playing = false;
      this.emit();
    });

    try {
      const res = await fetch('/player-catalog.json');
      this.catalog = (await res.json()) as PlayerCatalog;
    } catch {
      this.catalog = { version: 1, collections: [], tracks: {} };
    }

    this.restore();
    this.ready = true;
    this.emit();
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persist(), 400);
  }

  private persist() {
    if (typeof window === 'undefined') return;
    const snap: PlayerSnapshot = {
      collectionId: this.collectionId,
      trackId: this.track()?.id ?? null,
      queue: this.queue,
      index: this.index,
      currentTime: this.currentTime,
      duration: this.duration,
      playing: false, // never auto-resume with sound without gesture
      expand: this.expand === 'full' ? 'sheet' : this.expand,
      playMode: this.playMode,
      volume: this.volume,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch { /* ignore */ }
  }
  private restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw) as PlayerSnapshot;
      this.collectionId = snap.collectionId;
      this.queue = Array.isArray(snap.queue) ? snap.queue : [];
      this.index = typeof snap.index === 'number' ? snap.index : -1;
      this.expand = snap.expand || 'mini';
      this.playMode = snap.playMode || 'sequence';
      this.volume = typeof snap.volume === 'number' ? snap.volume : 0.85;
      if (this.audio) this.audio.volume = this.volume;

      const track = this.track();
      if (track?.audioUrl && this.audio) {
        const gen = ++this.mediaGen;
        this.audio.src = track.audioUrl;
        this.loadedTrackId = track.id;
        const t = Math.max(0, snap.currentTime || 0);
        const onMeta = () => {
          if (!this.audio || gen !== this.mediaGen) return;
          this.duration = this.audio.duration || 0;
          if (t > 0 && t < this.duration) {
            this.audio.currentTime = t;
            this.currentTime = t;
          }
          this.audio.removeEventListener('loadedmetadata', onMeta);
          this.emit();
        };
        this.audio.addEventListener('loadedmetadata', onMeta);
        void this.loadLyrics(track, gen);
      }
    } catch {
      /* ignore */
    }
  }

  getCatalog() {
    return this.catalog;
  }

  getSnapshot(): PlayerSnapshot & {
    lyrics: LyricLine[];
    lyricsLoading: boolean;
    track: PlayerTrack | null;
    ready: boolean;
    seeking: boolean;
    searchResults: PlayerTrack[];
    party: PartyRoom | null;
    liked: boolean;
  } {
    const track = this.track();
    return {
      collectionId: this.collectionId,
      trackId: track?.id ?? null,
      queue: this.queue,
      index: this.index,
      currentTime: this.currentTime,
      duration: this.duration,
      playing: this.playing,
      expand: this.expand,
      playMode: this.playMode,
      volume: this.volume,
      lyrics: this.lyrics,
      lyricsLoading: this.lyricsLoading,
      track,
      ready: this.ready,
      seeking: this.seeking,
      searchResults: this.searchResults,
      party: this.partyRoom,
      liked: isTrackLiked(track?.id),
    };
  }

  /** Live media clock for high-frequency UI (lyrics mask). Prefers the
   *  element clock so progress can advance every animation frame. */
  mediaTime(): number {
    if (this.pendingSeek && this.pendingSeek.gen === this.mediaGen) return this.pendingSeek.t;
    if (this.audio && Number.isFinite(this.audio.currentTime)) return this.audio.currentTime || 0;
    return this.currentTime;
  }

  track(): PlayerTrack | null {
    if (this.index < 0 || this.index >= this.queue.length || !this.catalog) return null;
    const id = this.queue[this.index];
    return this.catalog.tracks[id] ?? null;
  }

  collection() {
    if (!this.catalog || !this.collectionId) return null;
    return this.catalog.collections.find((c) => c.id === this.collectionId) ?? null;
  }

  playCollection(collectionId: string, startTrackId?: string) {
    if (!this.catalog) return;
    const col = this.catalog.collections.find((c) => c.id === collectionId);
    if (!col) return;
    this.collectionId = collectionId;
    this.queue = col.trackIds.filter((id) => this.catalog!.tracks[id]?.audioUrl);
    let idx = 0;
    if (startTrackId) {
      const i = this.queue.indexOf(startTrackId);
      if (i >= 0) idx = i;
    }
    this.index = this.queue.length ? idx : -1;
    this.expand = 'sheet';
    void this.loadCurrent(true);
  }
  playTrack(trackId: string, collectionId?: string) {
    if (!this.catalog) return;
    if (collectionId) {
      this.playCollection(collectionId, trackId);
      return;
    }
    // find first collection containing track, else solo queue
    const col = this.catalog.collections.find((c) => c.trackIds.includes(trackId));
    if (col) {
      this.playCollection(col.id, trackId);
      return;
    }
    this.collectionId = null;
    this.queue = this.catalog.tracks[trackId] ? [trackId] : [];
    this.index = this.queue.length ? 0 : -1;
    this.expand = 'sheet';
    void this.loadCurrent(true);
  }

  /**
   * Load the user's NetEase "English Essentials 40" playlist through the
   * same-origin proxy and play it. All NetEase traffic stays server-side:
   * the Pages Function attaches the KV session cookie, the browser only ever
   * talks to /netease/*.
   */
  private ingestNeteasePlaylist(id: string, name: string, coverUrl: string | undefined, songs: NeteaseSong[]): void {
    if (!this.catalog) this.catalog = { version: 1, collections: [], tracks: {} };
    const trackIds: string[] = [];
    for (const song of songs) {
      const track = neteaseSongToTrack(song);
      this.catalog.tracks[track.id] = track;
      trackIds.push(track.id);
    }
    const collection = {
      id,
      title: name,
      description: '来自网易云账户的歌单，经服务端代理播放。',
      coverUrl,
      kind: 'music' as const,
      trackIds,
    };
    const existing = this.catalog.collections.findIndex((c) => c.id === id);
    if (existing >= 0) this.catalog.collections[existing] = collection;
    else this.catalog.collections.push(collection);
  }

  async loadNeteaseCurrent(): Promise<void> {
    if (!this.ready) await this.init();
    const res = await fetch('/netease/playlist/current');
    if (!res.ok) throw new Error(`netease_playlist_${res.status}`);
    const body = (await res.json()) as { playlist?: { name?: string; coverImgUrl?: string; tracks?: NeteaseSong[] } };
    const songs = body.playlist?.tracks ?? [];
    if (!songs.length) throw new Error('netease_playlist_empty');
    this.ingestNeteasePlaylist(
      NETEASE_COLLECTION_ID,
      body.playlist?.name || '网易云歌单',
      body.playlist?.coverImgUrl,
      songs,
    );
    this.playCollection(NETEASE_COLLECTION_ID);
  }

  /** Load any playlist from the account by its NetEase id and play it. */
  async loadNeteasePlaylist(playlistId: string): Promise<void> {
    if (!this.ready) await this.init();
    const res = await fetch(`/netease/playlist/${playlistId}`);
    if (!res.ok) throw new Error(`netease_playlist_${res.status}`);
    const body = (await res.json()) as { playlist?: { name?: string; coverImgUrl?: string; tracks?: NeteaseSong[] } };
    const songs = body.playlist?.tracks ?? [];
    if (!songs.length) throw new Error('netease_playlist_empty');
    const collectionId = `netease-${playlistId}`;
    this.ingestNeteasePlaylist(
      collectionId,
      body.playlist?.name || '网易云歌单',
      body.playlist?.coverImgUrl,
      songs,
    );
    this.playCollection(collectionId);
  }

  /** Search NetEase through the proxy; results are playable via playSearchResult. */
  async searchNetease(query: string): Promise<PlayerTrack[]> {
    const res = await fetch(`/netease/search?q=${encodeURIComponent(query)}&limit=30`);
    if (!res.ok) throw new Error(`netease_search_${res.status}`);
    const body = (await res.json()) as { result?: { songs?: NeteaseSong[] } };
    this.searchResults = (body.result?.songs ?? []).map(neteaseSongToTrack);
    this.emit();
  }
  playSearchResult(index: number): void {
    const track = this.searchResults[index];
    if (!track || !this.catalog) return;
    this.catalog.tracks[track.id] = track;
    this.collectionId = SEARCH_COLLECTION_ID;
    this.queue = [track.id];
    this.index = 0;
    this.expand = 'sheet';
    void this.loadCurrent(true);
  }

  /** Play a single NetEase song (e.g. from a song detail page or search). */
  playNeteaseSong(info: { id: string; title: string; artist?: string; coverUrl?: string; duration?: number }): void {
    if (!info.id) return;
    if (!this.catalog) this.catalog = { version: 1, collections: [], tracks: {} };
    this.catalog.tracks[info.id] = {
      id: info.id,
      title: info.title || '未知歌曲',
      artist: info.artist,
      coverUrl: info.coverUrl,
      duration: info.duration,
      audioUrl: `/netease/audio/${info.id}`,
      href: `/song/${info.id}/`,
      source: 'netease',
    };
    this.collectionId = null;
    this.queue = [info.id];
    this.index = 0;
    this.expand = 'sheet';
    void this.loadCurrent(true);
  }
  private clearSeekRetries() {

    if (this.seekRetryCleanup) {
      try {
        this.seekRetryCleanup();
      } catch {
        /* ignore */
      }
      this.seekRetryCleanup = null;
    }
  }

  private flushPendingSeek() {
    if (!this.audio || !this.pendingSeek) return;
    if (this.pendingSeek.gen !== this.mediaGen) {
      this.pendingSeek = null;
      return;
    }
    if (this.seeking) return; // still dragging
    const job = this.pendingSeek;
    const t = job.t;
    try {
      if (Math.abs((this.audio.currentTime || 0) - t) > 0.05) {
        this.audio.currentTime = t;
      }
    } catch {
      return; // still not ready — keep pending
    }
    // Verify it stuck; if still far off, leave pending for next canplay/timeupdate.
    const actual = this.audio.currentTime || 0;
    if (Math.abs(actual - t) > 0.75 && t > 0.25) {
      return;
    }
    this.pendingSeek = null;
    this.currentTime = actual || t;
    this.emit();
    if (job.play) void this.play({ publish: job.publish });
  }

  private async loadCurrent(autoplay: boolean) {
    const track = this.track();
    if (!track || !this.audio) {
      this.playing = false;
      this.seeking = false;
      this.emit();
      return;
    }

    // Always clear scrub flag first so timeupdate can run on the new track.
    this.seeking = false;
    this.pendingSeek = null;
    this.clearSeekRetries();
    const sameTrack =
      this.loadedTrackId === track.id &&
      !!track.audioUrl &&
      ((this.audio.getAttribute('src') || '') === track.audioUrl ||
        (this.audio.src || '').includes(track.audioUrl));

    if (!sameTrack) {
      // Invalidate in-flight lyrics/seek callbacks from the previous track.
      const gen = ++this.mediaGen;

      try {
        this.audio.pause();
      } catch {
        /* ignore */
      }

      this.playing = false;
      this.currentTime = 0;
      this.duration = 0;
      this.lyrics = [];
      this.lyricsTrackId = null;
      this.lyricsLoading = true;
      this.loadedTrackId = null;
      this.emit();

      // Full media rebind: empty src first so readyState drops.
      try {
        this.audio.removeAttribute('src');
        this.audio.load();
      } catch {
        /* ignore */
      }
      this.audio.src = track.audioUrl;
      this.loadedTrackId = track.id;
      try {
        this.audio.load();
      } catch {
        /* ignore */
      }


      // Aborted by a newer track switch.
      if (gen !== this.mediaGen) return;

      const d = this.audio.duration;
      if (Number.isFinite(d) && d > 0) this.duration = d;
      this.currentTime = 0;
      this.seeking = false;
      this.emit();

      void this.loadLyrics(track, gen);
    } else {
      // Same track re-selected — just ensure lyrics exist.
      if (this.lyricsTrackId !== track.id || !this.lyrics.length) {
        void this.loadLyrics(track, this.mediaGen);
      }
    }
    this.persist();
    this.emit();

    if (autoplay) {
      if (this.loadedTrackId !== track.id) return;
      const intent = ++this.partyIntentSeq;
      try {
        await this.audio.play();
        if (this.loadedTrackId !== track.id) return;
        this.playing = true;
        this.seeking = false;
      } catch {
        if (this.loadedTrackId === track.id) this.playing = false;
      }
      this.emit();
      if (this.playing && intent === this.partyIntentSeq) this.announcePartyPlay();
    }
    void this.preloadNext();
  }

  private async loadLyrics(track: PlayerTrack, gen?: number) {
    const expectedGen = gen ?? this.mediaGen;
    if (this.lyricsTrackId === track.id && this.lyrics.length) {
      this.lyricsLoading = false;
      this.emit();
      return;
    }
    if (track.source === 'netease') {
      this.lyricsLoading = true;
      this.emit();
      try {
        const res = await fetch(`/netease/lyrics/${track.id}`);
        const payload: unknown = res.ok ? await res.json() : null;
        if (expectedGen !== this.mediaGen || this.track()?.id !== track.id) return;
        this.lyrics = payload ? parseNeteaseLyrics(payload) : [];
        this.lyricsTrackId = track.id;
      } catch {
        if (expectedGen !== this.mediaGen || this.track()?.id !== track.id) return;
        this.lyrics = [];
      }
      this.lyricsLoading = false;
      this.emit();
      return;
    }
    this.lyricsLoading = true;
    this.emit();
    try {
      const [srtText, lrcText, wordsJson] = await Promise.all([
        track.srtUrl ? fetch(track.srtUrl).then((r) => (r.ok ? r.text() : '')).catch(() => '') : Promise.resolve(''),
        track.lrcUrl ? fetch(track.lrcUrl).then((r) => (r.ok ? r.text() : '')).catch(() => '') : Promise.resolve(''),
        track.wordsUrl
          ? fetch(track.wordsUrl)
              .then((r) => (r.ok ? r.json() : []))
              .catch(() => [])
          : Promise.resolve([]),
      ]);
      // Drop stale result if user already switched tracks.
      if (expectedGen !== this.mediaGen || this.track()?.id !== track.id) return;

      const wordData = Array.isArray(wordsJson)
        ? (wordsJson as { word: string; start: number; end: number }[])
        : [];
      let base: { start: number; end: number; en: string; cn: string }[] = [];
      if (srtText) base = parseSRT(srtText);
      else if (lrcText) {
        const rows = parseLRC(lrcText);
        base = rows.map((row, i) => ({
          start: row.start,
          end: i + 1 < rows.length ? rows[i + 1].start : row.start + 4,
          en: row.text,
          cn: '',
        }));
      }
      this.lyrics = base.map((line) => attachWords(line, wordData));
      this.lyricsTrackId = track.id;
    } catch {
      if (expectedGen !== this.mediaGen || this.track()?.id !== track.id) return;
      this.lyrics = [];
    }
    this.lyricsLoading = false;
    this.emit();
  }

  toggle() {
    if (!this.audio || !this.track()) return;
    if (this.playing) this.pause();
    else void this.play();
  }

  async play(opts?: { publish?: boolean }) {
    if (!this.audio || !this.track()) return;
    const publish = opts?.publish !== false;
    const intent = publish ? ++this.partyIntentSeq : this.partyIntentSeq;
    try {
      await this.audio.play();
      this.playing = true;
    } catch {
      this.playing = false;
    }
    this.emit();
    if (publish && intent === this.partyIntentSeq) this.announcePartyPlay();
  }

  pause(opts?: { publish?: boolean }) {
    if (opts?.publish !== false) this.partyIntentSeq += 1;
    this.audio?.pause();
    this.playing = false;
    this.emit();
    this.persist();
    const room = this.partyRoom;
    if (room && opts?.publish !== false) {
      const offset = this.audio?.currentTime ?? this.currentTime;
      this.queuePartyStateWrite(() => announcePause(room.code, offset));
    }
  }

  /**
   * Seek to an absolute time (seconds).
   * opts.preview: update position without toggling play / persistence (used while dragging).
   * opts.play: when not preview, whether to ensure playback (default true).
   */
  seek(seconds: number, opts?: { play?: boolean; preview?: boolean; publish?: boolean }) {
    if (!this.audio) return;
    const cur = this.track();
    if (!cur || this.loadedTrackId !== cur.id) return;

    const dur =
      Number.isFinite(this.audio.duration) && this.audio.duration > 0
        ? this.audio.duration
        : this.duration;
    let t = Number(seconds);
    if (!Number.isFinite(t) || t < 0) return;
    if (Number.isFinite(dur) && dur > 0) {
      t = Math.min(Math.max(0, t), Math.max(0, dur - 0.05));
    } else {
      t = Math.max(0, t);
    }

    this.clearSeekRetries();
    this.currentTime = t;

    const gen = this.mediaGen;
    const wantPlay = opts?.preview ? false : opts?.play !== false;
    const publish = opts?.publish !== false;
    if (!opts?.preview) this.pendingSeek = { t, gen, play: wantPlay, publish };

    const apply = (): boolean => {
      if (!this.audio || gen !== this.mediaGen) return false;
      try {
        this.audio.currentTime = t;
      } catch {
        return false;
      }
      const actual = this.audio.currentTime || 0;
      return !(Math.abs(actual - t) > 0.75 && t > 0.25);
    };

    const ok = apply();
    if (!ok && !opts?.preview) {
      const audio = this.audio;
      const onReady = () => {
        if (gen !== this.mediaGen) return;
        this.flushPendingSeek();
      };
      audio.addEventListener('loadedmetadata', onReady);
      audio.addEventListener('canplay', onReady);
      audio.addEventListener('seeked', onReady);
      this.seekRetryCleanup = () => {
        audio.removeEventListener('loadedmetadata', onReady);
        audio.removeEventListener('canplay', onReady);
        audio.removeEventListener('seeked', onReady);
      };
      setTimeout(() => {
        if (this.seekRetryCleanup) this.clearSeekRetries();
        if (this.pendingSeek?.gen === gen) this.flushPendingSeek();
      }, 4000);
    } else if (ok && !opts?.preview) {
      const actual = this.audio.currentTime || 0;
      if (Math.abs(actual - t) <= 0.75) this.pendingSeek = null;
    }

    this.emit();
    if (opts?.preview) return;

    if (wantPlay) {
      if (ok) void this.play({ publish });
    } else if (publish) {
      const room = this.partyRoom;
      if (room) this.queuePartyStateWrite(() => announcePause(room.code, t));
    }
    this.persist();
  }


  setSeeking(v: boolean) {
    this.seeking = !!v;
    // When scrub ends without a successful commit, drop any stale hold.
    // (endDrag always calls seek() first while seeking is still true, then setSeeking(false).)
    if (!v && this.pendingSeek && this.audio) {
      // Re-apply pending once the user has released.
      this.flushPendingSeek();
    }
    this.emit();
  }

  next(auto = false) {
    if (!this.queue.length) return;
    // Any member can advance the shared playback (last-write-wins).
    if (auto && this.playMode === 'repeat-one' && this.loadedTrackId === this.track()?.id) {
      this.seek(0, { play: true });
      return;
    }
    if (this.playMode === 'shuffle' && this.queue.length > 1) {
      let pick = this.index;
      while (pick === this.index) pick = Math.floor(Math.random() * this.queue.length);
      this.index = pick;
      void this.loadCurrent(true);
      this.consumePartyQueueHead();
      return;
    }
    if (this.index < this.queue.length - 1) {
      this.index += 1;
      void this.loadCurrent(true);
      this.consumePartyQueueHead();
    } else if (this.playMode === 'repeat-all') {
      this.index = 0;
      void this.loadCurrent(true);
      this.consumePartyQueueHead();
    } else if (!auto) {
      this.pause();
      this.seek(0, { play: false });
    } else {
      this.pause();
    }
  }

  /** After advancing into the shared queue, drop that track from the room queue. */
  private consumePartyQueueHead(): void {
    const room = this.partyRoom;
    const track = this.track();
    if (!room || !track) return;
    if (room.queue.some((t) => t.id === track.id)) {
      partyReorder(room.code, room.queue.filter((t) => t.id !== track.id).map((t) => t.id))
        .then((fresh) => this.acceptPartyRoom(fresh))
        .catch(() => undefined);
    }
  }
  prev() {
    if (!this.audio) return;
    // Any member can rewind the shared playback (last-write-wins).
    if (this.audio.currentTime > 3) {
      this.seek(0, { play: this.playing });
      return;
    }
    if (this.index > 0) {
      this.index -= 1;
      void this.loadCurrent(true);
      this.consumePartyQueueHead();
    } else {
      this.seek(0, { play: this.playing });
    }
  }

  setPlayMode(mode: PlayMode): void {
    this.playMode = mode;
    this.emit();
    this.schedulePersist();
    void this.preloadNext();
  }

  cyclePlayMode(): void {
    const order: PlayMode[] = ['sequence', 'repeat-all', 'repeat-one', 'stop', 'shuffle'];
    const i = order.indexOf(this.playMode);
    this.setPlayMode(order[(i + 1) % order.length]);
  }

  /** Predict the track that will be played next under the current play mode. */
  private predictNext(): PlayerTrack | null {
    if (this.partyRoom && !this.isPartyHost()) return null;
    if (!this.queue.length || !this.catalog) return null;
    if (this.playMode === 'repeat-one') return this.track();
    if (this.playMode === 'shuffle' && this.queue.length > 1) {
      let pick = this.index;
      while (pick === this.index) pick = Math.floor(Math.random() * this.queue.length);
      return this.catalog.tracks[this.queue[pick]] ?? null;
    }
    if (this.index < this.queue.length - 1) return this.catalog.tracks[this.queue[this.index + 1]] ?? null;
    if (this.playMode === 'repeat-all') return this.catalog.tracks[this.queue[0]] ?? null;
    return null;
  }

  /** Warm a hidden <audio> for the predicted next track so switching is instant. */
  private async preloadNext(): Promise<void> {
    const next = this.predictNext();
    if (!next?.audioUrl) return;
    if (this.preloadId === next.id) return;
    this.preloadId = next.id;
    while (this.preloadPool.length >= 2) this.preloadPool.shift()?.pause();
    try {
      const el = new Audio(next.audioUrl);
      el.preload = 'auto';
      el.volume = 0;
      this.preloadPool.push(el);
      void el.load();
    } catch { /* ignore */ }
  }

  setExpand(next: PlayerExpand): void {
    if (next !== 'mini' && next !== 'sheet' && next !== 'full') return;
    if (this.expand === next) return;
    this.expand = next;
    this.emit();
    this.schedulePersist();
  }

  cycleExpand() {
    // mini -> sheet -> full -> mini
    const order: PlayerExpand[] = ['mini', 'sheet', 'full'];
    const i = order.indexOf(this.expand);
    this.setExpand(order[(i + 1) % order.length]);
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.audio) this.audio.volume = this.volume;
    this.emit();
    this.persist();
  }

  // ── Listen-together ────────────────────────────────────────────────────

  isPartyHost(): boolean {
    return Boolean(this.partyRoom && this.partyRoom.hostId === partyId());
  }

  private mergePartyRoom(incoming: PartyRoom): PartyRoom {
    const current = this.partyRoom;
    if (!current || current.code !== incoming.code) return incoming;
    const state = incoming.state.serverAt >= current.state.serverAt ? incoming.state : current.state;
    const useIncomingQueue = incoming.queueAt >= current.queueAt;
    const messages = new Map(current.chat.map((message) => [message.id, message]));
    for (const message of incoming.chat) messages.set(message.id, message);
    const members = new Map(current.members.map((member) => [member.id, member]));
    for (const member of incoming.members) {
      const prior = members.get(member.id);
      if (!prior || member.lastSeen >= prior.lastSeen) members.set(member.id, member);
    }
    return {
      ...current,
      ...incoming,
      updatedAt: Math.max(current.updatedAt, incoming.updatedAt),
      state,
      queue: useIncomingQueue ? incoming.queue : current.queue,
      queueAt: Math.max(current.queueAt, incoming.queueAt),
      members: [...members.values()].sort((a, b) => a.joinedAt - b.joinedAt),
      chat: [...messages.values()].sort((a, b) => a.at - b.at).slice(-100),
    };
  }

  private acceptPartyRoom(incoming: PartyRoom): PartyRoom {
    const merged = this.mergePartyRoom(incoming);
    this.partyRoom = merged;
    this.syncPartyQueue(merged, merged.state.track?.id ?? this.track()?.id);
    this.emit();
    return merged;
  }

  private queuePartyStateWrite(request: () => Promise<PartyRoom>): void {
    this.partyStatePending += 1;
    const execute = async () => {
      try {
        this.acceptPartyRoom(await request());
      } catch {
        /* next heartbeat reconciles transient failures */
      } finally {
        this.partyStatePending = Math.max(0, this.partyStatePending - 1);
      }
    };
    this.partyStateWriteChain = this.partyStateWriteChain.then(execute, execute);
  }

  private announcePartyPlay(): void {
    const room = this.partyRoom;
    const track = this.track();
    if (!room || !track) return;
    const at = Date.now();
    const offset = this.audio?.currentTime ?? this.currentTime;
    const sharedTrack = toPartyTrack(track);
    this.queuePartyStateWrite(() => announcePlay(room.code, sharedTrack, at, offset, at));
  }
  async startParty(name: string): Promise<PartyRoom> {
    const current = this.track();
    const queueIds = this.index >= 0 ? this.queue.slice(this.index + 1) : this.queue;
    const queue = queueIds
      .map((id) => this.catalog?.tracks[id])
      .filter((track): track is PlayerTrack => Boolean(track))
      .map(toPartyTrack);
    const room = await createRoom(name, {
      track: current ? toPartyTrack(current) : null,
      playing: this.playing,
      offset: this.audio?.currentTime ?? this.currentTime,
      queue,
    });
    this.acceptPartyRoom(room);
    this.startPartyTimer();
    return room;
  }

  async joinParty(code: string): Promise<PartyRoom> {
    const room = await joinRoom(code.trim().toUpperCase());
    this.partyRoom = room;
    this.startPartyTimer();
    await this.applyPartyRoom(room);
    return room;
  }

  async sendPartyChat(text: string): Promise<void> {
    const room = this.partyRoom;
    if (!room) return;
    this.acceptPartyRoom(await sendChat(room.code, text));
  }

  async leaveParty(): Promise<void> {
    const room = this.partyRoom;
    this.partyRoom = null;
    if (this.partyTimer) {
      clearInterval(this.partyTimer);
      this.partyTimer = null;
    }
    if (room) {
      try {
        await leaveRoom(room.code);
      } catch {
        /* room may already be gone */
      }
    }
    this.emit();
  }

  private async partyPoll(): Promise<void> {
    const room = this.partyRoom;
    if (!room || this.partyPollPending) return;
    this.partyPollPending = true;
    try {
      await this.applyPartyRoom(await heartbeat(room.code));
    } catch {
      /* transient network error — retry on the next tick */
    } finally {
      this.partyPollPending = false;
    }
  }

  private async applyPartyRoom(incoming: PartyRoom): Promise<void> {
    const room = this.mergePartyRoom(incoming);
    this.partyRoom = room;
    const state = room.state;
    const target = state.track;

    if (target) {
      if (!this.catalog) this.catalog = { version: 1, collections: [], tracks: {} };
      this.catalog.tracks[target.id] = {
        id: target.id,
        title: target.title,
        artist: target.artist,
        coverUrl: target.coverUrl,
        audioUrl: `/netease/audio/${target.id}`,
        source: 'netease',
        duration: target.duration,
      };

      const local = this.track();
      const changed = !local || local.id !== target.id;
      if (changed && !this.partySyncing) {
        this.partySyncing = true;
        try {
          this.collectionId = null;
          this.queue = [target.id];
          this.index = 0;
          if (this.expand === 'mini') this.expand = 'sheet';
          await this.loadCurrent(false);
        } finally {
          this.partySyncing = false;
        }
      }

      this.syncPartyQueue(room, target.id);
      // A local active write is already queued. Do not let a heartbeat rewind it;
      // the next poll applies the server-confirmed result after the write settles.
      if (this.partyStatePending > 0) {
        this.emit();
        return;
      }

      if (state.mode === 'playing') {
        const pos = roomPosition(room);
        if (this.audio && !this.seeking) {
          const drift = Math.abs((this.audio.currentTime || 0) - pos);
          if (changed || drift > 1.0) this.seek(pos, { play: true, publish: false });
          else if (!this.playing) void this.play({ publish: false });
        }
      } else {
        const drift = Math.abs((this.audio?.currentTime || 0) - state.offset);
        if (changed || drift > 0.75) this.seek(state.offset, { play: false, publish: false });
        if (this.playing) this.pause({ publish: false });
      }
    } else {
      this.syncPartyQueue(room);
      if (this.playing) this.pause({ publish: false });
    }
    this.emit();
  }

  /**
   * Move a queue entry. In a party the shared queue order is pushed to the
   * room so every member sees the same up-next list.
   */
  reorderQueue(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= this.queue.length || to >= this.queue.length) return;
    const moved = this.queue.splice(from, 1)[0];
    this.queue.splice(to, 0, moved);
    if (this.index === from) this.index = to;
    else if (from < this.index && to >= this.index) this.index -= 1;
    else if (from > this.index && to <= this.index) this.index += 1;
    this.emit();
    const room = this.partyRoom;
    if (room) {
      const currentId = this.track()?.id;
      partyReorder(room.code, this.queue.filter((id) => id !== currentId))
        .then((fresh) => this.acceptPartyRoom(fresh))
        .catch(() => undefined);
    }
    this.persist();
  }

  enqueueSearchResult(index: number): void {
    const track = this.searchResults[index];
    if (!track) return;
    if (!this.catalog) this.catalog = { version: 1, collections: [], tracks: {} };
    this.catalog.tracks[track.id] = track;
    const room = this.partyRoom;
    if (room) {
      enqueueTrack(room.code, toPartyTrack(track))
        .then((fresh) => this.acceptPartyRoom(fresh))
        .catch(() => undefined);
      return;
    }
    this.queue.push(track.id);
    if (this.index < 0) {
      this.index = this.queue.length - 1;
      void this.loadCurrent(true);
    }
    this.emit();
    this.persist();
  }

  /** Mirror the room's shared queue into the local queue (keeps current track first). */
  private syncPartyQueue(room: PartyRoom, overrideCurrentId?: string): void {
    if (!this.catalog) this.catalog = { version: 1, collections: [], tracks: {} };
    const currentId = overrideCurrentId ?? this.track()?.id;
    const ids: string[] = [];
    if (currentId) ids.push(currentId);
    for (const t of room.queue) {
      if (t.id === currentId) continue;
      this.catalog.tracks[t.id] = {
        id: t.id,
        title: t.title,
        artist: t.artist,
        coverUrl: t.coverUrl,
        audioUrl: `/netease/audio/${t.id}`,
        source: 'netease',
        duration: t.duration,
      };
      ids.push(t.id);
    }
    if (ids.join('|') !== this.queue.join('|')) {
      this.queue = ids;
      this.index = currentId ? 0 : this.queue.length ? 0 : -1;
    }
  }

  isLiked(trackId?: string | null): boolean {
    return isTrackLiked(trackId ?? this.track()?.id);
  }

  toggleLike(): boolean {
    const track = this.track();
    if (!track) return false;
    const liked = toggleLikedTrack(track);
    this.emit();
    return liked;
  }

  /** Play the browser-local liked playlist (never touches NetEase playlists). */
  playLikedCollection(): void {
    const tracks = likedTracksAsPlayerTracks();
    if (!tracks.length) return;
    if (!this.catalog) this.catalog = { version: 1, collections: [], tracks: {} };
    const trackIds: string[] = [];
    for (const track of tracks) {
      this.catalog.tracks[track.id] = track;
      trackIds.push(track.id);
    }
    const coverUrl = tracks.find((t) => t.coverUrl)?.coverUrl;
    const collection = {
      id: LIKED_COLLECTION_ID,
      title: '我喜欢的音乐',
      description: '浏览器本地红心歌曲，仅保存在本机。',
      coverUrl,
      kind: 'music' as const,
      trackIds,
    };
    const existing = this.catalog.collections.findIndex((c) => c.id === LIKED_COLLECTION_ID);
    if (existing >= 0) this.catalog.collections[existing] = collection;
    else this.catalog.collections.push(collection);
    this.playCollection(LIKED_COLLECTION_ID);
  }

  likedCount(): number {
    return listLikedTracks().length;
  }
}

declare global {
  interface Window {
    __yuxiPlayer?: YuxiPlayer;
  }
}

export function getPlayer(): YuxiPlayer {
  if (typeof window === 'undefined') {
    // SSR stub – methods no-op
    return new YuxiPlayer();
  }
  if (!window.__yuxiPlayer) {
    window.__yuxiPlayer = new YuxiPlayer();
  }
  return window.__yuxiPlayer;
}

export type { YuxiPlayer };
