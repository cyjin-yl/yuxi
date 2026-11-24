import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoom } from '../src/lib/player/party';

const room = { code: 'ABC123', name: 'Test', state: {}, members: [], queue: [], chat: [] };

describe('party browser session reconciliation', () => {
  beforeEach(() => {
    const values = new Map([['yuxi-party-id', 'old-id']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reuses the authenticated actor when only localStorage was cleared', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'actor_identity_conflict', actorId: 'bound-id' }), { status: 409 })).mockResolvedValueOnce(new Response(JSON.stringify(room)));
    vi.stubGlobal('fetch', fetch);
    expect((await createRoom('Test')).code).toBe('ABC123');
    expect(JSON.parse(fetch.mock.calls[0][1].body).id).toBe('old-id');
    expect(JSON.parse(fetch.mock.calls[1][1].body).id).toBe('bound-id');
  });

  it('creates a fresh identity when the cookie is gone without reclaiming the old one', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'actor_identity_conflict' }), { status: 409 })).mockResolvedValueOnce(new Response(JSON.stringify(room)));
    vi.stubGlobal('fetch', fetch);
    await createRoom('Test');
    expect(JSON.parse(fetch.mock.calls[1][1].body).id).not.toBe('old-id');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not loop or replay arbitrary failures', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: 'actor_identity_conflict' }), { status: 409 })));
    vi.stubGlobal('fetch', fetch);
    await expect(createRoom('Test')).rejects.toThrow('party_409');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
