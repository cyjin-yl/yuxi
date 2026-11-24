import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createHmac, generateKeyPairSync } from 'node:crypto';
import { createBackend } from '../server/index.mjs';

const TRACK = { id: '255249', title: 'A track', artist: 'An artist', duration: 200 };
const ORIGIN = 'http://localhost';

function visitorKeyReply(init) {
  const params = new URLSearchParams(init.body);
  const headers = new Headers(init.headers);
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.match(params.get('deviceId'), /^[A-F0-9]{52}$/);
  assert.match(params.get('nonce'), /^[0-9]{16}$/);
  assert.equal(params.get('os'), 'android');
  assert.match(headers.get('user-agent'), /^NeteaseMusic\/9\.5\.61\./);
  assert.equal(headers.get('cookie'), `deviceId=${params.get('deviceId')}`);
  const signature = createHmac('sha256', 'mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g==').update(params.get('timestamp') + params.get('nonce')).digest('base64');
  assert.equal(params.get('signature'), signature);
  const { publicKey } = generateKeyPairSync('x25519');
  const state = { publicKey: Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).subarray(-32).toString('base64'), version: 1, sk: 'fixture-key' };
  const cipher = createCipheriv('aes-256-ecb', Buffer.from('ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84', 'hex'), null);
  const encryptedData = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()]).toString('base64');
  return Response.json({ code: 200, data: { timestamp: params.get('timestamp'), signature, encryptedData } });
}

async function fixture(t, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'yuxi-backend-'));
  const opts = { dbPath: join(dir, 'state.sqlite'), audioDir: join(dir, 'audio'), publicOrigin: ORIGIN, rateLimit: false, ...extra };
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

test('same-millisecond playback changes have ordered revisions and a real-time playback anchor', async (t) => {
  let now = 1_800_000_000_000;
  const f = await fixture(t, { now: () => now });
  const host = f.client('clock-host');
  const created = await (await host.party('/create', { track: TRACK, playing: true, offset: 10 })).json();
  const paused = await (await host.party(`/${created.code}/pause`, { offset: 11 })).json();
  const playing = await (await host.party(`/${created.code}/play`, { track: TRACK, offset: 12 })).json();
  assert.ok(created.state.serverAt < paused.state.serverAt);
  assert.ok(paused.state.serverAt < playing.state.serverAt, 'a delayed pause response can be identified as older than the following play');
  assert.equal(paused.state.hostAt, now);
  assert.equal(playing.state.hostAt, now);
  const latest = await (await host.call(`/netease/party/${created.code}`)).json();
  assert.deepEqual(latest.state, playing.state);
  now += 5000;
  const stopped = await (await host.party(`/${created.code}/pause`)).json();
  assert.equal(stopped.state.offset, 17, 'elapsed playback uses the wall-clock anchor rather than the revision number');
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

test('anonymous NetEase credentials are lazy, shared, refreshed and kept inside the server', async (t) => {
  let now = 1_800_000_000_000;
  let registrations = 0;
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const cookie = new Headers(init.headers).get('cookie');
    calls.push({ path: url.pathname, cookie });
    assert.ok(!cookie.includes('MUSIC_U='));
    assert.ok(!cookie.includes('browser-cookie'));
    if (url.pathname === '/api/bsr/sk/get') {
      assert.equal(url.origin, 'https://interface.music.163.com');
      return visitorKeyReply(init);
    }
    if (url.pathname === '/xeapi/register/anonimous') {
      assert.equal(url.origin, 'https://interface3.music.163.com');
      const params = new URLSearchParams(init.body);
      assert.deepEqual([...params.keys()], ['C', 'S', 'R']);
      assert.match(params.get('C'), /^[A-Za-z0-9_-]{100,}$/);
      assert.ok(Buffer.from(params.get('S'), 'base64').length > 60);
      assert.equal(new Headers(init.headers).get('x-client-enc-state'), 'ENCRYPTED');
      assert.equal(new Headers(init.headers).get('x-os'), 'android');
      registrations++;
      return Response.json({ code: 200 }, { headers: [
        ['set-cookie', `MUSIC_A=visitor-${registrations}; Max-Age=3600; Path=/; HttpOnly`],
        ['set-cookie', '__csrf=visitor-csrf; Path=/'],
        ['set-cookie', 'MUSIC_U=discard-account-cookie; Path=/'],
      ] });
    }
    assert.match(cookie, /MUSIC_A=visitor-\d+/);
    if (url.pathname === '/api/v6/playlist/detail' && url.searchParams.get('id') === '99') return Response.json({ code: 401 });
    return Response.json({ code: 200, songs: [TRACK], MUSIC_A: 'hide-visitor', nested: { cookie: 'hide-cookie', __csrf: 'hide-csrf' } });
  };
  const f = await fixture(t, { fetchImpl, now: () => now });
  const client = f.client();
  assert.equal((await client.call('/api/health')).status, 200);
  assert.equal(registrations, 0);
  const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => client.call(`/netease/song/${i + 1}`, undefined, { headers: { cookie: 'MUSIC_A=browser-cookie; MUSIC_U=browser-cookie' } })));
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.ok(!(await response.text()).includes('hide-'));
  }
  assert.equal(registrations, 1, 'concurrent requests share one anonymous registration');
  assert.equal(f.app.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  const beforeCached = calls.length;
  assert.equal((await client.call('/netease/song/1')).status, 200);
  assert.equal(calls.length, beforeCached);
  now += 31_000;
  assert.equal((await client.call('/netease/playlist/99')).status, 403);
  assert.equal((await client.call('/netease/song/99')).status, 200);
  assert.equal(registrations, 1, 'a resource permission denial preserves the valid visitor for public requests');
  now += 3_240_001;
  assert.equal((await client.call('/netease/song/100')).status, 200);
  assert.equal(registrations, 2, 'cookie expiry triggers a fresh visitor');
  await f.restart();
  assert.equal((await client.call('/netease/song/1')).status, 200);
  assert.equal(registrations, 3, 'a process restart starts a fresh anonymous session');
});

test('unavailable anonymous registration is cooled down and retired account routes stay closed', async (t) => {
  let now = 1_800_000_000_000;
  let attempts = 0;
  let keys = 0;
  const f = await fixture(t, { now: () => now, fetchImpl: async (input, init) => {
    if (new URL(input).pathname === '/api/bsr/sk/get') { keys++; return visitorKeyReply(init); }
    assert.equal(new URL(input).pathname, '/xeapi/register/anonimous');
    attempts++;
    return Response.json({ code: 200 }, { headers: { 'set-cookie': 'MUSIC_U=an-account-is-not-a-visitor; Path=/' } });
  } });
  const client = f.client();
  for (const [path, body] of [
    ['/netease/auth/qr/create', {}], ['/netease/auth/qr/check', { key: 'old-key' }],
    ['/netease/auth/import', { cookie: 'MUSIC_U=old-cookie' }], ['/netease/auth/logout', {}],
    ['/netease/auth/status'], ['/netease/playlists/mine'], ['/netease/playlist/current'],
  ]) {
    const response = await client.call(path, body);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal(attempts, 0);
  assert.equal(keys, 0);
  assert.equal((await client.call('/netease/search?q=')).status, 400);
  assert.equal((await client.call('/netease/song/0')).status, 404);
  assert.equal(attempts, 0);
  const failed = await client.call('/netease/song/1');
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'netease_visitor_unavailable' });
  assert.equal((await client.call('/netease/song/2')).status, 503);
  assert.equal(attempts, 1);
  assert.equal(keys, 1);
  assert.equal((await client.party('/create', { track: TRACK })).status, 200);
  now += 30_001;
  assert.equal((await client.call('/netease/song/3')).status, 503);
  assert.equal(attempts, 2);
  assert.equal(keys, 2);
});

test('schema migration preserves rooms and browser identity while removing account data', async (t) => {
  const f = await fixture(t);
  const host = f.client('migration-host');
  const queued = { ...TRACK, id: 'migration-queued' };
  const code = (await (await host.party('/create', { track: TRACK, queue: [queued] })).json()).code;
  await host.party(`/${code}/chat`, { text: 'Keep this room' });
  await f.app.close();
  const old = new DatabaseSync(f.opts.dbPath);
  old.exec(`
    ALTER TABLE sessions ADD COLUMN cookie TEXT;
    UPDATE sessions SET cookie = 'retired-account-ciphertext';
    CREATE TABLE qr_keys (key TEXT PRIMARY KEY, session_hash TEXT REFERENCES sessions(hash), expires_at INTEGER);
    INSERT INTO qr_keys SELECT 'retired-qr-key', hash, expires_at FROM sessions;
    PRAGMA user_version = 1;
  `);
  old.close();
  await f.restart();
  assert.equal(f.app.store.db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.ok(!f.app.store.db.prepare('PRAGMA table_info(sessions)').all().some((column) => column.name === 'cookie'));
  assert.equal(f.app.store.db.prepare("SELECT name FROM sqlite_schema WHERE name = 'qr_keys'").get(), undefined);
  const room = await (await host.party(`/${code}/heartbeat`)).json();
  assert.equal(room.hostId, host.id);
  assert.equal(room.chat.at(-1).text, 'Keep this room');
  assert.deepEqual(room.queue, [queued]);
  await f.app.close();
  const bytes = await readFile(f.opts.dbPath);
  assert.ok(!bytes.includes(Buffer.from('retired-account-ciphertext')));
  assert.ok(!bytes.includes(Buffer.from('retired-qr-key')));
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
    if (url.pathname === '/api/bsr/sk/get') return visitorKeyReply(init);
    if (url.pathname === '/xeapi/register/anonimous') return Response.json({ code: 200 }, { headers: { 'set-cookie': 'MUSIC_A=media-visitor; Path=/' } });
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
