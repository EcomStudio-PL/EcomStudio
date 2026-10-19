"use client";
import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { goToForm, launchTrack } from "./launch-analytics";

/**
 * THE PHONE'S STICKY "ZAPISZ SIĘ" BAR — only when it is the shortest way to
 * the form.
 *
 * A long page on a phone puts the form a dozen swipes away once the visitor is
 * in the galleries. This bar brings it back — and gets out of the way in every
 * situation where it would be in it:
 *
 *  - EITHER FORM IS ON SCREEN — or the hero form is still AHEAD (a short
 *    phone, where it starts just under the fold). A button that scrolls to
 *    the thing already in view, or one swipe away, is noise, and it would sit
 *    over the form's own button. It appears once the visitor has passed it.
 *  - THE FOOTER IS ON SCREEN. It would cover the legal links, which must stay
 *    one tap away.
 *  - THE KEYBOARD IS OPEN. visualViewport shrinks while it is up (the layout
 *    viewport does not); a bar pinned to the bottom of a half-height window
 *    covers the field being typed into. A field holding focus counts too,
 *    because some keyboards do not resize the visual viewport.
 *
 * Below md only (`md:hidden`): from a tablet up the hero form and the final
 * call to action are close enough together. It clears the home indicator with
 * the safe-area inset, and slides — or, for reduced motion, simply appears.
 *
 * Hidden on the server and on the first client render (it is fixed, so its
 * absence moves nothing), then decided by observers.
 */
const FORM_ANCHORS = "zapis,zapis-koniec";

export function StickyCta({ label, watch = FORM_ANCHORS }: {
  label: string;
  /** Comma-separated ids of the form anchors whose visibility hides the bar
   *  (a string, so the effect below depends on a value, not an identity). */
  watch?: string;
}) {
  const [formsInView, setFormsInView] = useState(true);
  const [heroPassed, setHeroPassed] = useState(false);
  const [footerInView, setFooterInView] = useState(false);
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    const targets = watch.split(",").map((id) => document.getElementById(id.trim())).filter((el): el is HTMLElement => Boolean(el));
    const footer = document.querySelector<HTMLElement>("[data-launch-footer]");
    if (typeof IntersectionObserver === "undefined") return;

    const visible = new Map<Element, boolean>();
    const forms = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        visible.set(entry.target, entry.isIntersecting);
        // The first anchor is the hero form: passed = above the viewport.
        if (entry.target === targets[0]) setHeroPassed(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      }
      setFormsInView([...visible.values()].some(Boolean));
    }, { threshold: 0 });
    targets.forEach((el) => forms.observe(el));

    const foot = new IntersectionObserver(([entry]) => setFooterInView(Boolean(entry?.isIntersecting)), { threshold: 0 });
    if (footer) foot.observe(footer);

    return () => { forms.disconnect(); foot.disconnect(); };
  }, [watch]);

  useEffect(() => {
    const vv = window.visualViewport;
    const typing = () => {
      const el = document.activeElement as HTMLElement | null;
      return Boolean(el && el.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([readonly]), textarea, select"));
    };
    const update = () => {
      const shrunk = vv ? window.innerHeight - vv.height > 140 : false;
      setKeyboard(shrunk || typing());
    };
    // On focusout the next field may not have focus yet; look again after
    // the event has finished moving it.
    const later = () => { window.setTimeout(update, 0); };
    update();
    vv?.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", later);
    return () => {
      vv?.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", later);
    };
  }, []);

  const shown = heroPassed && !formsInView && !footerInView && !keyboard;

  return (
    <div data-launch-sticky aria-hidden={!shown}
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-6 md:hidden",
        "bg-[linear-gradient(0deg,rgb(var(--bg)/0.92)_0%,rgb(var(--bg)/0.6)_60%,transparent_100%)]",
        "transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-full opacity-0",
      )}>
      <button type="button" tabIndex={shown ? 0 : -1} data-launch-sticky-cta
        onClick={() => {
          launchTrack("prelaunch_cta_clicked", { cta_id: "sticky_cta", section: "sticky" });
          goToForm("zapis");
        }}
        className={cn(
          "cta flex h-12 w-full items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold",
          shown && "pointer-events-auto",
        )}>
        <Send size={15} aria-hidden />{label}
      </button>
    </div>
  );
}
