"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { ResolvedGuide } from "@/lib/tool-guides";
import { GuideArtwork } from "./guide-art";

type Tutorial = NonNullable<ResolvedGuide["tutorial"]>;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * THE TUTORIAL — one dialog for every tool, the steps are the tool's own.
 *
 * Built to sit still: every step's illustration and text are laid in the SAME
 * grid cell and only the current one is shown, so the dialog is always as
 * tall as its tallest step — moving between steps never changes its height.
 * On a phone it is a compact sheet that scrolls inside itself; on a desktop a
 * balanced card. Escape and the X close it, ←/→ (and a swipe on the picture)
 * move between steps, Tab stays inside, and focus returns to whatever opened
 * it. Rendered at <body>: no card around it can trap or clip it.
 */
export function TutorialModal({ open, onClose, tutorial, initialStep = 0 }: {
  open: boolean;
  onClose: () => void;
  tutorial: Tutorial;
  /** Where an opening starts (0-based). Only the admin's per-step preview
   *  passes one; every customer screen leaves it out and starts at step 1. */
  initialStep?: number;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const total = tutorial.steps.length;
  const last = step === total - 1;
  // Kept current for the opening below (declared first, so it runs first)
  // without making the opening re-run when it changes.
  const startAt = useRef(0);
  useEffect(() => {
    startAt.current = Number.isInteger(initialStep) ? Math.min(Math.max(0, initialStep), Math.max(0, total - 1)) : 0;
  });

  // Every opening starts at the first step (or the one asked for) and
  // remembers who opened it.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    setStep(startAt.current);
    // The page behind stays put. The lock goes on <html>: the stylesheet
    // clips it horizontally, so a lock on <body> alone never reaches the
    // viewport. A classic scrollbar keeps its gutter, so nothing shifts.
    const root = document.documentElement;
    const gutter = window.innerWidth - root.clientWidth;
    const prev = { html: root.style.overflow, body: document.body.style.overflow, gutter: root.style.scrollbarGutter };
    if (gutter > 0) root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const id = window.requestAnimationFrame(() => primaryRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(id);
      root.style.overflow = prev.html;
      document.body.style.overflow = prev.body;
      root.style.scrollbarGutter = prev.gutter;
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [open]);

  const next = useCallback(() => setStep((s) => Math.min(total - 1, s + 1)), [total]);
  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  // Escape and ←/→ work wherever the pointer last landed — a click on the
  // picture must not leave the keyboard with nowhere to go.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Not a shortcut, not handled already, not aimed at something stacked
      // above this dialog (a search palette, say). Focus on the page itself
      // (after a click on the picture) still counts as ours.
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as Node | null;
      if (target && target !== document.body && dialogRef.current && !dialogRef.current.contains(target)) return;
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, next, back]);

  // Tab stays inside the dialog.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0], end = nodes[nodes.length - 1];
    // From the first control — or from the dialog box itself, which a click
    // on the picture focuses — Shift+Tab wraps to the last one.
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) { e.preventDefault(); end.focus(); }
    else if (!e.shiftKey && active === end) { e.preventDefault(); first.focus(); }
  };

  if (!open || typeof document === "undefined") return null;

  const current = tutorial.steps[step];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-tool-tutorial>
      <div className="scrim animate-fade absolute inset-0 backdrop-blur-[3px]" onClick={onClose} aria-hidden />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={current?.body ? bodyId : undefined}
        tabIndex={-1} onKeyDown={onKeyDown}
        className={cn(
          "overlay animate-sheet relative flex w-full flex-col overflow-hidden outline-none",
          "max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] rounded-t-[26px]",
          "sm:m-4 sm:max-h-[min(92dvh,760px)] sm:max-w-[660px] sm:rounded-[28px]",
        )}
        style={{ boxShadow: "var(--shadow-4), 0 30px 80px -30px rgb(var(--accent) / 0.45)" }}>
        {/* The light: two soft washes behind the content, never over it. */}
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, rgb(var(--accent) / 0.28), transparent 70%)" }} />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-24 h-64 w-64 rounded-full opacity-50 blur-3xl"
          style={{ background: "radial-gradient(circle, rgb(var(--violet) / 0.26), transparent 70%)" }} />

        {/* HEADER — what this is, how far along, the way out. */}
        <div className="relative px-5 pb-3 pt-5 sm:px-7 sm:pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="overline text-[10px] text-accent">{t("toolGuide.overline")}</p>
              <h2 id={titleId} className="mt-1 font-display text-[18px] font-semibold leading-snug sm:text-[20px]">{tutorial.title}</h2>
              {tutorial.body && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{tutorial.body}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label={t("toolGuide.close")} data-guide-close
              className="-mr-1.5 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink">
              <X size={17} aria-hidden />
            </button>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div role="progressbar" aria-label={t("toolGuide.progress")} aria-valuemin={1} aria-valuemax={total} aria-valuenow={step + 1}
              className="flex min-w-0 flex-1 gap-1.5">
              {tutorial.steps.map((_, i) => (
                <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/70">
                  <span className={cn("block h-full rounded-full bg-accent motion-safe:transition-[width] motion-safe:duration-300",
                    i <= step ? "w-full" : "w-0")} />
                </span>
              ))}
            </div>
            <span aria-live="polite" className="shrink-0 text-[12px] font-semibold tabular-nums text-muted" data-guide-counter>
              {t("toolGuide.counter", { n: step + 1, total })}
            </span>
          </div>
        </div>

        {/* THE STEPS — all in one cell; the dialog keeps the tallest's size. */}
        <div className="thin-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-7">
          <div className="grid"
            onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
            onPointerUp={(e) => {
              const s = swipe.current; swipe.current = null;
              if (!s) return;
              const dx = e.clientX - s.x, dy = e.clientY - s.y;
              if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) next(); else back(); }
            }}>
            {tutorial.steps.map((s, i) => {
              const on = i === step;
              return (
                <section key={i} aria-hidden={!on} data-guide-step={i + 1}
                  className={cn("[grid-area:1/1] motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:ease-out",
                    on ? "visible opacity-100 translate-x-0" : cn("invisible opacity-0", i < step ? "-translate-x-3" : "translate-x-3"))}>
                  <div className="relative overflow-hidden rounded-2xl border border-line"
                    style={{ background: "linear-gradient(160deg, rgb(var(--accent) / 0.07), rgb(var(--raised) / 0.9) 45%, rgb(var(--violet) / 0.07))" }}>
                    <div className="aspect-[16/10] w-full">
                      {s.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.image.url} srcSet={s.image.srcSet} sizes="(max-width: 640px) 92vw, 600px"
                          alt={s.image.alt || s.title} loading={i === 0 ? "eager" : "lazy"} decoding="async"
                          className="h-full w-full object-contain" />
                      ) : (
                        <GuideArtwork art={s.art} className="h-full w-full" />
                      )}
                    </div>
                  </div>
                  <div className="flex gap-3.5 pb-2 pt-4">
                    <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white"
                      style={{ background: "linear-gradient(135deg, rgb(var(--accent)), rgb(var(--accent-strong)))", boxShadow: "0 8px 18px -8px rgb(var(--accent) / 0.8)" }}>
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-[15.5px] font-semibold leading-snug">
                        <span className="sr-only">{t("toolGuide.stepLabel", { n: i + 1 })}: </span>{s.title}
                      </h3>
                      {s.body && (
                        <p id={on ? bodyId : undefined} className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.body}</p>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
          <p className="sr-only" aria-live="polite">{current ? `${t("toolGuide.stepLabel", { n: step + 1 })}: ${current.title}` : ""}</p>
        </div>

        {/* FOOTER — skip, back, next / start. */}
        <div className="relative flex items-center justify-between gap-2 border-t border-line/70 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3.5 sm:px-7 sm:pb-5">
          <button type="button" onClick={onClose} data-guide-skip
            className={cn("h-10 min-w-0 truncate rounded-xl px-3 text-[13px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink",
              last && "invisible")}>
            {t("toolGuide.skip")}
          </button>
          <div className="flex items-center gap-2">
            {/* On a narrow phone "Wstecz" is its arrow alone (named for
                screen readers), so the primary button never gets clipped. */}
            <button type="button" onClick={back} disabled={step === 0} data-guide-back aria-label={t("toolGuide.back")}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40 sm:px-3.5">
              <ArrowLeft size={14} aria-hidden /><span className="max-[380px]:sr-only">{t("toolGuide.back")}</span>
            </button>
            <button ref={primaryRef} type="button" onClick={last ? onClose : next} data-guide-next={last ? "start" : "next"}
              className="cta flex h-10 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-4 text-[13px] font-semibold sm:min-w-[7.5rem]">
              {last ? <><Check size={14} aria-hidden />{t("toolGuide.start")}</> : <>{t("toolGuide.next")}<ArrowRight size={14} aria-hidden /></>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
