import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { HttpError } from './party.mjs';

const RELEASE_BASE = 'https://github.com/cyjin-yl/yuxi/releases/download/40classic-songs-audio/';
const FORWARD_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

function allowedHost(url, kind) {
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  if (kind === 'release') return ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname);
  return url.hostname === 'music.163.com' || url.hostname.endsWith('.music.163.com') || url.hostname.endsWith('.music.126.net');
}

export function mediaUrl(raw, kind) {
  let url;
  try { url = new URL(raw); } catch { throw new HttpError(502, 'invalid_media_origin'); }
  // NetEase still returns HTTP CDN URLs. Use the same CDN host over TLS.
  if (kind === 'netease' && url.protocol === 'http:') url.protocol = 'https:';
  if (!allowedHost(url, kind)) throw new HttpError(502, 'invalid_media_origin');
  return url;
}

export async function proxyMedia({ url, kind, headers, method, fetchImpl, signal }) {
  let target = mediaUrl(url, kind);
  const forwarded = new Headers({ 'User-Agent': 'Yuxi/1.0', 'Accept-Encoding': 'identity' });
  if (kind === 'netease') forwarded.set('Referer', 'https://music.163.com/');
  for (const name of ['range', 'if-range', 'if-none-match', 'if-modified-since']) {
    if (headers.get(name)) forwarded.set(name, headers.get(name));
  }
  const range = headers.get('range');
  if (range && (!/^bytes=(?:\d+-\d*|-\d+)$/.test(range) || range.length > 100)) throw new HttpError(416, 'invalid_range');
  let upstream;
  for (let attempt = 0; attempt <= 4; attempt++) {
    upstream = await fetchImpl(target, { method, headers: forwarded, redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
    const location = upstream.headers.get('location');
    await upstream.body?.cancel();
    if (!location || attempt === 4) throw new HttpError(502, 'media_redirect_failed');
    target = mediaUrl(new URL(location, target).href, kind);
  }
  if (![200, 206, 304, 404, 416].includes(upstream.status)) {
    await upstream.body?.cancel();
    throw new HttpError(502, 'media_upstream_failure');
  }
  const encoding = upstream.headers.get('content-encoding');
  if (encoding && encoding !== 'identity') {
    await upstream.body?.cancel();
    throw new HttpError(502, 'unexpected_media_encoding');
  }
  const responseHeaders = new Headers();
  for (const name of FORWARD_HEADERS) if (upstream.headers.has(name)) responseHeaders.set(name, upstream.headers.get(name));
  if (kind === 'release') responseHeaders.set('content-type', 'audio/mp4');
  // Each NetEase playback uses its current short-lived CDN URL.
  responseHeaders.set('cache-control', kind === 'release' && [200, 206].includes(upstream.status) ? 'public, max-age=3600' : 'private, no-store');
  if (method === 'HEAD' || upstream.status === 304) {
    await upstream.body?.cancel();
    return new Response(null, { status: upstream.status, headers: responseHeaders });
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

function byteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

export async function releaseAudio({ file, audioDir, method, headers, fetchImpl, signal }) {
  if (!/^[^/\\\0]{1,180}\.m4a$/.test(file) || file.startsWith('.') || file.includes('\r') || file.includes('\n')) throw new HttpError(404, 'not_found');
  let handle;
  if (audioDir) {
    try { handle = await open(join(audioDir, file), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if (error.code !== 'ENOENT') throw new HttpError(404, 'not_found'); }
  }
  if (!handle) return proxyMedia({ url: `${RELEASE_BASE}${encodeURIComponent(file)}`, kind: 'release', method, headers, fetchImpl, signal });
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new HttpError(404, 'not_found');
    const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
    const lastModified = stat.mtime.toUTCString();
    const responseHeaders = new Headers({ 'content-type': 'audio/mp4', 'accept-ranges': 'bytes', 'etag': etag, 'last-modified': lastModified, 'cache-control': 'public, max-age=3600' });
    if (headers.get('if-none-match')?.split(',').map((part) => part.trim()).includes(etag)) {
      await handle.close(); handle = null;
      return new Response(null, { status: 304, headers: responseHeaders });
    }
    let range = headers.get('range');
    const ifRange = headers.get('if-range');
    if (ifRange && ifRange !== etag && ifRange !== lastModified) range = null;
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    if (range) {
      const parsed = byteRange(range, stat.size);
      if (!parsed) {
        responseHeaders.set('content-range', `bytes */${stat.size}`);
        await handle.close(); handle = null;
        return new Response(null, { status: 416, headers: responseHeaders });
      }
      ({ start, end } = parsed);
      status = 206;
      responseHeaders.set('content-range', `bytes ${start}-${end}/${stat.size}`);
    }
    responseHeaders.set('content-length', String(Math.max(0, end - start + 1)));
    if (method === 'HEAD' || stat.size === 0) {
      await handle.close(); handle = null;
      return new Response(null, { status, headers: responseHeaders });
    }
    const stream = handle.createReadStream({ start, end, autoClose: true });
    handle = null; // The stream now owns the descriptor, including on cancellation.
    return new Response(Readable.toWeb(stream), { status, headers: responseHeaders });
  } finally {
    if (handle) await handle.close();
  }
}
