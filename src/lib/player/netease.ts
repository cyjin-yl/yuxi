import type { LyricLine, PlayerTrack } from './types';

/** Minimal shape of a NetEase song object used across the app. */
export interface NeteaseSong {
  id: number;
  name: string;
  ar?: { name: string }[];
  al?: { picUrl?: string };
  dt?: number;
}

/** Map a NetEase song to the player's track shape (served via the same-origin proxy). */
export function neteaseSongToTrack(song: NeteaseSong): PlayerTrack {
  return {
    id: String(song.id),
    title: song.name,
    artist: (song.ar ?? []).map((a) => a.name).join(' / '),
    coverUrl: song.al?.picUrl,
    audioUrl: `/netease/audio/${song.id}`,
    href: `/song/${song.id}/`,
    duration: typeof song.dt === 'number' && song.dt > 0 ? Math.round(song.dt / 1000) : undefined,
    source: 'netease',
  };
}

// Credits lines ("作词: …") — anchored on the role label + colon so ordinary
// English lyrics (which may contain "op"/"sp" substrings) never match.
const CREDITS_RE =
  /^\s*(作词|作曲|编曲|制作|制作人|录音|混音|母带|监制|出品|发行|吉他|贝斯|鼓|弦乐|和声|和音|工程|工作室|词|曲|词曲|OP|SP)\s*[:：]/;

function isCredits(text: string): boolean {
  const t = text.trim();
  return CREDITS_RE.test(t) || t === '纯音乐，请欣赏' || t === '暂无歌词';
}

interface Word { text: string; start: number; end: number }
interface RawLine { start: number; end: number; text: string; words: Word[] }

/**
 * Parse a NetEase lyric field. The field is hybrid: a few leading JSON credit
 * lines, then either classic LRC ("[mm:ss.mmm]text") or word-level yrc
 * ("[start,dur](wStart,wDur,0)word …"). JSON lines are skipped as credits.
 */
function parseField(text: string, wordLevel: boolean): RawLine[] {
  const out: RawLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('{')) continue;

    if (wordLevel) {
      // yrc: [lineStart,lineDur](wStart,wDur,flag)word (wStart,wDur,flag)word …
      const header = /^\[(\d+),(\d+)\]/.exec(line);
      if (!header) continue;
      const lineStart = parseInt(header[1], 10) / 1000;
      const lineDur = parseInt(header[2], 10) / 1000;
      const words: Word[] = [];
      let full = '';
      const wordRe = /\((\d+),(\d+),\d+\)([^()]*)/g;
      let m: RegExpExecArray | null;
      while ((m = wordRe.exec(line))) {
        const ws = parseInt(m[1], 10) / 1000;
        const wd = parseInt(m[2], 10) / 1000;
        const wtext = m[3];
        full += wtext;
        words.push({ text: wtext, start: ws, end: ws + Math.max(wd, 0.05) });
      }
      if (!full.trim()) continue;
      out.push({ start: lineStart, end: lineStart + Math.max(lineDur, 0.4), text: full, words });
    } else {
      // classic LRC: [mm:ss.mmm]text (possibly several timestamps per line)
      const re = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
      const stamps: number[] = [];
      let m: RegExpExecArray | null;
      let last = 0;
      while ((m = re.exec(line))) {
        stamps.push(parseInt(m[1], 10) * 60 + parseFloat(m[2]));
        last = re.lastIndex;
      }
      if (!stamps.length) continue;
      const body = line.slice(last).trim();
      if (!body) continue;
      for (const start of stamps) {
        out.push({ start, end: start + 4, text: body, words: [] });
      }
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

function parseLrcEntries(text: string): { start: number; text: string }[] {
  const entries: { start: number; text: string }[] = [];
  // A single LRC line may carry multiple timestamps: [00:01.00][00:05.00]text
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('{')) continue;
    const stamps: number[] = [];
    const re = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = re.exec(line))) {
      stamps.push(parseInt(m[1], 10) * 60 + parseFloat(m[2]));
      last = re.lastIndex;
    }
    if (!stamps.length) continue;
    const body = line.slice(last).trim();
    if (!body || isCredits(body)) continue;
    for (const start of stamps) entries.push({ start, text: body });
  }
  entries.sort((a, b) => a.start - b.start);
  return entries;
}

/**
 * Attach each original line to the closest unused translation within a
 * generous window. Discrete 0.1s key lookups miss when yrc (ms) and tlyric
 * (mm:ss.xx) drift by a few hundred ms — common on NetEase 逐字 tracks.
 */
function matchTranslations(
  lines: RawLine[],
  translations: { start: number; text: string }[],
): Map<number, string> {
  const out = new Map<number, string>();
  if (!translations.length) return out;
  const used = new Array(translations.length).fill(false);
  const WINDOW = 2.5; // seconds

  for (const line of lines) {
    if (isCredits(line.text)) continue;
    let best = -1;
    let bestDist = WINDOW + 1;
    for (let i = 0; i < translations.length; i++) {
      if (used[i]) continue;
      const d = Math.abs(translations[i].start - line.start);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0 && bestDist <= WINDOW) {
      used[best] = true;
      out.set(line.start, translations[best].text);
    }
  }
  return out;
}

function toLyricLines(lines: RawLine[], cnByStart: Map<number, string>): LyricLine[] {
  const out: LyricLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCredits(line.text)) continue;
    const end = i + 1 < lines.length ? Math.min(lines[i + 1].start, line.start + 10) : line.end;
    const words: LyricLine['words'] = line.words.length
      ? line.words.map((w) => {
          const isSpace = /^\s+$/.test(w.text);
          return { text: w.text, start: isSpace ? null : w.start, end: isSpace ? null : w.end, space: isSpace };
        })
      : line.text.split(/(\s+)/).filter(Boolean).map((t) => ({ text: t, start: null, end: null, space: /^\s+$/.test(t) }));
    out.push({
      start: line.start,
      end: Math.max(end, line.start + 0.4),
      en: line.text,
      cn: cnByStart.get(line.start) ?? '',
      words,
    });
  }
  return out;
}

/**
 * Parse the /netease/lyrics/<id> payload (NetEase /api/song/lyric/v1). Prefers
 * word-level 逐字 lyrics (yrc), falls back to line-level (lrc) when yrc carries
 * only staff credits, and merges the translation (tlyric / ytlrc) onto each line.
 */
export function parseNeteaseLyrics(raw: unknown): LyricLine[] {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const field = (key: string): string => {
    const block = body[key] as { lyric?: string } | undefined;
    return typeof block?.lyric === 'string' ? block.lyric : '';
  };
  const yrcText = field('yrc');
  const lrcText = field('lrc');
  // tlyric = line-level translation; ytlrc = translated yrc (some tracks only have one).
  const tlyricText = field('tlyric') || field('ytlrc') || field('romalrc');
  const translations = tlyricText ? parseLrcEntries(tlyricText) : [];

  const yrcRaw = yrcText ? parseField(yrcText, true) : [];
  if (yrcRaw.length) {
    const cn = matchTranslations(yrcRaw, translations);
    const yrcLines = toLyricLines(yrcRaw, cn);
    if (yrcLines.length) return yrcLines;
  }
  if (lrcText) {
    const lrcRaw = parseField(lrcText, false);
    const cn = matchTranslations(lrcRaw, translations);
    const lrcLines = toLyricLines(lrcRaw, cn);
    if (lrcLines.length) return lrcLines;
  }
  return [];
}
