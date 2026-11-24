import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackend } from '../server/index.mjs';

const TRACK = { id: '255249', title: 'A track', artist: 'An artist', duration: 200 };
const ORIGIN = 'http://localhost';
const KEY = Buffer.alloc(32, 29);

async function fixture(t, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'yuxi-backend-'));
  const opts = { dbPath: join(dir, 'state.sqlite'), audioDir: join(dir, 'audio'), publicOrigin: ORIGIN, sessionKey: KEY, rateLimit: false, ...extra };
  let app = createBackend(opts);
  let base = await app.listen(0);
  const clients = [];
  const f = {
    dir, opts, get app() { return app; }, get base() { return base; },
    client(id = `actor-${clients.length}`) {
      const client = {
        id, cookie: '',
        async call(path, body, init = {}) {
          const headers = { ...(client.cookie ? { cookie: client.cookie } : {}), ...init.headers };
          const method = init.method ?? (body === undefined ? 'GET' : 'POST');
          if (body !== undefined) headers['content-type'] = 'application/json';
          const res = await fetch(`${base}${path}`, { ...init, method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
          if (res.headers.get('set-cookie')) client.cookie = res.headers.get('set-cookie').split(';')[0];
          return res;
        },
        async party(path, fields = {}) {
          return client.call(`/netease/party${path}`, { id: client.id, name: client.id, ...fields });
        },
      };
      clients.push(client);
      return client;
    },
    async restart() { await app.close(); app = createBackend(opts); base = await app.listen(0); },
  };
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  return f;
}

test('real HTTP room lifecycle commits immediately and survives backend restart', async (t) => {
  let now = 1_800_000_000_000;
  const f = await fixture(t, { now: () => now });
  const host = f.client('host');
  const guest = f.client('guest');
  let res = await host.party('/create', { roomName: '音乐房间', track: TRACK, playing: true, offset: 12, queue: [{ ...TRACK, id: 'other' }] });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const created = await res.json();
  const code = created.code;
  assert.match(code, /^[A-Z2-9]{4}$/);
  assert.equal(created.name, '音乐房间');
  assert.equal(created.hostId, 'host');
  assert.equal(created.state.offset, 12);
  assert.deepEqual(created.queue.map((item) => item.id), ['other']);
  assert.equal(f.app.store.getRoom(code).state.offset, 12, 'HTTP completion must follow SQLite commit');

  const joined = await (await guest.party(`/${code}/join`)).json();
  assert.equal(joined.members.length, 2);
  assert.equal(joined.chat.at(-1).text, '加入了房间');
  const duplicateJoin = await (await guest.party(`/${code}/join`)).json();
  assert.equal(duplicateJoin.chat.length, joined.chat.length, 'retrying a join is idempotent');
  now += 5000;
  const heartbeat = await (await guest.party(`/${code}/heartbeat`)).json();
  assert.deepEqual(heartbeat.state, created.state, 'presence does not replace playback state');
  const paused = await (await host.party(`/${code}/pause`)).json();
  assert.equal(paused.state.mode, 'idle');
  assert.equal(paused.state.offset, 17);
  await guest.party(`/${code}/chat`, { text: 'hello' });
  const ownList = await (await host.call('/netease/party?id=some-other-id')).json();
  assert.equal(ownList.rooms[0].host, true, 'host flag comes from verified browser session');
  const guestList = await (await guest.call('/netease/party?id=host')).json();
  assert.equal(guestList.rooms[0].host, false, 'untrusted query ID cannot impersonate host');
  await f.restart();
  const recovered = await (await guest.call(`/netease/party/${code}`)).json();
  assert.equal(recovered.state.offset, 17);
  assert.equal(recovered.chat.at(-1).text, 'hello');
  assert.equal((await host.party(`/${code}/heartbeat`)).status, 200, 'session binding survives restart');
  await guest.party(`/${code}/leave`);
  await host.party(`/${code}/leave`);
  assert.deepEqual(await (await host.call('/netease/party')).json(), { rooms: [] });
  now += 60_001;
  f.app.store.sweep();
  assert.equal((await host.call(`/netease/party/${code}`)).status, 404);
});

test('room code collision never overwrites a room and concurrent changes are not lost', async (t) => {
  let generated = 0;
  const f = await fixture(t, { codeGenerator: () => ['ABCD', 'ABCD', 'EFGH'][Math.min(generated++, 2)] });
  const one = f.client('one');
  const two = f.client('two');
  const first = await (await one.party('/create', { roomName: 'First' })).json();
  const second = await (await two.party('/create', { roomName: 'Second' })).json();
  assert.equal(first.code, 'ABCD');
  assert.equal(second.code, 'EFGH');
  assert.equal((await (await one.call('/netease/party/ABCD')).json()).name, 'First');
  await two.party('/ABCD/join');
  const replies = await Promise.all(Array.from({ length: 25 }, (_, i) => (i % 2 ? one : two).party('/ABCD/chat', { text: `message-${i}` })));
  assert.ok(replies.every((res) => res.status === 200));
  for (const res of replies) await res.arrayBuffer();
  const room = await (await one.call('/netease/party/ABCD')).json();
  assert.equal(new Set(room.chat.filter((item) => item.text.startsWith('message-')).map((item) => item.text)).size, 25);
  const queued = await Promise.all(Array.from({ length: 16 }, (_, i) => one.party('/ABCD/queue', { track: { ...TRACK, id: `q-${i}` } })));
  for (const res of queued) assert.equal(res.status, 200);
  const after = await (await one.party('/ABCD/reorder', { order: ['q-3', 'q-2'] })).json();
  assert.equal(after.queue.length, 16, 'partial stale reorder preserves later additions');
  assert.deepEqual(after.queue.slice(0, 2).map((item) => item.id), ['q-3', 'q-2']);
  await one.party('/ABCD/play', { track: { ...TRACK, id: 'q-3' } });
  const playing = await (await one.party('/ABCD/reorder', { order: [] })).json();
  assert.equal(playing.queue.length, 15);
  assert.ok(!playing.queue.some((item) => item.id === 'q-3'));
});

test('client identity, request limits and internal maintenance routes have enforceable boundaries', async (t) => {
  const f = await fixture(t);
  const host = f.client('host-id');
  const attacker = f.client('attacker');
  const code = (await (await host.party('/create')).json()).code;
  const forged = await attacker.party(`/${code}/join`, { id: 'host-id' });
  assert.equal(forged.status, 409);
  assert.equal((await forged.json()).error, 'actor_identity_conflict');
  assert.equal((await attacker.party(`/${code}/pause`)).status, 403);
  assert.equal((await attacker.party(`/${code}/join`)).status, 200);
  assert.equal((await attacker.party(`/${code}/pause`)).status, 200, 'joined members can still control shared playback');
  const mismatch = await host.party(`/${code}/heartbeat`, { id: 'lost-localstorage' });
  assert.deepEqual(await mismatch.json(), { error: 'actor_identity_conflict', actorId: 'host-id' });
  const maintenance = await host.call(`/netease/party/${code}/__deleteIfEmpty?force=true`, {});
  assert.equal(maintenance.status, 404);
  assert.equal((await host.call(`/netease/party/${code}`)).status, 200);
  assert.equal((await host.call(`/netease/party/${code}/leave`)).status, 405);
  assert.equal((await host.call(`/netease/party/${code}/chat`, { id: host.id, text: 'CSRF' }, { headers: { origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await host.call(`/netease/party/${code}/chat`, { id: host.id, text: '' })).status, 400);
  const malformed = await fetch(`${f.base}/netease/party/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const huge = await host.call('/netease/party/create', { id: 'large', padding: 'a'.repeat(512 * 1024) });
  assert.equal(huge.status, 413);
  const wrongType = await fetch(`${f.base}/netease/party/create`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(wrongType.status, 415);
  assert.equal((await host.call(`/netease/party/ZZZZ/chat`, { id: host.id, text: 'absent' })).status, 404);
});

test('discovery reflects live membership after timeout without stale registry rows', async (t) => {
  let now = 1_800_000_000_000;
  const f = await fixture(t, { now: () => now });
  const host = f.client('h');
  const code = (await (await host.party('/create')).json()).code;
  now += 120_001;
  assert.deepEqual(await (await host.call('/netease/party')).json(), { rooms: [] });
  assert.deepEqual((await (await host.call(`/netease/party/${code}`)).json()).members, []);
  assert.equal((await (await host.party(`/${code}/heartbeat`)).json()).members.length, 1);
  assert.equal((await (await host.call('/netease/party')).json()).rooms.length, 1);
});

test('NetEase login is per-browser, QR ownership is checked, cookies are encrypted and never returned', async (t) => {
  let keyNumber = 0;
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/unikey')) return Response.json({ code: 200, unikey: `qr-${++keyNumber}` });
    if (url.pathname.endsWith('/client/login')) {
      const key = new URLSearchParams(init.body).get('key');
      return Response.json({ code: 803, cookie: `MUSIC_U=private-${key}; Path=/;` });
    }
    if (url.pathname.endsWith('/account/get')) {
      const cookie = new Headers(init.headers).get('cookie');
      return Response.json({ code: 200, profile: { userId: cookie.includes('qr-1') ? 101 : 102, nickname: cookie.includes('qr-1') ? 'Alice' : 'Bob' }, cookie: 'should-never-leak' });
    }
    if (url.pathname.endsWith('/user/playlist')) return Response.json({ code: 200, playlist: [{ id: 123, name: 'Private playlist', trackCount: 1 }], token: 'do-not-return' });
    throw new Error('unexpected upstream route');
  };
  const f = await fixture(t, { fetchImpl, qrEncoder: async () => '<svg/>', importToken: 'an-import-token-with-at-least-24-characters' });
  const alice = f.client('alice');
  const bob = f.client('bob');
  const aQr = await (await alice.call('/netease/auth/qr/create', {})).json();
  assert.match(aQr.qrImg, /^data:image\/svg\+xml/);
  assert.equal((await bob.call('/netease/auth/qr/check', { key: aQr.key })).status, 403);
  const login = await (await alice.call('/netease/auth/qr/check', { key: aQr.key })).json();
  assert.equal(login.authenticated, true);
  assert.equal(login.scope, 'browser');
  assert.equal(login.profile.nickname, 'Alice');
  assert.ok(!JSON.stringify(login).includes('private-'));
  assert.deepEqual(await (await bob.call('/netease/auth/status')).json(), { authenticated: false, profile: null, scope: 'browser' });
  assert.equal((await bob.call('/netease/playlists/mine')).status, 401);
  const bQr = await (await bob.call('/netease/auth/qr/create', {})).json();
  await bob.call('/netease/auth/qr/check', { key: bQr.key });
  assert.equal((await (await alice.call('/netease/auth/status')).json()).profile.nickname, 'Alice');
  assert.equal((await (await bob.call('/netease/auth/status')).json()).profile.nickname, 'Bob');
  const stored = f.app.store.db.prepare('SELECT cookie FROM sessions WHERE cookie IS NOT NULL').all();
  assert.equal(stored.length, 2);
  assert.ok(stored.every((row) => !row.cookie.includes('MUSIC_U') && !row.cookie.includes('private-')));
  assert.equal((await bob.call('/netease/auth/import', { cookie: 'MUSIC_U=foo' })).status, 401);
  const playlists = await (await alice.call('/netease/playlists/mine')).json();
  assert.equal(playlists.playlists[0].id, '123');
  assert.ok(!JSON.stringify(playlists).includes('do-not-return'));
  await f.restart();
  assert.equal((await (await alice.call('/netease/auth/status')).json()).profile.nickname, 'Alice');
  await alice.call('/netease/auth/logout', {});
  assert.equal((await (await alice.call('/netease/auth/status')).json()).authenticated, false);
  assert.equal((await (await bob.call('/netease/auth/status')).json()).authenticated, true);
});

test('local audio serves correct Range, suffix, HEAD, conditional and unsatisfiable responses', async (t) => {
  const f = await fixture(t, { fetchImpl: async () => { throw new Error('local audio must not go upstream'); } });
  await mkdir(f.opts.audioDir);
  await writeFile(join(f.opts.audioDir, 'sample.m4a'), '0123456789abcdef');
  const client = f.client();
  const partial = await client.call('/audio/sample.m4a', undefined, { headers: { range: 'bytes=2-5' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 2-5/16');
  assert.equal(partial.headers.get('content-length'), '4');
  assert.equal(await partial.text(), '2345');
  const etag = partial.headers.get('etag');
  const suffix = await client.call('/audio/sample.m4a', undefined, { headers: { range: 'bytes=-3' } });
  assert.equal(await suffix.text(), 'def');
  const head = await client.call('/audio/sample.m4a', undefined, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '16');
  assert.equal(await head.text(), '');
  const bad = await client.call('/audio/sample.m4a', undefined, { headers: { range: 'bytes=99-' } });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get('content-range'), 'bytes */16');
  const unchanged = await client.call('/audio/sample.m4a', undefined, { headers: { 'if-none-match': etag } });
  assert.equal(unchanged.status, 304);
  const staleRange = await client.call('/audio/sample.m4a', undefined, { headers: { range: 'bytes=2-5', 'if-range': '"old"' } });
  assert.equal(staleRange.status, 200);
  assert.equal((await staleRange.text()).length, 16);
  assert.equal((await client.call('/audio/..%2Fsecret.m4a')).status, 404);
});

test('media proxy forwards byte ranges, streams 206 and rejects upstream SSRF URLs', async (t) => {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url: url.href, headers: new Headers(init.headers) });
    if (url.hostname === 'github.com') return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/release/sample.m4a' } });
    if (url.pathname.endsWith('/api/song/enhance/player/url/v1')) {
      const id = new URLSearchParams(init.body).get('ids');
      return Response.json({ data: [{ url: id === '[20]' ? 'http://127.0.0.1/private' : 'http://m7.music.126.net/audio.mp3' }] });
    }
    return new Response('abcd', { status: 206, headers: { 'content-range': 'bytes 0-3/200', 'content-length': '4', 'accept-ranges': 'bytes', 'set-cookie': 'upstream=not-public' } });
  };
  const f = await fixture(t, { fetchImpl });
  const client = f.client();
  const release = await client.call('/audio/missing.m4a', undefined, { headers: { range: 'bytes=0-3' } });
  assert.equal(release.status, 206);
  assert.equal(await release.text(), 'abcd');
  assert.equal(release.headers.get('content-range'), 'bytes 0-3/200');
  assert.equal(release.headers.get('set-cookie'), null);
  assert.equal(calls.at(-1).headers.get('range'), 'bytes=0-3');
  const song = await client.call('/netease/audio/10', undefined, { headers: { range: 'bytes=0-3' } });
  assert.equal(song.status, 206);
  assert.equal(song.headers.get('cache-control'), 'private, no-store');
  assert.equal(await song.text(), 'abcd');
  assert.match(calls.at(-1).url, /^https:\/\/m7\.music\.126\.net/);
  const blocked = await client.call('/netease/audio/20');
  assert.equal(blocked.status, 502);
  assert.equal((await blocked.json()).error, 'invalid_media_origin');
  assert.ok(calls.every((call) => !call.url.includes('127.0.0.1')));
});

test('rate limits stop room creation without deleting existing state', async (t) => {
  const f = await fixture(t, { rateLimit: true });
  const client = f.client('limited');
  for (let i = 0; i < 10; i++) assert.equal((await client.party('/create')).status, 200);
  const limited = await client.party('/create');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await (await client.call('/netease/party')).json()).rooms.length, 10);
});
