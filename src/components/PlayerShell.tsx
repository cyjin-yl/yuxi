import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Heart,
  ListMusic,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Users,
  X,
} from 'lucide-react';
import { getPlayer } from '../lib/player/store';
import type { LyricLine, PlayMode, PlayerTrack } from '../lib/player/types';
import { listRooms, partyId, roomPosition } from '../lib/player/party';
import ProgressiveCover from './ProgressiveCover';

function fmt(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

function playModeLabel(mode: PlayMode): string {
  switch (mode) {
    case 'repeat-one': return '单曲循环';
    case 'repeat-all': return '列表循环';
    case 'stop': return '播完即止';
    case 'shuffle': return '随机播放';
    default: return '顺序播放';
  }
}

function playModeIcon(mode: PlayMode): React.ReactNode {
  switch (mode) {
    case 'repeat-one': return <Repeat1 size={20} strokeWidth={1.75} />;
    case 'repeat-all': return <Repeat size={20} strokeWidth={1.75} />;
    case 'stop': return <Square size={18} strokeWidth={1.75} />;
    case 'shuffle': return <Shuffle size={20} strokeWidth={1.75} />;
    default: return <Repeat size={20} strokeWidth={1.75} />;
  }
}

function usePlayer() {
  const player = getPlayer();
  const [snap, setSnap] = useState(() => player.getSnapshot());

  useEffect(() => {
    void player.init().then(() => setSnap(player.getSnapshot()));
    return player.subscribe(() => setSnap(player.getSnapshot()));
  }, [player]);

  return { player, snap };
}

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const apply = () => setM(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return m;
}

/** Scrolls text that overflows its container (Apple Music-style long titles). */
function MarqueeText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const measure = () => {
      const extra = el.scrollWidth - parent.clientWidth;
      setOverflow(extra > 6 ? extra : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [text]);

  const style = overflow
    ? ({
        ['--yp-marquee-px' as string]: `${overflow}px`,
        animationDuration: `${Math.max(6, overflow / 45)}s`,
      } as React.CSSProperties)
    : undefined;

  return (
    <span className={`yp-marquee${className ? ` ${className}` : ''}`}>
      <span ref={ref} className="yp-marquee-text" data-overflow={overflow ? '1' : undefined} style={style}>
        {text}
      </span>
    </span>
  );
}
/**
 * Split a NetEase artist string into individual artist names so each can be its
 * own search target. Common separators: 、& / , ; feat./ft. joins.
 */
function splitArtists(value: string): string[] {
  if (!value) return [];
  // Keep zero-width joins out, split on the multi-artist separators NetEase uses.
  const parts = value
    .replace(/\s+/g, ' ')
    .split(/\s*(?:[、&/;]|_feat\.?_|_ft\.?_|feat\.|ft\.|,|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  // Deduplicate while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

/** Renders one clickable chip per artist; null when nothing to render. */
function ArtistLinks({ value, onPick }: { value: string | undefined | null; onPick: (name: string) => void }) {
  const names = splitArtists(value ?? '');
  if (!names.length) return null;
  return (
    <span className="yp-artist-links">
      {names.map((n, i) => (
        <span key={`${n}-${i}`} className="yp-artist-links-item">
          {i > 0 ? <span className="yp-artist-sep" aria-hidden>·</span> : null}
          <button
            type="button"
            className="yp-artist-link"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPick(n);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onPick(n);
              }
            }}
            aria-label={`搜索 ${n}`}
          >
            {n}
          </button>
        </span>
      ))}
    </span>
  );
}

function ProgressBar({
  currentTime,
  duration,
  trackId,
  onSeek,
  onSeeking,
}: {
  currentTime: number;
  duration: number;
  trackId?: string | null;
  onSeek: (t: number, opts?: { preview?: boolean }) => void;
  onSeeking: (v: boolean) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  // Keep latest duration/currentTime in refs so pointer handlers never close over stale values after track switch.
  const durationRef = useRef(duration);
  const currentTimeRef = useRef(currentTime);
  durationRef.current = duration;
  currentTimeRef.current = currentTime;
  // Local-only scrub position. NEVER write to the audio engine while dragging.
  const [dragTime, setDragTime] = useState<number | null>(null);

  // Reset scrub UI when track changes (also covered by key=track.id remount).
  useEffect(() => {
    dragging.current = false;
    setDragTime(null);
    onSeeking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trackId only
  }, [trackId]);

  // If duration collapses to 0 mid-drag (track swap), abort scrub.
  useEffect(() => {
    if ((!duration || duration <= 0) && dragging.current) {
      dragging.current = false;
      setDragTime(null);
      onSeeking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  const displayTime = dragTime != null ? dragTime : currentTime;

  const timeFromClientX = useCallback((clientX: number) => {
    const el = barRef.current;
    const dur = durationRef.current;
    if (!el || !dur || !Number.isFinite(dur) || dur <= 0) return NaN;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
    return ratio * dur;
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const dur = durationRef.current;
    if (!dur || !Number.isFinite(dur) || dur <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    onSeeking(true);
    try {
      barRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDragTime(timeFromClientX(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    e.preventDefault();
    const t = timeFromClientX(e.clientX);
    if (Number.isFinite(t)) setDragTime(t);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    e.preventDefault();
    dragging.current = false;
    const t = timeFromClientX(e.clientX);
    try {
      barRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (Number.isFinite(t) && t >= 0 && durationRef.current > 0) {
      // Keep dragTime until the next currentTime prop catches up, so the bar
      // never flashes to 0 while the store is still settling a pending seek.
      setDragTime(t);
      onSeek(t, { preview: false });
      onSeeking(false);
      return;
    }
    setDragTime(null);
    onSeeking(false);
  };

  // Drop local override once the engine time is near the committed scrub target.
  // Never clear just because currentTime is 0 — that's the snap bug.
  useEffect(() => {
    if (dragTime == null || dragging.current) return;
    if (Math.abs(currentTime - dragTime) < 0.6) {
      setDragTime(null);
    }
  }, [currentTime, dragTime]);

  // Safety: don't hold local scrub forever if the engine never confirms.
  useEffect(() => {
    if (dragTime == null || dragging.current) return;
    const id = window.setTimeout(() => setDragTime(null), 2500);
    return () => window.clearTimeout(id);
  }, [dragTime]);

  const pct = duration > 0 ? Math.min(100, Math.max(0, (displayTime / duration) * 100)) : 0;

  return (
    <div className="yp-progress">
      <span className="yp-time">{fmt(displayTime)}</span>
      <div
        className={`yp-bar${dragTime != null ? ' is-dragging' : ''}`}
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label="进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e) => {
          if (!duration) return;
          const step = e.shiftKey ? 5 : 2;
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            onSeek(Math.min(duration, currentTime + step));
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            onSeek(Math.max(0, currentTime - step));
          }
        }}
      >
        <div className="yp-bar-fill" style={{ width: `${pct}%` }} />
        <div className="yp-bar-knob" style={{ left: `${pct}%` }} />
      </div>
      <span className="yp-time">{fmt(duration)}</span>
    </div>
  );
}


/** Simple timed word line: mask/glow only, no per-word scale. */
function WordLine({
  words,
  wordProgress,
  isCjk,
  lineProgressPct,
  active,
}: {
  words: LyricLine['words'];
  wordProgress: (number | null)[];
  isCjk: boolean;
  lineProgressPct?: number;
  active: boolean;
}) {
  return (
    <div
      className={`yp-line-en${isCjk ? ' is-cjk' : ''}`}
      style={
        active && lineProgressPct != null
          ? ({ '--yp-line-progress': `${Math.round(lineProgressPct)}%` } as React.CSSProperties)
          : undefined
      }
    >
      {words.map((w, wi) => {
        if (w.space) {
          return (
            <span key={wi} className="yp-space">
              {w.text}
            </span>
          );
        }
        const wp = wordProgress[wi];
        const sung = wp === 1;
        // Current word only: 0 < progress < 1. Progress 0 = not yet reached.
        const hi = wp != null && wp > 0 && wp < 1;
        // Always pin progress for hi/sung so CSS never falls back to a full fill flash.
        const styleVars: React.CSSProperties | undefined =
          hi || sung
            ? ({
                '--yp-word-progress': `${Math.round((sung ? 1 : (wp ?? 0)) * 100)}%`,
              } as React.CSSProperties)
            : undefined;
        return (
          <span
            key={wi}
            className={`yp-word${hi ? ' is-hi' : ''}${sung ? ' is-sung' : ''}`}
            style={styleVars}
            data-word-start={
              w.start != null && Number.isFinite(w.start) ? String(w.start) : undefined
            }
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
}
function LyricsPane({
  lyrics,
  currentTime,
  loading,
  onSeek,
  track,
  playing,
}: {
  lyrics: LyricLine[];
  currentTime: number;
  loading: boolean;
  onSeek: (t: number) => void;
  track: PlayerTrack | null;
  playing: boolean;
}) {
  const player = getPlayer();
  const scroller = useRef<HTMLDivElement>(null);
  const lastLine = useRef(-1);
  // High-frequency clock for mask/warp. timeupdate is only ~4 Hz; rAF reads
  // the media element directly so progress stays continuous (~60 fps).
  const [clock, setClock] = useState(currentTime);

  useEffect(() => {
    setClock(currentTime);
  }, [currentTime, track?.id]);

  useEffect(() => {
    if (!playing) {
      setClock(player.mediaTime());
      return;
    }
    let raf = 0;
    const tick = () => {
      setClock(player.mediaTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, player, track?.id]);

  const t = Number.isFinite(clock) ? clock : currentTime;

  let active = -1;
  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (t >= lyrics[i].start) {
      active = i;
      break;
    }
  }

  useEffect(() => {
    // New lyrics set → allow re-scroll from line 0
    lastLine.current = -1;
  }, [lyrics]);

  useEffect(() => {
    if (active < 0) return;
    if (active === lastLine.current) return;
    lastLine.current = active;
    const root = scroller.current;
    if (!root) return;
    const el = root.querySelector(`[data-line="${active}"]`) as HTMLElement | null;
    if (!el) return;

    // Anchor the active line slightly above center (~38% from top) so the
    // previous line stays in view rather than dead-center framing.
    const rootRect = root.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const target = root.clientHeight * 0.38;
    const delta = elRect.top - rootRect.top - target + root.scrollTop + el.clientHeight * 0.5;
    root.scrollTo({ top: Math.max(0, delta), behavior: 'smooth' });
  }, [active]);

  if (loading) return <div className="yp-lyrics"><div className="yp-lyrics-empty">加载歌词…</div></div>;
  if (!lyrics.length) return <div className="yp-lyrics"><div className="yp-lyrics-empty">暂无歌词</div></div>;

  return (
    <div className="yp-lyrics" ref={scroller}>
      {lyrics.map((line, i) => {
        const lineStart = Number(line.start);
        const lineDur = line.end > lineStart ? line.end - lineStart : 0;
        let activeProgress = 0;
        if (i === active && lineDur > 0) {
          activeProgress = Math.min(1, Math.max(0, (t - lineStart) / lineDur));
        }
        const wordProgress = line.words.map((w) => {
          if (w.end == null || !Number.isFinite(w.end) || w.end <= 0) return null;
          const ws = w.start != null && Number.isFinite(w.start) ? w.start : lineStart;
          if (i !== active && i >= active) return null;
          if (i < active) return 1;
          if (t >= w.end) return 1;
          if (t <= ws) return 0;
          return Math.min(1, Math.max(0, (t - ws) / Math.max(0.04, w.end - ws)));
        });

        // Distance falloff for blur/opacity of non-active lines.
        const dist = active < 0 ? Math.abs(i) : Math.abs(i - active);
        // MUST NOT shadow outer media clock `t`.
        const easeT = Math.min(1, dist / 6);
        const ease = easeT * easeT * (3 - 2 * easeT);
        const lineBlur = i === active ? 0 : 0.4 + ease * 2.6;
        const lineOpacity = i === active ? 1 : i < active ? 0.72 - ease * 0.28 : 0.42 - ease * 0.22;
        const lineSat = i === active ? 1 : 1 - ease * 0.25;
        // Whole-line GPU scale only. Keep modest so left-origin scale stays in bounds.
        const lineScale = i === active ? 1.08 : 1;

        const hasWordTiming = line.words.some(
          (w) => !w.space && w.end != null && Number.isFinite(w.end) && w.end > 0,
        );

        return (
          <div
            key={`${i}-${lineStart}`}
            className={`yp-line${i === active ? ' is-active' : ''}${i < active ? ' is-past' : ''}`}
            data-line={i}
            data-start={Number.isFinite(lineStart) ? String(lineStart) : undefined}
            style={
              {
                '--yp-line-blur': `${lineBlur.toFixed(2)}px`,
                '--yp-line-opacity': String(Math.max(0.12, lineOpacity).toFixed(3)),
                '--yp-line-sat': String(Math.max(0.7, lineSat).toFixed(3)),
                '--yp-line-scale': lineScale.toFixed(4),
              } as React.CSSProperties
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const el = e.target as HTMLElement;
              const wordEl = el.closest('[data-word-start]') as HTMLElement | null;
              if (wordEl) {
                const wt = parseFloat(wordEl.getAttribute('data-word-start') || '');
                if (Number.isFinite(wt)) {
                  onSeek(wt);
                  return;
                }
              }
              const lineEl = el.closest('[data-start]') as HTMLElement | null;
              const raw = lineEl?.getAttribute('data-start') ?? String(lineStart);
              const st = parseFloat(raw);
              if (!Number.isFinite(st)) return;
              onSeek(st);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (Number.isFinite(lineStart)) onSeek(lineStart);
              }
            }}
          >
            {hasWordTiming ? (
              <WordLine
                words={line.words}
                wordProgress={wordProgress}
                isCjk={CJK_RE.test(line.en)}
                active={i === active}
                lineProgressPct={i === active && lineDur > 0 ? activeProgress * 100 : undefined}
              />
            ) : (
              <div
                className={`yp-line-en is-line-mask${CJK_RE.test(line.en) ? ' is-cjk' : ''}${i === active ? ' is-active' : ''}${i < active ? ' is-sung' : ''}`}
                style={
                  i === active || i < active
                    ? ({
                        '--yp-en-progress': `${Math.round((i < active ? 1 : activeProgress) * 100)}%`,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                {line.en}
              </div>
            )}
            {line.cn ? (
              <div
                className={`yp-line-cn${i === active ? ' is-active' : ''}${i < active ? ' is-sung' : ''}`}
                style={
                  i === active || i < active
                    ? ({
                        '--yp-cn-progress': `${Math.round((i < active ? 1 : activeProgress) * 100)}%`,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                {line.cn}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function QueueList({
  queue,
  currentId,
  onPick,
}: {
  queue: string[];
  currentId: string;
  onPick: (id: string) => void;
}) {
  const player = getPlayer();
  const catalog = player.getCatalog();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const cur = queue.indexOf(currentId);
    if (cur < 0) return;
    const el = ul.children[cur] as HTMLElement | undefined;
    if (!el) return;
    const top = el.offsetTop - ul.offsetTop - ul.clientHeight * 0.4 + el.clientHeight / 2;
    ul.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [currentId, queue]);

  const drop = (to: number) => {
    if (dragIndex != null && dragIndex !== to) player.reorderQueue(dragIndex, to);
    setDragIndex(null);
    setOverIndex(null);
  };

  if (!catalog || queue.length === 0) return <div className="yp-lyrics-empty">队列为空</div>;
  return (
    <aside className="yp-queue yp-queue-standalone" aria-label="播放列表">
      <div className="yp-queue-head">正在播放 · 拖动排序</div>
      <ul className="yp-queue-list" ref={listRef}>
        {queue.map((id, i) => {
          const t = catalog.tracks[id];
          if (!t) return null;
          return (
            <li
              key={id}
              data-queue-index={i}
              draggable
              className={overIndex === i && dragIndex !== null && dragIndex !== i ? 'is-over' : ''}
              onDragStart={(e) => {
                setDragIndex(i);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overIndex !== i) setOverIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(i);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
            >
              <span
                className="yp-queue-grip"
                aria-hidden
                onTouchStart={() => setDragIndex(i)}
                onTouchMove={(e) => {
                  e.preventDefault();
                  const touch = e.touches[0];
                  const el = document.elementFromPoint(touch.clientX, touch.clientY);
                  const li = el?.closest('li[data-queue-index]');
                  if (!li) return;
                  const idx = Number(li.getAttribute('data-queue-index'));
                  if (Number.isFinite(idx) && overIndex !== idx) setOverIndex(idx);
                }}
                onTouchEnd={() => {
                  if (overIndex != null) drop(overIndex);
                  else setDragIndex(null);
                }}
              >
                ⋮⋮
              </span>
              <button
                type="button"
                className={`yp-queue-item${id === currentId ? ' is-current' : ''}`}
                onClick={() => onPick(id)}
              >
                <span className="yp-queue-num">{t.num ?? String(i + 1).padStart(2, '0')}</span>
                <span className="yp-queue-meta">
                  <span className="yp-queue-title">{t.title}</span>
                  <span className="yp-queue-artist yp-artist-links">
                    <ArtistLinks value={t.artist} onPick={(n) => void player.searchNetease(n)} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function SearchPanel() {
  const { player, snap } = usePlayer();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const results = Array.isArray(snap.searchResults) ? snap.searchResults : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    setError(null);
    try {
      await player.searchNetease(query);
    } catch {
      setError('搜索失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="yp-search">
      <form className="yp-search-form" onSubmit={submit}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索歌曲、歌手…"
          aria-label="搜索网易云"
        />
        <button type="submit" disabled={busy || !q.trim()}>
          {busy ? '…' : '搜索'}
        </button>
      </form>
      {error ? <div className="yp-lyrics-empty">{error}</div> : null}
      {!results.length && !error ? (
        <div className="yp-lyrics-empty">输入关键词，直接听网易云曲库</div>
      ) : null}
      <ul className="yp-search-list">
        {results.map((t, i) => (
          <li key={`${t.id}-${i}`} className="yp-search-item">
            <button type="button" className="yp-queue-item" onClick={() => player.playSearchResult(i)}>
              {t.coverUrl ? (
                <img className="yp-search-cover" src={t.coverUrl} alt="" />
              ) : (
                <span className="yp-queue-num">{String(i + 1).padStart(2, '0')}</span>
              )}
              <span className="yp-search-text">
                <span className="yp-queue-title">{t.title}</span>
                {t.artist ? (
                  <span className="yp-search-artist yp-artist-links">
                    <ArtistLinks
                      value={t.artist}
                      onPick={(n) => {
                        setQ(n);
                        void player.searchNetease(n);
                      }}
                    />
                  </span>
                ) : null}
              </span>
            </button>
            <button
              type="button"
              className="yp-search-add"
              aria-label={`把 ${t.title} 加入队列`}
              title={snap.party ? '加入一起听队列' : '加入临时队列'}
              onClick={() => player.enqueueSearchResult(i)}
            >
              +
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PartyPanel() {
  const { player, snap } = usePlayer();
  const room = snap.party;
  const [code, setCode] = useState('');
  const [chatText, setChatText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<{ code: string; name: string; members: number; host: boolean }[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

  const refreshRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const next = await listRooms();
      setRooms(Array.isArray(next) ? next : []);
    } catch {
      setRooms([]);
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!room) void refreshRooms();
  }, [room, refreshRooms]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      if (message === 'party_400') setError('房间码无效。请输入 4 位字母数字码。');
      else if (message === 'party_404') setError('房间不存在或已经失效。');
      else if (message === 'party_401') setError('一起听服务鉴权失败，请刷新后重试。');
      else if (message === 'party_invalid_response') setError('服务器返回了无法识别的房间数据。');
      else if (message.startsWith('party_')) setError(`一起听请求失败（${message.replace('party_', '')}）。`);
      else setError(message ? `操作失败：${message}` : '操作失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const onSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatText.trim();
    if (!text || !room) return;
    setChatText('');
    void act(() => player.sendPartyChat(text));
  };

  if (room) {
    const host = room.hostId === partyId();
    const members = Array.isArray(room.members) ? room.members : [];
    const messages = Array.isArray(room.chat) ? room.chat : [];
    const state = room.state ?? {
      mode: 'idle' as const,
      track: null,
      startedAt: 0,
      offset: 0,
      serverAt: 0,
      hostAt: 0,
    };
    const now = Date.now();
    return (
      <div className="yp-party">
        <div className="yp-party-head">
          <div>
            <div className="yp-party-code">房间 {room.code}</div>
            <div className="yp-party-name">
              {room.name} · {members.length} 人在线{host ? ' · 你是房主' : ''}
            </div>
          </div>
          <button type="button" className="yp-text-btn" disabled={busy} onClick={() => void act(() => player.leaveParty())}>
            <X size={14} strokeWidth={2} /> 离开
          </button>
        </div>
        <div className="yp-party-members" aria-label="在线成员">
          {members.map((m) => {
            const age = now - (m.lastSeen || 0);
            const online = age < 120_000;
            const isHost = m.id === room.hostId;
            const isSelf = m.id === partyId();
            return (
              <span
                key={m.id}
                className={`yp-party-member${online ? ' is-online' : ''}${isHost ? ' is-host' : ''}`}
                title={online ? '在线' : '可能已离线'}
              >
                <span className="yp-party-member-dot" aria-hidden />
                {m.name || '听众'}
                {isHost ? ' · 房主' : ''}
                {isSelf ? ' · 我' : ''}
              </span>
            );
          })}
        </div>
        {state.track ? (
          <div className="yp-party-now">
            {host ? '正在播放（同步给所有人）' : '跟随房主播放'} · {state.track.title}
            {state.track.artist ? ` — ${state.track.artist}` : ''}
            {state.mode === 'idle' ? ' · 已暂停' : ` · ${fmt(roomPosition(room))}`}
          </div>
        ) : (
          <div className="yp-party-now">房主还没开始播放</div>
        )}
        <div className="yp-party-chat" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className="yp-party-msg">
              <span className="yp-party-msg-name">{m.name}</span>
              {m.text}
            </div>
          ))}
        </div>
        <form className="yp-search-form" onSubmit={onSendChat}>
          <input
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="说点什么…"
            aria-label="聊天"
            maxLength={500}
          />
          <button type="submit" disabled={!chatText.trim() || busy}>
            发送
          </button>
        </form>
        {error ? <div className="yp-lyrics-empty">{error}</div> : null}
      </div>
    );
  }

  return (
    <div className="yp-party">
      <p className="yp-party-intro">
        和朋友一起听：创建房间或输入房间码加入。所有人跟随房主的进度同步播放，不限人数。
      </p>
      <div className="yp-party-actions">
        <button
          type="button"
          className="yp-text-btn"
          disabled={busy}
          onClick={() => void act(() => player.startParty('一起听'))}
        >
          <Users size={16} strokeWidth={2} /> 创建房间
        </button>
        <form
          className="yp-search-form yp-party-join"
          onSubmit={(e) => {
            e.preventDefault();
            const roomCode = code.trim().toUpperCase();
            if (!/^[A-Z2-9]{4}$/.test(roomCode)) {
              setError('房间码为 4 位字母或数字，不包含 0、1。');
              return;
            }
            void act(() => player.joinParty(roomCode));
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
            placeholder="房间码"
            aria-label="房间码"
            inputMode="text"
            autoComplete="off"
            maxLength={4}
          />
          <button type="submit" disabled={busy || code.trim().length !== 4}>
            加入
          </button>
        </form>
      </div>
      <div className="yp-party-rooms">
        <div className="yp-party-rooms-head">
          <span>正在进行的房间</span>
          <button type="button" className="yp-text-btn" disabled={roomsLoading} onClick={() => void refreshRooms()}>
            {roomsLoading ? '刷新中…' : '刷新'}
          </button>
        </div>
        {rooms.length === 0 ? (
          <p className="yp-party-intro">现在没有活跃的房间，创建一个吧。</p>
        ) : (
          <ul className="yp-party-room-list">
            {rooms.map((r) => (
              <li key={r.code} className="yp-party-room">
                <div className="yp-party-room-info">
                  <span className="yp-party-room-name">{r.name}</span>
                  <span className="yp-party-room-meta">
                    {r.code} · {r.members} 人{r.host ? ' · 你是房主' : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="yp-search-add"
                  disabled={busy}
                  onClick={() => void act(() => player.joinParty(r.code))}
                >
                  加入
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? <div className="yp-lyrics-empty">{error}</div> : null}
    </div>
  );
}

function ArtBlock({ track, coverUrl, large }: { track: PlayerTrack; coverUrl?: string; large?: boolean }) {
  const art = coverUrl || track.coverUrl;
  return (
    <div className={`yp-artwork${large ? ' is-large yp-artwork-enter' : ''}`} aria-hidden>
      <ProgressiveCover
        src={art}
        thumbSize={large ? 64 : 32}
        fallback={
          <div className="yp-artwork-fallback">
            <ListMusic size={large ? 56 : 28} strokeWidth={1.5} />
          </div>
        }
      />
    </div>
  );
}

type SideTab = 'lyrics' | 'queue' | 'search' | 'party';

export default function PlayerShell() {
  const { player, snap } = usePlayer();
  const {
    track,
    playing,
    currentTime,
    duration,
    expand,
    playMode,
    lyrics,
    lyricsLoading,
    ready,
    queue,
    party,
    liked,
  } = snap;
  const activeCollection = player.collection();
  const collectionCover = activeCollection?.coverUrl;
  const artworkKey = track?.id || activeCollection?.id || 'artwork';

  const isMobile = useIsMobile();
  const [sideTab, setSideTab] = useState<SideTab>('lyrics');
  const visible = ready && !!track;
  const panelRef = useRef<HTMLDivElement>(null);
  const panelRect = useRef<DOMRect | null>(null);
  const previousExpand = useRef(expand);
  const flipFrame = useRef(0);
  const flipTimer = useRef(0);

  // Click artist name → jump to in-player search for that artist.
  const searchArtist = useCallback(
    (name: string) => {
      const q = name.trim();
      if (!q) return;
      setSideTab('search');
      void player.searchNetease(q);
      // Ensure the player is visible so the user sees the search panel.
      if (expand === 'mini') player.setExpand(isMobile ? 'full' : 'sheet');
    },
    [player, expand, isMobile],
  );
  const seek = useCallback(
    (t: number, opts?: { preview?: boolean }) => {
      if (!Number.isFinite(t)) return;
      if (opts?.preview) {
        player.seek(t, { preview: true, play: false });
        return;
      }
      // A committed scrub preserves the user's current play/pause state while
      // publishing the exact offset to the shared room.
      player.seek(t, { play: playing });
    },
    [player, playing],
  );

  // Stable identity so ProgressBar effects don't re-fire every render.
  const setSeekingStable = useCallback(
    (v: boolean) => {
      player.setSeeking(v);
    },
    [player],
  );

  useEffect(() => {
    document.body.classList.toggle('has-player', visible);
    return () => document.body.classList.remove('has-player');
  }, [visible]);

  // Escape closes expanded views
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && expand !== 'mini') player.setExpand('mini');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expand, player]);

  // FLIP the whole player shell across mini → sheet → full so the container
  // feels like one continuous Apple Music surface instead of three layouts.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!visible || !panel) {
      panelRect.current = null;
      previousExpand.current = expand;
      return;
    }
    if (previousExpand.current === expand) {
      panelRect.current = panel.getBoundingClientRect();
      return;
    }
    if (flipFrame.current) cancelAnimationFrame(flipFrame.current);
    if (flipTimer.current) window.clearTimeout(flipTimer.current);

    panel.style.transition = 'none';
    panel.style.transform = '';
    const next = panel.getBoundingClientRect();
    const prev = panelRect.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prev && next.width > 0 && next.height > 0 && !reduced) {
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      const sx = prev.width / next.width;
      const sy = prev.height / next.height;
      panel.style.transformOrigin = '0 0';
      panel.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      flipFrame.current = requestAnimationFrame(() => {
        panel.style.transition =
          'transform 620ms cubic-bezier(.22,1,.36,1), border-radius 620ms cubic-bezier(.22,1,.36,1), background 260ms ease, box-shadow 260ms ease';
        panel.style.transform = 'translate(0px, 0px) scale(1, 1)';
      });
      flipTimer.current = window.setTimeout(() => {
        panel.style.transition = '';
        panel.style.transform = '';
        panel.style.transformOrigin = '';
        flipFrame.current = 0;
        flipTimer.current = 0;
      }, 700);
    } else {
      panel.style.transition = '';
    }
    panelRect.current = next;
    previousExpand.current = expand;
  }, [expand, visible]);

  if (!visible || !track) return null;

  const shellClass = [
    'yp-shell',
    `yp-expand-${expand}`,
    isMobile ? 'yp-mobile' : 'yp-desktop',
  ].join(' ');

  const openSheet = () => player.setExpand(isMobile ? 'full' : 'sheet');
  const openFull = () => player.setExpand('full');

  const sideTabs: { id: SideTab; label: string; icon: React.ReactNode }[] = [
    { id: 'lyrics', label: '歌词', icon: null },
    { id: 'queue', label: '列表', icon: null },
    { id: 'search', label: '搜索', icon: <Search size={13} strokeWidth={2} /> },
    {
      id: 'party',
      label: party ? `一起听 ${Array.isArray(party.members) ? party.members.length : 0}` : '一起听',
      icon: <Users size={13} strokeWidth={2} />,
    },
  ];

  return (
    <div className={shellClass} data-player-shell>
      <button
        type="button"
        className={`yp-backdrop${expand === 'mini' ? ' is-hidden' : ''}`}
        aria-label="收起播放器"
        tabIndex={expand === 'mini' ? -1 : 0}
        onClick={() => player.setExpand('mini')}
      />

      <div
        ref={panelRef}
        className="yp-panel"
        role="region"
        aria-label="正在播放"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {track?.coverUrl ? (
          <div className="yp-wallpaper" aria-hidden>
            <img src={track.coverUrl} alt="" />
            <div className="yp-wallpaper-veil" />
          </div>
        ) : null}

        {/* grabber for mobile sheet */}
        {isMobile && expand !== 'mini' && (
          <div className="yp-grabber" aria-hidden>
            <span />
          </div>
        )}

        {/* ── Mini / chrome bar (always) ── */}
        <div
          className="yp-chrome"
          onClick={(e) => {
            // Only expand when tapping non-controls in mini mode
            if (expand !== 'mini') return;
            const el = e.target as HTMLElement;
            if (el.closest('button, a, input, [role="slider"]')) return;
            openSheet();
          }}
        >
          {expand === 'mini' ? (
            <ArtBlock track={track} />
          ) : (
            <button
              type="button"
              className="yp-icon-btn"
              aria-label="收起"
              onClick={() => player.setExpand('mini')}
            >
              <ChevronDown size={22} strokeWidth={2} />
            </button>
          )}
          <div className="yp-meta">
            <div className="yp-title">
              <MarqueeText text={track.title} />
            </div>
            {track.artist || track.cnTitle ? (
              <span className="yp-now-sub yp-artist-links">
                <ArtistLinks value={track.artist || track.cnTitle} onPick={(n) => searchArtist(n)} />
              </span>
            ) : null}
          </div>
        </div>

        {/* ── Expanded body ── */}
        {expand !== 'mini' && (
          <div className="yp-now">
            {/* left: art + transport (desktop full / mobile sheet) */}
            <div className="yp-now-main">
              <ArtBlock key={artworkKey} track={track} large />
              <div className="yp-now-meta">
                <MarqueeText className="yp-now-title" text={track.title} />
                {track.artist || track.cnTitle ? (
                  <span className="yp-now-sub yp-artist-links">
                    <ArtistLinks value={track.artist || track.cnTitle} onPick={(n) => searchArtist(n)} />
                  </span>
                ) : null}
              </div>

              <div className="yp-progress-wrap">
                <ProgressBar
                  key={track.id}
                  currentTime={currentTime}
                  duration={duration}
                  trackId={track.id}
                  onSeek={seek}
                  onSeeking={setSeekingStable}
                />
              </div>

              <div className="yp-transport">
                <button
                  type="button"
                  className={`yp-icon-btn yp-like-btn${liked ? ' is-liked' : ''}`}
                  aria-label={liked ? '取消喜欢' : '喜欢'}
                  aria-pressed={liked}
                  onClick={() => player.toggleLike()}
                >
                  <Heart size={22} strokeWidth={liked ? 0 : 1.75} fill={liked ? 'currentColor' : 'none'} />
                </button>
                <button type="button" className="yp-icon-btn yp-transport-btn" aria-label="上一首" onClick={() => player.prev()}>
                  <SkipBack size={26} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="yp-play-btn yp-play-lg"
                  aria-label={playing ? '暂停' : '播放'}
                  onClick={() => player.toggle()}
                >
                  {playing ? <Pause size={28} strokeWidth={2} /> : <Play size={28} strokeWidth={2} />}
                </button>
                <button type="button" className="yp-icon-btn yp-transport-btn" aria-label="下一首" onClick={() => player.next()}>
                  <SkipForward size={26} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="yp-icon-btn yp-mode-btn"
                  aria-label={playModeLabel(playMode)}
                  title={playModeLabel(playMode)}
                  onClick={() => player.cyclePlayMode()}
                >
                  {playModeIcon(playMode)}
                </button>
              </div>

              {!isMobile && (
                <div className="yp-now-actions">
                  <button
                    type="button"
                    className="yp-text-btn"
                    onClick={() => player.setExpand(expand === 'full' ? 'sheet' : 'full')}
                  >
                    {expand === 'full' ? (
                      <>
                        <Minimize2 size={16} strokeWidth={2} /> 退出全屏
                      </>
                    ) : (
                      <>
                        <Maximize2 size={16} strokeWidth={2} /> 全屏
                      </>
                    )}
                  </button>
                  <button type="button" className="yp-text-btn" onClick={() => player.setExpand('mini')}>
                    <X size={16} strokeWidth={2} /> 收起
                  </button>
                </div>
              )}
            </div>

            {/* right / bottom: tabbed lyrics · queue · search · party */}
            <div className="yp-now-side">
              <div className="yp-side-tabs" role="tablist" aria-label="侧栏">
                {sideTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={sideTab === tab.id}
                    className={sideTab === tab.id ? 'is-active' : ''}
                    onClick={() => setSideTab(tab.id)}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="yp-side-body">
                {sideTab === 'lyrics' && (
                  <LyricsPane
                    key={track.id}
                    lyrics={lyrics}
                    currentTime={currentTime}
                    loading={lyricsLoading}
                    onSeek={(t) => seek(t)}
                    track={track}
                    playing={playing}
                  />
                )}
                {sideTab === 'queue' && (
                  <QueueList
                    queue={queue}
                    currentId={track.id}
                    onPick={(id) => {
                      const col = player.collection()?.id;
                      player.playTrack(id, col ?? undefined);
                    }}
                  />
                )}
                {sideTab === 'search' && <SearchPanel />}
                {sideTab === 'party' && <PartyPanel />}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function usePlayerActions() {
  const player = getPlayer();
  useEffect(() => {
    void player.init();
  }, [player]);
  return player;
}
