/**
 * Progressive cover / image loading helpers shared by the NetEase player and
 * blog widgets.
 *
 * NetEase's image CDN supports a `?param=WxH` (or `?param=WyN`) suffix to
 * request resized images. We use a tiny base64-ish canvas-sized variant as a
 * blurry placeholder while the full-res cover streams in, then cross-fade
 * via a CSS spring transition once the big image fires its `load` event.
 *
 * For non-NetEase blog images there is no equivalent server-side resize, so
 * the same component falls back to a CSS `filter: blur()` + reduced-opacity
 * thumbnail that we approximate from the original image (the browser downscales
 * a smaller rendered copy on the placeholder layer while the big image loads).
 */

const NETEASE_HOST_RE = /^https?:\/\/p\d+\.music\.126\.net\//i;

/** Force HTTPS for NetEase covers (mixed-content guard on https pages). */
export function neteaseHttps(url: string): string {
  if (!url) return url;
  return url.replace(/^http:\/\//i, 'https://');
}

/**
 * Append a NetEase resize suffix. The classic tiny-placeholder request uses
 * `?param=NyN` to ask the CDN for an N×N thumbnail. NetEase will scale-crop
 * and serve; the small size renders blurry and instant, then we swap to the
 * full-res `url` once it `load`s.
 */
export function neteaseThumb(url: string, size: number = 64): string | null {
  if (!url || !NETEASE_HOST_RE.test(url)) return null;
  const clean = neteaseHttps(url).split('?')[0];
  return `${clean}?param=${size}y${size}`;
}

/**
 * Detect whether a URL supports a server-side thumbnail (today only NetEase).
 * Blog images return false and use a CSS-blur fallback instead.
 */
export function hasThumbnail(url: string | undefined | null): url is string {
  return Boolean(url && NETEASE_HOST_RE.test(url));
}

/**
 * Build-time fetch helper: read a remote URL once at build time and cache the
 * result in module memory. Used by the NetEase widget to bake cover/title
 * into static HTML so the page paints immediately and only the audio load
 * needs the network at runtime.
 *
 * During `astro build` in Node we don't have a base URL for relative paths
 * like `/netease/song/<id>`. Until we have a local SSR adapter, route the
 * build-time prefetch through the live production site (same Worker, same
 * auth). Override with `YUXI_BUILD_BASE_URL` if needed.
 *
 * Returns null on any error so callers can degrade gracefully.
 */
const memCache = new Map<string, unknown>();
function buildBase(): string {
  if (typeof process !== 'undefined' && process.env && process.env.YUXI_BUILD_BASE_URL) {
    return process.env.YUXI_BUILD_BASE_URL.replace(/\/$/, '');
  }
  return 'https://yvxi.pages.dev';
}
function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return buildBase() + (path.startsWith('/') ? path : '/' + path);
}
let proxyConfigured = false;
function ensureProxy(): void {
  if (proxyConfigured) return;
  proxyConfigured = true;
  try {
    const proxy = (typeof process !== 'undefined' && process.env && (process.env.HTTPS_PROXY || process.env.https_proxy)) || '';
    if (proxy && typeof require !== 'undefined') {
      // undici ships with Node 18+; calling require here keeps it out of SSR
      // paths where fetch already works without a proxy.
      const undici = require('undici') as typeof import('undici');
      undici.setGlobalDispatcher(new undici.ProxyAgent(proxy));
    }
  } catch {
    /* proxy init optional */
  }
}
export async function fetchOnce<T>(path: string): Promise<T | null> {
  ensureProxy();
  if (memCache.has(path)) return memCache.get(path) as T;
  try {
    const res = await fetch(absoluteUrl(path), { headers: { 'user-agent': 'yuxi-build-prefetch/1.0' } });
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    memCache.set(path, data);
    return data;
  } catch {
    return null;
  }
}

/** Normalize a NetEase song/playlist cover to https for production use. */
export function normalizeCoverUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return neteaseHttps(url);
}
