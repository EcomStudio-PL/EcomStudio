"use client";
import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { resolveHandler, type FormKind } from "@/lib/cms-forms";

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
  const [state, setState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [error, setError] = useState("");

  // A form with no approved handler is not rendered as a form that silently
  // does nothing — it is not rendered at all.
  if (!target) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending" || !target) return;
    const form = new FormData(event.currentTarget);
    setState("sending");
    setError("");
    try {
      const res = await fetch(target.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && body.ok) { setState("ok"); return; }
      setState("error");
      setError(body.error === "rate_limited" ? labels.error : labels.error);
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
