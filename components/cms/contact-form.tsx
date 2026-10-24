"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Check, CircleCheck, Copy, ImagePlus, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { sniff } from "@/lib/ice/sniff";
import {
  CONTACT_BUCKET, CONTACT_LIMITS, cleanMessage, fillTokens, isContactMime, validateContact,
  type ContactErrors, type ContactField, type ContactMime, type TicketTopic,
} from "@/lib/contact-page";
import { stegaStrip } from "@/lib/ice/stega";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * KONTAKT V2 — THE TICKET FORM.
 *
 * What a person sees is decided by the topic: a technical problem asks for the
 * generation and takes up to three pictures, payments asks for the NIP, every
 * other topic is the message alone. The rules (lib/contact-page.ts) are
 * checked here for the PERSON — which field, in their language — and again in
 * the route and the database, which are the boundary.
 *
 * ONE SUBMISSION, HOWEVER MANY TRIES. The form keeps one submission id until a
 * ticket exists; a lost response, a timeout or a second click sends the SAME
 * id, and the database answers with the ticket it already created (0152). The
 * pictures go straight from the browser to the private bucket, each to a path
 * the server reserved for this submission a moment earlier (Vercel's request
 * limit is below 5 MB); a picture already uploaded is not uploaded again.
 *
 * SUCCESS IS THE DATABASE'S WORD. The thank-you card is drawn only from a
 * response carrying the ticket number — never from a request that merely
 * left the browser.
 */

type Labels = {
  topic: string; name: string; email: string; message: string;
  generation: string; files: string; filesHint: string; nip: string;
  consent: string; privacy: string; submit: string; sending: string;
  successTitle: string; successBody: string; ticket: string; back: string;
};

type Picked = { key: string; file: File; mime: ContactMime; url: string };
type Uploaded = { path: string; name: string; size: number; mime: ContactMime };

/** The route's refusals, as sentences (cms.contact.err.*). */
const SERVER_ERRORS = new Set([
  "rate_limited", "too_fast", "unavailable", "attachment_invalid", "upload_failed", "upload_limit", "invalid", "network",
]);

const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (ch) =>
      (Number(ch) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(ch) / 4)))).toString(16));

const kb = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function ContactForm({
  topics, initialTopic, initialEmail, labels, backHref, privacyHref,
}: {
  topics: { value: TicketTopic; label: string }[];
  initialTopic: TicketTopic;
  initialEmail: string;
  labels: Labels;
  backHref: string;
  privacyHref: string;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const [topic, setTopic] = useState<TicketTopic>(initialTopic);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [formError, setFormError] = useState("");
  const [ticket, setTicket] = useState<number | null>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [fileError, setFileError] = useState("");
  const [count, setCount] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const submission = useRef<string>("");
  const uploaded = useRef(new Map<string, Uploaded>());
  const sending = useRef(false);
  const openedAt = useRef(0);

  useEffect(() => {
    submission.current = uuid();
    openedAt.current = Date.now();
  }, []);
  // The previews' object URLs die with the form.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.url)), []);
  useEffect(() => {
    if (ticket !== null) successRef.current?.focus();
  }, [ticket]);

  const technical = topic === "technical";
  const payments = topic === "payments";
  const errText = (field: ContactField, code: string) => t(`cms.contact.err.${field}.${code}`);

  async function addFiles(list: FileList | null) {
    setFileError("");
    if (!list || list.length === 0) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= CONTACT_LIMITS.files) { setFileError(t("cms.contact.err.attachments.count")); break; }
      if (file.size > CONTACT_LIMITS.fileBytes) { setFileError(t("cms.contact.err.attachments.size", { name: file.name })); continue; }
      // What the bytes are, not what the name says (the route checks again).
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const mime = sniff(head);
      if (!isContactMime(mime) || file.size === 0) { setFileError(t("cms.contact.err.attachments.type", { name: file.name })); continue; }
      next.push({ key: `${file.name}:${file.size}:${file.lastModified}:${next.length}:${uuid()}`, file, mime, url: URL.createObjectURL(file) });
    }
    setFiles(next);
    if (fileInput.current) fileInput.current.value = "";
  }

  function removeFile(key: string) {
    const gone = files.find((f) => f.key === key);
    if (gone) URL.revokeObjectURL(gone.url);
    uploaded.current.delete(key);
    setFiles(files.filter((f) => f.key !== key));
    setFileError("");
  }

  function clearError(field: ContactField) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  /** Upload what is not uploaded yet, each to a path the server reserved. */
  async function uploadPending(): Promise<Uploaded[] | string> {
    const todo = files.filter((f) => !uploaded.current.has(f.key));
    if (todo.length > 0) {
      const res = await fetch("/api/public/contact/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId: submission.current, count: todo.length }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; paths?: string[]; error?: string };
      if (!res.ok || !body.ok || !Array.isArray(body.paths) || body.paths.length !== todo.length) return body.error ?? "upload_failed";
      const supabase = createClient();
      for (let i = 0; i < todo.length; i++) {
        const f = todo[i];
        const path = body.paths[i];
        const { error } = await supabase.storage.from(CONTACT_BUCKET).upload(path, f.file, {
          contentType: f.mime, upsert: false, cacheControl: "0",
        });
        if (error) return "upload_failed";
        uploaded.current.set(f.key, { path, name: f.file.name.slice(0, 200), size: f.file.size, mime: f.mime });
      }
    }
    return files.map((f) => uploaded.current.get(f.key)!).filter(Boolean);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || ticket !== null) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    const input = {
      topic, name: value("name"), email: value("email"), message: value("message"),
      nip: payments ? value("nip") : "", generation: technical ? value("generation") : "",
    };
    const problems = validateContact(input);
    setErrors(problems);
    setFormError("");
    const order: ContactField[] = ["name", "email", "nip", "generation", "message"];
    const first = order.find((k) => problems[k]);
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    sending.current = true;
    setBusy(true);
    try {
      let attachments: Uploaded[] = [];
      if (technical && files.length > 0) {
        const up = await uploadPending();
        if (typeof up === "string") {
          setFormError(t(`cms.contact.err.${SERVER_ERRORS.has(up) ? up : "upload_failed"}`));
          return;
        }
        attachments = up;
      }
      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId: submission.current,
          topic, name: input.name, email: input.email, message: input.message,
          nip: input.nip, generation: input.generation,
          attachments,
          company: value("company"),
          locale,
          elapsed: openedAt.current ? Date.now() - openedAt.current : undefined,
          client: {
            viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "",
            lang: typeof navigator !== "undefined" ? navigator.language : "",
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; ticket?: number; error?: string; field?: ContactField; code?: string };
      if (res.ok && body.ok && typeof body.ticket === "number") {
        setTicket(body.ticket);
        return;
      }
      if (body.error === "invalid" && body.field && ["name", "email", "message", "nip", "generation"].includes(body.field)) {
        setErrors({ [body.field]: body.code ?? "invalid" });
        formRef.current?.querySelector<HTMLElement>(`[name="${body.field}"]`)?.focus();
        return;
      }
      if (body.error === "attachment_invalid") {
        // The route removed the picture it refused; the next try reserves anew.
        uploaded.current.clear();
      }
      setFormError(t(`cms.contact.err.${body.error && SERVER_ERRORS.has(body.error) ? body.error : "generic"}`));
    } catch {
      // The same submission id goes again on the next click — never a second ticket.
      setFormError(t("cms.contact.err.network"));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (ticket !== null) {
    return (
      <div ref={successRef} role="status" tabIndex={-1} data-contact-success
        className="flex flex-col items-start gap-2 rounded-2xl border border-accent/30 bg-accent-soft/40 p-6 outline-none sm:p-8">
        <CircleCheck size={34} aria-hidden className="text-accent" />
        <p className="mt-1 font-display text-[1.45rem] font-semibold tracking-tight text-ink">{labels.successTitle}</p>
        {labels.successBody && <p className="text-[15px] leading-relaxed text-muted">{labels.successBody}</p>}
        <p className="mt-1 text-[15px] font-semibold text-ink" data-contact-ticket={ticket}>
          {fillTokens(labels.ticket, { numer: String(ticket) })}
        </p>
        <Link href={backHref}
          className="tap mt-3 inline-flex min-h-[44px] items-center rounded-xl border border-line bg-surface px-5 text-sm font-semibold text-ink transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
          {labels.back}
        </Link>
      </div>
    );
  }

  const field = "w-full rounded-xl border border-line bg-bg/60 px-4 py-3 text-base text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/25 aria-[invalid=true]:border-danger/70 sm:text-[15px]";
  const label = "mb-2 block text-[13px] font-medium text-ink/85";
  const describe = (name: ContactField, hint?: string) => ({
    ...(errors[name] ? { "aria-invalid": true as const } : {}),
    "aria-describedby": [errors[name] ? `${id}-${name}-err` : "", hint ?? ""].filter(Boolean).join(" ") || undefined,
  });
  const fieldError = (name: ContactField) => errors[name] ? (
    <p id={`${id}-${name}-err`} className="mt-1.5 text-[12.5px] font-medium text-danger">{errText(name, errors[name]!)}</p>
  ) : null;

  return (
    <form ref={formRef} onSubmit={submit} noValidate data-contact-form aria-busy={busy} className="space-y-5">
      <fieldset>
        <legend className={label}>{labels.topic}</legend>
        <div className="flex flex-wrap gap-2" data-contact-topics>
          {topics.map((o) => (
            <label key={o.value} className="relative">
              <input type="radio" name="topic" value={o.value} checked={topic === o.value}
                onChange={() => { setTopic(o.value); setFormError(""); }}
                className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" data-contact-topic={o.value} />
              <span
                className="inline-flex min-h-[40px] items-center rounded-full border border-line bg-surface px-4 py-2 text-[13.5px] font-medium text-muted transition-colors peer-hover:border-accent/40 peer-hover:text-ink peer-checked:border-accent peer-checked:bg-accent-soft/70 peer-checked:text-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface">
                {o.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-name`} className={label}>{labels.name}</label>
          <input id={`${id}-name`} name="name" autoComplete="given-name" maxLength={CONTACT_LIMITS.nameMax} className={field}
            onInput={() => clearError("name")} {...describe("name")} />
          {fieldError("name")}
        </div>
        <div>
          <label htmlFor={`${id}-email`} className={label}>{labels.email} <span aria-hidden className="text-accent">*</span></label>
          <input id={`${id}-email`} name="email" type="email" required aria-required="true" autoComplete="email" inputMode="email"
            defaultValue={initialEmail} maxLength={CONTACT_LIMITS.emailMax} className={field}
            onInput={() => clearError("email")} {...describe("email")} />
          {fieldError("email")}
        </div>
      </div>

      {payments && (
        <div>
          <label htmlFor={`${id}-nip`} className={label}>{labels.nip}</label>
          <input id={`${id}-nip`} name="nip" autoComplete="off" inputMode="text" maxLength={CONTACT_LIMITS.nipMax} className={field}
            onInput={() => clearError("nip")} {...describe("nip")} />
          {fieldError("nip")}
        </div>
      )}

      {technical && (
        <div>
          <label htmlFor={`${id}-generation`} className={label}>{labels.generation}</label>
          <input id={`${id}-generation`} name="generation" autoComplete="off" maxLength={CONTACT_LIMITS.generationMax} className={field}
            onInput={() => clearError("generation")} {...describe("generation")} />
          {fieldError("generation")}
        </div>
      )}

      <div>
        <label htmlFor={`${id}-message`} className={label}>{labels.message} <span aria-hidden className="text-accent">*</span></label>
        <textarea id={`${id}-message`} name="message" required aria-required="true" rows={6} maxLength={CONTACT_LIMITS.messageMax}
          className={cn(field, "min-h-[9.5rem] resize-y")}
          onInput={(e) => { clearError("message"); setCount(cleanMessage(e.currentTarget.value).length); }}
          {...describe("message", `${id}-message-count`)} />
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <div className="min-w-0">{fieldError("message")}</div>
          <p id={`${id}-message-count`} className="shrink-0 text-[12px] tabular-nums text-faint">
            {t("cms.contact.count", { n: count, min: CONTACT_LIMITS.messageMin, max: CONTACT_LIMITS.messageMax })}
          </p>
        </div>
      </div>

      {technical && (
        <div data-contact-files>
          <p className={label} id={`${id}-files-label`}>{labels.files}</p>
          {labels.filesHint && <p id={`${id}-files-hint`} className="-mt-1 mb-2 text-[12.5px] text-faint">{labels.filesHint}</p>}
          {files.length > 0 && (
            <ul className="mb-3 grid gap-2 sm:grid-cols-3" aria-labelledby={`${id}-files-label`}>
              {files.map((f) => (
                <li key={f.key} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2 sm:flex-col sm:items-stretch" data-contact-file>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover sm:aspect-[4/3] sm:h-auto sm:w-full" />
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-ink">{f.file.name}</span>
                      <span className="block text-[11.5px] text-faint">{kb(f.file.size)}</span>
                    </span>
                    <button type="button" onClick={() => removeFile(f.key)} disabled={busy}
                      aria-label={t("cms.contact.removeFile", { name: f.file.name })}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40">
                      <X size={16} aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {files.length < CONTACT_LIMITS.files && (
            <>
              <input ref={fileInput} id={`${id}-files`} type="file" multiple accept="image/jpeg,image/png,image/webp"
                className="sr-only" aria-describedby={`${id}-files-hint`} disabled={busy}
                onChange={(e) => void addFiles(e.target.files)} />
              <label htmlFor={`${id}-files`}
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line-strong bg-bg/40 px-4 py-2.5 text-[13.5px] font-medium text-muted transition-colors hover:border-accent/50 hover:text-accent [input:focus-visible+&]:ring-2 [input:focus-visible+&]:ring-accent/50">
                <ImagePlus size={17} aria-hidden />
                {t("cms.contact.addFiles", { n: CONTACT_LIMITS.files - files.length })}
              </label>
            </>
          )}
          {fileError && <p role="alert" className="mt-2 text-[12.5px] font-medium text-danger">{fileError}</p>}
        </div>
      )}

      {/* A field a person cannot see and a robot cannot resist. */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden
        className="absolute left-[-9999px] h-0 w-0 opacity-0" />

      <p className="text-[12.5px] leading-relaxed text-faint">
        {labels.consent}{labels.consent ? " " : ""}
        <Link href={privacyHref} className="font-medium text-muted underline underline-offset-2 transition-colors hover:text-ink">
          {labels.privacy}
        </Link>
      </p>

      <div aria-live="assertive">
        {formError && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-[13.5px] font-medium text-danger" data-contact-error>{formError}</p>}
      </div>

      <button type="submit" disabled={busy} aria-disabled={busy}
        className="brand-gradient inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-[15px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60 sm:w-auto sm:min-w-[14rem]">
        {busy && <Loader2 size={16} aria-hidden className="animate-spin" />}
        {busy ? labels.sending : labels.submit}
      </button>
    </form>
  );
}

/** "Kopiuj adres" → "Skopiowano", announced to a screen reader. */
export function CopyAddress({ address, label, done }: { address: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(stegaStrip(address));
      setCopied(true);
    } catch {
      // No clipboard (an old browser, a denied permission): the address is
      // on screen and selectable, and the mailto link still works.
      setCopied(false);
    }
  }
  return (
    <button type="button" onClick={() => void copy()} data-contact-copy
      className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] font-semibold text-muted transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      <span>{copied ? done : label}</span>
      <span role="status" className="sr-only">{copied ? done : ""}</span>
    </button>
  );
}
