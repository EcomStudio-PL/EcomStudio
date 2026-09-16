"use client";
import { useEffect } from "react";

/**
 * FREEZE THE PAGE BEHIND AN OVERLAY — and put it back exactly where it was.
 *
 * `overflow: hidden` on the body is the usual answer and it is not enough on a
 * phone. iOS Safari keeps scrolling the document anyway: the overlay opens, the
 * finger lands on it, and the page underneath slides. What actually stops it is
 * taking the body out of flow — `position: fixed` — which pins it whatever the
 * touch does.
 *
 * The price of that is the whole point of this file. A fixed body forgets where
 * it was scrolled to and jumps to the top, so the scroll offset is read BEFORE
 * the freeze and written back into `top` as a negative offset, which keeps the
 * page looking untouched behind the overlay. On release the offset is restored
 * with `scrollTo`, and because `position: fixed` is dropped in the same frame
 * the page never flashes at the top.
 *
 * WHAT IT RESTORES IS WHAT IT FOUND, not a guess at defaults: every property it
 * touches is read first and written back verbatim, so a page that already had
 * its own `overflow` or `paddingRight` keeps it. `scrollBehavior` is forced to
 * `auto` for the one `scrollTo` call, because a site-wide `scroll-behavior:
 * smooth` would otherwise animate the restore and make closing look like the
 * page was scrolling by itself.
 *
 * The scrollbar's width is added as padding on a desktop, where a scrollbar
 * takes real space and removing it would shift the whole layout sideways behind
 * the overlay. On a phone there is no such gutter and the value is 0.
 */
export function useScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    const { body, documentElement: root } = document;
    const y = window.scrollY;
    const gutter = window.innerWidth - root.clientWidth;

    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
      overscroll: body.style.overscrollBehavior,
    };

    body.style.position = "fixed";
    body.style.top = `${-y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    // Stops a scroll that reaches the end of the overlay from being handed to
    // the page — and stops the pull-to-refresh gesture along with it.
    body.style.overscrollBehavior = "none";
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;

    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      body.style.paddingRight = prev.paddingRight;
      body.style.overscrollBehavior = prev.overscroll;

      const behavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(0, y);
      root.style.scrollBehavior = behavior;
    };
  }, [locked]);
}
