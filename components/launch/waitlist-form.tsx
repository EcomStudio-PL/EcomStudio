"use client";
import { useState } from "react";
import { Check, Loader2, Lock, Send } from "lucide-react";
import { FacebookIcon, InstagramIcon, LinkedinIcon, XIcon } from "@/components/launch/social-icons";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { FieldMode, WaitlistFieldConfig } from "@/lib/server/registration-config";

/**
 * ZAPIS NA PREMIERĘ — the same form in the hero and in the closing block.
 *
 * One component, one endpoint, one table: a second copy of this on the page
 * would be a second place for the behaviour to drift. The field is a native
 * type=email input at 16px so a phone keyboard opens the right layout and
 * iOS does not zoom the page; the state after submitting replaces the form
 * rather than sitting under it, so the answer is never below the fold.
 *
 * The name and phone fields above the address are the admin's decision, not
 * this file's: `fields` says per field whether it is hidden, optional or
 * required, and a hidden one is not rendered and not sent. The e-mail row
 * itself is untouched by that — its height, its stacking and its button are
 * the page's whole call to action.
 */

/** The launch page's field styling, in one place so the optional name/phone
 *  inputs cannot drift from the e-mail field they sit above: 56px on phones,
 *  60 from sm, 16px text so iOS does not zoom the layout on focus. */
const FIELD_CLASS = cn(
  "h-12 w-full min-w-0 rounded-xl border border-[rgb(var(--glass-border)/0.22)] bg-[rgb(var(--sunken)/0.55)]",
  "px-4 text-base text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint",
  "focus:border-[rgb(var(--accent)/0.6)] focus:ring-4 focus:ring-[rgb(var(--accent)/0.16)]",
  "sm:text-[14.5px]",
);

/** No field is asked for unless the admin turned it on. Matches the seeded
 *  defaults' shape, so a caller that has not threaded the config through yet
 *  gets the plain e-mail form rather than a crash. */
const NO_EXTRA_FIELDS: WaitlistFieldConfig = { firstName: "hidden", lastName: "hidden", phone: "hidden" };

type ExtraField = {
  /** The JSON key the route reads — first_name / last_name / phone. */
  name: "first_name" | "last_name" | "phone";
  mode: FieldMode;
  label: string;
  type: "text" | "tel";
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
};

export function WaitlistForm({
  placeholder, cta, source, consentLabel, className, id,
  successTitle, successBody, successFollow, social, fields = NO_EXTRA_FIELDS, safetyNote,
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
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "created" | "exists" | "error" | "invalid">("idle");
  const needsConsent = Boolean(consentLabel);

  const configured: ExtraField[] = [
    { name: "first_name", mode: fields.firstName, label: t("launch.firstName"), type: "text", autoComplete: "given-name", value: firstName, onChange: setFirstName },
    { name: "last_name", mode: fields.lastName, label: t("launch.lastName"), type: "text", autoComplete: "family-name", value: lastName, onChange: setLastName },
    { name: "phone", mode: fields.phone, label: t("launch.phone"), type: "tel", autoComplete: "tel", value: phone, onChange: setPhone },
  ];
  const extras = configured.filter((f) => f.mode !== "hidden");
  // The form carries noValidate, so the browser will not enforce `required`
  // for us — the submit button is the gate, exactly as it already is for the
  // consent checkbox.
  const missingRequired = extras.some((f) => f.mode === "required" && !f.value.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "busy") return;
    if (needsConsent && !consent) return;
    if (missingRequired) return;
    setState("busy");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email, locale, source, company, consent: needsConsent ? consent : undefined,
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

  return (
    <form onSubmit={submit} data-waitlist-form className={cn("w-full", className)} noValidate>
      {/* The extra fields sit ABOVE the e-mail row and stack the same way it
          does — the address and its button stay one unbroken call to action.
          `flex-1` is sm-only here for the same reason it is on the e-mail
          field: on phones the row is a column, where flex would size height. */}
      {extras.length > 0 && (
        <div data-waitlist-extras className="mb-2.5 grid gap-2.5 sm:grid-cols-2">
          {extras.map((f, i) => (
            // Two per row — Imię next to Nazwisko. An odd trailing field (the
            // phone, when the admin turns it on) takes the whole row instead
            // of leaving a hole beside itself.
            <div key={f.name} className={cn(
              "min-w-0",
              extras.length % 2 === 1 && i === extras.length - 1 && "sm:col-span-2",
            )}>
              <label htmlFor={`${id ?? `waitlist-${source}`}-${f.name}`} className="sr-only">{f.label}</label>
              <input
                id={`${id ?? `waitlist-${source}`}-${f.name}`}
                type={f.type}
                inputMode={f.type === "tel" ? "tel" : "text"}
                autoComplete={f.autoComplete}
                required={f.mode === "required"}
                value={f.value}
                onChange={(e) => f.onChange(e.target.value)}
                placeholder={f.label}
                data-waitlist-extra={f.name}
                className={FIELD_CLASS}
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
        value={email}
        onChange={(e) => { setEmail(e.target.value); if (state !== "idle") setState("idle"); }}
        placeholder={placeholder}
        data-waitlist-email
        className={FIELD_CLASS}
      />
      {/* Honeypot: off-screen, never announced, never focusable. */}
      <input
        type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden
        value={company} onChange={(e) => setCompany(e.target.value)}
        className="pointer-events-none absolute h-0 w-0 opacity-0"
      />
      {/* Full width at every size: this button IS the page's single action. */}
      <button type="submit" disabled={state === "busy" || (needsConsent && !consent) || missingRequired} data-waitlist-submit
        className={cn(
          "cta mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl px-6 text-[14.5px] font-semibold",
          state === "busy" && "cursor-wait opacity-70")}>
        {state === "busy"
          ? <><Loader2 size={16} className="animate-spin" aria-hidden />{t("launch.busy")}</>
          : <><Send size={15} aria-hidden />{cta}</>}
      </button>
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
      {/* The form takes more than an address — a name, sometimes a phone
          number, and the IP and source the route records to keep bots out — so
          it says so where it is asked, not only in the privacy policy. The
          launch page passes its own short line; the long one is the fallback
          for any other caller. */}
      <p data-waitlist-privacy
        className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-[11.5px] leading-relaxed text-faint">
        {safetyNote ? <Lock size={11} aria-hidden className="shrink-0" /> : null}
        {safetyNote || t("launch.privacyNote")}
      </p>
    </form>
  );
}
