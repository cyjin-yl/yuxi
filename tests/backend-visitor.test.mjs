import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHmac, generateKeyPairSync } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { NetEase } from '../server/netease.mjs';

const KEY_URL = 'https://interface.music.163.com/api/bsr/sk/get';
const REGISTER_URL = 'https://interface3.music.163.com/xeapi/register/anonimous';
const STATIC_KEY = Buffer.from('ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84', 'hex');
const SIGN_KEY = 'mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g==';
const RESPONSE_KEY = Buffer.from('e82ckenh8dichen8');

function encrypted(key, bytes) {
  const cipher = createCipheriv(`aes-${key.length * 8}-ecb`, key, Buffer.alloc(0));
  return Buffer.concat([cipher.update(bytes), cipher.final()]);
}

function fixture({ invalidSignature = false, registrationBody = { code: 200 } } = {}) {
  const { publicKey } = generateKeyPairSync('x25519');
  const keyState = {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
    sk: 'test-key-state', version: '1',
  };
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(init.method, 'POST');
    const params = new URLSearchParams(init.body);
    if (url === KEY_URL) {
      const timestamp = params.get('timestamp');
      const nonce = params.get('nonce');
      assert.match(nonce, /^[0-9]{16}$/);
      const signature = createHmac('sha256', SIGN_KEY).update(timestamp + nonce).digest('base64');
      assert.equal(params.get('signature'), signature);
      return Response.json({ code: 200, data: {
        timestamp,
        signature: invalidSignature ? 'A'.repeat(signature.length) : signature,
        encryptedData: encrypted(STATIC_KEY, Buffer.from(JSON.stringify(keyState))).toString('base64'),
      } });
    }
    assert.equal(url, REGISTER_URL);
    for (const field of ['C', 'S', 'R']) assert.ok(params.get(field), `registration includes ${field}`);
    const headers = new Headers();
    headers.append('set-cookie', 'MUSIC_A=guest-fixture; Max-Age=7200; HttpOnly');
    headers.append('set-cookie', '__csrf=csrf-fixture; Path=/');
    headers.append('set-cookie', 'MUSIC_U=private-account-fixture; HttpOnly');
    headers.append('set-cookie', 'deviceId=upstream-device-fixture; Path=/');
    headers.append('set-cookie', 'unexpected=unrelated-cookie-fixture; Path=/');
    return new Response(encrypted(RESPONSE_KEY, gzipSync(Buffer.from(JSON.stringify(registrationBody)))), { headers });
  };
  return { calls, fetchImpl };
}

test('anonymous registration rejects a bad key signature before submitting registration', async () => {
  const f = fixture({ invalidSignature: true });
  const service = new NetEase({ fetchImpl: f.fetchImpl });
  await assert.rejects(service.getVisitor(), { status: 503, message: 'netease_visitor_unavailable' });
  assert.deepEqual(f.calls, [KEY_URL]);
  assert.equal(service.visitor, null);
});

test('anonymous registration decodes encrypted gzip and selects only guest credentials', async () => {
  const now = 1_800_000_000_000;
  const f = fixture();
  const service = new NetEase({ fetchImpl: f.fetchImpl, now: () => now });
  const visitor = await service.getVisitor();
  assert.deepEqual(f.calls, [KEY_URL, REGISTER_URL]);
  assert.match(visitor.cookie, /(?:^|; )MUSIC_A=guest-fixture(?:;|$)/);
  assert.match(visitor.cookie, /(?:^|; )__csrf=csrf-fixture(?:;|$)/);
  assert.doesNotMatch(visitor.cookie, /MUSIC_U|private-account-fixture|upstream-device-fixture|unexpected|unrelated-cookie-fixture/);
  assert.equal(visitor.expires, now + 7200_000 * 0.9);
});

test('anonymous registration bounds decompression and keeps the failure cooldown', async () => {
  let now = 1_800_000_000_000;
  const f = fixture({ registrationBody: { code: 200, padding: 'a'.repeat(3 * 1024 * 1024) } });
  const service = new NetEase({ fetchImpl: f.fetchImpl, now: () => now });
  await assert.rejects(service.getVisitor(), { status: 503, message: 'netease_visitor_unavailable' });
  assert.deepEqual(f.calls, [KEY_URL, REGISTER_URL]);
  assert.equal(service.visitor, null);
  assert.equal(service.retryAfter, now + 30_000);
  now += 29_999;
  await assert.rejects(service.getVisitor(), { status: 503, message: 'netease_visitor_unavailable' });
  assert.deepEqual(f.calls, [KEY_URL, REGISTER_URL], 'cooldown must avoid another key exchange or registration');
});
