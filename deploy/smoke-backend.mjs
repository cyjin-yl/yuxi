import assert from 'node:assert/strict';
import { mkdtemp, readdir, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Usage: node deploy/smoke-backend.mjs /release/server/index.mjs /var/lib/yuxi/audio
const [entry, audioDir] = process.argv.slice(2);
assert.ok(entry && audioDir, 'server entry and local audio directory are required');
const { createBackend } = await import(pathToFileURL(entry).href);
const temporary = await mkdtemp(join(tmpdir(), 'yvxi-backend-smoke-'));
const dbPath = join(temporary, 'smoke.sqlite');
let externalRequests = 0;
const options = {
  dbPath, audioDir, publicOrigin: 'http://127.0.0.1', rateLimit: false,
  fetchImpl: async () => { externalRequests++; throw new Error('unexpected_external_request'); },
};
let app;
let base;
const report = { healthSchema: null, closedAccountRoutes: 0, roomSync: false, migration: false, localAudio: null };

function client(id) {
  let cookie = '';
  return {
    async request(path, body, headers = {}) {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const issued = response.headers.get('set-cookie');
      if (issued) cookie = issued.split(';')[0];
      return response;
    },
    async party(path, fields = {}) {
      const response = await this.request(`/netease/party${path}`, { ...fields, id, name: id });
      assert.equal(response.status, 200, `party request failed: ${path}`);
      return response.json();
    },
  };
}

try {
  app = createBackend(options);
  base = await app.listen(0);
  const host = client('smoke-host');
  const guest = client('smoke-guest');
  const health = await (await host.request('/api/health')).json();
  assert.deepEqual(health, { status: 'ok', service: 'yuxi', storage: 'sqlite', version: 2 });
  report.healthSchema = health.version;
  for (const [path, body] of [
    ['/netease/auth/qr/create', {}], ['/netease/auth/qr/check', { key: 'smoke' }],
    ['/netease/auth/import', {}], ['/netease/auth/logout', {}], ['/netease/auth/status'],
    ['/netease/playlists/mine'], ['/netease/playlist/current'],
  ]) {
    const response = await host.request(path, body);
    assert.equal(response.status, 404, `retired route is active: ${path}`);
    assert.equal(response.headers.get('set-cookie'), null);
    await response.arrayBuffer();
    report.closedAccountRoutes++;
  }
  const track = { id: 'smoke-current', title: 'Current', artist: 'Smoke', duration: 180 };
  const queued = { ...track, id: 'smoke-next', title: 'Next' };
  const room = await host.party('/create', { roomName: 'Deployment smoke', track, playing: true, offset: 5 });
  assert.match(room.code, /^[A-Z2-9]{4}$/);
  assert.equal((await guest.party(`/${room.code}/join`)).members.length, 2);
  await guest.party(`/${room.code}/queue`, { track: queued });
  await guest.party(`/${room.code}/chat`, { text: 'smoke chat' });
  const paused = await host.party(`/${room.code}/pause`, { offset: 9 });
  const shared = await (await guest.request(`/netease/party/${room.code}`)).json();
  assert.deepEqual(shared.state, paused.state);
  assert.deepEqual(shared.queue, [queued]);
  assert.equal(shared.chat.at(-1).text, 'smoke chat');
  assert.equal((await (await host.request('/netease/party')).json()).rooms[0].host, true);
  assert.equal((await (await guest.request('/netease/party')).json()).rooms[0].host, false);
  report.roomSync = true;

  await app.close();
  const previous = new DatabaseSync(dbPath);
  previous.exec(`
    ALTER TABLE sessions ADD COLUMN cookie TEXT;
    UPDATE sessions SET cookie = 'smoke-retired-account';
    CREATE TABLE qr_keys (key TEXT PRIMARY KEY, session_hash TEXT REFERENCES sessions(hash), expires_at INTEGER);
    INSERT INTO qr_keys SELECT 'smoke-' || hash, hash, expires_at FROM sessions;
    PRAGMA user_version = 1;
  `);
  previous.close();
  app = createBackend(options);
  base = await app.listen(0);
  assert.equal((await (await host.request('/api/health')).json()).version, 2);
  assert.ok(!app.store.db.prepare('PRAGMA table_info(sessions)').all().some((column) => column.name === 'cookie'));
  assert.equal(app.store.db.prepare("SELECT name FROM sqlite_schema WHERE name = 'qr_keys'").get(), undefined);
  const restored = await host.party(`/${room.code}/heartbeat`);
  await guest.party(`/${room.code}/heartbeat`);
  assert.equal(restored.hostId, 'smoke-host');
  assert.deepEqual(restored.state, paused.state);
  assert.deepEqual(restored.queue, [queued]);
  assert.equal(restored.chat.at(-1).text, 'smoke chat');
  assert.equal(restored.members.length, 2);
  report.migration = true;

  const file = (await readdir(audioDir, { withFileTypes: true })).find((item) => item.isFile() && !item.name.startsWith('.') && item.name.endsWith('.m4a'))?.name;
  assert.ok(file, 'local original audio file is required');
  const handle = await open(join(audioDir, file), 'r');
  let size;
  const expected = Buffer.alloc(32);
  try {
    size = (await handle.stat()).size;
    assert.ok(size >= 32, 'local audio must contain at least 32 bytes');
    assert.equal((await handle.read(expected, 0, 32, 0)).bytesRead, 32);
  } finally { await handle.close(); }
  const ranged = await host.request(`/audio/${encodeURIComponent(file)}`, undefined, { range: 'bytes=0-31' });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), `bytes 0-31/${size}`);
  assert.equal(ranged.headers.get('content-length'), '32');
  assert.ok(Buffer.from(await ranged.arrayBuffer()).equals(expected), 'audio range bytes differ from local source');
  report.localAudio = { file, status: 206, verifiedBytes: 32 };
  assert.equal(externalRequests, 0);
  console.log(JSON.stringify({ ok: true, ...report }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, ...report }));
  process.exitCode = 1;
} finally {
  await app?.close();
  await rm(temporary, { recursive: true, force: true });
}
