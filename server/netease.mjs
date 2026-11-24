import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from './party.mjs';
import { proxyMedia } from './media.mjs';

const API = 'https://music.163.com';
const ID = /^[1-9][0-9]{0,19}$/;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
const PROFILE_TTL = 300_000;
const SECRET_FIELDS = /^(?:cookie|cookies|token|access_?token|refresh_?token|MUSIC_U|password)$/i;
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;

export const json = (body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
});

function sanitized(value) {
  if (Array.isArray(value)) return value.map(sanitized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_FIELDS.test(key)).map(([key, item]) => [key, sanitized(item)]));
  return value;
}

function musicCookie(value) {
  if (typeof value !== 'string' || value.length > 16384 || /[\r\n]/.test(value)) return '';
  const match = /(?:^|[;,]\s*)MUSIC_U=([^;\s,]+)/.exec(value);
  return match ? `MUSIC_U=${match[1]}` : '';
}

function fingerprint(cookie) {
  if (!cookie) return '';
  const id = createHash('sha256').update(cookie).digest('hex').slice(0, 32);
  return `${cookie}; __remember_me=true; _ntes_nuid=${id}; WEVNSM=1.0.0; os=pc; deviceId=yuxi-${id}; appver=3.1.17.204416; channel=netease`;
}

function normalizePlaylist(value) {
  const playlist = record(value?.playlist);
  if (!Array.isArray(playlist?.trackIds) || !Array.isArray(playlist.tracks)) return value;
  const byId = new Map(playlist.tracks.map((item) => [String(item.id), item]));
  const ordered = playlist.trackIds.map((item) => byId.get(String(item.id))).filter(Boolean);
  playlist.tracks = ordered;
  return value;
}

function profile(value) {
  const user = value?.profile ?? value?.data?.profile;
  return value?.code === 200 && Number.isSafeInteger(user?.userId) ? { userId: user.userId, nickname: typeof user.nickname === 'string' ? user.nickname.slice(0, 100) : '' } : null;
}

function boundedInt(value, fallback, max) {
  if (value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new HttpError(400, 'invalid_pagination');
  return Math.min(parsed, max);
}

export class NetEase {
  constructor({ store, fetchImpl = fetch, importToken = '', qrEncoder, signalFor }) {
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.importToken = importToken;
    this.qrEncoder = qrEncoder ?? (async (url) => (await import('qrcode')).default.toString(url, { type: 'svg', width: 320, margin: 1 }));
    this.signalFor = signalFor;
    this.cache = new Map();
    this.cacheBytes = 0;
  }

  async upstream(path, cookie, init = {}) {
    const headers = new Headers(init.headers);
    headers.set('user-agent', UA);
    headers.set('referer', `${API}/`);
    if (cookie) headers.set('cookie', fingerprint(cookie));
    const response = await this.fetchImpl(`${API}${path}`, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel(); throw new HttpError(502, 'netease_upstream_failure'); }
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 3 * 1024 * 1024) { await reader.cancel(); throw new HttpError(502, 'netease_response_too_large'); }
        chunks.push(value);
      }
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { throw new HttpError(502, 'netease_invalid_response'); }
    return { body, headers: response.headers };
  }

  async cached(path, cookie, ttl, init = {}) {
    const key = createHash('sha256').update(`${cookie}\n${path}\n${String(init.body ?? '')}`).digest('hex');
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.store.now()) return JSON.parse(cached.data);
    if (cached) { this.cache.delete(key); this.cacheBytes -= cached.bytes; }
    const { body } = await this.upstream(path, cookie, init);
    const data = JSON.stringify(sanitized(body));
    const bytes = Buffer.byteLength(data);
    while (this.cache.size >= 256 || (this.cacheBytes + bytes > 32 * 1024 * 1024 && this.cache.size)) {
      const oldest = this.cache.keys().next().value;
      this.cacheBytes -= this.cache.get(oldest).bytes;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { data, bytes, expires: this.store.now() + ttl });
    this.cacheBytes += bytes;
    return JSON.parse(data);
  }

  async validate(cookie) {
    if (!cookie) return null;
    return profile(await this.cached('/api/nuser/account/get', cookie, PROFILE_TTL));
  }

  authorized(header) {
    if (!this.importToken || this.importToken.length < 24 || !header) return false;
    const wanted = Buffer.from(`Bearer ${this.importToken}`);
    const got = Buffer.from(header);
    return wanted.length === got.length && timingSafeEqual(wanted, got);
  }

  async handle({ url, method, body, headers, session, signal }) {
    const path = url.pathname;
    const form = (values) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
    if (path === '/netease/auth/import') {
      if (method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      if (!this.authorized(headers.get('authorization'))) throw new HttpError(401, 'unauthorized');
      const cookie = musicCookie(body.cookie);
      const account = await this.validate(cookie);
      if (!account) throw new HttpError(400, 'invalid_netease_cookie');
      this.store.saveCookie(session, cookie);
      return json({ authenticated: true, ...account, scope: 'browser' });
    }
    if (path === '/netease/auth/logout') {
      if (method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      this.store.clearCookie(session);
      return json({ authenticated: false, scope: 'browser' });
    }
    if (path === '/netease/auth/qr/create') {
      if (method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      const { body: result } = await this.upstream('/api/login/qrcode/unikey', '', form({ type: '3' }));
      const key = result.unikey ?? result.data?.unikey;
      if (result.code !== 200 || typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(key)) throw new HttpError(502, 'qr_key_failed');
      const qrUrl = `${API}/login?codekey=${encodeURIComponent(key)}`;
      const svg = await this.qrEncoder(qrUrl);
      // One live QR key per browser; a refresh invalidates that browser's old key only.
      this.store.transaction(() => {
        this.store.db.prepare('DELETE FROM qr_keys WHERE session_hash = ?').run(session.hash);
        this.store.db.prepare('INSERT INTO qr_keys(key, session_hash, expires_at) VALUES (?, ?, ?)').run(key, session.hash, this.store.now() + 600_000);
      });
      return json({ key, qrUrl, qrImg: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
    }
    if (path === '/netease/auth/qr/check') {
      if (method !== 'POST' && method !== 'GET') throw new HttpError(405, 'method_not_allowed');
      const key = method === 'POST' ? body.key : url.searchParams.get('key');
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(key)) throw new HttpError(400, 'missing_qr_key');
      const row = this.store.db.prepare('SELECT key FROM qr_keys WHERE key = ? AND session_hash = ? AND expires_at > ?').get(key, session.hash, this.store.now());
      if (!row) throw new HttpError(403, 'qr_session_mismatch');
      const { body: result, headers: upstreamHeaders } = await this.upstream('/api/login/qrcode/client/login', '', form({ key, type: '3' }));
      const code = Number.isInteger(result.code) ? result.code : 0;
      if (code !== 803) return json({ code, message: typeof result.message === 'string' ? result.message.slice(0, 200) : '' });
      const candidates = [result.cookie, ...(upstreamHeaders.getSetCookie?.() ?? []), upstreamHeaders.get('set-cookie')];
      const cookie = candidates.map(musicCookie).find(Boolean);
      if (!cookie) throw new HttpError(502, 'login_cookie_missing');
      const account = await this.validate(cookie);
      if (!account) throw new HttpError(502, 'login_cookie_invalid');
      this.store.transaction(() => {
        this.store.saveCookie(session, cookie);
        this.store.db.prepare('DELETE FROM qr_keys WHERE key = ? AND session_hash = ?').run(key, session.hash);
      });
      return json({ code, authenticated: true, profile: account, scope: 'browser' });
    }
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');
    const cookie = this.store.cookie(session);
    if (path === '/netease/auth/status') {
      const account = await this.validate(cookie);
      return json({ authenticated: Boolean(account), profile: account, scope: 'browser' });
    }
    if (path === '/netease/playlists/mine' || path === '/netease/playlist/current') {
      const account = await this.validate(cookie);
      if (!account) throw new HttpError(401, 'netease_auth_required');
      const data = await this.cached(`/api/user/playlist?uid=${account.userId}&limit=1000&offset=0`, cookie, 300_000);
      const list = Array.isArray(data.playlist) ? data.playlist : [];
      if (path.endsWith('/mine')) return json({ playlists: list.filter((item) => Number.isSafeInteger(item.id) && typeof item.name === 'string').map((item) => ({
        id: String(item.id), name: item.name, coverUrl: typeof item.coverImgUrl === 'string' ? item.coverImgUrl : null, trackCount: Number.isFinite(item.trackCount) ? item.trackCount : 0,
      })) }, 200, 'private, max-age=300');
      const current = list.find((item) => typeof item.name === 'string' && item.name.startsWith('English Essentials 40 —'));
      if (!current || !ID.test(String(current.id))) throw new HttpError(404, 'english_playlist_not_found');
      return json(normalizePlaylist(await this.cached(`/api/v6/playlist/detail?id=${current.id}&n=1000&s=0`, cookie, 300_000)), 200, 'private, max-age=300');
    }
    if (path === '/netease/search') {
      const query = (url.searchParams.get('q') ?? '').trim();
      if (!query || query.length > 200) throw new HttpError(400, 'invalid_query');
      const params = new URLSearchParams({ s: query, type: '1', limit: String(boundedInt(url.searchParams.get('limit'), 30, 100)), offset: String(boundedInt(url.searchParams.get('offset'), 0, 10000)), total: 'true' });
      return json(await this.cached(`/api/cloudsearch/pc?${params}`, cookie, 60_000), 200, 'private, max-age=60');
    }
    const match = /^\/netease\/(playlist|song|lyrics|comments|audio)\/([1-9][0-9]{0,19})$/.exec(path);
    if (!match) throw new HttpError(404, 'not_found');
    const [, kind, id] = match;
    if (kind === 'playlist') return json(normalizePlaylist(await this.cached(`/api/v6/playlist/detail?id=${id}&n=1000&s=0`, cookie, 300_000)), 200, 'private, max-age=300');
    if (kind === 'song') return json(await this.cached('/api/v3/song/detail', cookie, 3600_000, form({ c: `[{"id":${id}}]` })), 200, 'private, max-age=3600');
    if (kind === 'lyrics') return json(await this.cached(`/api/song/lyric/v1?id=${id}&cp=false&tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0`, cookie, 3600_000), 200, 'private, max-age=3600');
    if (kind === 'comments') {
      const limit = boundedInt(url.searchParams.get('limit'), 20, 100);
      const offset = boundedInt(url.searchParams.get('offset'), 0, 10000);
      return json(await this.cached(`/api/v1/resource/comments/R_SO_4_${id}`, cookie, 300_000, form({ rid: id, limit: String(limit), offset: String(offset), beforeTime: '0' })), 200, 'private, max-age=300');
    }
    const data = await this.cached('/api/song/enhance/player/url/v1', cookie, 60_000, form({ ids: `[${id}]`, level: 'standard', encodeType: 'aac' }));
    const media = data?.data?.[0];
    if (!media || typeof media.url !== 'string') return json({ error: 'audio_unavailable', code: Number.isInteger(media?.code) ? media.code : null }, 451);
    return proxyMedia({ url: media.url, kind: 'netease', headers, method, fetchImpl: this.fetchImpl, signal });
  }
}
