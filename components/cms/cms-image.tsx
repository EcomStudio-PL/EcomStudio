import { safeUrl } from "@/lib/cms";
import type { MediaMeta } from "@/lib/server/cms-media";

/**
 * AN IMAGE ON A PUBLIC PAGE.
 *
 * A marketing page is mostly pictures, so this component is most of its
 * performance. Four things it always does, because leaving any of them out is
 * how a landing page ends up at a 4-second LCP and a visibly jumping layout:
 *
 *   WIDTH AND HEIGHT are printed whenever they are known, so the browser
 *   reserves the box before a byte of image arrives. Without them the text
 *   below reflows when each image lands — that is CLS, and it is the single
 *   most common defect on a hand-built landing page.
 *
 *   SRCSET + SIZES are emitted whenever derivatives exist, so a 390px phone
 *   downloads a 640px file instead of the 2400px original. The original is
 *   never replaced; it stays the `src` and the largest candidate.
 *
 *   LAZY EVERYWHERE EXCEPT THE FIRST SCREEN. `priority` turns off lazy
 *   loading AND sets fetchpriority="high" — the hero image is the thing the
 *   page is measured on, and telling the browser to fetch it last is a
 *   self-inflicted LCP.
 *
 *   ONLY https URLS RENDER. safeUrl() refuses anything else, which is how a
 *   `javascript:` or a `data:` URL in a CMS field stays a broken image rather
 *   than becoming a script.
 *
 * Deliberately a plain <img> rather than next/image: the media manager accepts
 * arbitrary https images, and next/image refuses any host not listed in
 * next.config. A component that works for our bucket and throws for an
 * external logo is worse than one that always works.
 */

export function CmsImage({
  url, alt, meta, priority = false, sizes = "100vw", className, aspect,
}: {
  url: string | undefined | null;
  /** Empty string is legitimate: a decorative image is announced by saying
   *  nothing, and a screen reader skips it. */
  alt: string;
  meta?: MediaMeta;
  priority?: boolean;
  sizes?: string;
  className?: string;
  /** `4 / 5`, `16 / 9` — used when the real dimensions are unknown, so the
   *  box is still reserved. */
  aspect?: string;
}) {
  const safe = safeUrl(url ?? undefined);
  if (!safe) return null;

  const srcSet = buildSrcSet(meta);
  const dims = meta?.width && meta.height
    ? { width: meta.width, height: meta.height }
    : {};
  const style = !meta?.width && aspect ? { aspectRatio: aspect } : undefined;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={safe}
      {...(srcSet ? { srcSet, sizes } : {})}
      {...dims}
      style={style}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      // High for the LCP candidate; "auto" rather than "low" for the rest, so
      // a below-fold image still loads promptly once it is reached.
      fetchPriority={priority ? "high" : "auto"}
      decoding={priority ? "sync" : "async"}
      className={className}
    />
  );
}

/** `url 640w, url 1280w, …` from the derivatives the media table recorded.
 *  Returns null when there are none, so no srcset attribute is printed at all
 *  rather than one that points at files which may not exist. */
function buildSrcSet(meta: MediaMeta | undefined): string | null {
  const variants = meta?.variants;
  if (!variants) return null;
  const candidates = Object.entries(variants)
    .map(([width, href]) => {
      const w = Number(width);
      const safe = safeUrl(href);
      return Number.isFinite(w) && w > 0 && safe ? `${safe} ${w}w` : null;
    })
    .filter((c): c is string => c !== null);
  return candidates.length > 0 ? candidates.join(", ") : null;
}
