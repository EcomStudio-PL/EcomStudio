"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RotateCcw, RotateCw, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import {
  SMART_PROMPT_ERRORS, SMART_PROMPT_MAX, SMART_PROMPT_MIN,
  type SmartPromptError, type SmartPromptOffer,
} from "@/lib/smart-prompt";

/**
 * INTELIGENTNY PROMPT — the editor side.
 *
 * STRICT PASSTHROUGH, SEEN FROM HERE: the answer replaces the textarea's text
 * and that is all. Nothing is kept aside to be sent later; Generate reads the
 * same `prompt` state it always read, so what the customer sees is what the
 * image model gets.
 *
 * Three things are remembered for one idea: what the customer wrote
 * (`originalIntent`), the version now in the field (`enhancedPrompt`) and
 * which version that is (`variationIndex`). "Another version" always starts
 * again from `originalIntent` — never from the previous rewrite — and is a new
 * click, so a new charge. Restoring the original is free and local.
 *
 * Editing by hand is respected: once the text differs from the rewrite, the
 * corner button (which would overwrite it) goes away, and the main button
 * takes the CURRENT text as the new idea — an explicit choice, never a reset
 * that happens by itself.
 */

export type SmartSession = { originalIntent: string; enhancedPrompt: string; variationIndex: number };

type Reply = { ok?: boolean; prompt?: unknown; credits?: unknown; balance?: unknown; error?: unknown };
type ErrorCode = SmartPromptError | "generic";

/** "1 kredyt" / "3 kredyty" / "5 kredytów" — the dictionaries hold the forms. */
export function creditLabel(t: (key: string, vars?: Record<string, string | number>) => string, n: number): string {
  if (n === 1) return t("genv3.smart.costOne", { n });
  const tens = n % 100;
  const ones = n % 10;
  const few = ones >= 2 && ones <= 4 && (tens < 12 || tens > 14);
  return t(few ? "genv3.smart.costFew" : "genv3.smart.costMany", { n });
}

export function useSmartPrompt({ value, onChange, offer, referencePaths, balance, onBalance }: {
  value: string;
  onChange: (v: string) => void;
  offer: SmartPromptOffer | undefined;
  referencePaths: string[];
  balance: number;
  onBalance: (update: (b: number) => number) => void;
}) {
  const { t } = useI18n();
  const [session, setSession] = useState<SmartSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [status, setStatus] = useState("");
  /** The server said the feature cannot run — stop offering it this visit. */
  const [down, setDown] = useState(false);
  const inFlight = useRef(false);

  // An error is about the text it was raised for: editing that text clears it.
  useEffect(() => { setError(null); }, [value]);

  const credits = offer?.credits ?? 0;
  const cost = creditLabel(t, credits);
  const offered = !!offer?.available && credits > 0;
  const enhanced = !!session && value === session.enhancedPrompt;
  const canRestore = !!session && value !== session.originalIntent;
  const tooShort = value.trim().length < SMART_PROMPT_MIN;
  const canEnhance = offered && !down && !busy && !tooShort && value.length <= SMART_PROMPT_MAX;

  // Every code has a sentence in all three dictionaries (the suite checks it);
  // anything the server might add later arrives here as "generic".
  const errorText = useCallback((code: ErrorCode) => t(`genv3.smart.err.${code}`), [t]);

  const run = useCallback(async (intent: string, variationIndex: number) => {
    if (inFlight.current) return;
    if (balance < credits) {
      setError("insufficient_credits");
      setStatus(errorText("insufficient_credits"));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setStatus(t("genv3.smart.busy"));
    try {
      const res = await fetch("/api/smart-prompt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // One id per deliberate click: a re-sent copy of THIS request is the
        // same charge on the server; the next click is a new one.
        body: JSON.stringify({ requestId: crypto.randomUUID(), intent, variationIndex, referencePaths }),
      });
      let json: Reply = {};
      try { json = (await res.json()) as Reply; } catch { /* handled below */ }
      if (json.ok && typeof json.prompt === "string" && json.prompt.length > 0) {
        const text = json.prompt;
        onChange(text);
        setSession({ originalIntent: intent, enhancedPrompt: text, variationIndex });
        const charged = typeof json.credits === "number" ? json.credits : credits;
        if (typeof json.balance === "number") {
          const next = json.balance;
          onBalance(() => next);
        } else {
          onBalance((b) => Math.max(0, b - charged));
        }
        setStatus(t("genv3.smart.done", { n: variationIndex + 1, cost: creditLabel(t, charged) }));
      } else {
        const code: ErrorCode = typeof json.error === "string" && (SMART_PROMPT_ERRORS as readonly string[]).includes(json.error)
          ? (json.error as SmartPromptError) : "generic";
        if (code === "unavailable" || code === "feature_unavailable" || code === "maintenance") setDown(true);
        setError(code);
        setStatus(errorText(code));
      }
    } catch {
      setError("generic");
      setStatus(errorText("generic"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [balance, credits, errorText, onBalance, onChange, referencePaths, t]);

  /** The main button. On an untouched rewrite it asks for another version of
   *  the SAME idea; otherwise the text in the field is the idea. */
  const enhance = useCallback(() => {
    if (!canEnhance) return;
    if (session && enhanced) return void run(session.originalIntent, session.variationIndex + 1);
    const next = session && session.originalIntent === value ? session.variationIndex + 1 : 0;
    return void run(value, next);
  }, [canEnhance, enhanced, run, session, value]);

  const regenerate = useCallback(() => {
    if (!session || !offered || down || busy) return;
    void run(session.originalIntent, session.variationIndex + 1);
  }, [busy, down, offered, run, session]);

  const restore = useCallback(() => {
    if (!session || busy) return;
    onChange(session.originalIntent);
    setError(null);
    setStatus(t("genv3.smart.restored"));
  }, [busy, onChange, session, t]);

  return {
    offered, down, busy, error, status, session, enhanced, canRestore, canEnhance, tooShort, cost,
    errorText, enhance, regenerate, restore,
  };
}

export type SmartPromptControls = ReturnType<typeof useSmartPrompt>;

/** The magenta pill beside the counter. */
export function SmartPromptButton({ smart }: { smart: SmartPromptControls }) {
  const { t } = useI18n();
  if (!smart.offered) return null;
  const edited = !!smart.session && !smart.enhanced;
  const hint = smart.down ? t("genv3.smart.err.unavailable")
    : smart.tooShort ? t("genv3.smart.emptyHint")
    : smart.enhanced ? t("genv3.smart.againTitle")
    : edited ? t("genv3.smart.editedTitle")
    : t("genv3.smart.title");
  return (
    <button
      type="button"
      data-smart-prompt
      onClick={smart.enhance}
      disabled={!smart.canEnhance}
      aria-busy={smart.busy || undefined}
      title={hint}
      aria-label={`${t("genv3.smart.button")} · ${smart.cost}`}
      aria-describedby="smart-prompt-hint"
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-colors duration-150",
        "border-[rgb(var(--accent)/0.4)] bg-accent-soft/70 text-accent",
        "hover:border-[rgb(var(--accent)/0.65)] hover:bg-accent-soft",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent)/0.55)] focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        "disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-faint",
        smart.busy && "disabled:border-[rgb(var(--accent)/0.4)] disabled:text-accent",
      )}
    >
      {smart.busy
        ? <Loader2 size={12} aria-hidden className="animate-spin" />
        : <Sparkles size={12} aria-hidden />}
      <span>{smart.busy ? t("genv3.smart.busy") : t("genv3.smart.button")}</span>
      {!smart.busy && <span aria-hidden className="font-medium opacity-75">· {smart.cost}</span>}
      <span id="smart-prompt-hint" className="sr-only">{hint}</span>
    </button>
  );
}

/** The small "another version" icon in the field's top-right corner — shown
 *  only while the field holds an untouched rewrite. Spins only in flight. */
export function SmartPromptCorner({ smart }: { smart: SmartPromptControls }) {
  const { t } = useI18n();
  if (!smart.offered || !smart.session || !smart.enhanced) return null;
  const label = t("genv3.smart.again");
  return (
    <span className="group/again absolute right-1.5 top-1.5 z-[1]">
      <button
        type="button"
        data-smart-again
        onClick={smart.regenerate}
        disabled={smart.busy || smart.down}
        aria-busy={smart.busy || undefined}
        aria-label={`${label} · ${smart.cost}`}
        className={cn(
          "grid h-7 w-7 place-items-center rounded-lg border border-transparent text-accent transition-colors duration-150",
          "hover:border-[rgb(var(--accent)/0.35)] hover:bg-accent-soft/80",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent)/0.55)]",
          "disabled:cursor-not-allowed disabled:text-faint",
          smart.busy && "disabled:text-accent",
        )}
      >
        <RotateCw size={14} aria-hidden className={cn(smart.busy && "animate-spin")} />
      </button>
      <span role="presentation" aria-hidden
        className={cn(
          "pointer-events-none absolute right-0 top-full mt-1 whitespace-nowrap rounded-md border border-line bg-float px-2 py-1 text-[10.5px] font-medium text-ink shadow-e2",
          "opacity-0 transition-opacity duration-150 group-hover/again:opacity-100 group-focus-within/again:opacity-100",
        )}>
        {label} · {smart.cost}
      </span>
    </span>
  );
}

/** "Przywróć mój opis" — free, local, beside "Zwiń". */
export function SmartPromptRestore({ smart }: { smart: SmartPromptControls }) {
  const { t } = useI18n();
  if (!smart.canRestore) return null;
  return (
    <button type="button" data-smart-restore onClick={smart.restore} disabled={smart.busy}
      title={t("genv3.smart.restoreTitle")}
      className="flex items-center gap-1 text-[10.5px] font-semibold text-faint transition-colors hover:text-accent focus-visible:text-accent focus-visible:outline-none disabled:opacity-50">
      <RotateCcw size={11} aria-hidden />
      {t("genv3.smart.restore")}
    </button>
  );
}

/** The error line (with a top-up link when it is about credits) and the
 *  polite live region that announces progress to screen readers. */
export function SmartPromptStatus({ smart }: { smart: SmartPromptControls }) {
  const { t } = useI18n();
  return (
    <>
      <span className="sr-only" aria-live="polite" data-smart-status>{smart.status}</span>
      {smart.error && (
        <p role="alert" data-smart-error={smart.error} className="mt-1.5 px-1.5 text-[11px] leading-snug text-danger">
          {smart.errorText(smart.error)}
          {smart.error === "insufficient_credits" && (
            <>{" "}<Link href="/credits" className="font-semibold text-accent hover:opacity-75">{t("credits.topup")}</Link></>
          )}
        </p>
      )}
    </>
  );
}
