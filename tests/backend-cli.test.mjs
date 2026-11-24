import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('production CLI starts through a release symlink and restores room identity after restart', { timeout: 15_000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'yuxi-cli-'));
  const source = fileURLToPath(new URL('../server', import.meta.url));
  const release = join(temp, 'release');
  await mkdir(release);
  await symlink(source, join(release, 'server'));
  await symlink(release, join(temp, 'current'));
  let cookie;
  let roomCode;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const child = spawn(process.execPath, [join(temp, 'current/server/index.mjs')], {
        cwd: temp,
        env: { ...process.env, PORT: '0', YUXI_DB: join(temp, 'state.sqlite'), YUXI_ORIGIN: 'http://127.0.0.1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let errorOutput = '';
      child.stderr.on('data', (chunk) => { errorOutput += chunk; });
      try {
        const port = await new Promise((resolvePort, reject) => {
          let output = '';
          const timer = setTimeout(() => reject(new Error('CLI did not begin listening')), 5000);
          child.once('error', (error) => { clearTimeout(timer); reject(error); });
          child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`CLI exited before acceptance: ${code} ${errorOutput}`)); });
          child.stdout.on('data', (chunk) => {
            output += chunk;
            const match = /listening on 127\.0\.0\.1:(\d+)/.exec(output);
            if (match) { clearTimeout(timer); resolvePort(Number(match[1])); }
          });
        });
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).storage, 'sqlite');
        const path = roomCode ? `/netease/party/${roomCode}/heartbeat` : '/netease/party/create';
        const roomResponse = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
          body: JSON.stringify({ id: 'cli-host', name: 'CLI host' }),
        });
        assert.equal(roomResponse.status, 200);
        const room = await roomResponse.json();
        assert.equal(room.hostId, 'cli-host');
        if (roomCode) assert.equal(room.code, roomCode);
        else {
          roomCode = room.code;
          cookie = roomResponse.headers.get('set-cookie').split(';')[0];
        }
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        assert.equal((await exited)[0], 0);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit');
          child.kill('SIGKILL');
          await exited;
        }
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
