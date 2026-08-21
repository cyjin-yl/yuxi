import type { PlayerTrack } from './types';

const LIKES_KEY = 'yuxi-liked-tracks-v1';

export type LikedTrack = {
  id: string;
  title: string;
  artist?: string;
  coverUrl?: string;
  duration?: number;
  likedAt: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readAll(): LikedTrack[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LIKES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const row = asRecord(item);
      if (!row || typeof row.id !== 'string' || !row.id) return [];
      return [{
        id: row.id,
        title: typeof row.title === 'string' ? row.title : '未知歌曲',
        artist: typeof row.artist === 'string' ? row.artist : undefined,
        coverUrl: typeof row.coverUrl === 'string' ? row.coverUrl : undefined,
        duration: typeof row.duration === 'number' ? row.duration : undefined,
        likedAt: typeof row.likedAt === 'number' ? row.likedAt : Date.now(),
      }];
    });
  } catch {
    return [];
  }
}

function writeAll(list: LikedTrack[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LIKES_KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode */
  }
}

export function listLikedTracks(): LikedTrack[] {
  return readAll().sort((a, b) => b.likedAt - a.likedAt);
}

export function isTrackLiked(id: string | null | undefined): boolean {
  if (!id) return false;
  return readAll().some((t) => t.id === id);
}

export function toggleLikedTrack(track: PlayerTrack | null | undefined): boolean {
  if (!track?.id) return false;
  const all = readAll();
  const idx = all.findIndex((t) => t.id === track.id);
  if (idx >= 0) {
    all.splice(idx, 1);
    writeAll(all);
    return false;
  }
  all.unshift({
    id: track.id,
    title: track.title || '未知歌曲',
    artist: track.artist,
    coverUrl: track.coverUrl,
    duration: track.duration,
    likedAt: Date.now(),
  });
  writeAll(all);
  return true;
}

export function likedTracksAsPlayerTracks(): PlayerTrack[] {
  return listLikedTracks().map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    coverUrl: t.coverUrl,
    duration: t.duration,
    audioUrl: `/netease/audio/${t.id}`,
    href: `/song/${t.id}/`,
    source: 'netease' as const,
  }));
}

export const LIKED_COLLECTION_ID = 'liked-local';
