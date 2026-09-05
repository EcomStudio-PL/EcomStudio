"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Paperclip, Send, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { sendMailAction } from "@/app/actions/mail";
import type { MailMessage } from "@/lib/server/imap";
import { integrationErrorKey, type ErrorChannel } from "@/components/admin/integration-cards";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { formatBytes } from "@/lib/utils";

/**
 * NOWA WIADOMOŚĆ — the compose sheet, plus everything the mailbox screen and
 * this sheet have to agree on.
 *
 * The draft builders and the error vocabulary live here rather than in
 * mail-client.tsx because that file already imports this one: putting the
 * shared pieces the other way round would make the two modules import each
 * other, and a cycle between two "use client" modules is not worth the tidier
 * filename.
 *
 * Nothing is composed in HTML. A reply written here is plain text, which is
 * what sendMailAction sends and what keeps this screen from ever producing
 * markup that some other inbox has to sanitise.
 */

/** Exactly the fields sendMailAction reads, so a draft is posted as-is. */
export type MailDraft = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  /** Threading headers, carried as opaque strings — the action validates their
   *  shape and drops anything that is not a message-id. */
  inReplyTo: string;
  references: string;
};

/** The server caps the total at 4 MB; the same number here means the admin
 *  learns about it while picking files instead of after a long upload. The cap
 *  is 4 and not 10 because Vercel refuses a serverless request body over
 *  4.5 MB before the action runs, and that refusal reaches the admin as an
 *  opaque platform error rather than as this sentence — the remaining 0.5 MB is
 *  headroom for the text fields and the multipart overhead in the same body. */
const MAX_ATTACHMENT_TOTAL_BYTES = 4 * 1024 * 1024;
/** A forwarded body is quoted into a textarea, not stored — enough for a real
 *  message, far below the action's 100 000-character body limit. */
const QUOTE_MAX_CHARS = 20_000;

/**
 * Mail-specific failure codes on top of the integration vocabulary.
 * `integrationErrorKey` already knows the ones both screens share
 * (not_configured, auth, encryption_unavailable…); these are the ones only the
 * mailbox can return, and every one of them names the field to fix.
 */
const MAIL_ERROR_KEYS: Record<string, string> = {
  unauthenticated: "comm.err.forbidden",
  not_admin: "comm.err.forbidden",
  no_recipients: "comm.recipientRequired",
  invalid_recipient: "comm.invalidEmail",
  attachments_too_large: "comm.attachmentTooLarge",
  too_many_recipients: "comm.err.tooManyRecipients",
  // "invalid" reaches the admin only from the send path, where it means the
  // subject and the body are both empty; the folder and page guards that share
  // the code are fed by this module, never by a person.
  invalid: "comm.err.emptyMessage",
  not_found: "comm.err.messageGone",
  // The mailbox is reachable but the module's switch is off, which is the same
  // sentence and the same fix as a mailbox that was never set up.
  not_enabled: "comm.err.notConfigured",
};

/** A code is never shown raw. Anything unmapped falls back to the channel's
 *  sentence, so a code added to app/actions/mail.ts later still reads as
 *  Polish rather than as debug output. */
export function mailErrorKey(code: string | undefined, channel: ErrorChannel): string {
  const mapped = code ? MAIL_ERROR_KEYS[code] : undefined;
  return mapped ?? integrationErrorKey(code, channel);
}

export function emptyDraft(): MailDraft {
  return { to: "", cc: "", bcc: "", subject: "", body: "", inReplyTo: "", references: "" };
}

/** `to`/`cc` arrive from IMAP as display strings ("Nazwa <a@b.c>"), while both
 *  the compose fields and the send action work in bare addresses. */
function addressOf(entry: string): string {
  const angled = entry.match(/<([^<>]+)>\s*$/);
  return (angled ? angled[1] : entry).trim();
}

/** Same address written two ways is one recipient; comparison is case-folded
 *  because mail domains are, and most mailboxes are too. */
function uniqueAddresses(entries: string[], exclude: string[]): string[] {
  const skip = new Set(exclude.map((entry) => addressOf(entry).toLowerCase()).filter(Boolean));
  const out: string[] = [];
  for (const entry of entries) {
    const address = addressOf(entry);
    const key = address.toLowerCase();
    if (!address || skip.has(key)) continue;
    skip.add(key);
    out.push(address);
  }
  return out;
}

/** "Re: " once, however many times the thread has been round. */
function prefixed(subject: string, prefix: string): string {
  const clean = subject.trim();
  return new RegExp(`^${prefix}\\s*:`, "i").test(clean) ? clean : `${prefix}: ${clean}`;
}

function threadHeaders(message: MailMessage): { inReplyTo: string; references: string } {
  const id = message.messageId ?? "";
  // Our own id goes on the end of the chain the original already carried, which
  // is what lets the recipient's client thread the answer.
  return { inReplyTo: id, references: [...message.references, id].filter(Boolean).join(" ") };
}

/**
 * Reply, and reply-all.
 *
 * `self` is the mailbox this panel reads. Answering everyone must not put our
 * own address in the copy line — it would deliver the reply back into the very
 * folder it was written from and announce it as new mail.
 */
export function replyDraft(message: MailMessage, self: string, all: boolean): MailDraft {
  const sender = message.from.address || message.from.name;
  const cc = all ? uniqueAddresses([...message.to, ...message.cc], [self, sender]) : [];
  return {
    ...emptyDraft(),
    to: sender,
    cc: cc.join(", "),
    subject: prefixed(message.subject, "Re"),
    ...threadHeaders(message),
  };
}

/**
 * Forward: a new message that quotes the original.
 *
 * The plaintext alternative is quoted, never the HTML body — the sanitized
 * markup belongs to the reader pane, and pasting it into a plaintext field
 * would send a stranger's tags on to somebody else as visible text.
 */
export function forwardDraft(message: MailMessage, t: (key: string) => string): MailDraft {
  const header = [
    `${t("comm.from")}: ${message.from.name || message.from.address}`,
    `${t("comm.to")}: ${message.to.join(", ")}`,
    `${t("comm.date")}: ${message.date}`,
    `${t("comm.subject")}: ${message.subject}`,
  ];
  const quoted = message.text
    .slice(0, QUOTE_MAX_CHARS)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return {
    ...emptyDraft(),
    subject: prefixed(message.subject, "Fwd"),
    body: `\n\n${header.map((line) => `> ${line}`).join("\n")}\n>\n${quoted}\n`,
    // No In-Reply-To: a forward starts a conversation with someone who was
    // never part of the original thread.
    references: "",
  };
}

export function MailCompose({ draft, onClose, onSent }: {
  /** null closes the sheet; a new object opens it with those fields. */
  draft: MailDraft | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [v, setV] = useState<MailDraft>(emptyDraft());
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Every open is a fresh draft: reply, reply-all and forward all arrive as a
  // new object, so the fields must follow the prop rather than keep what the
  // previous message left behind.
  useEffect(() => {
    if (!draft) return;
    setV(draft);
    setFiles([]);
  }, [draft]);

  const patch = <K extends keyof MailDraft>(key: K, value: MailDraft[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  function addFiles(picked: FileList) {
    const next = [...files, ...Array.from(picked)];
    if (next.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_TOTAL_BYTES) {
      toast.error(t("comm.attachmentTooLarge"));
      return;
    }
    setFiles(next);
  }

  function send() {
    if (!v.to.trim()) {
      toast.error(t("comm.recipientRequired"));
      return;
    }
    start(async () => {
      // FormData rather than a plain object: attachments are Files, and this is
      // the shape sendMailAction reads them from.
      const form = new FormData();
      form.set("to", v.to);
      form.set("cc", v.cc);
      form.set("bcc", v.bcc);
      form.set("subject", v.subject);
      form.set("text", v.body);
      form.set("inReplyTo", v.inReplyTo);
      form.set("references", v.references);
      for (const file of files) form.append("attachments", file);

      const res = await sendMailAction(form);
      if (!res.ok) {
        toast.error(t(mailErrorKey(res.error, "smtp")));
        return;
      }
      toast.success(t("comm.mailSent"));
      onSent();
    });
  }

  return (
    <Modal open={draft !== null} onClose={onClose} title={t("comm.compose")} wide>
      <div className="space-y-4" data-mail-compose>
        <div>
          <Label htmlFor="compose-to">{t("comm.to")}</Label>
          <Input id="compose-to" type="text" inputMode="email" autoComplete="off" value={v.to}
            onChange={(e) => patch("to", e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="compose-cc">{t("comm.cc")}</Label>
            <Input id="compose-cc" type="text" inputMode="email" autoComplete="off" value={v.cc}
              onChange={(e) => patch("cc", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="compose-bcc">{t("comm.bcc")}</Label>
            <Input id="compose-bcc" type="text" inputMode="email" autoComplete="off" value={v.bcc}
              onChange={(e) => patch("bcc", e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="compose-subject">{t("comm.subject")}</Label>
          <Input id="compose-subject" value={v.subject} onChange={(e) => patch("subject", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="compose-body">{t("comm.body")}</Label>
          <Textarea id="compose-body" rows={10} value={v.body} className="min-h-48"
            onChange={(e) => patch("body", e.target.value)} />
        </div>

        <section className="space-y-2">
          <Label hint={t("comm.attachmentsHint")}>{t("comm.attachments")}</Label>
          <input ref={fileRef} type="file" multiple className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => fileRef.current?.click()}>
            <Paperclip size={14} aria-hidden />
            {t("comm.addAttachment")}
          </Button>
          {files.length > 0 && (
            <ul className="space-y-1.5">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}
                  className="flex items-center gap-2 rounded-xl bg-sunken/60 px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-faint">{formatBytes(file.size)}</span>
                  <button type="button" aria-label={t("comm.delete")} disabled={pending}
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                    className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-raised hover:text-danger disabled:opacity-50">
                    <X size={13} aria-hidden />
                  </button>
                </li>
              ))}
              <li className="px-3 text-[11px] tabular-nums text-faint">{formatBytes(totalBytes)}</li>
            </ul>
          )}
        </section>

        {/* env(safe-area-inset-bottom) is already on the Modal shell, so this
            row only needs to stay clear of the fields above it. */}
        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" disabled={pending} onClick={onClose}>{t("comm.back")}</Button>
          <Button disabled={pending} onClick={send} data-mail-send>
            <Send size={14} aria-hidden />
            {t("comm.send")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
