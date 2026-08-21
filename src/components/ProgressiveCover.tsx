import { useEffect, useRef, useState } from 'react';
import { hasThumbnail, neteaseThumb, neteaseHttps } from '../lib/cover';

type Props = {
  src: string | undefined;
  alt?: string;
  className?: string;
  /** Thumbnail request size in px (default 32 — small enough to be instant). */
  thumbSize?: number;
  /** Spinner / fallback element shown while no src is set at all. */
  fallback?: React.ReactNode;
  /** Spring cross-fade duration in ms. Default 650 (matches the player art enter). */
  duration?: number;
};

/**
 * Progressive cover. Renders a tiny blurred thumbnail (NetEase `?param=NyN`
 * for instant first paint) plus a full-res layer that fades+springs in once
 * it fires `load`. For non-NetEase images there's no server-side thumbnail, so
 * the placeholder layer falls back to the full URL with a CSS blur filter —
 * the browser still benefits from progressive paint even without a smaller
 * byte budget.
 *
 * No layout pop: both layers are absolute-positioned inside the container, so
 * the children taking part in the parent grid don't shift on load.
 */
export default function ProgressiveCover({
  src,
  alt = '',
  className = '',
  thumbSize = 32,
  fallback = null,
  duration = 650,
}: Props) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const fullRef = useRef<HTMLImageElement>(null);
  const realSrc = src ? neteaseHttps(src) : undefined;
  const thumbSrc = realSrc && hasThumbnail(realSrc) ? neteaseThumb(realSrc, thumbSize) : realSrc;
  const useBlurFallback = realSrc && !hasThumbnail(realSrc);

  // If `src` changes (e.g., next track), drop the full flag so the next layer
  // animates in again.
  useEffect(() => {
    setFullLoaded(false);
  }, [realSrc]);

  // Also catch the synchronous-cache case where the new full image is already
  // decoded from memory (load fires before React's commit).
  useEffect(() => {
    if (!fullRef.current) return;
    if (fullRef.current.complete && fullRef.current.naturalWidth > 0) {
      setFullLoaded(true);
    }
  }, [realSrc]);

  if (!realSrc) {
    return <>{fallback}</>;
  }

  return (
    <div
      className={`yp-prog-cover${className ? ' ' + className : ''}`}
      style={{ '--yp-prog-duration': `${duration}ms` } as React.CSSProperties}
    >
      {/* Thumbnail layer: blurry, low opacity, springs toward hidden as the full
          layer fills in. */}
      {thumbSrc ? (
        <img
          className={`yp-prog-thumb${useBlurFallback ? ' is-blur-fallback' : ''}`}
          src={thumbSrc}
          alt=""
          aria-hidden
          data-loaded={fullLoaded ? '1' : '0'}
        />
      ) : null}
      {/* Full-res layer: hidden initial state, springs into place on load. */}
      <img
        ref={fullRef}
        className={`yp-prog-full${fullLoaded ? ' is-loaded' : ''}`}
        src={realSrc}
        alt={alt}
        onLoad={() => setFullLoaded(true)}
      />
      {thumbSrc ? null : null}
    </div>
  );
}
