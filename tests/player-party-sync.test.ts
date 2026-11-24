import { afterEach, expect, it, vi } from 'vitest';

let currentPlayer: { leaveParty(): Promise<void> } | undefined;
afterEach(async () => {
  await currentPlayer?.leaveParty();
  currentPlayer = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function fixture() {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('__yuxiPlayer', undefined);
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  const audio: AudioStub[] = [];
  class AudioStub {
    src = ''; preload = ''; volume = 1; duration = 180; currentTime = 0; readyState = 4;
    seekable = { length: 1, start: () => 0, end: () => 180 };
    constructor(src = '') { this.src = src; audio.push(this); }
    addEventListener() {} removeEventListener() {} load() {} pause() {}
    async play() {}
    getAttribute() { return this.src; }
    removeAttribute() { this.src = ''; }
    fastSeek(value: number) { this.currentTime = value; }
  }
  vi.stubGlobal('Audio', AudioStub);
  const first = { id: 'classic-01', title: 'First song', artist: 'Artist', source: 'local', audioUrl: '/audio/first.m4a' };
  const second = { id: 'classic-02', title: 'Second song', artist: 'Artist', source: 'local', audioUrl: '/audio/second.m4a' };
  const state = {
    heartbeatStatus: 200, heartbeats: 0, leaves: 0,
    room: {
      code: 'ABCD', name: 'Room', hostId: 'host', createdAt: Date.now(), updatedAt: Date.now(),
      state: { mode: 'idle', track: first, startedAt: 0, offset: 0, serverAt: Date.now(), hostAt: Date.now() },
      queue: [second], queueAt: Date.now(), members: [
        { id: 'host', name: 'Host', joinedAt: Date.now(), lastSeen: Date.now() },
        { id: 'guest', name: 'Guest', joinedAt: Date.now(), lastSeen: Date.now() },
      ], chat: [],
    },
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/player-catalog.json') return Response.json({ version: 1, collections: [], tracks: { [first.id]: first, [second.id]: second } });
    if (url.endsWith('/heartbeat')) {
      state.heartbeats++;
      if (state.heartbeatStatus !== 200) return Response.json({ error: 'room_not_found' }, { status: state.heartbeatStatus });
    }
    if (url.endsWith('/leave')) state.leaves++;
    return Response.json(state.room);
  }));
  const { getPlayer } = await import('../src/lib/player/store');
  const player = getPlayer();
  currentPlayer = player;
  await player.init();
  await player.joinParty('ABCD');
  await vi.advanceTimersByTimeAsync(0);
  return { player, state, audio, first, second };
}

it('leaves a missing room once and stops heartbeats', async () => {
  const { player, state } = await fixture();
  state.heartbeatStatus = 404;
  await vi.advanceTimersByTimeAsync(2500);
  expect(player.getSnapshot().party).toBeNull();
  expect(state.leaves).toBe(1);
  const heartbeats = state.heartbeats;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(state.heartbeats).toBe(heartbeats);
});

it('keeps the room through a transient failure and resumes polling', async () => {
  const { player, state } = await fixture();
  state.heartbeatStatus = 502;
  await vi.advanceTimersByTimeAsync(2500);
  expect(player.getSnapshot().party?.code).toBe('ABCD');
  expect(state.leaves).toBe(0);
  const heartbeats = state.heartbeats;
  state.heartbeatStatus = 200;
  await vi.advanceTimersByTimeAsync(2500);
  expect(state.heartbeats).toBe(heartbeats + 1);
  expect(player.getSnapshot().party?.code).toBe('ABCD');
});

it('rebinds audio after a chat response advances the room track before a heartbeat', async () => {
  const { player, state, audio, first, second } = await fixture();
  expect(audio[0].src).toBe(first.audioUrl);
  state.room.state.track = second;
  state.room.state.serverAt++;
  state.room.queueAt++;
  state.room.queue = [];
  await player.sendPartyChat('下一首');
  expect(player.getSnapshot().trackId).toBe(second.id);
  expect(audio[0].src).toBe(first.audioUrl);
  await vi.advanceTimersByTimeAsync(2500);
  expect(audio[0].src).toBe(second.audioUrl);
  expect(player.getSnapshot().trackId).toBe(second.id);
});

it('removes departed members from a fresh snapshot and ignores an older membership snapshot', async () => {
  const { player, state } = await fixture();
  const original = [...state.room.members];
  state.room.updatedAt++;
  state.room.members = original.slice(0, 1);
  await player.sendPartyChat('现在只有房主');
  expect(player.getSnapshot().party?.members.map((member) => member.id)).toEqual(['host']);
  state.room.updatedAt -= 2;
  state.room.members = original;
  await player.sendPartyChat('迟到的旧快照');
  expect(player.getSnapshot().party?.members.map((member) => member.id)).toEqual(['host']);
});

it('keeps a newer play state when a pause response has the same playback anchor', async () => {
  const { player, state } = await fixture();
  state.room.state.mode = 'playing';
  state.room.state.serverAt++;
  const latestStamp = state.room.state.serverAt;
  const anchor = state.room.state.hostAt;
  await vi.advanceTimersByTimeAsync(2500);
  expect(player.getSnapshot().party?.state.mode).toBe('playing');
  state.room.state.mode = 'idle';
  state.room.state.serverAt--;
  await vi.advanceTimersByTimeAsync(2500);
  expect(player.getSnapshot().party?.state).toMatchObject({ mode: 'playing', serverAt: latestStamp, hostAt: anchor });
  expect(player.getSnapshot().playing).toBe(true);
});
