"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A VIDEO IN A CARD, WITHOUT COSTING THE DASHBOARD ITS DATA BUDGET.
 *
 * Six category tiles that each autoplay a clip would download six videos the
 * moment the page opens — on a phone, on someone's data. So nothing is
 * fetched until the card is ABOUT to be seen:
 *
 *   · `preload="none"` until an IntersectionObserver says the element is
 *     within a screen of the viewport, then `metadata`, then play;
 *   · the POSTER carries the card in the meantime, which is why a video slot
 *     without one is worth warning about in the admin — the alternative is a
 *     black rectangle;
 *   · `prefers-reduced-motion` is honoured: somebody who asked the system to
 *     stop moving things gets the poster and a control, not a loop.
 *
 * WHY THE SOURCE IS PICKED IN JAVASCRIPT. `<picture>` chooses between images
 * declaratively, but `<video><source media>` was dropped from the spec and no
 * browser honours it. So a responsive override for a video has to be a
 * measurement. The desktop file is what the server renders, so a phone with no
 * override never waits for JavaScript to know what to play — only a slot that
 * actually HAS a mobile file pays for the swap, and it pays before anything is
 * fetched because `preload` is still "none" at that point.
 */

type Props = {
  desktop: string;
  tablet?: string;
  mobile?: string;
  poster?: string;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  controls: boolean;
  fit: "cover" | "contain";
  position: string;
  /** The admin's alt text. A decorative clip has none and is hidden from
   *  assistive technology rather than announced as "video". */
  label?: string;
};

export function SlotVideo({
  desktop, tablet, mobile, poster, autoplay, muted, loop, controls, fit, position, label,
}: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState(desktop);
  const [near, setNear] = useState(false);
  const [calm, setCalm] = useState(false);

  // Which file this viewport should play. Runs before anything is fetched:
  // `preload` is "none" until `near` turns true, so changing src here costs
  // nothing on the wire.
  useEffect(() => {
    const pick = () => {
      if (mobile && window.matchMedia("(max-width: 639px)").matches) return mobile;
      if (tablet && window.matchMedia("(max-width: 1023px)").matches) return tablet;
      return desktop;
    };
    setSrc(pick());
    // A tablet rotated into landscape crosses a breakpoint; so does a resized
    // desktop window. Both should end up with the right file.
    const onResize = () => setSrc(pick());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [desktop, tablet, mobile]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setCalm(query.matches);
    const onChange = () => setCalm(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No observer: fetch it, because we cannot know when it is visible and a
    // permanently blank card is worse than a download.
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setNear(true); io.disconnect(); } },
      // A screen of margin: the clip has started loading by the time the card
      // is actually looked at, and never before.
      { rootMargin: "100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Autoplay only once the bytes are wanted AND the viewer has not asked for
  // less motion. A muted autoplay is the only kind a browser will honour, so
  // the two travel together.
  const plays = autoplay && near && !calm;

  return (
    <video
      ref={ref}
      // `key` on the src so a breakpoint change genuinely reloads the element
      // rather than leaving the old buffer playing.
      key={src}
      src={near ? src : undefined}
      poster={poster}
      preload={near ? "metadata" : "none"}
      autoPlay={plays}
      muted={muted || plays}
      loop={loop}
      controls={controls || calm}
      playsInline
      // A clip with no alt text is decoration; one with alt text is content.
      {...(label ? { "aria-label": label } : { "aria-hidden": true })}
      className="absolute inset-0 h-full w-full"
      style={{ objectFit: fit, objectPosition: position }}
    />
  );
}
