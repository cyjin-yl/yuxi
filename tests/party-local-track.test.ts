import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

it('a guest keeps original audio for room tracks, queue entries and local likes', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) });
  class AudioStub {
    src = ''; preload = ''; volume = 1; duration = 180; currentTime = 0; readyState = 4;
    seekable = { length: 1, start: () => 0, end: () => 180 };
    constructor(src = '') { this.src = src; }
    addEventListener() {} removeEventListener() {} load() {} pause() {}
    async play() {}
    getAttribute() { return this.src; }
    removeAttribute() { this.src = ''; }
    fastSeek(value: number) { this.currentTime = value; }
  }
  vi.stubGlobal('Audio', AudioStub);
  const first = { id: 'classic-01', title: 'Original one', artist: 'Artist', source: 'local', audioUrl: '/audio/01_original.m4a' };
  const next = { id: 'classic-02', title: 'Original two', artist: 'Artist', source: 'local', audioUrl: '/audio/02_original.m4a' };
  const catalog = { version: 1, collections: [], tracks: { [first.id]: first, [next.id]: next } };
  const room = {
    code: 'ABCD', name: 'Original recordings', hostId: 'host', createdAt: Date.now(), updatedAt: Date.now(),
    state: { mode: 'idle', track: { id: first.id, title: first.title, artist: first.artist }, startedAt: 0, offset: 0, serverAt: Date.now(), hostAt: Date.now() },
    queue: [{ id: next.id, title: next.title, artist: next.artist }], queueAt: Date.now(), members: [], chat: [],
  };
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requests.push(url);
    return new Response(JSON.stringify(url === '/player-catalog.json' ? catalog : room));
  }));
  const { getPlayer } = await import('../src/lib/player/store');
  const player = getPlayer();
  await player.init();
  try {
    await player.joinParty('ABCD');
    expect(player.getSnapshot().track?.audioUrl).toBe(first.audioUrl);
    expect(player.getSnapshot().track?.source).toBe('local');
    expect(player.getCatalog()?.tracks[next.id].audioUrl).toBe(next.audioUrl);
    expect(requests.some((url) => url.includes('/netease/lyrics/classic-'))).toBe(false);
    player.toggleLike();
    await player.leaveParty();
    player.playLikedCollection();
    expect(player.getSnapshot().track?.audioUrl).toBe(first.audioUrl);
    expect(player.getSnapshot().track?.source).toBe('local');
  } finally {
    await player.leaveParty();
  }
});
