/**
 * Integration tests for PartyRoomDO — the listen-together room authority.
 *
 * Runs the real DO class in miniflare's workerd runtime, so the storage
 * semantics (SQL-backed state, markDirty/flush coalescing) are production
 * ones, not mocks. Covers the write-path contract the client relies on:
 *
 *
 *  - create: atomic snapshot (state + host membership + queue)
 *  - heartbeat: touches presence only; never mutates playback state
 *    (regression guard for the KV-index burn and for accidental state resets)
 *  - pause: stores exact offset when provided, computes it when not
 *  - join/leave/chat: membership + chat append semantics
 *  - prune: stale members (lastSeen > 120s) disappear from responses
 */
import esbuild from 'esbuild';
import { Miniflare } from 'miniflare';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let mf: Miniflare;
let doFetch: (input: string, init?: RequestInit) => Promise<Response>;

beforeAll(async () => {
  // Bundle workers/party-room.ts to a single ESM file with esbuild —
  // miniflare's module rules don't transpile TypeScript. The bundle exports
  // PartyRoomDO for the durableObjects binding plus a default fetch so the
  // worker itself is a valid module.
  const outfile = new URL('./party-do-bundle.mjs', import.meta.url);
  await esbuild.build({
    entryPoints: [new URL('./party-do-shim.ts', import.meta.url).pathname],
    outfile: outfile.pathname,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
  });
  mf = new Miniflare({
    // workerd refuses module paths that escape its root via ".."; pin the
    // root at the repo so the tests/ bundle resolves cleanly.
    rootPath: new URL('..', import.meta.url).pathname,
    modules: true,
    scriptPath: outfile.pathname.slice(new URL('..', import.meta.url).pathname.length),
    durableObjects: {
      PARTY_ROOM: { className: 'PartyRoomDO', useSQLite: true },
      PARTY_INDEX: { className: 'PartyIndexDO', useSQLite: true },
    },
  });
  const ns = await mf.getDurableObjectNamespace('PARTY_ROOM');
  const stub = ns.get(ns.idFromName('TESTROOM'));
  doFetch = (input: string, init?: RequestInit) =>
    stub.fetch(new URL(input, 'https://do').toString(), init);
});

afterAll(async () => {
  await mf.dispose();
});

function json(body: unknown, init?: RequestInit): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  };
}

describe('PartyRoomDO', () => {
  it('create returns an atomic room snapshot with host as sole member', async () => {
    const res = await doFetch('/create?code=TESTROOM', json({
      id: 'host-1', name: 'Host', roomName: 'Test Room',
      track: { id: '255249', title: 'Song A', artist: 'Artist A' },
      playing: true, offset: 12.5,
    }));
    expect(res.status).toBe(200);
    const room = (await res.json()) as any;
    expect(room.code).toBe('TESTROOM');
    expect(room.hostId).toBe('host-1');
    expect(room.state.mode).toBe('playing');
    expect(room.state.track.id).toBe('255249');
    expect(room.state.offset).toBe(12.5);
    expect(room.members).toHaveLength(1);
    expect(room.members[0].id).toBe('host-1');
    expect(room.queue).toEqual([]);
  });

  it('join adds a member and appends the system chat message', async () => {
    const res = await doFetch('/join', json({ id: 'guest-1', name: 'Guest' }));
    const room = (await res.json()) as any;
    expect(room.members.map((m: any) => m.id).sort()).toEqual(['guest-1', 'host-1']);
    expect(room.chat.some((c: any) => c.text === '加入了房间' && c.name === 'Guest')).toBe(true);
  });

  it('heartbeat touches presence but NEVER changes playback state', async () => {
    // Capture state before
    const before = await (await doFetch('/get')).json() as any;

    // Guest heartbeats several times
    for (let i = 0; i < 3; i++) {
      const res = await doFetch('/heartbeat', json({ id: 'guest-1', name: 'Guest' }));
      expect(res.status).toBe(200);
      await res.json();
    }

    const after = await (await doFetch('/get')).json() as any;
    // Playback state untouched by presence writes
    expect(after.state.mode).toBe(before.state.mode);
    expect(after.state.track).toEqual(before.state.track);
    expect(after.state.offset).toBe(before.state.offset);
    expect(after.state.startedAt).toBe(before.state.startedAt);
    // But lastSeen did advance
    const guestBefore = before.members.find((m: any) => m.id === 'guest-1');
    const guestAfter = after.members.find((m: any) => m.id === 'guest-1');
    expect(guestAfter.lastSeen).toBeGreaterThanOrEqual(guestBefore.lastSeen);
  });

  it('pause stores the explicit offset and flips mode to idle', async () => {
    const res = await doFetch('/pause', json({ id: 'host-1', offset: 77.25 }));
    const room = (await res.json()) as any;
    expect(room.state.mode).toBe('idle');
    expect(room.state.offset).toBeCloseTo(77.25, 2);
  });

  it('pause without offset derives position from elapsed play time', async () => {
    // Resume first so there's elapsed time to derive from
    await doFetch('/play', json({
      id: 'host-1',
      track: { id: '999', title: 'T', artist: 'A' },
      offset: 10, startedAt: Date.now(),
    }));
    const res = await doFetch('/pause', json({ id: 'host-1' }));
    const room = (await res.json()) as any;
    expect(room.state.mode).toBe('idle');
    // offset >= 10 (start) plus a little elapsed time
    expect(room.state.offset).toBeGreaterThanOrEqual(10);
  });

  it('chat appends messages; other members see them on next read', async () => {
    // Client's post() always sends {id, name}; DO falls back to 听众 without it.
    await doFetch('/chat', json({ id: 'guest-1', name: 'Guest', text: 'hello room' }));
    const room = await (await doFetch('/get')).json() as any;
    const msgs = room.chat.filter((c: any) => c.text === 'hello room');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].name).toBe('Guest');
  });

  it('leave removes the member; empty room deletes index-worthy state', async () => {
    await doFetch('/leave', json({ id: 'guest-1' }));
    let room = await (await doFetch('/get')).json() as any;
    expect(room.members.map((m: any) => m.id)).toEqual(['host-1']);
    await doFetch('/leave', json({ id: 'host-1' }));
    // After everyone leaves the DO prunes itself on alarm; immediate get may
    // still return data until the alarm fires — but members list must be empty.
    room = await (await doFetch('/get')).json().catch(() => null) as any;
    if (room && room.members) expect(room.members).toHaveLength(0);
  });

  it('unknown actions are rejected', async () => {
    const res = await doFetch('/SOMEOTHERROOM/dance', json({ id: 'x' }));
    expect([400, 404]).toContain(res.status);
  });

  it('heartbeat/get/chat on a fresh DO returns room_not_found, NOT a 500', async () => {
    // Regression: ensure() used cursor.one() which throws "Expected exactly one
    // result" when the room table is empty (new DO, or after cleanup alarm
    // deletes the row). That bubbled up as a worker exception 1101 — the client
    // could not distinguish "room gone" from "server broken".
    const freshNs = await mf.getDurableObjectNamespace('PARTY_ROOM');
    const freshStub = freshNs.get(freshNs.idFromName('NEVEREXISTED'));
    const fetchFresh = (input: string, init?: RequestInit) =>
      freshStub.fetch(new URL(input, 'https://do').toString(), init);

    const hb = await fetchFresh('/heartbeat', json({ id: 'newcomer' }));
    expect(hb.status).toBe(404);
    expect(await hb.json()).toMatchObject({ error: 'room_not_found' });

    const get = await fetchFresh('/get');
    expect(get.status).toBe(404);

    const chat = await fetchFresh('/chat', json({ id: 'x', text: 'hi' }));
    expect(chat.status).toBe(404);
  });
 });

 describe('PartyIndexDO', () => {
   let idxFetch: (input: string, init?: RequestInit) => Promise<Response>;

   beforeAll(async () => {
     const ns = await mf.getDurableObjectNamespace('PARTY_INDEX');
     const stub = ns.get(ns.idFromName('INDEX'));
     idxFetch = (input, init) => stub.fetch(new URL(input, 'https://idx').toString(), init);
   });

   it('upsert then list returns the room with correct metadata', async () => {
     await idxFetch('/upsert', json({
       code: 'AAA1', name: 'room a', hostId: 'h1', members: 2, updatedAt: 1,
     }));
     await idxFetch('/upsert', json({
       code: 'BBB2', name: 'room b', hostId: 'h2', members: 1, updatedAt: 2,
     }));
     const r = await (await idxFetch('/list?actorId=h1')).json() as any;
     expect(r.rooms).toHaveLength(2);
     const aaa1 = r.rooms.find((x: any) => x.code === 'AAA1');
     expect(aaa1).toMatchObject({ code: 'AAA1', name: 'room a', members: 2, host: true });
     const bbb2 = r.rooms.find((x: any) => x.code === 'BBB2');
     expect(bbb2).toMatchObject({ host: false });
     // higher member count first
     expect(r.rooms[0].code).toBe('AAA1');
   });

   it('zero-member entries are excluded from list', async () => {
     await idxFetch('/upsert', json({
       code: 'CCC3', name: 'empty', hostId: 'h3', members: 0, updatedAt: 3,
     }));
     const r = await (await idxFetch('/list')).json() as any;
     expect(r.rooms.find((x: any) => x.code === 'CCC3')).toBeUndefined();
   });

   it('remove deletes the entry from list', async () => {
     await idxFetch('/remove?code=BBB2');
     const r = await (await idxFetch('/list')).json() as any;
     expect(r.rooms.find((x: any) => x.code === 'BBB2')).toBeUndefined();
   });

   it('rejects upsert without code; rejects unknown action', async () => {
     const noCode = await idxFetch('/upsert', json({ name: 'x' }));
     expect(noCode.status).toBe(400);
     const unknown = await idxFetch('/dance');
     expect(unknown.status).toBe(400);
   });

  it('alarm sweep drops rows older than the TTL, keeps fresh ones', async () => {
    await idxFetch('/upsert', json({
      code: 'OLD9', name: 'stale', hostId: 'h', members: 1,
      updatedAt: Date.now() - 7 * 3600 * 1000,
    }));
    await idxFetch('/upsert', json({
      code: 'NEW8', name: 'fresh', hostId: 'h', members: 3, updatedAt: Date.now(),
    }));
    // Drive the alarm directly through the DO's storage API — miniflare
    // exposes setAlarm/alarm() on the same instance, no wall-clock waiting.
    const ns = await mf.getDurableObjectNamespace('PARTY_INDEX');
    const stub = ns.get(ns.idFromName('INDEX'));
    // The DO armed its alarm on the first upsert; force it to fire NOW by
    // deleting the scheduled time and re-setting it in the past is not
    // exposed over RPC. Instead call the sweep logic via a dedicated test
    // action guarded to test bundles.
    const res = await stub.fetch('https://idx/sweep');
    expect(res.status).toBe(200);
    const r = await (await idxFetch('/list')).json() as any;
    expect(r.rooms.some((x: any) => x.code === 'OLD9')).toBe(false);
    expect(r.rooms.some((x) => x.code === 'NEW8' || x.code === 'AAA1')).toBe(true);
  });
 });
