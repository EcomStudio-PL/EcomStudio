"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Ban, Check, Info, Layers, Loader2, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useDockRoom } from "@/components/layout/dock-room";
import { ToolNotice } from "@/components/public-tools/tool-notice";
import { useToolViewer } from "@/components/public-tools/tool-viewer";
import type { ToolSession } from "@/components/public-tools/use-tool-session";
import { barPriority } from "@/components/generate/bar-priority";
import { cn } from "@/lib/utils";

/**
 * THE GENERATE BAR — one for every tool that makes something.
 *
 *   [ at most one line: what stands in the way, and the way past it ]
 *   [ ✦ Generuj  ·  20 kr. ]
 *
 * It replaced the white cost card each panel drew above its button ("Koszt
 * jednego ujęcia", "Łączny koszt", the balance again): the price is ON the
 * button, its make-up one tap away on the price itself, and the line above it
 * exists only while something blocks the click.
 *
 * WHERE IT SITS. On a desktop it is the last thing in the settings column, in
 * the page rather than in a card, right under the settings card (which scrolls
 * inside itself when it is long). On a phone the SAME element docks to the
 * bottom of the screen — the app's own dock steps aside on a tool screen — so
 * it is reachable from the settings and from the results alike, and there is
 * never a second Generate button. The room it needs at the foot of the page is
 * reserved in one place (components/layout/dock-room.ts).
 *
 * The bar decides nothing the server does not decide again: it only greys out
 * a click that would be refused.
 */

export type BarState = "idle" | "sending" | "added";

export function GenerateBar({
  label, total, breakdown, state, sendingLabel, blocked, onGenerate, line, ctaAttrs,
}: {
  /** The tool's own action ("Generuj", "Stwórz miniaturkę", "Retuszuj"…). */
  label: string;
  /** Credits this click costs. 0 → no price on the button. */
  total: number;
  /** How the total is made, one line per part, from the live prices. */
  breakdown: string[];
  state: BarState;
  /** What the button says while the click is being sent (e.g. GrovBase's
   *  planner pass); the bar's own default otherwise. */
  sendingLabel?: string;
  /** The click would be refused (the line above says why). */
  blocked: boolean;
  onGenerate: () => void;
  /** The one line above the button — `useBarLine` builds it. */
  line?: React.ReactNode;
  /** The test hooks each panel's button already carries. */
  ctaAttrs?: Record<`data-${string}`, string | boolean>;
}) {
  const { t, locale } = useI18n();
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const dockRef = useRef<HTMLDivElement>(null);
  useDockRoom(dockRef);
  const keyboard = useKeyboardOpen();
  const [tip, setTip] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipId = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  // A tap outside, or Escape, closes the make-up.
  useEffect(() => {
    if (!tip) return;
    const onDown = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setTip(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTip(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [tip]);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  const sending = state === "sending";
  const added = state === "added";
  const disabled = blocked || sending || added;
  const showCost = total > 0;
  const hover = (on: boolean) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    // Hover only where there IS hover; a touch opens it with a tap on the price.
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    hoverTimer.current = setTimeout(() => setTip(on), on ? 250 : 120);
  };

  return (
    <div ref={dockRef} data-gen-dock data-tool-dock data-kb={keyboard || undefined}
      className={cn(
        "relative z-20 shrink-0",
        // The phone's dock: the bottom of the screen, above the home indicator.
        "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:border-t max-lg:border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.4))]",
        "max-lg:bg-[rgb(var(--surface))] max-lg:px-[var(--page-x)] max-lg:pt-2.5 max-lg:pb-[calc(0.625rem+env(safe-area-inset-bottom))] max-lg:shadow-e4",
        keyboard && "max-lg:hidden",
      )}>
      <div className="max-lg:mx-auto max-lg:max-w-[var(--content-max)]">
        {/* The account's line can come out as nothing at all (nothing to
            say): the empty wrapper then takes no room. */}
        {line && <div data-bar-line className="mb-2 empty:hidden">{line}</div>}
        <div ref={boxRef} className="relative" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
          <div data-blocked={disabled || undefined}
            className={cn("cta flex h-11 w-full items-stretch rounded-xl", disabled && "opacity-55")}>
            <button type="button" {...ctaAttrs} disabled={disabled} onClick={onGenerate}
              aria-describedby={showCost && tip ? tipId : undefined}
              aria-label={added ? t("inflight.added") : sending ? (sendingLabel || t("inflight.sending"))
                : showCost ? `${label} · ${n(total)} ${t("genv3.creditsShortWord")}` : label}
              onFocus={(e) => { if (e.currentTarget.matches(":focus-visible") && showCost) setTip(true); }}
              onBlur={() => setTip(false)}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-center gap-1.5 px-3 text-[13.5px] font-semibold text-white outline-none",
                "focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset",
                disabled && "cursor-not-allowed",
              )}>
              {added ? <Check size={15} aria-hidden /> : sending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />}
              {added ? (
                <span data-generate-added>{t("inflight.added")}</span>
              ) : (
                <span className="truncate">{sending ? (sendingLabel || t("inflight.sending")) : label}</span>
              )}
            </button>
            {showCost && (
              // The price is its OWN control: a tap on it explains it and can
              // never start a generation; the action is the rest of the bar.
              <button type="button" data-bar-cost aria-expanded={tip} aria-controls={tipId}
                aria-label={t("bar.costAria", { n: n(total) })}
                onClick={() => setTip((v) => !v)}
                className="flex shrink-0 items-center gap-1 border-l border-white/25 px-3.5 text-[13.5px] font-semibold tabular-nums text-white outline-none focus-visible:rounded-r-xl focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70">
                <span key={total} className="bar-cost-tick">{n(total)}</span>
                <span className="text-[12px] font-medium opacity-85">{t("genv3.creditsShortWord")}</span>
              </button>
            )}
          </div>
          {showCost && (
            <div id={tipId} role="tooltip" data-bar-breakdown hidden={!tip}
              className="overlay animate-pop absolute bottom-full right-0 z-30 mb-2 w-max max-w-[min(20rem,calc(100vw-2rem))] rounded-xl px-3 py-2.5 text-[12px] leading-relaxed">
              {breakdown.map((row) => <p key={row} className="tabular-nums text-muted">{row}</p>)}
              <p className="mt-1 border-t border-line pt-1 font-semibold tabular-nums text-ink">
                {t("bar.total", { n: n(total) })}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One line above the button: an icon, a few words, at most one way past. */
export function BarLine({ icon, tone = "muted", children, data }: {
  icon: React.ReactNode;
  tone?: "muted" | "warn";
  children: React.ReactNode;
  data?: string;
}) {
  return (
    <p data-bar-reason={data} role={tone === "warn" ? "status" : undefined}
      className={cn("flex min-w-0 items-start gap-1.5 text-[12px] leading-snug", tone === "warn" ? "text-ink" : "text-muted")}>
      <span aria-hidden className={cn("mt-[1px] shrink-0", tone === "warn" ? "text-warning" : "text-faint")}>{icon}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** The `·  Doładuj` part of a line. */
export function BarAction({ href, onClick, children, data }: {
  href?: string; onClick?: () => void; children: React.ReactNode; data?: string;
}) {
  const cls = "font-semibold text-accent transition-opacity hover:opacity-75";
  return (
    <>
      <span aria-hidden className="text-faint"> · </span>
      {href
        ? <Link href={href} className={cls} data-bar-action={data}>{children}</Link>
        : <button type="button" onClick={onClick} className={cls} data-bar-action={data}>{children}</button>}
    </>
  );
}

/**
 * WHICH ONE LINE. Several things can stand in the way at once; the bar shows
 * the one the customer has to deal with first, in one fixed order (see
 * `barPriority`): the tool itself → what the form still needs → the plan's
 * limit of generations in progress → the account and its credits (the Public
 * Tools state: confirm the address, the survey, a plan, a top-up). Every
 * refusal the server gives is still handled where it always was; this only
 * spares the click.
 */
export function useBarLine({ unavailable, invalid, limit, cost, balance, session }: {
  /** The tool cannot run right now (not configured, not offered). */
  unavailable?: string | null;
  /** The form is not complete or a value is not on offer. */
  invalid?: string | null;
  /** The plan's limit of generations in progress is reached. */
  limit?: { max: number; plan: string } | null;
  cost: number;
  balance: number;
  session?: Pick<ToolSession, "prepare" | "guest">;
}): React.ReactNode {
  const { t, locale } = useI18n();
  const viewer = useToolViewer();
  const first = barPriority({ unavailable: !!unavailable, invalid: !!invalid, limit: !!limit });
  if (first === "unavailable") return <BarLine icon={<Ban size={13} />} tone="warn" data="unavailable">{unavailable}</BarLine>;
  if (first === "invalid") return <BarLine icon={<Info size={13} />} data="invalid">{invalid}</BarLine>;
  if (first === "limit" && limit) {
    return (
      <BarLine icon={<Layers size={13} />} tone="warn" data="limit">
        {shortLimit(t, locale, limit.max)}
        {limit.plan !== "agency" && <BarAction href="/plan" data="raise">{t("inflight.raiseLimit")}</BarAction>}
      </BarLine>
    );
  }
  // The account's state, from the one Public Tools rule, as ONE line with the
  // same dialogs and actions behind it.
  if (viewer) return <ToolNotice variant="line" cost={cost} balance={balance} session={session} />;
  const missing = Math.max(0, cost - balance);
  if (missing > 0 && !session?.guest) {
    return (
      <BarLine icon={<Info size={13} />} tone="warn" data="missing">
        {t("publicTools.line.missing", { n: new Intl.NumberFormat(locale).format(missing) })}
        <BarAction href="/credits" data="topup">{t("publicTools.line.topup")}</BarAction>
      </BarLine>
    );
  }
  return null;
}

/** "Masz 3 generacje w toku — limit Twojego planu" (plural-aware). */
function shortLimit(t: ReturnType<typeof useI18n>["t"], locale: string, n: number): string {
  let form = "other";
  try { form = new Intl.PluralRules(locale).select(n); } catch { /* default */ }
  const key = `bar.limit.${form}`;
  const text = t(key, { n });
  return text === key ? t("bar.limit.other", { n }) : text;
}

/** The on-screen keyboard is up (a field has focus and the visual viewport
 *  shrank): the docked bar steps aside so it never sits over what is typed. */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "range", "button", "file"].includes((el as HTMLInputElement).type)) || el.isContentEditable);
      setOpen(typing && window.innerHeight - vv.height > 140);
    };
    vv.addEventListener("resize", check);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    return () => {
      vv.removeEventListener("resize", check);
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
    };
  }, []);
  return open;
}
