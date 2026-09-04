"use client";
import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { FacebookIcon, InstagramIcon } from "@/components/launch/social-icons";
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
export function WaitlistForm({
  placeholder, cta, source, consentLabel, className, id,
  successTitle, successBody, successFollow, social,
}: {
  placeholder: string;
  cta: string;
  /** Which block this submission came from — kept on the row for the admin. */
  source: string;
  /** The sentence the visitor is agreeing to. Empty (the default) means no
   *  consent checkbox is shown; writing one in the admin turns it on. */
  consentLabel?: string;
  className?: string;
  id?: string;
  /** Success-state copy, editable in the admin. */
  successTitle?: string;
  successBody?: string;
  successFollow?: string;
  /** Social profiles from the site settings. An empty URL means no button —
   *  a dead social icon is worse than none. */
  social?: { instagramUrl: string; facebookUrl: string };
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
    const socials = [
      { key: "instagram", url: social?.instagramUrl, Icon: InstagramIcon, label: "Instagram" },
      { key: "facebook", url: social?.facebookUrl, Icon: FacebookIcon, label: "Facebook" },
    ].filter((s) => Boolean(s.url));
    return (
      <div data-waitlist-success
        className="rounded-2xl border border-[rgb(var(--accent)/0.35)] bg-accent-soft/25 px-5 py-5 sm:px-6 sm:py-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white shadow-[0_10px_30px_-10px_rgb(var(--accent)/0.9)]">
          <Check size={22} strokeWidth={3} aria-hidden />
        </span>
        <p className="mt-4 font-display text-[19px] font-semibold tracking-tight">{successTitle || t("launch.ok")}</p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{successBody || t("launch.okBody")}</p>
        {socials.length > 0 && (
          <>
            <p className="mt-5 text-[13px] font-semibold">{successFollow || t("launch.success.follow")}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {socials.map(({ key, url, Icon, label }) => (
                // noreferrer as well as noopener: the launch page should not
                // announce itself to a social network as the referrer.
                <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                  data-waitlist-social={key}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[13.5px] font-semibold transition-colors hover:border-[rgb(var(--accent)/0.45)] hover:bg-raised">
                  <Icon size={16} />
                  {label}
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} data-waitlist-form className={cn("w-full", className)} noValidate>
      <div className="flex flex-col gap-2.5 sm:flex-row">
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
          // 56px on phones, 60 from sm: the single most important field on the
          // page should read as the invitation it is, and 16px text keeps iOS
          // from zooming the layout when it gains focus.
          //
          // `flex-1` is deliberately sm-only. The row stacks on phones, so
          // there flex sizes the HEIGHT — and a flex-basis of 0 would beat the
          // height class and collapse the field to its text.
          className="h-14 w-full min-w-0 rounded-2xl border border-line bg-surface px-5 text-base text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-[rgb(var(--accent)/0.6)] focus:ring-4 focus:ring-[rgb(var(--accent)/0.16)] sm:h-[60px] sm:flex-1 sm:text-[16px]"
        />
        {/* Honeypot: off-screen, never announced, never focusable. */}
        <input
          type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden
          value={company} onChange={(e) => setCompany(e.target.value)}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />
        <button type="submit" disabled={state === "busy" || (needsConsent && !consent)} data-waitlist-submit
          className={cn(
            "cta flex h-14 w-full shrink-0 items-center justify-center gap-2 rounded-2xl px-7 text-[15.5px] font-semibold",
            "sm:h-[60px] sm:w-auto",
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
