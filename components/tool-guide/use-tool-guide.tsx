"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { markToolTutorialSeenAction } from "@/app/actions/tool-guide-seen";
import { shouldAutoOpen, type GuideResponse, type GuideToolKey } from "@/lib/tool-guides";
import { TutorialModal, preloadGuideChunks } from "./lazy";

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
export function useToolGuide(tool: GuideToolKey | null, opts: { compactLabel?: boolean } = {}): {
  response: GuideResponse | null;
  /** Still asking: the empty gallery waits for the answer rather than
   *  flashing one empty state and then another. */
  pending: boolean;
  button: ReactNode;
  dialog: ReactNode;
} {
  const { t } = useI18n();
  const [response, setResponse] = useState<GuideResponse | null>(null);
  const [pending, setPending] = useState(Boolean(tool));
  const [open, setOpen] = useState(false);
  const autoDone = useRef(false);

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
        if (json?.ok) setResponse({ guide: json.guide, seen: json.seen, live: json.live, hasResults: json.hasResults });
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
    const firstTime = response.hasResults === false || (response.guide?.version ?? 1) > 1;
    if (!firstTime || !shouldAutoOpen(response, false)) return;
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
    const id = window.setInterval(() => {
      tries++;
      if (!blocked()) { window.clearInterval(id); go(); }
      else if (tries > 90) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [tool, response]);

  const close = useCallback(() => setOpen(false), []);
  const tutorial = response?.live ? response.guide?.tutorial ?? null : null;

  const button = tutorial && tutorial.steps.length > 0 ? (
    <button type="button" data-guide-open onClick={() => setOpen(true)}
      aria-label={t("toolGuide.openAria")} title={t("toolGuide.openAria")} aria-haspopup="dialog"
      className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-line px-3 text-[12.5px] font-semibold text-muted transition-colors duration-200 hover:bg-raised hover:text-ink">
      <BookOpen size={14} aria-hidden className="text-accent" />
      <span className={cn(opts.compactLabel && "lg:max-xl:sr-only")}>{t("toolGuide.open")}</span>
    </button>
  ) : null;

  const dialog = tutorial ? <TutorialModal open={open} onClose={close} tutorial={tutorial} /> : null;

  return { response, pending, button, dialog };
}
