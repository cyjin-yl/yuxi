import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('concurrent first-click and React mount share one audio engine and catalog request', async () => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  const audio = vi.fn(function () { return { addEventListener() {}, volume: 1, preload: '' }; });
  vi.stubGlobal('Audio', audio);
  let respond!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const { getPlayer } = await import('../src/lib/player/store');
  const player = getPlayer();
  const pending = [player.init(), player.init()];
  expect(audio).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  respond(new Response(JSON.stringify({ version: 1, collections: [], tracks: {} })));
  await Promise.all(pending);
  await player.init();
  expect(player.getSnapshot().ready).toBe(true);
  expect(audio).toHaveBeenCalledTimes(1);
});
