"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Lock, MailCheck, RotateCw, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { ConsentPart, SellerChannel } from "@/lib/launch/fields";
import { isLaunchEmail } from "@/lib/launch/email";
import { ChannelQuestion } from "./channel-question";
import { ReferralShare } from "./referral-share";
import { launchTrack } from "./launch-analytics";
import { browserStore, refCodeFromSearch, storedRef } from "./referral";

/**
 * ZAPIS NA PREMIERĘ — the pre-launch signup, in one component, used twice.
 *
 * The hero carries the full form (an optional first name, the address, the
 * two consents); the final call to action carries the short one (the address
 * and the consents). Both post to the same endpoint with their `form` name, so
 * the admin can see which one converts. A second copy of this component would
 * be a second place for the behaviour to drift.
 *
 * DOUBLE OPT-IN. Submitting does not put anybody on the list: it sends a
 * confirmation link, and only the click in that mail does. So the success
 * state says "check your inbox", offers to send the mail again, and — while
 * the visitor is still here — asks where they sell and hands them their
 * referral link.
 *
 * THE RESPONSE IS THE SAME FOR EVERY ADDRESS. New, already pending, already
 * confirmed, suppressed or throttled: 200 and "check your inbox" (the server
 * decides whether a mail actually goes out). The form therefore cannot tell a
 * visitor whether an address is on the list, and does not try — that is the
 * enumeration the old "Ten adres jest już zapisany" message allowed.
 *
 * TWO CONSENTS, BOTH REQUIRED, NEITHER PRE-TICKED. Their sentences come from
 * the server exactly as it will record them, with a version derived from the
 * words; the form sends the versions back, and a 409 means the wording changed
 * since this page was rendered — the visitor is asked to reload rather than
 * agree to a sentence they did not see.
 *
 * NOTHING IS ENFORCED BY DISABLING THE BUTTON. It is always live, and a submit
 * that is missing something names it next to the field, with aria-invalid and
 * aria-describedby so a screen reader hears the same thing.
 */

/** The field styling, shared by the name and the address: 48px tall, 16px
 *  text on a phone so iOS does not zoom the page on focus. */
const FIELD_CLASS = cn(
  "h-12 w-full min-w-0 rounded-xl border border-[rgb(var(--glass-border)/0.22)] bg-[rgb(var(--sunken)/0.55)]",
  "px-4 text-base text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint",
  "focus:border-[rgb(var(--accent)/0.6)] focus:ring-4 focus:ring-[rgb(var(--accent)/0.16)]",
  "sm:text-[14.5px]",
  "min-[1400px]:h-[clamp(50px,min(3.3vw,5.56vh),62px)] min-[1400px]:rounded-[clamp(13px,1vw,18px)]",
  "min-[1400px]:px-[clamp(17px,1.2vw,24px)] min-[1400px]:text-[clamp(15px,min(1.1vw,1.67vh),18px)]",
);
const FIELD_INVALID = "border-[rgb(var(--danger)/0.75)] bg-[rgb(var(--danger)/0.08)]";


/** How long "Wyślij ponownie" rests after a mail went out. The server has its
 *  own, durable limits; this only stops a nervous double press. */
const RESEND_COOLDOWN_S = 60;

export type FormConsent = { parts: ConsentPart[]; version: string };

export type WaitlistSuccessCopy = {
  title: string;
  body: string;
  /** "Wyślij ponownie". */
  resend: string;
  /** "Nie widzisz wiadomości? Sprawdź folder Spam lub". */
  resendHint: string;
  /** null = the "Gdzie sprzedajesz?" question is switched off. */
  channel: { question: string; labels: Record<SellerChannel, string>; thanks: string } | null;
  /** null = the referral card is switched off. */
  referral: { title: string; body: string; copy: string; rewardNote: string | null } | null;
};

type Field = "email" | "terms" | "marketing";
type ServerProblem = "" | "invalid" | "consent_changed" | "rate_limited" | "generic";
type Done = { email: string; answer: string | null; referralUrl: string | null };

type SignupResponse = {
  ok?: boolean;
  error?: string;
  answer?: unknown;
  referral?: { url?: unknown } | null;
};

export function WaitlistForm({
  variant, id, placeholder, cta, firstNameLabel, consents, safetyNote, success, className,
}: {
  /** Which form this is — sent with the signup and on every funnel event. */
  variant: "hero" | "final";
  /** Prefix for the field ids (unique per instance on the page). */
  id: string;
  /** The e-mail field's placeholder and accessible name. */
  placeholder: string;
  cta: string;
  /** "Imię (opcjonalnie)" — or null: the final form never asks, and the hero
   *  does not when the registration settings hide the field. */
  firstNameLabel?: string | null;
  consents: { terms: FormConsent; marketing: FormConsent };
  safetyNote?: string;
  success: WaitlistSuccessCopy;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [company, setCompany] = useState("");
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [invalid, setInvalid] = useState<Set<Field>>(new Set());
  const [problem, setProblem] = useState<ServerProblem>("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const inFlight = useRef(false);
  const started = useRef(false);
  const ids = {
    first: `${id}-first-name`,
    email: `${id}-email`,
    emailError: `${id}-email-error`,
    terms: `${id}-terms`,
    termsError: `${id}-terms-error`,
    marketing: `${id}-marketing`,
    marketingError: `${id}-marketing-error`,
    status: `${id}-status`,
  };

  /** First touch of the form — once per form per page load. */
  const onStart = () => {
    if (started.current) return;
    started.current = true;
    launchTrack("prelaunch_form_start", { form_variant: variant });
  };
  const clear = (field: Field) => setInvalid((prev) => {
    if (!prev.has(field)) return prev;
    const next = new Set(prev);
    next.delete(field);
    return next;
  });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    const wrong = new Set<Field>();
    if (!isLaunchEmail(email)) wrong.add("email");
    if (!terms) wrong.add("terms");
    if (!marketing) wrong.add("marketing");
    setInvalid(wrong);
    setProblem("");
    if (wrong.size > 0) {
      // The first thing the eye will land on, in form order.
      const first = wrong.has("email") ? ids.email : wrong.has("terms") ? ids.terms : ids.marketing;
      document.getElementById(first)?.focus();
      return;
    }

    inFlight.current = true;
    setBusy(true);
    const refCode = storedRef(browserStore()) ?? refCodeFromSearch(window.location.search);
    const name = firstNameLabel ? firstName.trim().slice(0, 40) : "";
    try {
      const res = await fetch("/api/public/prelaunch/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          ...(name ? { first_name: name } : {}),
          locale,
          form: variant,
          consent_terms: true,
          consent_marketing: true,
          consent_versions: { terms_privacy: consents.terms.version, marketing_email: consents.marketing.version },
          ...(refCode ? { ref_code: refCode } : {}),
          company,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as SignupResponse;
      if (res.ok && json.ok) {
        launchTrack("prelaunch_signup_submitted", { form_variant: variant });
        setDone({
          email: email.trim(),
          answer: typeof json.answer === "string" && json.answer ? json.answer : null,
          referralUrl: typeof json.referral?.url === "string" && json.referral.url ? json.referral.url : null,
        });
        return;
      }
      if (res.status === 400 && json.error === "invalid_email") { setInvalid(new Set<Field>(["email"])); setProblem("invalid"); }
      else if (res.status === 400 && json.error === "consent_required") setInvalid(new Set<Field>(["terms", "marketing"]));
      else if (res.status === 409) setProblem("consent_changed");
      else if (res.status === 429) setProblem("rate_limited");
      else setProblem("generic");
    } catch {
      setProblem("generic");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (done) return <SuccessState done={done} success={success} />;

  const emailMessage = problem === "invalid" ? t("launch.invalid") : t("launch.needEmail");
  const serverMessage = problem === "consent_changed" ? t("prelaunchUi.consentChanged")
    : problem === "rate_limited" ? t("prelaunchUi.rateLimited")
      : problem === "generic" ? t("launch.err") : "";

  return (
    <form onSubmit={submit} onFocus={onStart} onInput={onStart} noValidate
      data-waitlist-form={variant} className={cn("w-full", className)}>
      <div className={cn("grid gap-2.5", firstNameLabel && "sm:grid-cols-2")}>
        {firstNameLabel && (
          <div className="min-w-0">
            <label htmlFor={ids.first} className="sr-only">{firstNameLabel}</label>
            <input id={ids.first} type="text" autoComplete="given-name" maxLength={40}
              value={firstName} onChange={(e) => setFirstName(e.target.value)}
              placeholder={firstNameLabel} data-waitlist-first-name className={FIELD_CLASS} />
          </div>
        )}
        <div className="min-w-0">
          <label htmlFor={ids.email} className="sr-only">{placeholder}</label>
          <input id={ids.email} type="email" inputMode="email" autoComplete="email" required
            aria-invalid={invalid.has("email")}
            aria-describedby={invalid.has("email") ? ids.emailError : undefined}
            value={email}
            onChange={(e) => { setEmail(e.target.value); clear("email"); if (problem === "invalid") setProblem(""); }}
            placeholder={placeholder} data-waitlist-email
            className={cn(FIELD_CLASS, invalid.has("email") && FIELD_INVALID)} />
        </div>
      </div>
      {invalid.has("email") && (
        <p id={ids.emailError} data-waitlist-error="email" className="mt-1.5 text-[12.5px] font-medium text-danger">
          {emailMessage}
        </p>
      )}
      {/* Honeypot: off-screen, never announced, never focusable. */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden
        value={company} onChange={(e) => setCompany(e.target.value)}
        className="pointer-events-none absolute h-0 w-0 opacity-0" />

      {/* Consents sit ABOVE the button: you agree, then you act. */}
      <ConsentBox id={ids.terms} errorId={ids.termsError} checked={terms}
        invalid={invalid.has("terms")} error={t("prelaunchUi.needTerms")}
        onChange={(v) => { setTerms(v); if (v) clear("terms"); }} parts={consents.terms.parts} kind="terms" />
      <ConsentBox id={ids.marketing} errorId={ids.marketingError} checked={marketing}
        invalid={invalid.has("marketing")} error={t("prelaunchUi.needMarketing")}
        onChange={(v) => { setMarketing(v); if (v) clear("marketing"); }} parts={consents.marketing.parts} kind="marketing" />

      <button type="submit" disabled={busy} data-waitlist-submit aria-describedby={serverMessage ? ids.status : undefined}
        className={cn(
          "cta mt-2.5 flex h-[46px] w-full items-center justify-center gap-2 rounded-xl px-6 text-[14.5px] font-semibold sm:h-12",
          "min-[1400px]:mt-[clamp(11px,min(0.9vw,1.22vh),20px)] min-[1400px]:h-[clamp(52px,min(3.6vw,5.78vh),68px)] min-[1400px]:rounded-[clamp(13px,1vw,18px)] min-[1400px]:text-[clamp(15.5px,min(1.2vw,1.72vh),19px)]",
          busy && "cursor-wait opacity-70",
        )}>
        {busy
          ? <><Loader2 size={16} className="animate-spin" aria-hidden />{t("launch.busy")}</>
          : <><Send size={15} aria-hidden />{cta}</>}
      </button>

      <div id={ids.status} role="alert" aria-live="assertive">
        {serverMessage && (
          <p data-waitlist-note={problem} className="mt-2 text-[13px] font-medium text-danger">
            {serverMessage}
            {problem === "consent_changed" && (
              <>
                {" "}
                <button type="button" onClick={() => window.location.reload()}
                  className="tap font-semibold text-ink underline underline-offset-2">
                  {t("prelaunchUi.refresh")}
                </button>
              </>
            )}
          </p>
        )}
      </div>

      {safetyNote && (
        <p data-waitlist-privacy
          className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] leading-relaxed text-muted sm:text-[11.5px] lg:mt-1.5 min-[1400px]:mt-[clamp(9px,min(0.7vw,1.0vh),16px)] min-[1400px]:text-[clamp(12px,min(0.88vw,1.33vh),14px)]">
          <Lock size={11} aria-hidden className="shrink-0" />
          {safetyNote}
        </p>
      )}
    </form>
  );
}

/**
 * One consent: a real checkbox (keyboard, screen reader, form semantics),
 * hidden from sight, and the square beside it that the visitor sees. The
 * sentence's two documents are links that open in a new tab — clicking one
 * opens the document, it does not tick the box.
 */
function ConsentBox({ id, errorId, checked, invalid, error, onChange, parts, kind }: {
  id: string; errorId: string; checked: boolean; invalid: boolean; error: string;
  onChange: (value: boolean) => void; parts: ConsentPart[]; kind: "terms" | "marketing";
}) {
  const linkClass = "font-semibold text-accent underline decoration-[rgb(var(--accent)/0.45)] underline-offset-2 transition-colors hover:text-ink";
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="mt-2.5 min-[1400px]:mt-[clamp(10px,min(0.8vw,1.1vh),16px)]">
      <label htmlFor={id} data-waitlist-consent={kind}
        className={cn(
          "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 text-[12px] leading-[1.45] text-muted transition-colors sm:text-[12.5px] lg:py-1.5 min-[1400px]:gap-[clamp(11px,0.8vw,14px)] min-[1400px]:rounded-[clamp(13px,1vw,18px)] min-[1400px]:px-[clamp(13px,1vw,18px)] min-[1400px]:py-[clamp(7px,min(0.6vw,0.78vh),12px)] min-[1400px]:text-[clamp(13px,min(0.95vw,1.44vh),15px)]",
          invalid
            ? "border-[rgb(var(--danger)/0.7)] bg-[rgb(var(--danger)/0.08)]"
            : "border-[rgb(var(--glass-border)/0.16)] bg-[rgb(var(--sunken)/0.4)] hover:border-[rgb(var(--accent)/0.35)]",
        )}>
        <input id={id} type="checkbox" required checked={checked}
          aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}
          onChange={(e) => onChange(e.target.checked)}
          data-waitlist-consent-input={kind} className="peer sr-only" />
        <span aria-hidden className={cn(
          "mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-all min-[1400px]:h-[clamp(19px,min(1.35vw,2.11vh),24px)] min-[1400px]:w-[clamp(19px,min(1.35vw,2.11vh),24px)]",
          "border-[rgb(var(--glass-border)/0.45)] bg-[rgb(var(--sunken)/0.8)]",
          "peer-checked:border-transparent peer-checked:bg-[linear-gradient(135deg,rgb(var(--accent)),rgb(var(--accent-glow)))]",
          "peer-checked:shadow-[0_4px_14px_-4px_rgb(var(--accent)/0.9)]",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-[rgb(var(--accent)/0.55)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[rgb(var(--surface))]",
          "peer-checked:[&_svg]:opacity-100",
        )}>
          <Check size={12} strokeWidth={3.5} className="text-white opacity-0 transition-opacity" />
        </span>
        <span className="min-w-0">
          {parts.map((part, i) => part.kind === "text"
            ? <span key={i}>{part.text}</span>
            : (
              <Link key={i} href={part.link === "terms" ? "/regulamin" : "/polityka-prywatnosci"}
                target="_blank" rel="noopener" onClick={stop}
                data-consent-link={part.link} className={linkClass}>{part.text}</Link>
            ))}
        </span>
      </label>
      {invalid && (
        <p id={errorId} data-waitlist-error={kind} className="mt-1 text-[12px] font-medium text-danger">{error}</p>
      )}
    </div>
  );
}

/**
 * "Sprawdź skrzynkę" — what replaces the form once the address is in.
 * Focus moves here, so a screen reader hears the outcome instead of silence
 * where a form used to be.
 */
function SuccessState({ done, success }: { done: Done; success: WaitlistSuccessCopy }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  // The confirmation mail just went out: the button rests for the same
  // minute the server would refuse a second one in anyway.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [note, setNote] = useState<"" | "sent" | "rate_limited" | "generic">("");
  const sending = useRef(false);

  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  async function resend() {
    if (sending.current || cooldown > 0) return;
    sending.current = true;
    setNote("");
    try {
      const res = await fetch("/api/public/prelaunch/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: done.email }),
      });
      setNote(res.ok ? "sent" : res.status === 429 ? "rate_limited" : "generic");
      if (res.ok || res.status === 429) setCooldown(RESEND_COOLDOWN_S);
    } catch {
      setNote("generic");
    } finally {
      sending.current = false;
    }
  }

  const noteText = note === "sent" ? t("prelaunchUi.resent")
    : note === "rate_limited" ? t("prelaunchUi.rateLimited")
      : note === "generic" ? t("launch.err") : "";

  return (
    <div ref={box} tabIndex={-1} data-waitlist-success
      className="rounded-2xl border border-[rgb(var(--accent)/0.35)] bg-accent-soft/25 px-4 py-5 outline-none sm:px-6 sm:py-6">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white shadow-[0_10px_30px_-10px_rgb(var(--accent)/0.9)]">
        <MailCheck size={21} strokeWidth={2.4} aria-hidden />
      </span>
      <p className="mt-4 font-display text-[19px] font-semibold tracking-tight text-ink">{success.title}</p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{success.body}</p>

      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        {success.resendHint}{" "}
        <button type="button" onClick={resend} disabled={cooldown > 0} data-waitlist-resend
          className={cn(
            "tap inline-flex items-center gap-1 font-semibold underline underline-offset-2",
            cooldown > 0 ? "cursor-default text-muted no-underline" : "text-accent hover:text-ink",
          )}>
          <RotateCw size={12} aria-hidden />
          {cooldown > 0 ? t("prelaunchUi.resendIn", { s: cooldown }) : success.resend}
        </button>
      </p>
      <p role="status" className="mt-1 text-[12.5px] font-medium text-ink">{noteText}</p>

      {success.channel && done.answer && (
        <ChannelQuestion answer={done.answer} question={success.channel.question}
          labels={success.channel.labels} thanks={success.channel.thanks} />
      )}
      {success.referral && done.referralUrl && (
        <ReferralShare url={done.referralUrl} title={success.referral.title} body={success.referral.body}
          copyLabel={success.referral.copy} rewardNote={success.referral.rewardNote} />
      )}
    </div>
  );
}
