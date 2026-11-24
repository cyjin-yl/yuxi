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
 * Prefetch is opt-in: YUXI_BUILD_BASE_URL selects the music API origin.
 * With no origin configured, widgets use their supplied title and cover.
 *
 * Returns null on any error so callers can degrade gracefully.
 */
const memCache = new Map<string, unknown>();
// Production builds do not need a live music service.
function buildBase(): string | null {
  const value = typeof process !== 'undefined' ? process.env.YUXI_BUILD_BASE_URL : undefined;
  return value ? value.replace(/\/$/, '') : null;
}
export async function fetchOnce<T>(path: string): Promise<T | null> {
  const base = buildBase();
  if (!base) return null;
  if (memCache.has(path)) return memCache.get(path) as T | null;
  try {
    const res = await fetch(new URL(path, base), {
      headers: { 'user-agent': 'yuxi-build-prefetch/1.0' },
      signal: AbortSignal.timeout(3000),
    });
    const data = res.ok ? await res.json() as T : null;
    memCache.set(path, data);
    return data;
  } catch {
    memCache.set(path, null);
    return null;
  }
}

/** Normalize a NetEase song/playlist cover to https for production use. */
export function normalizeCoverUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return neteaseHttps(url);
}
