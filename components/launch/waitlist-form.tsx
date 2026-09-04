"use client";
import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * ZAPIS NA PREMIERĘ — the same form in the hero and in the closing block.
 *
 * One component, one endpoint, one table: a second copy of this on the page
 * would be a second place for the behaviour to drift. The field is a native
 * type=email input at 16px so a phone keyboard opens the right layout and
 * iOS does not zoom the page; the state after submitting replaces the form
 * rather than sitting under it, so the answer is never below the fold.
 */
export function WaitlistForm({ placeholder, cta, source, consentLabel, className, id }: {
  placeholder: string;
  cta: string;
  /** Which block this submission came from — kept on the row for the admin. */
  source: string;
  /** The sentence the visitor is agreeing to. Empty (the default) means no
   *  consent checkbox is shown; writing one in the admin turns it on. */
  consentLabel?: string;
  className?: string;
  id?: string;
}) {
  const { t, locale } = useI18n();
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "created" | "exists" | "error" | "invalid">("idle");
  const needsConsent = Boolean(consentLabel);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "busy") return;
    if (needsConsent && !consent) return;
    setState("busy");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, locale, source, company, consent: needsConsent ? consent : undefined }),
      });
      const json = (await res.json()) as { ok: boolean; status?: string; error?: string };
      if (json.ok) setState(json.status === "exists" ? "exists" : "created");
      else setState(json.error === "invalid_email" ? "invalid" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "created") {
    return (
      <div data-waitlist-success
        className="flex items-start gap-3 rounded-2xl border border-[rgb(var(--accent)/0.35)] bg-accent-soft/25 px-4 py-3.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-white">
          <Check size={14} strokeWidth={3} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold tracking-tight">{t("launch.ok")}</span>
          <span className="mt-0.5 block text-[13px] text-muted">{t("launch.okBody")}</span>
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={submit} data-waitlist-form className={cn("w-full", className)} noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={id ?? `waitlist-${source}`} className="sr-only">{placeholder}</label>
        <input
          id={id ?? `waitlist-${source}`}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (state !== "idle") setState("idle"); }}
          placeholder={placeholder}
          data-waitlist-email
          className="h-12 w-full min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-base text-ink outline-none transition-colors placeholder:text-faint focus:border-[rgb(var(--accent)/0.55)] focus:ring-4 focus:ring-[rgb(var(--accent)/0.14)] sm:text-[15px]"
        />
        {/* Honeypot: off-screen, never announced, never focusable. */}
        <input
          type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden
          value={company} onChange={(e) => setCompany(e.target.value)}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />
        <button type="submit" disabled={state === "busy" || (needsConsent && !consent)} data-waitlist-submit
          className={cn("cta flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold",
            state === "busy" && "cursor-wait opacity-70")}>
          {state === "busy"
            ? <><Loader2 size={16} className="animate-spin" aria-hidden />{t("launch.busy")}</>
            : <>{cta}<ArrowRight size={16} aria-hidden /></>}
        </button>
      </div>
      {needsConsent && (
        <label data-waitlist-consent className="mt-3 flex items-start gap-2.5 text-[12.5px] leading-relaxed text-muted">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" />
          <span>{consentLabel}</span>
        </label>
      )}
      {state === "exists" && (
        <p data-waitlist-note className="mt-2 text-[13px] font-medium text-accent">{t("launch.dup")}</p>
      )}
      {state === "invalid" && (
        <p data-waitlist-note className="mt-2 text-[13px] font-medium text-warning">{t("launch.invalid")}</p>
      )}
      {state === "error" && (
        <p data-waitlist-note className="mt-2 text-[13px] font-medium text-danger">{t("launch.err")}</p>
      )}
    </form>
  );
}
