/** Shared types for collection-based media player */

export type CollectionKind = 'music' | 'podcast' | 'audiobook' | string;

export interface PlayerTrack {
  id: string;
  num?: string;
  title: string;
  cnTitle?: string;
  audioUrl: string;
  wordsUrl?: string;
  srtUrl?: string;
  lrcUrl?: string;
  href?: string;
  artist?: string;
  coverUrl?: string;
  /** Where the track comes from: local static assets or the NetEase proxy. */
  source?: 'local' | 'netease';
  /** Duration in seconds, when known (NetEase provides it). */
  duration?: number;
}

export interface PlayerCollection {
  id: string;
  title: string;
  titleZh?: string;
  description?: string;
  coverUrl?: string;
  kind: CollectionKind;
  trackIds: string[];
}

export interface PlayerCatalog {
  version: number;
  collections: PlayerCollection[];
  tracks: Record<string, PlayerTrack>;
}

export interface LyricLine {
  start: number;
  end: number;
  en: string;
  cn: string;
  words: { text: string; start: number | null; end: number | null; space: boolean }[];
}

export type PlayMode = 'sequence' | 'repeat-one' | 'repeat-all' | 'stop' | 'shuffle';

export interface PlayerSnapshot {
  collectionId: string | null;
  trackId: string | null;
  queue: string[];
  index: number;
  currentTime: number;
  duration: number;
  playing: boolean;
  expand: PlayerExpand;
  playMode: PlayMode;
  volume: number;
}
