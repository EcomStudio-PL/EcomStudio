"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, Loader2, Lock, Send } from "lucide-react";
import { FacebookIcon, InstagramIcon, LinkedinIcon, XIcon } from "@/components/launch/social-icons";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { FieldMode, WaitlistFieldConfig } from "@/lib/server/registration-config";

/**
 * ZAPIS NA PREMIERĘ — the pre-launch signup, in one component.
 *
 * One component, one endpoint, one table: a second copy of this on the page
 * would be a second place for the behaviour to drift. The field is a native
 * type=email input at 16px so a phone keyboard opens the right layout and
 * iOS does not zoom the page; the state after submitting replaces the form
 * rather than sitting under it, so the answer is never below the fold.
 *
 * The name fields above the address are the admin's decision, not this file's:
 * `fields` says per field whether it is hidden, optional or required. There is
 * no phone field here at all — a mailing list is built on e-mail.
 *
 * NOTHING IS ENFORCED BY DISABLING THE BUTTON. A submit button that is greyed
 * out because a checkbox further up is unticked tells the visitor nothing; it
 * just stops working. So the button is always live and the form answers with
 * a message that names what is missing.
 */

/** The launch page's field styling, in one place so the optional name inputs
 *  cannot drift from the e-mail field they sit above: 48px tall, 16px text so
 *  iOS does not zoom the layout on focus. */
const FIELD_CLASS = cn(
  "h-12 w-full min-w-0 rounded-xl border border-[rgb(var(--glass-border)/0.22)] bg-[rgb(var(--sunken)/0.55)]",
  "px-4 text-base text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint",
  "focus:border-[rgb(var(--accent)/0.6)] focus:ring-4 focus:ring-[rgb(var(--accent)/0.16)]",
  "sm:text-[14.5px]",
  // From lg the field grows with the screen, like everything else on the
  // desktop landing page. Below lg nothing changes — the phone layout is
  // finished and is not to be touched.
  "min-[1400px]:h-[clamp(50px,min(3.3vw,5.56vh),62px)] min-[1400px]:rounded-[clamp(13px,1vw,18px)]",
  "min-[1400px]:px-[clamp(17px,1.2vw,24px)] min-[1400px]:text-[clamp(15px,min(1.1vw,1.67vh),18px)]",
);

/** The same field, flagged. Applied only after a submit attempt — a form that
 *  turns red while you are still filling it in is nagging, not helping. */
const FIELD_INVALID = "border-[rgb(var(--danger)/0.75)] bg-[rgb(var(--danger)/0.08)]";

/** No field is asked for unless the admin turned it on. Matches the seeded
 *  defaults' shape, so a caller that has not threaded the config through yet
 *  gets the plain e-mail form rather than a crash. */
const NO_EXTRA_FIELDS: WaitlistFieldConfig = { firstName: "hidden", lastName: "hidden" };

/** Roughly what the route's own regex accepts. Deliberately loose: this only
 *  catches the empty box and the obvious typo, and the server decides. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

/** Where the consent sentence puts its two links. An admin rewriting the
 *  sentence keeps the links by keeping the tokens; drop them and the links are
 *  appended after the sentence instead, because they are not optional. */
const PRIVACY_TOKEN = "{privacy}";
const TERMS_TOKEN = "{terms}";
const TOKENS = /(\{privacy\}|\{terms\})/g;

type ExtraField = {
  /** The JSON key the route reads — first_name / last_name. */
  name: "first_name" | "last_name";
  mode: FieldMode;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
};

/** What a submit attempt found wrong, or "" when it found nothing. */
type Problem = "" | "email" | "required" | "consent";

export function WaitlistForm({
  placeholder, cta, source, consentLabel, className, id,
  successTitle, successBody, successFollow, social, fields = NO_EXTRA_FIELDS, safetyNote,
}: {
  placeholder: string;
  cta: string;
  /** Which block this submission came from — kept on the row for the admin. */
  source: string;
  /** The sentence the visitor agrees to. Empty falls back to the shipped one:
   *  the consent is mandatory, so it can be reworded but never switched off. */
  consentLabel?: string;
  className?: string;
  id?: string;
  /** Success-state copy, editable in the admin. */
  successTitle?: string;
  successBody?: string;
  successFollow?: string;
  /** Social profiles from the site settings. An empty URL means no button —
   *  a dead social icon is worse than none. */
  social?: { instagramUrl: string; facebookUrl: string; linkedinUrl: string; xUrl: string };
  /** Which extra fields this form asks for, from /admin/settings/registration. */
  fields?: WaitlistFieldConfig;
  /** The short reassurance under the button ("Twoje dane są bezpieczne…").
   *  Empty falls back to the full privacy sentence. */
  safetyNote?: string;
}) {
  const { t, locale } = useI18n();
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [consent, setConsent] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [problem, setProblem] = useState<Problem>("");
  const [state, setState] = useState<"idle" | "busy" | "created" | "exists" | "error" | "invalid">("idle");

  const configured: ExtraField[] = [
    { name: "first_name", mode: fields.firstName, label: t("launch.firstName"), autoComplete: "given-name", value: firstName, onChange: setFirstName },
    { name: "last_name", mode: fields.lastName, label: t("launch.lastName"), autoComplete: "family-name", value: lastName, onChange: setLastName },
  ];
  const extras = configured.filter((f) => f.mode !== "hidden");
  const missing = extras.filter((f) => f.mode === "required" && !f.value.trim());

  /** Clear a complaint the moment the visitor acts on it. */
  const resolve = (fixed: Problem) => setProblem((p) => (p === fixed ? "" : p));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "busy") return;
    // In the order they appear on the form, so the message points at the first
    // thing the eye will land on rather than the last thing checked.
    if (missing.length > 0) { setProblem("required"); return; }
    if (!EMAIL_SHAPE.test(email.trim())) { setProblem("email"); return; }
    if (!consent) { setProblem("consent"); return; }
    setProblem("");
    setState("busy");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email, locale, source, company, consent,
          // Only the fields this form actually showed: a key the visitor was
          // never asked for has no business on their row.
          ...Object.fromEntries(extras.map((f) => [f.name, f.value])),
        }),
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
      { key: "linkedin", url: social?.linkedinUrl, Icon: LinkedinIcon, label: "LinkedIn" },
      { key: "x", url: social?.xUrl, Icon: XIcon, label: "X" },
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

  const consentId = `${id ?? `waitlist-${source}`}-consent`;
  const message = problem === "required"
    ? t("launch.needFields", { fields: missing.map((f) => f.label).join(", ") })
    : problem === "email" ? t("launch.needEmail")
      : problem === "consent" ? t("launch.needConsent") : "";

  return (
    <form onSubmit={submit} data-waitlist-form className={cn("w-full", className)} noValidate>
      {/* The name fields sit ABOVE the e-mail row so the address and its button
          stay one unbroken call to action. Two per row at every width — Imię next
          to Nazwisko — because stacking them costs a whole row of height on
          exactly the screen where the form is trying to reach the fold. */}
      {extras.length > 0 && (
        <div data-waitlist-extras className="mb-2.5 grid grid-cols-2 gap-2.5 min-[1400px]:mb-[clamp(11px,min(0.85vw,1.22vh),18px)] min-[1400px]:gap-[clamp(11px,0.85vw,18px)]">
          {extras.map((f, i) => (
            // An odd trailing field takes the whole row instead of leaving a
            // hole beside itself.
            <div key={f.name} className={cn(
              "min-w-0",
              extras.length % 2 === 1 && i === extras.length - 1 && "col-span-2",
            )}>
              <label htmlFor={`${id ?? `waitlist-${source}`}-${f.name}`} className="sr-only">{f.label}</label>
              <input
                id={`${id ?? `waitlist-${source}`}-${f.name}`}
                type="text"
                autoComplete={f.autoComplete}
                required={f.mode === "required"}
                aria-invalid={problem === "required" && f.mode === "required" && !f.value.trim()}
                value={f.value}
                onChange={(e) => { f.onChange(e.target.value); resolve("required"); }}
                placeholder={f.label}
                data-waitlist-extra={f.name}
                className={cn(
                  FIELD_CLASS,
                  problem === "required" && f.mode === "required" && !f.value.trim() && FIELD_INVALID,
                )}
              />
            </div>
          ))}
        </div>
      )}
      <label htmlFor={id ?? `waitlist-${source}`} className="sr-only">{placeholder}</label>
      <input
        id={id ?? `waitlist-${source}`}
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        aria-invalid={problem === "email"}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          resolve("email");
          if (state !== "idle") setState("idle");
        }}
        placeholder={placeholder}
        data-waitlist-email
        className={cn(FIELD_CLASS, problem === "email" && FIELD_INVALID)}
      />
      {/* Honeypot: off-screen, never announced, never focusable. */}
      <input
        type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden
        value={company} onChange={(e) => setCompany(e.target.value)}
        className="pointer-events-none absolute h-0 w-0 opacity-0"
      />

      {/* Consent sits ABOVE the button: you agree, then you act. Below it, the
          last thing before the submit would be an unticked box the visitor has
          already scrolled past. */}
      <label htmlFor={consentId} data-waitlist-consent
        className={cn(
          "mt-2.5 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 text-[12px] leading-[1.45] text-muted transition-colors sm:text-[12.5px] lg:py-1.5 min-[1400px]:mt-[clamp(11px,min(0.85vw,1.22vh),18px)] min-[1400px]:gap-[clamp(11px,0.8vw,14px)] min-[1400px]:rounded-[clamp(13px,1vw,18px)] min-[1400px]:px-[clamp(13px,1vw,18px)] min-[1400px]:py-[clamp(7px,min(0.6vw,0.78vh),12px)] min-[1400px]:text-[clamp(13px,min(0.95vw,1.44vh),15px)]",
          problem === "consent"
            ? "border-[rgb(var(--danger)/0.7)] bg-[rgb(var(--danger)/0.08)]"
            : "border-[rgb(var(--glass-border)/0.16)] bg-[rgb(var(--sunken)/0.4)] hover:border-[rgb(var(--accent)/0.35)]",
        )}>
        {/* The native box is kept for the keyboard, screen readers and form
            semantics, and hidden from sight; the square beside it is what the
            visitor sees. `peer` wires one to the other with no JS. */}
        <input
          id={consentId} type="checkbox" required checked={consent}
          aria-invalid={problem === "consent"}
          onChange={(e) => { setConsent(e.target.checked); if (e.target.checked) resolve("consent"); }}
          data-waitlist-consent-input
          className="peer sr-only"
        />
        <span aria-hidden className={cn(
          "mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-all min-[1400px]:h-[clamp(19px,min(1.35vw,2.11vh),24px)] min-[1400px]:w-[clamp(19px,min(1.35vw,2.11vh),24px)]",
          "border-[rgb(var(--glass-border)/0.45)] bg-[rgb(var(--sunken)/0.8)]",
          "peer-checked:border-transparent peer-checked:bg-[linear-gradient(135deg,rgb(var(--accent)),rgb(var(--accent-glow)))]",
          "peer-checked:shadow-[0_4px_14px_-4px_rgb(var(--accent)/0.9)]",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-[rgb(var(--accent)/0.55)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[rgb(var(--surface))]",
          // The tick lives INSIDE this span, so it cannot be a `peer-checked:`
          // target itself — that variant only reaches siblings of the input.
          "peer-checked:[&_svg]:opacity-100",
        )}>
          <Check size={12} strokeWidth={3.5} className="text-white opacity-0 transition-opacity" />
        </span>
        <span className="min-w-0">
          <ConsentSentence
            label={consentLabel?.trim() || t("launch.hero.consent")}
            privacyLabel={t("launch.consentPrivacy")}
            termsLabel={t("launch.consentTerms")}
          />
        </span>
      </label>

      {/* Full width at every size: this button IS the page's single action. It
          is never disabled for a validation reason — see the file header. */}
      <button type="submit" disabled={state === "busy"} data-waitlist-submit
        className={cn(
          "cta mt-2.5 flex h-[46px] w-full items-center justify-center gap-2 rounded-xl px-6 text-[14.5px] font-semibold sm:h-12",
          "min-[1400px]:mt-[clamp(11px,min(0.9vw,1.22vh),20px)] min-[1400px]:h-[clamp(52px,min(3.6vw,5.78vh),68px)] min-[1400px]:rounded-[clamp(13px,1vw,18px)] min-[1400px]:text-[clamp(15.5px,min(1.2vw,1.72vh),19px)]",
          state === "busy" && "cursor-wait opacity-70")}>
        {state === "busy"
          ? <><Loader2 size={16} className="animate-spin" aria-hidden />{t("launch.busy")}</>
          : <><Send size={15} aria-hidden />{cta}</>}
      </button>

      {message && (
        <p data-waitlist-error role="alert" className="mt-2 text-[12.5px] font-medium text-danger">{message}</p>
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
      {/* The form takes more than an address — a name, and the IP and source
          the route records to keep bots out — so it says so where it is asked,
          not only in the privacy policy. The launch page passes its own short
          line; the long one is the fallback for any other caller. */}
      <p data-waitlist-privacy
        className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] leading-relaxed text-faint sm:text-[11.5px] lg:mt-1.5 min-[1400px]:mt-[clamp(9px,min(0.7vw,1.0vh),16px)] min-[1400px]:text-[clamp(12px,min(0.88vw,1.33vh),14px)]">
        {safetyNote ? <Lock size={11} aria-hidden className="shrink-0" /> : null}
        {safetyNote || t("launch.privacyNote")}
      </p>
    </form>
  );
}

/**
 * The consent sentence, with the two documents as real links.
 *
 * The sentence is one editable string carrying `{privacy}` and `{terms}` where
 * the links belong, so a translation — or an admin rewrite — can put them
 * wherever that language wants them. If a rewrite loses the tokens the links
 * are appended rather than dropped: what is being agreed to has to be readable
 * before it is agreed to.
 */
function ConsentSentence({ label, privacyLabel, termsLabel }: {
  label: string; privacyLabel: string; termsLabel: string;
}) {
  const linkClass = "font-semibold text-accent underline decoration-[rgb(var(--accent)/0.45)] underline-offset-2 transition-colors hover:text-ink";
  // The label is a link INSIDE a <label>: clicking it must open the document,
  // not toggle the checkbox the label is bound to.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const privacy = (
    <Link key="p" href="/polityka-prywatnosci" target="_blank" rel="noopener"
      onClick={stop} data-consent-privacy className={linkClass}>{privacyLabel}</Link>
  );
  const terms = (
    <Link key="t" href="/regulamin" target="_blank" rel="noopener"
      onClick={stop} data-consent-terms className={linkClass}>{termsLabel}</Link>
  );

  if (!label.includes(PRIVACY_TOKEN) && !label.includes(TERMS_TOKEN)) {
    return <>{label} {privacy} · {terms}</>;
  }
  return (
    <>
      {label.split(TOKENS).map((part, i) => {
        if (part === PRIVACY_TOKEN) return <span key={i}>{privacy}</span>;
        if (part === TERMS_TOKEN) return <span key={i}>{terms}</span>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
