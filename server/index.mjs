import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { Store } from './storage.mjs';
import { party, HttpError } from './party.mjs';
import { NetEase, json } from './netease.mjs';
import { releaseAudio } from './media.mjs';

const COOKIE = 'yuxi_session';
const MAX_BODY = 512 * 1024;
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-robots-tag': 'noindex',
};
const MUSIC_HTTP_ERRORS = new Set([
  'origin_not_allowed', 'method_not_allowed', 'rate_limited', 'body_too_large', 'json_required',
  'invalid_json', 'json_object_required', 'invalid_query', 'invalid_pagination',
  'netease_visitor_unavailable', 'netease_resource_unavailable', 'netease_upstream_failure',
  'netease_invalid_response', 'netease_response_too_large', 'invalid_media_origin',
  'invalid_range', 'media_redirect_failed', 'media_upstream_failure', 'unexpected_media_encoding',
  'upstream_timeout', 'service_unavailable',
]);

function musicRoute(path) {
  if (path === '/netease/search') return 'search';
  const matched = /^\/netease\/(playlist|song|lyrics|comments|audio)\/[1-9][0-9]{0,19}$/.exec(path);
  return matched?.[1] ?? null;
}

function tokenFrom(headers) {
  return (headers.get('cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';
}

function requestHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

function clientIp(req, trustProxy) {
  const remote = req.socket.remoteAddress ?? 'unknown';
  if (!trustProxy || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return remote;
  // Only the final hop appended by the loopback reverse proxy is authoritative.
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim();
  return forwarded && isIP(forwarded) ? forwarded : remote;
}

class Limiter {
  constructor(now) { this.now = now; this.entries = new Map(); }
  allow(key, limit, interval = 60_000) {
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry || entry.until <= now) {
      if (this.entries.size >= 10_000) this.entries.delete(this.entries.keys().next().value);
      entry = { count: 0, until: now + interval };
      this.entries.set(key, entry);
    }
    return ++entry.count <= limit;
  }
}

async function readJson(req) {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_BODY) throw new HttpError(413, 'body_too_large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body_too_large');
    chunks.push(chunk);
  }
  if (!size) return {};
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))) throw new HttpError(415, 'json_required');
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new HttpError(400, 'invalid_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'json_object_required');
  return body;
}

/** Creates an isolated backend. Listening and persistence are real; outbound I/O is injectable for tests. */
export function createBackend(options = {}) {
  const config = {
    dbPath: options.dbPath ?? process.env.YUXI_DB ?? '/var/lib/yuxi/yuxi.sqlite',
    audioDir: options.audioDir ?? process.env.YUXI_AUDIO_DIR ?? '/var/lib/yuxi/audio',
    publicOrigin: options.publicOrigin ?? process.env.YUXI_ORIGIN ?? 'https://yvxi.cyjin.dev',
    trustProxy: options.trustProxy ?? process.env.YUXI_TRUST_PROXY === '1',
    rateLimit: options.rateLimit !== false,
    now: options.now ?? Date.now,
    fetchImpl: options.fetchImpl ?? fetch,
    onMusicHttpEvent: options.onMusicHttpEvent ?? ((detail) => process.stderr.write(`${JSON.stringify(detail)}\n`)),
  };
  const origin = new URL(config.publicOrigin).origin;
  if (!['http:', 'https:'].includes(new URL(origin).protocol)) throw new Error('invalid_public_origin');
  const secure = origin.startsWith('https:');
  const store = new Store({ path: config.dbPath, now: config.now });
  const netease = new NetEase({ fetchImpl: config.fetchImpl, now: config.now });
  const limiter = new Limiter(config.now);
  const sweep = setInterval(() => { try { store.sweep(); } catch { process.stderr.write('yuxi: database maintenance failed\n'); } }, 60_000);
  sweep.unref();
  let closed = false;
  let firstMusicResponse = true;
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 20_000, headersTimeout: 10_000, keepAliveTimeout: 5000 }, async (req, res) => {
    const abort = new AbortController();
    const disconnected = () => { if (!res.writableEnded) abort.abort(); };
    req.once('aborted', disconnected);
    res.once('close', disconnected);
    let issuedToken;
    let result;
    let route;
    let localErrorCode;
    try {
      if (!req.url || req.url.length > 4096) throw new HttpError(414, 'uri_too_long');
      const url = new URL(req.url, origin);
      route = musicRoute(url.pathname);
      const method = req.method ?? 'GET';
      const headers = requestHeaders(req);
      const source = headers.get('origin');
      if (source && source !== origin) throw new HttpError(403, 'origin_not_allowed');
      if (headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'origin_not_allowed');
      if (!['GET', 'HEAD', 'POST'].includes(method)) throw new HttpError(405, 'method_not_allowed');
      const ip = clientIp(req, config.trustProxy);
      if (config.rateLimit && !limiter.allow(`request:${ip}`, 1200)) throw new HttpError(429, 'rate_limited');
      const body = method === 'POST' ? await readJson(req) : {};
      const token = tokenFrom(headers);
      let session = store.session(token);
      const needsSession = method === 'POST' && url.pathname.startsWith('/netease/party/');
      if (!session && needsSession) {
        if (config.rateLimit && !limiter.allow(`session:${ip}`, 60, 10 * 60_000)) throw new HttpError(429, 'rate_limited');
        const created = store.newSession();
        session = created.row;
        issuedToken = created.token;
      }
      if (config.rateLimit && method === 'POST') {
        const key = session?.hash ?? ip;
        if (!limiter.allow(`write:${key}`, 180)) throw new HttpError(429, 'rate_limited');
        if (url.pathname === '/netease/party/create' && (!limiter.allow(`create:${ip}`, 30, 600_000) || !limiter.allow(`create:${key}`, 10, 600_000))) throw new HttpError(429, 'rate_limited');
        if (url.pathname.endsWith('/chat') && !limiter.allow(`chat:${key}`, 40)) throw new HttpError(429, 'rate_limited');
      }
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(120_000)]);
      if (url.pathname === '/api/health' && (method === 'GET' || method === 'HEAD')) {
        store.db.prepare('SELECT 1').get();
        result = json({ status: 'ok', service: 'yuxi', storage: 'sqlite', version: 2 });
      } else if (url.pathname === '/netease/party' || url.pathname.startsWith('/netease/party/')) {
        result = json(party({ store, path: url.pathname, method, body, session, codeGenerator: options.codeGenerator }));
      } else if (url.pathname.startsWith('/netease/')) {
        result = await netease.handle({ url, method, headers, signal });
      } else if (url.pathname.startsWith('/audio/') && (method === 'GET' || method === 'HEAD')) {
        let file;
        try { file = decodeURIComponent(url.pathname.slice('/audio/'.length)); }
        catch { throw new HttpError(400, 'invalid_filename'); }
        result = await releaseAudio({ file, audioDir: config.audioDir, method, headers, fetchImpl: config.fetchImpl, signal });
      } else throw new HttpError(404, 'not_found');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error?.name === 'TimeoutError' ? 504 : 502;
      const code = error instanceof HttpError ? error.message : status === 504 ? 'upstream_timeout' : 'service_unavailable';
      localErrorCode = MUSIC_HTTP_ERRORS.has(code) ? code : 'request_failed';
      result = json({ error: error instanceof HttpError ? error.message : status === 504 ? 'upstream_timeout' : 'service_unavailable', ...(error instanceof HttpError ? error.details : {}) }, status);
      if (status === 429) result.headers.set('retry-after', '60');
      if (status === 413) result.headers.set('connection', 'close');
    }
    if (route && (firstMusicResponse || result.status >= 400)) {
      const first = firstMusicResponse;
      firstMusicResponse = false;
      const detail = {
        event: result.status >= 400 ? 'netease_http_error' : 'netease_first_response',
        method: ['GET', 'HEAD', 'POST'].includes(req.method) ? req.method : 'OTHER',
        route, status: result.status, first,
        ...(result.status >= 400 ? { errorCode: localErrorCode ?? (route === 'audio' && result.status === 451 ? 'audio_unavailable' : 'request_failed') } : {}),
      };
      try { config.onMusicHttpEvent(detail); } catch { /* Response delivery proceeds when a log sink is closed. */ }
    }
    if (issuedToken) result.headers.append('set-cookie', `${COOKIE}=${issuedToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}`);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) result.headers.set(key, value);
    if (res.destroyed) { await result.body?.cancel(); return; }
    const headersOut = Object.fromEntries(result.headers);
    const cookies = result.headers.getSetCookie();
    if (cookies.length) headersOut['set-cookie'] = cookies;
    res.writeHead(result.status, headersOut);
    try {
      if (req.method === 'HEAD' || !result.body) { await result.body?.cancel(); res.end(); }
      else await pipeline(Readable.fromWeb(result.body), res);
    } catch { res.destroy(); }
    finally { req.off('aborted', disconnected); res.off('close', disconnected); }
  });
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  return {
    server,
    store,
    async listen(port = Number(process.env.PORT ?? 8787), host = '127.0.0.1') {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(); });
      });
      return `http://${host}:${server.address().port}`;
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(sweep);
      if (server.listening) {
        const forceClose = setTimeout(() => server.closeAllConnections(), 10_000);
        forceClose.unref();
        await new Promise((resolve) => server.close(resolve));
        clearTimeout(forceClose);
      }
      store.close();
    },
  };
}

// Deployments start through the atomic `current` symlink. Node resolves module
// URLs to real paths, while argv retains the spelling passed by systemd.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const app = createBackend();
  await app.listen();
  process.stdout.write('yuxi backend listening on 127.0.0.1:' + app.server.address().port + '\n');
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
