"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CircleCheck, Loader2 } from "lucide-react";
import { CONTACT_EMAIL_PATTERN, resolveHandler, type FormKind } from "@/lib/cms-forms";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * THE FORM ON A PUBLIC PAGE.
 *
 * Two of them exist — "napisz do nas" and "zapisz się" — and both post to a
 * handler chosen from lib/cms-forms.ts by name. There is no URL field: a CMS
 * that lets an admin point a form at an arbitrary endpoint is a CMS that can
 * be made to collect email addresses for somebody else.
 *
 * Validation here is for the VISITOR, not for safety. The route revalidates
 * everything, rate-limits by address and checks the captcha; nothing on this
 * side is trusted, and nothing on this side needs to be.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CONSENT IS A CHECKBOX NOW, AND IT LEAVES THE BROWSER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It used to be a paragraph. A sentence rendered under a form is a claim that
 * somebody agreed to something, made by the page, on their behalf, with no act
 * from them and nothing recorded anywhere — which is the one thing
 * `newsletter_contacts.marketing_consent` exists to prevent. `newsletter_
 * subscribe` takes consent as an ARGUMENT and defaults it to false precisely so
 * that nothing can infer it, and until now this form never sent one.
 *
 * So the newsletter form draws a real box, will not submit without it, and the
 * value it sends is the value that was ticked. What it is NOT is a box that
 * gates the address: a form that collects an address with the box unticked is
 * still allowed to record that address with `marketing_consent = false` — that
 * is how the waitlist works, and it is why this component sends the boolean
 * rather than withholding the request.
 *
 * The CONTACT form has no box and never sends true. Writing to us about a
 * partnership is not agreeing to a newsletter, and a shared component must not
 * quietly turn one into the other.
 *
 * WHY THE BOX'S LABEL COMES FROM THE DICTIONARY AND NOT FROM `consent`. The
 * admin's copy is a page-builder subtitle — free text, per section, unversioned
 * — and `consent_version` only means something if the wording it names is the
 * same everywhere and changes on purpose. So the admin's paragraph stays what
 * it always was (descriptive copy above the form) and the sentence the checkbox
 * is bound to is the reviewed one, in the visitor's language. See
 * lib/newsletter-consent.ts.
 */

type Labels = {
  name: string; email: string; topic: string; message: string;
  sending: string; ok: string; error: string; required: string;
};

/** The inputs a visitor types into, and so the ones that can be wrong. */
type Checked = "name" | "email" | "message";

/**
 * WHAT THE ROUTE'S REFUSALS MEAN TO THE PERSON WHO SENT THE FORM.
 *
 * A limit and a typo are not the same failure, and "spróbuj ponownie" is the
 * wrong advice for both of them: retrying a rate-limited message only hits the
 * limit again. Each code the routes answer with gets its own sentence; anything
 * else (a 500, a dropped connection) is the generic one.
 */
const SERVER_ERRORS: Record<string, string> = {
  rate_limited: "cms.formErrRateLimited",
  invalid: "cms.formErrInvalid",
  invalid_email: "cms.formErrEmail",
  too_fast: "cms.formErrTooFast",
  suppressed: "newsletter.form.suppressed",
};

export function CmsForm({ kind, handler, submitLabel, consent, labels, topics, layout = "stack", privacy }: {
  kind: FormKind;
  handler?: string;
  submitLabel: string;
  consent?: string;
  labels: Labels;
  topics: { value: string; label: string }[];
  /** `card` is the contact page's form (contact_hub): name and e-mail side by
   *  side, larger inputs, and a success panel that offers another message.
   *  `stack` is the form every other section has always drawn. */
  layout?: "stack" | "card";
  /** A link printed after the consent sentence — the privacy policy. */
  privacy?: { label: string; href: string };
}) {
  const target = resolveHandler(handler, kind);
  const id = useId();
  const { t, locale } = useI18n();
  const [state, setState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [error, setError] = useState("");
  const [consented, setConsented] = useState(false);
  const [invalid, setInvalid] = useState<Partial<Record<Checked, string>>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  /** When the form became usable. A script that fills and posts it in the
   *  same second is not a person writing to us (see the contact route). */
  const openedAt = useRef(0);
  useEffect(() => {
    // From the moment the form was SEEN: on a slow phone a person can type
    // into the server-rendered form before this script runs, and timing them
    // from hydration would call a real message "too fast".
    const typed = Array.from(formRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[name="name"], input[name="email"], textarea[name="message"]') ?? []).some((el) => el.value.trim() !== "");
    openedAt.current = typed ? Math.min(Date.now(), Math.round(performance.timeOrigin)) : Date.now();
  }, []);
  /** "Napisz kolejną wiadomość" swaps the panel back for the form; focus goes
   *  to its first field rather than falling to <body> with the panel. */
  const refocus = useRef(false);
  useEffect(() => {
    if (state !== "idle" || !refocus.current) return;
    refocus.current = false;
    formRef.current?.querySelector<HTMLElement>('[name="name"], [name="email"]')?.focus();
  }, [state]);

  // The success panel replaces the form, button and all; focus follows it, or
  // a keyboard user is left on an element that no longer exists.
  useEffect(() => {
    if (state === "ok" && layout === "card") statusRef.current?.focus();
  }, [state, layout]);

  // A form with no approved handler is not rendered as a form that silently
  // does nothing — it is not rendered at all.
  if (!target) return null;

  const wantsConsent = target.kind === "newsletter";

  /** The visitor's mistakes, in the page's language. The route checks the
   *  same things again; this only saves a round trip and says WHICH field. */
  function check(form: FormData): Partial<Record<Checked, string>> {
    const out: Partial<Record<Checked, string>> = {};
    const value = (name: string) => String(form.get(name) ?? "").trim();
    if (target?.fields.includes("name") && !value("name")) out.name = t("cms.formErrName");
    const email = value("email");
    // Nobody replies to a newsletter signup: its empty address gets the plain sentence.
    if (!email) out.email = t(target?.kind === "newsletter" ? "cms.formErrEmailRequired" : "cms.formErrEmailEmpty");
    else if (!CONTACT_EMAIL_PATTERN.test(email)) out.email = t("cms.formErrEmail");
    if (target?.fields.includes("message")) {
      const message = value("message");
      if (!message) out.message = t("cms.formErrMessage");
      else if (message.length < 5) out.message = t("cms.formErrMessageShort");
    }
    return out;
  }

  /** Typing into a field that was marked wrong takes the mark off it. */
  function clearInvalid(name: Checked) {
    if (invalid[name]) setInvalid((prev) => ({ ...prev, [name]: undefined }));
  }

  function reset() {
    refocus.current = true;
    setState("idle");
    setError("");
    setInvalid({});
    openedAt.current = Date.now();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending" || !target) return;
    const form = new FormData(event.currentTarget);

    const problems = check(form);
    if (Object.values(problems).some(Boolean)) {
      setInvalid(problems);
      setState("idle");
      setError("");
      // The first field that needs attention, in the order they are drawn.
      const first = (["name", "email", "message"] as const).find((k) => problems[k]);
      if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setInvalid({});

    /*
      THE BLOCK IS OURS RATHER THAN THE BROWSER'S, and not by accident.

      `required` on the input would also stop the submit, but the message it
      shows ("Please check this box if you want to proceed") is written by the
      browser in the BROWSER'S language. This site ships Polish, English and
      German and a visitor reading the Polish page in a German Chrome would get
      a German refusal under a Polish form. So the box is aria-required for
      assistive technology, and the one sentence that actually appears is ours,
      from the dictionary, in the page's language.
    */
    if (wantsConsent && !consented) {
      setState("error");
      setError(t("newsletter.form.consentRequired"));
      return;
    }

    setState("sending");
    setError("");
    try {
      const res = await fetch(target.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...Object.fromEntries(form.entries()),
          // WHAT WAS TICKED, AND NOTHING ELSE. The contact form sends false
          // because nobody agreed to a newsletter by writing to us; the
          // newsletter form cannot reach this line with false. Neither infers.
          consent: wantsConsent && consented,
          // So the contact row is stored in the language the visitor was
          // actually reading, which is what decides the language of every
          // campaign they are later sent.
          locale,
          // How long the form was open before this send, in ms.
          elapsed: openedAt.current ? Date.now() - openedAt.current : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && body.ok) { setState("ok"); return; }
      setState("error");
      // AN ADDRESS THAT UNSUBSCRIBED IS NOT A FAILED SUBMISSION, and saying
      // "spróbuj ponownie" to somebody on the suppression list invites them to
      // retry something that will never work. `newsletter_subscribe` answers
      // 'suppressed' for exactly this and the route passes it through — and a
      // rate limit or a refused field each get their own sentence the same way.
      const known = body.error ? SERVER_ERRORS[body.error] : undefined;
      setError(known ? t(known) : labels.error);
    } catch {
      setState("error");
      setError(labels.error);
    }
  }

  const card = layout === "card";

  if (state === "ok") {
    if (!card) {
      return (
        <p role="status" className="rounded-2xl border border-accent/30 bg-accent-soft/50 px-5 py-4 text-sm font-medium text-accent">
          {labels.ok}
        </p>
      );
    }
    return (
      <div ref={statusRef} role="status" tabIndex={-1} data-cms-form-ok
        className="flex flex-col items-start gap-2 rounded-2xl border border-accent/30 bg-accent-soft/40 p-6 outline-none sm:p-7">
        <CircleCheck size={30} aria-hidden className="text-accent" />
        <p className="mt-1 font-display text-lg font-semibold tracking-tight">{t("cms.formOkTitle")}</p>
        <p className="text-[14.5px] leading-relaxed text-muted">{labels.ok}</p>
        <button type="button" onClick={reset}
          className="tap mt-2 text-sm font-semibold text-accent underline-offset-4 hover:underline focus-visible:underline">
          {t("cms.formAnother")}
        </button>
      </div>
    );
  }

  const field = card
    ? "w-full rounded-xl border border-line bg-bg/60 px-4 py-3 text-base outline-none transition-colors placeholder:text-faint focus:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/25 aria-[invalid=true]:border-danger/70 sm:text-[15px]"
    : "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/25 aria-[invalid=true]:border-danger/70";
  const label = card
    ? "mb-2 block text-[13px] font-medium text-ink/85"
    : "mb-1.5 block text-[12.5px] font-medium text-muted";
  /** The attributes that tie a field to its own error line. */
  const describe = (name: Checked) => invalid[name]
    ? { "aria-invalid": true as const, "aria-describedby": `${id}-${name}-err` }
    : {};
  const fieldError = (name: Checked) => invalid[name] ? (
    <p id={`${id}-${name}-err`} className="mt-1.5 text-[12.5px] font-medium text-danger">{invalid[name]}</p>
  ) : null;

  return (
    <form ref={formRef} onSubmit={submit} noValidate data-cms-form={target.key}
      className={card ? "space-y-4" : "space-y-3"}>
      <div className={card && target.fields.includes("name") ? "grid gap-4 sm:grid-cols-2" : "space-y-3"}>
        {target.fields.includes("name") && (
          <div>
            <label htmlFor={`${id}-name`} className={label}>{labels.name}</label>
            <input id={`${id}-name`} name="name" required autoComplete="name" maxLength={120} className={field}
              onInput={() => clearInvalid("name")} {...describe("name")} />
            {fieldError("name")}
          </div>
        )}
        <div>
          <label htmlFor={`${id}-email`} className={label}>{labels.email}</label>
          <input id={`${id}-email`} name="email" type="email" required autoComplete="email"
            inputMode="email" maxLength={200} className={field}
            onInput={() => clearInvalid("email")} {...describe("email")} />
          {fieldError("email")}
        </div>
      </div>
      {target.fields.includes("topic") && topics.length > 0 && (
        <div>
          <label htmlFor={`${id}-topic`} className={label}>{labels.topic}</label>
          <select id={`${id}-topic`} name="topic" className={cn(field, card && "cursor-pointer")} defaultValue={topics[0].value}>
            {topics.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      {target.fields.includes("message") && (
        <div>
          <label htmlFor={`${id}-message`} className={label}>{labels.message}</label>
          <textarea id={`${id}-message`} name="message" required rows={card ? 6 : 5} maxLength={4000}
            className={cn(field, card && "min-h-[9.5rem] resize-y")}
            onInput={() => clearInvalid("message")} {...describe("message")} />
          {fieldError("message")}
        </div>
      )}
      {/* A field a person cannot see and a robot cannot resist. Cheap, and it
          does not make a human solve anything. */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden
        className="absolute left-[-9999px] h-0 w-0 opacity-0" />
      {(consent || privacy) && (
        <p className="text-[12px] leading-relaxed text-faint">
          {consent}
          {privacy && (
            <>
              {consent ? " " : ""}
              <Link href={privacy.href} className="font-medium text-muted underline underline-offset-2 transition-colors hover:text-ink">
                {privacy.label}
              </Link>
            </>
          )}
        </p>
      )}
      {wantsConsent && (
        /* items-start, not items-center: the sentence wraps to three lines at
           320px and a centred box floats beside the middle of the paragraph.
           The 44px tap target is the LABEL — the whole sentence is clickable,
           which on a phone is the difference between a checkbox that works and
           one people miss. */
        <label htmlFor={`${id}-consent`}
          className="flex cursor-pointer items-start gap-2.5 py-1.5 text-[12.5px] leading-relaxed text-muted">
          <input id={`${id}-consent`} type="checkbox" checked={consented}
            onChange={(e) => {
              setConsented(e.target.checked);
              // Clearing the refusal the moment they comply: leaving "zaznacz
              // zgodę" on screen under a ticked box is the form arguing with
              // the visitor about something they have already done.
              if (e.target.checked && state === "error") { setState("idle"); setError(""); }
            }}
            aria-required="true"
            aria-invalid={state === "error" && !consented}
            className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-line accent-[rgb(var(--accent))]" />
          <span>{t("newsletter.form.consent")}</span>
        </label>
      )}
      {state === "error" && (
        <p role="alert" className="text-[12.5px] font-medium text-danger">{error || labels.error}</p>
      )}
      <button type="submit" disabled={state === "sending"} aria-busy={state === "sending"}
        className={cn(
          "brand-gradient inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60",
          card && "w-full sm:w-auto sm:min-w-[13rem] min-h-[48px] text-[15px]",
        )}>
        {state === "sending" && <Loader2 size={15} aria-hidden className="animate-spin" />}
        {state === "sending" ? labels.sending : submitLabel}
      </button>
    </form>
  );
}
