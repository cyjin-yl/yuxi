import { createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { HttpError } from './party.mjs';
import { proxyMedia } from './media.mjs';

const API = 'https://music.163.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
const VISITOR_UA = 'NeteaseMusic/9.5.61.260802021928(9005061);Dalvik/2.1.0 (Linux; U; Android 12; HBN-AL00 Build/cd737a2.0)';
const VISITOR_TTL = 6 * 3600_000;
const RETRY_DELAY = 30_000;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
// Public wire-format constants used by the NetEase xeapi visitor protocol.
const XEAPI_KEY = Buffer.from('ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84', 'hex');
const XEAPI_SIGNING_KEY = 'mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g==';
const XEAPI_RESPONSE_KEY = Buffer.from('e82ckenh8dichen8');
const X25519_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const SECRET_FIELDS = /^(?:cookie|cookies|token|access_?token|refresh_?token|MUSIC_[AU]|__csrf|password)$/i;
const VISITOR_ERROR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EACCES', 'EPERM',
  'EHOSTUNREACH', 'ENETUNREACH', 'EAFNOSUPPORT', 'EPROTONOSUPPORT', 'ESOCKTNOSUPPORT', 'ENOENT',
  'ERR_OSSL_EVP_UNSUPPORTED', 'ERR_OSSL_BAD_DECRYPT', 'ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH',
  'ERR_CRYPTO_INVALID_KEYLEN', 'ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY', 'ERR_BUFFER_TOO_LARGE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_HANDSHAKE_TIMEOUT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED',
]);
const VISITOR_STAGES = new Set(['public_key', 'registration', 'visitor_cookie']);
const VISITOR_PHASES = new Set(['prepare', 'request', 'http_status', 'read_response', 'response_json', 'response_code', 'key_fields', 'signature', 'key_decrypt', 'key_json', 'packet', 'response_decrypt', 'response_decompress', 'cookie_select']);
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const form = (values) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
const upstreamCode = (value) => Number.isSafeInteger(value) && Math.abs(value) <= 9999 ? value : null;

function visitorFailure(attempt, error) {
  const codes = new Set();
  const collect = (item, depth = 0) => {
    if (!item || depth > 3) return;
    if (VISITOR_ERROR_CODES.has(item.code)) codes.add(item.code);
    collect(item.cause, depth + 1);
    if (Array.isArray(item.errors)) for (const child of item.errors.slice(0, 4)) collect(child, depth + 1);
  };
  collect(error);
  const knownReasons = {
    visitor_http_failure: 'upstream_http_status', visitor_upstream_code: 'upstream_code',
    invalid_visitor_key: 'invalid_key_fields', invalid_visitor_key_signature: 'invalid_key_signature',
    netease_response_too_large: 'response_too_large', netease_visitor_unavailable: 'visitor_cookie_unavailable',
  };
  const errorType = ['Error', 'TypeError', 'SyntaxError', 'RangeError', 'TimeoutError', 'AbortError'].includes(error?.name) ? error.name : 'Error';
  return {
    event: 'netease_visitor_failure',
    stage: VISITOR_STAGES.has(attempt.stage) ? attempt.stage : 'unknown',
    phase: VISITOR_PHASES.has(attempt.phase) ? attempt.phase : 'unknown',
    httpStatus: Number.isInteger(attempt.httpStatus) && attempt.httpStatus >= 100 && attempt.httpStatus <= 599 ? attempt.httpStatus : null,
    upstreamCode: upstreamCode(attempt.upstreamCode),
    reason: Object.hasOwn(knownReasons, error?.message) ? knownReasons[error.message] : errorType === 'TimeoutError' ? 'timeout' : errorType === 'SyntaxError' ? 'invalid_json' : 'operation_failed',
    errorType, errorCodes: [...codes],
    elapsedMs: Math.max(0, Math.round(performance.now() - attempt.started)),
    ...(typeof attempt.hasVisitorCookie === 'boolean' ? { hasVisitorCookie: attempt.hasVisitorCookie, cookieExpired: attempt.cookieExpired === true } : {}),
  };
}

const logVisitorFailure = (detail) => process.stderr.write(`${JSON.stringify(detail)}\n`);

export const json = (body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
});

function sanitized(value) {
  if (Array.isArray(value)) return value.map(sanitized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_FIELDS.test(key)).map(([key, item]) => [key, sanitized(item)]));
  return value;
}

async function responseBytes(response) {
  const reader = response.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new HttpError(502, 'netease_response_too_large'); }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

function ecb(key, input, decrypt = false) {
  const cipher = (decrypt ? createDecipheriv : createCipheriv)(`aes-${key.length * 8}-ecb`, key, Buffer.alloc(0));
  return Buffer.concat([cipher.update(input), cipher.final()]);
}

function encodedUsername(deviceId) {
  const xorKey = '3go8&$8*3*3h0k(2)2';
  const xored = Buffer.from(deviceId, 'ascii').map((byte, index) => byte ^ xorKey.charCodeAt(index % xorKey.length));
  const digest = createHash('md5').update(xored).digest('base64');
  return Buffer.from(`${deviceId} ${digest}`).toString('base64');
}

function visitorPacket(data, keyState) {
  const dynamic = randomBytes(16);
  const plaintext = Buffer.from(JSON.stringify({ content: new URLSearchParams(data).toString(), queryString: 'e_r=true' }));
  const inner = ecb(XEAPI_KEY, plaintext);
  const mask = randomBytes(16);
  const xored = inner.map((value, index) => value ^ mask[index % 16]);
  const rotate = (mask[0] & 15) % xored.length;
  const C = ecb(dynamic, Buffer.concat([mask, xored.subarray(rotate), xored.subarray(0, rotate)]));
  const peer = createPublicKey({ key: Buffer.concat([X25519_PREFIX, Buffer.from(keyState.publicKey, 'base64')]), format: 'der', type: 'spki' });
  const pair = generateKeyPairSync('x25519');
  const ephemeral = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' })).subarray(-32);
  const shared = diffieHellman({ privateKey: pair.privateKey, publicKey: peer });
  const prk = createHmac('sha256', Buffer.alloc(32)).update(shared).digest();
  const derived = createHmac('sha256', prk).update(Buffer.concat([ephemeral, Buffer.from([1])])).digest().subarray(0, 16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-128-gcm', derived, iv);
  const sealed = Buffer.concat([cipher.update(`${dynamic.toString('base64')}|android|${keyState.sk}`), cipher.final()]);
  const S = Buffer.concat([ephemeral, iv, sealed, cipher.getAuthTag()]);
  const R = ecb(XEAPI_KEY, Buffer.from(`${keyState.version}|`));
  return { C: C.toString('base64url'), S: S.toString('base64'), R: R.toString('base64') };
}

function registrationBody(bytes, attempt) {
  attempt.phase = 'response_json';
  try { return JSON.parse(bytes.toString()); } catch { /* Successful app responses use the encrypted format. */ }
  attempt.phase = 'response_decrypt';
  let plain = ecb(XEAPI_RESPONSE_KEY, bytes, true);
  if (plain[0] === 0x1f && plain[1] === 0x8b) {
    attempt.phase = 'response_decompress';
    plain = gunzipSync(plain, { maxOutputLength: MAX_RESPONSE_BYTES });
  }
  attempt.phase = 'response_json';
  return JSON.parse(plain.toString());
}

const visitorSignature = (timestamp, nonce) => createHmac('sha256', XEAPI_SIGNING_KEY).update(String(timestamp) + nonce).digest('base64');

async function registerVisitor(fetchImpl, now, attempt) {
  const request = async (stage, url, values, headers) => {
    Object.assign(attempt, { stage, phase: 'request', httpStatus: null, upstreamCode: null });
    const response = await fetchImpl(url, {
      ...form(values), headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8', 'user-agent': VISITOR_UA, ...headers },
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    attempt.httpStatus = response.status;
    attempt.phase = 'http_status';
    if (!response.ok) { await response.body?.cancel(); throw new Error('visitor_http_failure'); }
    attempt.phase = 'read_response';
    return { headers: response.headers, bytes: await responseBytes(response) };
  };
  const deviceId = randomBytes(26).toString('hex').toUpperCase();
  const nonce = Array.from({ length: 16 }, () => String(randomInt(10))).join('');
  const timestamp = String(now());
  const keyReply = await request('public_key', 'https://interface.music.163.com/api/bsr/sk/get', {
    appVersion: '9.5.61', currentKeyVersion: '', deviceId, nonce, os: 'android', requestType: 'active',
    signature: visitorSignature(timestamp, nonce), t1: '', t2: '', timestamp, uid: '',
  }, { cookie: `deviceId=${deviceId}` });
  attempt.phase = 'response_json';
  const envelope = JSON.parse(keyReply.bytes.toString());
  attempt.phase = 'response_code';
  attempt.upstreamCode = upstreamCode(envelope?.code);
  if (envelope?.code !== 200) throw new Error('visitor_upstream_code');
  attempt.phase = 'key_fields';
  const data = record(envelope?.data);
  if (typeof data?.encryptedData !== 'string' || !['string', 'number'].includes(typeof data.timestamp)) throw new Error('invalid_visitor_key');
  attempt.phase = 'signature';
  const expected = Buffer.from(visitorSignature(data.timestamp, nonce));
  const supplied = Buffer.from(String(data.signature ?? ''));
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error('invalid_visitor_key_signature');
  attempt.phase = 'key_decrypt';
  const keyBytes = ecb(XEAPI_KEY, Buffer.from(data.encryptedData, 'base64'), true);
  attempt.phase = 'key_json';
  const key = JSON.parse(keyBytes.toString());
  attempt.phase = 'key_fields';
  if (typeof key?.publicKey !== 'string' || Buffer.from(key.publicKey, 'base64').length !== 32 || typeof key.sk !== 'string' || !key.sk || key.sk.length > 16384 || !['string', 'number'].includes(typeof key.version) || !String(key.version) || String(key.version).length > 128) throw new Error('invalid_visitor_key');

  Object.assign(attempt, { stage: 'registration', phase: 'prepare', httpStatus: null, upstreamCode: null });
  const registeredAt = now();
  const buildver = String(Math.floor(registeredAt / 1000));
  const nuid = randomBytes(32).toString('hex');
  const fingerprint = `__remember_me=true; ntes_kaola_ad=1; _ntes_nuid=${nuid}; _ntes_nnid=${nuid},${registeredAt}; WNMCID=${randomBytes(3).toString('hex')}.${registeredAt}.01.0; WEVNSM=1.0.0; os=android; osver=16; appver=9.1.65; channel=netease; deviceId=${deviceId}; sDeviceId=${deviceId}; buildver=${buildver}`;
  attempt.phase = 'packet';
  const packet = visitorPacket({ username: encodedUsername(deviceId) }, key);
  const result = await request('registration', 'https://interface3.music.163.com/xeapi/register/anonimous', packet, {
    cookie: fingerprint, 'X-Client-Enc-State': 'ENCRYPTED', 'x-aeapi': 'true',
    'x-deviceid': deviceId, 'x-os': 'android', 'x-osver': '16', 'x-appver': '9.1.65', 'x-sdeviceid': deviceId, 'x-buildver': buildver,
  });
  const body = registrationBody(result.bytes, attempt);
  attempt.phase = 'response_code';
  attempt.upstreamCode = upstreamCode(body?.code);
  if (body?.code !== 200) throw new Error('visitor_upstream_code');
  return { headers: result.headers, fingerprint };
}

function visitorCookies(headers, now, attempt) {
  const cookies = new Map();
  let expires = now + VISITOR_TTL;
  for (const header of headers.getSetCookie()) {
    const parts = header.split(';').map((part) => part.trim());
    const match = /^(MUSIC_A|__csrf)=([^\s;,]{1,4096})$/.exec(parts[0]);
    if (!match || /["\\\x00-\x20\x7f-\xff]/.test(match[2])) continue;
    cookies.set(match[1], match[2]);
    if (match[1] !== 'MUSIC_A') continue;
    const age = parts.find((part) => /^max-age=/i.test(part));
    const until = parts.find((part) => /^expires=/i.test(part));
    const expiry = age ? now + Number(age.slice(8)) * 1000 : until ? Date.parse(until.slice(8)) : NaN;
    if (Number.isFinite(expiry)) expires = Math.min(expires, now + (expiry - now) * 0.9);
  }
  Object.assign(attempt, { hasVisitorCookie: cookies.has('MUSIC_A'), cookieExpired: expires <= now });
  if (!cookies.has('MUSIC_A') || expires <= now) throw new HttpError(503, 'netease_visitor_unavailable');
  return { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '), expires };
}

function normalizePlaylist(value) {
  const playlist = record(value?.playlist);
  if (!Array.isArray(playlist?.trackIds) || !Array.isArray(playlist.tracks)) return value;
  const byId = new Map(playlist.tracks.map((item) => [String(item.id), item]));
  playlist.tracks = playlist.trackIds.map((item) => byId.get(String(item.id))).filter(Boolean);
  return value;
}

function boundedInt(value, fallback, max) {
  if (value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new HttpError(400, 'invalid_pagination');
  return Math.min(parsed, max);
}

export class NetEase {
  constructor({ fetchImpl = fetch, now = Date.now, onVisitorFailure = logVisitorFailure } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.onVisitorFailure = onVisitorFailure;
    this.visitor = null;
    this.visitorPending = null;
    this.retryAfter = 0;
    this.cache = new Map();
    this.cacheBytes = 0;
  }

  async upstream(path, cookie, init = {}) {
    const headers = new Headers(init.headers);
    headers.set('user-agent', UA);
    headers.set('referer', `${API}/`);
    headers.set('cookie', cookie);
    const response = await this.fetchImpl(`${API}${path}`, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) return { body: { code: 401 }, headers: response.headers };
      throw new HttpError(502, 'netease_upstream_failure');
    }
    const bytes = await responseBytes(response);
    let body;
    try { body = JSON.parse(bytes.toString()); }
    catch { throw new HttpError(502, 'netease_invalid_response'); }
    return { body, headers: response.headers };
  }

  async getVisitor() {
    const now = this.now();
    if (this.visitor && this.visitor.expires > now) return this.visitor;
    if (this.visitorPending) return this.visitorPending;
    if (now < this.retryAfter) throw new HttpError(503, 'netease_visitor_unavailable');
    this.visitor = null;
    this.visitorPending = (async () => {
      const attempt = { stage: 'public_key', phase: 'prepare', httpStatus: null, upstreamCode: null, started: performance.now() };
      try {
        const result = await registerVisitor(this.fetchImpl, this.now, attempt);
        Object.assign(attempt, { stage: 'visitor_cookie', phase: 'cookie_select' });
        const { cookie, expires } = visitorCookies(result.headers, this.now(), attempt);
        this.visitor = { cookie: `${cookie}; ${result.fingerprint}`, expires };
        this.retryAfter = 0;
        return this.visitor;
      } catch (error) {
        this.retryAfter = this.now() + RETRY_DELAY;
        try { this.onVisitorFailure(visitorFailure(attempt, error)); } catch { /* The HTTP failure remains available when a log sink is closed. */ }
        throw new HttpError(503, 'netease_visitor_unavailable');
      } finally {
        this.visitorPending = null;
      }
    })();
    return this.visitorPending;
  }

  async cached(path, ttl, init = {}) {
    const key = `${path}\n${String(init.body ?? '')}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return JSON.parse(cached.data);
    if (cached) { this.cache.delete(key); this.cacheBytes -= cached.bytes; }
    const visitor = await this.getVisitor();
    const result = await this.upstream(path, visitor.cookie, init);
    if ([301, 401].includes(result.body?.code)) {
      throw new HttpError(403, 'netease_resource_unavailable');
    }
    const data = JSON.stringify(sanitized(result.body));
    if (result.body?.code !== undefined && result.body.code !== 200) return JSON.parse(data);
    const bytes = Buffer.byteLength(data);
    while (this.cache.size >= 256 || (this.cacheBytes + bytes > 32 * 1024 * 1024 && this.cache.size)) {
      const oldest = this.cache.keys().next().value;
      this.cacheBytes -= this.cache.get(oldest).bytes;
      this.cache.delete(oldest);
    }
    const previous = this.cache.get(key);
    if (previous) this.cacheBytes -= previous.bytes;
    this.cache.set(key, { data, bytes, expires: this.now() + ttl });
    this.cacheBytes += bytes;
    return JSON.parse(data);
  }

  async handle({ url, method, headers, signal }) {
    const path = url.pathname;
    const match = /^\/netease\/(playlist|song|lyrics|comments|audio)\/([1-9][0-9]{0,19})$/.exec(path);
    if (path !== '/netease/search' && !match) throw new HttpError(404, 'not_found');
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');
    if (path === '/netease/search') {
      const query = (url.searchParams.get('q') ?? '').trim();
      if (!query || query.length > 200) throw new HttpError(400, 'invalid_query');
      const params = new URLSearchParams({ s: query, type: '1', limit: String(boundedInt(url.searchParams.get('limit'), 30, 100)), offset: String(boundedInt(url.searchParams.get('offset'), 0, 10000)), total: 'true' });
      return json(await this.cached(`/api/cloudsearch/pc?${params}`, 60_000), 200, 'public, max-age=60');
    }
    const [, kind, id] = match;
    if (kind === 'playlist') return json(normalizePlaylist(await this.cached(`/api/v6/playlist/detail?id=${id}&n=1000&s=0`, 300_000)), 200, 'public, max-age=300');
    if (kind === 'song') return json(await this.cached('/api/v3/song/detail', 3600_000, form({ c: `[{"id":${id}}]` })), 200, 'public, max-age=3600');
    if (kind === 'lyrics') return json(await this.cached(`/api/song/lyric/v1?id=${id}&cp=false&tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0`, 3600_000), 200, 'public, max-age=3600');
    if (kind === 'comments') {
      const limit = boundedInt(url.searchParams.get('limit'), 20, 100);
      const offset = boundedInt(url.searchParams.get('offset'), 0, 10000);
      return json(await this.cached(`/api/v1/resource/comments/R_SO_4_${id}`, 300_000, form({ rid: id, limit: String(limit), offset: String(offset), beforeTime: '0' })), 200, 'public, max-age=300');
    }
    const data = await this.cached('/api/song/enhance/player/url/v1', 60_000, form({ ids: `[${id}]`, level: 'standard', encodeType: 'aac' }));
    const media = data?.data?.[0];
    if (!media || typeof media.url !== 'string') return json({ error: 'audio_unavailable', code: Number.isInteger(media?.code) ? media.code : null }, 451);
    return proxyMedia({ url: media.url, kind: 'netease', headers, method, fetchImpl: this.fetchImpl, signal });
  }
}
