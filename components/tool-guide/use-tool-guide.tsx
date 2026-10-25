"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { markToolTutorialSeenAction } from "@/app/actions/tool-guide-seen";
import { shouldAutoOpen, type GuideResponse, type GuideToolKey } from "@/lib/tool-guides";
import { TutorialModal, preloadGuideChunks } from "./lazy";
import { useIsGuest } from "@/components/public-tools/tool-viewer";

/**
 * ONE TOOL'S GUIDE ON ITS SCREEN — fetched after the gallery has painted, so
 * a tool page waits for nothing and needs no change of its own (the frozen
 * Retusz page included: the gallery asks for its own tool's guide).
 *
 * Returns what the gallery places: the "Samouczek" button (null until the
 * guide arrives and only on a live tool), the tutorial dialog, and the answer
 * the starter-gallery decision needs. A failed fetch leaves everything as it
 * was before this feature — no button, no example effects, no dialog.
 */
export function useToolGuide(requested: GuideToolKey | null, opts: { compactLabel?: boolean } = {}): {
  response: GuideResponse | null;
  /** Still asking: the empty gallery waits for the answer rather than
   *  flashing one empty state and then another. */
  pending: boolean;
  /** The tutorial is on screen: the tool's own shortcuts and drop targets
   *  stand down while it is. */
  open: boolean;
  button: ReactNode;
  dialog: ReactNode;
} {
  const { t } = useI18n();
  // A visitor (Public Tools V1) has no account to mark a guide seen on, and
  // the guide endpoint answers members only: no request is made for them.
  const guest = useIsGuest();
  const tool = guest ? null : requested;
  const [response, setResponse] = useState<GuideResponse | null>(null);
  const [pending, setPending] = useState(Boolean(tool));
  const [open, setOpen] = useState(false);
  const autoDone = useRef(false);
  /** An auto-open still waiting for another dialog to close. */
  const waiting = useRef<number | null>(null);

  useEffect(() => {
    if (!tool) { setPending(false); return; }
    preloadGuideChunks();
    let alive = true;
    setPending(true);
    setResponse(null);
    autoDone.current = false;
    fetch(`/api/tool-guides?tool=${encodeURIComponent(tool)}`, { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: (GuideResponse & { ok?: boolean }) | null) => {
        if (!alive) return;
        if (json?.ok) {
          setResponse({ guide: json.guide, seen: json.seen, live: json.live, hasResults: json.hasResults, usedBefore: json.usedBefore ?? null });
        }
      })
      .catch(() => { /* no guide: the screen stays exactly as it was */ })
      .finally(() => { if (alive) setPending(false); });
    return () => { alive = false; };
  }, [tool]);

  // FIRST VISIT: open by itself once — on a live tool, for a version this
  // user has not seen, and (for the first version) only for someone new to
  // the tool: a seller who already has results here knows it. Never over
  // another dialog or the visual editor; it waits for them to close instead.
  useEffect(() => {
    if (!tool || !response || autoDone.current) return;
    if (!shouldAutoOpen(response, false)) return;
    autoDone.current = true;
    let tries = 0;
    const blocked = () => Boolean(document.querySelector('[role="dialog"][aria-modal="true"], [data-ice-ui]'));
    const go = () => {
      setOpen(true);
      // Seen when it OPENS, so leaving mid-tutorial does not bring it back on
      // every visit. Fire-and-forget: a failed mark only means it shows again.
      void markToolTutorialSeenAction(tool).catch(() => undefined);
    };
    if (!blocked()) { go(); return; }
    const stop = () => { window.clearInterval(id); if (waiting.current === id) waiting.current = null; };
    const id = window.setInterval(() => {
      tries++;
      if (!blocked()) { stop(); go(); }
      else if (tries > 90) stop();
    }, 1000);
    waiting.current = id;
    return stop;
  }, [tool, response]);

  const close = useCallback(() => setOpen(false), []);
  // Opened by hand while an auto-open was still waiting: that one is
  // dropped (it would open again after this closes) and the visit counts.
  const openByHand = useCallback(() => {
    if (waiting.current !== null && tool) {
      window.clearInterval(waiting.current);
      waiting.current = null;
      void markToolTutorialSeenAction(tool).catch(() => undefined);
    }
    setOpen(true);
  }, [tool]);
  const tutorial = response?.live ? response.guide?.tutorial ?? null : null;

  const button = tutorial && tutorial.steps.length > 0 ? (
    <button type="button" data-guide-open onClick={openByHand}
      aria-label={t("toolGuide.openAria")} title={t("toolGuide.openAria")} aria-haspopup="dialog"
      className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-line px-3 text-[12.5px] font-semibold text-muted transition-colors duration-200 hover:bg-raised hover:text-ink">
      <BookOpen size={14} aria-hidden className="text-accent" />
      <span className={cn(opts.compactLabel && "lg:max-xl:sr-only")}>{t("toolGuide.open")}</span>
    </button>
  ) : null;

  // Mounted only while open: nothing of it sits in the page otherwise.
  const dialog = tutorial && open ? <TutorialModal open onClose={close} tutorial={tutorial} /> : null;

  return { response, pending, open, button, dialog };
}
