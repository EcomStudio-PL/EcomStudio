"use client";
import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { resolveHandler, type FormKind } from "@/lib/cms-forms";
import { useI18n } from "@/lib/i18n/provider";

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

export function CmsForm({ kind, handler, submitLabel, consent, labels, topics }: {
  kind: FormKind;
  handler?: string;
  submitLabel: string;
  consent?: string;
  labels: Labels;
  topics: { value: string; label: string }[];
}) {
  const target = resolveHandler(handler, kind);
  const id = useId();
  const { t, locale } = useI18n();
  const [state, setState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [error, setError] = useState("");
  const [consented, setConsented] = useState(false);

  // A form with no approved handler is not rendered as a form that silently
  // does nothing — it is not rendered at all.
  if (!target) return null;

  const wantsConsent = target.kind === "newsletter";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending" || !target) return;
    const form = new FormData(event.currentTarget);

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
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && body.ok) { setState("ok"); return; }
      setState("error");
      // AN ADDRESS THAT UNSUBSCRIBED IS NOT A FAILED SUBMISSION, and saying
      // "spróbuj ponownie" to somebody on the suppression list invites them to
      // retry something that will never work. `newsletter_subscribe` answers
      // 'suppressed' for exactly this and the route passes it through.
      setError(body.error === "suppressed" ? t("newsletter.form.suppressed") : labels.error);
    } catch {
      setState("error");
      setError(labels.error);
    }
  }

  if (state === "ok") {
    return (
      <p role="status" className="rounded-2xl border border-accent/30 bg-accent-soft/50 px-5 py-4 text-sm font-medium text-accent">
        {labels.ok}
      </p>
    );
  }

  const field = "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/25";

  return (
    <form onSubmit={submit} className="space-y-3" data-cms-form={target.key}>
      {target.fields.includes("name") && (
        <div>
          <label htmlFor={`${id}-name`} className="mb-1.5 block text-[12.5px] font-medium text-muted">{labels.name}</label>
          <input id={`${id}-name`} name="name" required autoComplete="name" maxLength={120} className={field} />
        </div>
      )}
      <div>
        <label htmlFor={`${id}-email`} className="mb-1.5 block text-[12.5px] font-medium text-muted">{labels.email}</label>
        <input id={`${id}-email`} name="email" type="email" required autoComplete="email"
          inputMode="email" maxLength={200} className={field} />
      </div>
      {target.fields.includes("topic") && topics.length > 0 && (
        <div>
          <label htmlFor={`${id}-topic`} className="mb-1.5 block text-[12.5px] font-medium text-muted">{labels.topic}</label>
          <select id={`${id}-topic`} name="topic" className={field} defaultValue={topics[0].value}>
            {topics.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      {target.fields.includes("message") && (
        <div>
          <label htmlFor={`${id}-message`} className="mb-1.5 block text-[12.5px] font-medium text-muted">{labels.message}</label>
          <textarea id={`${id}-message`} name="message" required rows={5} maxLength={4000} className={field} />
        </div>
      )}
      {/* A field a person cannot see and a robot cannot resist. Cheap, and it
          does not make a human solve anything. */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden
        className="absolute left-[-9999px] h-0 w-0 opacity-0" />
      {consent && <p className="text-[12px] leading-relaxed text-faint">{consent}</p>}
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
      <button type="submit" disabled={state === "sending"}
        className="brand-gradient inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60">
        {state === "sending" && <Loader2 size={15} aria-hidden className="animate-spin" />}
        {state === "sending" ? labels.sending : submitLabel}
      </button>
    </form>
  );
}
