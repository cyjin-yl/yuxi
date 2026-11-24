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
  const failures = [];
  const service = new NetEase({ fetchImpl: f.fetchImpl, onVisitorFailure: (detail) => failures.push(detail) });
  await assert.rejects(service.getVisitor(), { status: 503, message: 'netease_visitor_unavailable' });
  assert.deepEqual(f.calls, [KEY_URL]);
  assert.equal(service.visitor, null);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].stage, 'public_key');
  assert.equal(failures[0].phase, 'signature');
  assert.equal(failures[0].httpStatus, 200);
  assert.equal(failures[0].upstreamCode, 200);
  assert.equal(failures[0].reason, 'invalid_key_signature');
});

test('anonymous registration decodes encrypted gzip and selects only guest credentials', async () => {
  const now = 1_800_000_000_000;
  const f = fixture();
  const failures = [];
  const service = new NetEase({ fetchImpl: f.fetchImpl, now: () => now, onVisitorFailure: (detail) => failures.push(detail) });
  const visitor = await service.getVisitor();
  assert.deepEqual(f.calls, [KEY_URL, REGISTER_URL]);
  assert.match(visitor.cookie, /(?:^|; )MUSIC_A=guest-fixture(?:;|$)/);
  assert.match(visitor.cookie, /(?:^|; )__csrf=csrf-fixture(?:;|$)/);
  assert.doesNotMatch(visitor.cookie, /MUSIC_U|private-account-fixture|upstream-device-fixture|unexpected|unrelated-cookie-fixture/);
  assert.equal(visitor.expires, now + 7200_000 * 0.9);
  assert.deepEqual(failures, [], 'successful registration stays quiet');
});

test('anonymous registration bounds decompression and keeps the failure cooldown', async () => {
  let now = 1_800_000_000_000;
  const f = fixture({ registrationBody: { code: 200, padding: 'a'.repeat(3 * 1024 * 1024) } });
  const failures = [];
  const service = new NetEase({ fetchImpl: f.fetchImpl, now: () => now, onVisitorFailure: (detail) => failures.push(detail) });
  await assert.rejects(service.getVisitor(), { status: 503, message: 'netease_visitor_unavailable' });
  assert.deepEqual(f.calls, [KEY_URL, REGISTER_URL]);
  assert.equal(service.visitor, null);
  assert.equal(service.retryAfter, now + 30_000);
  now += 29_999;
  await assert.rejects(service.getVisitor(), { status: 503, message: 'netease_visitor_unavailable' });
  assert.deepEqual(f.calls, [KEY_URL, REGISTER_URL], 'cooldown must avoid another key exchange or registration');
  assert.equal(failures.length, 1, 'cooldown responses must not produce duplicate failure logs');
  assert.equal(failures[0].stage, 'registration');
  assert.equal(failures[0].phase, 'response_decompress');
  assert.equal(failures[0].httpStatus, 200);
  assert.equal(failures[0].upstreamCode, null);
  assert.deepEqual(failures[0].errorCodes, ['ERR_BUFFER_TOO_LARGE']);
});

test('visitor failure diagnostics retain an upstream code and exclude response secrets', async () => {
  const hidden = 'fixture-private-response-value';
  const f = fixture({ registrationBody: { code: 400, message: hidden, cookie: hidden, url: `https://private.invalid/${hidden}` } });
  const failures = [];
  const service = new NetEase({ fetchImpl: f.fetchImpl, onVisitorFailure: (detail) => failures.push(detail) });
  await assert.rejects(service.getVisitor(), { status: 503, message: 'netease_visitor_unavailable' });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].stage, 'registration');
  assert.equal(failures[0].phase, 'response_code');
  assert.equal(failures[0].httpStatus, 200);
  assert.equal(failures[0].upstreamCode, 400);
  assert.equal(failures[0].reason, 'upstream_code');
  assert.doesNotMatch(JSON.stringify(failures), /fixture-private|https:|MUSIC_[AU]|test-key-state/);
});

test('transport diagnostics share one attempt and only retain whitelisted native error codes', async () => {
  let now = 1_800_000_000_000;
  let calls = 0;
  const failures = [];
  const hidden = 'private-cookie-body-and-key';
  const cause = Object.assign(new Error(`https://private.invalid/${hidden}`), { code: 'ECONNRESET' });
  const thrown = Object.assign(new TypeError(hidden, { cause }), {
    code: hidden,
    errors: [Object.assign(new Error(hidden), { code: 'EAI_AGAIN' }), Object.assign(new Error(hidden), { code: hidden })],
  });
  const service = new NetEase({ now: () => now, fetchImpl: async () => { calls++; throw thrown; }, onVisitorFailure: (detail) => failures.push(detail) });
  await Promise.all(Array.from({ length: 6 }, () => assert.rejects(service.getVisitor(), { status: 503, message: 'netease_visitor_unavailable' })));
  assert.equal(calls, 1);
  assert.equal(failures.length, 1);
  const detail = failures[0];
  assert.equal(detail.event, 'netease_visitor_failure');
  assert.equal(detail.stage, 'public_key');
  assert.equal(detail.phase, 'request');
  assert.equal(detail.httpStatus, null);
  assert.equal(detail.upstreamCode, null);
  assert.equal(detail.errorType, 'TypeError');
  assert.deepEqual(detail.errorCodes, ['ECONNRESET', 'EAI_AGAIN']);
  assert.ok(Number.isInteger(detail.elapsedMs) && detail.elapsedMs >= 0);
  assert.doesNotMatch(JSON.stringify(detail), /private|https:|cookie|body|key-state/);
  now += 29_999;
  await assert.rejects(service.getVisitor(), { status: 503, message: 'netease_visitor_unavailable' });
  assert.equal(calls, 1);
  assert.equal(failures.length, 1);
});
