import "server-only";
import { randomUUID } from "crypto";
import nodemailer from "nodemailer";
import { decryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { sendEmail } from "@/lib/server/email";

/**
 * OUTBOUND MAIL, TWO WAYS.
 *
 * GrovBase already sends through Resend when RESEND_API_KEY is set. An admin
 * can now also point the app at their own SMTP server, which is what most
 * sellers actually have. SMTP wins when it is configured, because configuring
 * it is an explicit act; Resend is the fallback, and with neither the send is
 * an honest no-op (`{sent:false}`) that never blocks the business logic.
 *
 * THE PASSWORD NEVER EXISTS AT REST, and there are now two ways it reaches
 * this module.
 *
 * `password` is for a caller that ALREADY HOLDS the plaintext — it read it from
 * Supabase Vault a moment ago, or the admin just typed it into the form. Four
 * callers are in that position, and until this field existed every one of them
 * had to re-encrypt the password with APP_ENCRYPTION_KEY purely to satisfy the
 * ciphertext shape below, then have it decrypted again three lines later. That
 * round trip is why testing SMTP, sending a login code, mailing an admin
 * notification and sending an authentication e-mail ALL failed when the deploy
 * key went missing — not because anything was encrypted with it, but because
 * the type demanded a ciphertext and there was no key to make one with.
 *
 * The ciphertext triple stays for the callers that genuinely read ciphertext
 * from a row: email_settings and the waitlist_subscribe payload. Those are
 * legacy at-rest secrets and they are opened here, for one send, as before.
 */

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  encryption: "auto" | "tls" | "ssl";
  /** The plaintext, when the caller has it. Preferred over the ciphertext. */
  password?: string | null;
  /** Legacy at-rest form: AES-256-GCM sealed with APP_ENCRYPTION_KEY. */
  ciphertext?: string | null;
  iv?: string | null;
  auth_tag?: string | null;
};

export type MailIdentity = {
  from_name: string;
  from_email: string;
  reply_to: string;
};

export type MailInput = { to: string; subject: string; text: string };

function fromHeader(identity: MailIdentity): string | null {
  const email = identity.from_email.trim();
  if (!email) return null;
  const name = identity.from_name.trim();
  return name ? `${name} <${email}>` : email;
}

/**
 * The password for one send: the plaintext the caller passed, or the legacy
 * ciphertext opened with the app key. Null when neither is usable — a missing
 * app key only matters for the second case now.
 */
function smtpPassword(cfg: SmtpConfig): string | null {
  const direct = cfg.password?.trim();
  if (direct) return direct;
  if (!cfg.ciphertext || !cfg.iv || !cfg.auth_tag || !encryptionAvailable()) return null;
  try { return decryptSecret(cfg.ciphertext, cfg.iv, cfg.auth_tag); }
  catch { return null; }
}

/** A transport built from the admin's row, or null when SMTP is not set up
 *  (no host, or no password this process can get at). */
export function smtpTransport(cfg: SmtpConfig | null) {
  if (!cfg?.host?.trim()) return null;
  const password = smtpPassword(cfg);
  if (!password) return null;
  const port = cfg.port || 587;
  // "auto" follows the port the way every mail client does: 465 is implicit
  // TLS, everything else upgrades with STARTTLS.
  const secure = cfg.encryption === "ssl" || (cfg.encryption === "auto" && port === 465);
  return nodemailer.createTransport({
    host: cfg.host.trim(),
    port,
    secure,
    requireTLS: cfg.encryption === "tls",
    auth: cfg.user.trim() ? { user: cfg.user.trim(), pass: password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

/** Deliver one message. Never throws — mail is best-effort everywhere here. */
export async function deliver(
  input: MailInput,
  identity: MailIdentity,
  smtp: SmtpConfig | null,
): Promise<{ sent: boolean; via: "smtp" | "resend" | "none"; error?: string }> {
  const transport = smtpTransport(smtp);
  const from = fromHeader(identity);
  if (transport && from) {
    try {
      await transport.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        replyTo: identity.reply_to.trim() || undefined,
      });
      return { sent: true, via: "smtp" };
    } catch (e) {
      // The reason is useful to an admin and harmless to show: it is their own
      // server talking. Credentials are never part of these messages.
      return { sent: false, via: "smtp", error: safeError(e) };
    } finally {
      transport.close();
    }
  }
  const viaResend = await sendEmail(input);
  return { sent: viaResend.sent, via: viaResend.sent ? "resend" : "none" };
}

/**
 * Deliver one HTML message through the admin's OWN SMTP, or fail honestly.
 *
 * Unlike `deliver`, this never falls back to Resend: a transactional GrovBase
 * mail (a login security code, a branded confirmation) must go out as the
 * mailbox the operator configured or not at all — a code that arrives from a
 * different identity than the one the customer trusts is worse than a resend.
 */
export async function deliverHtml(
  input: { to: string; subject: string; text: string; html: string },
  identity: MailIdentity,
  smtp: SmtpConfig | null,
): Promise<{ sent: boolean; error?: string }> {
  const transport = smtpTransport(smtp);
  const from = fromHeader(identity);
  if (!transport || !from) return { sent: false, error: "not_configured" };
  try {
    await transport.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: identity.reply_to.trim() || undefined,
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, error: safeError(e) };
  } finally {
    transport.close();
  }
}

/* ── BULK ────────────────────────────────────────────────────────────────── */

/**
 * THE NEWSLETTER'S SENDER, and why it is not `deliverHtml` in a loop.
 *
 * `deliverHtml` opens a connection, sends one message and closes it. That is
 * exactly right for a login code and exactly wrong for two thousand: it is a
 * TCP handshake, a TLS negotiation and an AUTH round trip per recipient
 * against a shared-hosting mailbox that also carries this app's signup mail.
 * A loop over it is the fastest way to get the sending identity throttled —
 * and because SMTP and IMAP share one credential here, a throttle would take
 * the admin inbox down with it.
 *
 * So this one is pooled and paced, and the caller closes it when its batch is
 * done. Three further differences, each of which the newsletter needs and the
 * transactional path must never grow:
 *
 *   HEADERS. A marketing message carries List-Unsubscribe and
 *   List-Unsubscribe-Post, which is what puts a native "Unsubscribe" button in
 *   Gmail and Apple Mail. Without them a recipient's only exit is the spam
 *   button, and that costs the whole domain.
 *
 *   A MESSAGE-ID WE KEEP. Replies are correlated by matching an incoming
 *   In-Reply-To against the id we sent under, so the id has to be minted here
 *   and handed back rather than left to the server.
 *
 *   THE ANSWER, NOT A BOOLEAN. nodemailer reports which addresses the server
 *   accepted, which it rejected and what it said. Every existing call site
 *   throws that away, which is why nothing in GrovBase can honestly say
 *   "delivered" — it can only say the call did not raise. Keeping it lets the
 *   campaign report say "accepted by the mail server", which is true, instead
 *   of "delivered", which nobody here can substantiate.
 */
export type BulkPacing = {
  /** Parallel connections. One is the safe default for shared hosting. */
  connections?: number;
  /** Messages per connection before it is recycled. */
  messagesPerConnection?: number;
  /** At most `limit` messages per `deltaMs`. */
  limit?: number;
  deltaMs?: number;
};

export type BulkMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Where a one-click unsubscribe should go. Absent = no header, which is
   *  only ever right for a test send to the operator themselves. */
  unsubscribeUrl?: string;
  /** Pre-minted so the caller can store it before the send returns. */
  messageId?: string;
};

export type BulkResult = {
  sent: boolean;
  /** Addresses the server took responsibility for. */
  accepted: string[];
  rejected: string[];
  /** The server's own last word, e.g. "250 2.0.0 Ok: queued as …". */
  response?: string;
  messageId?: string;
  error?: string;
};

export type BulkMailer = {
  send(message: BulkMessage): Promise<BulkResult>;
  close(): void;
  /** The domain the Message-IDs are minted under, for the caller's records. */
  newMessageId(): string;
};

/**
 * One pooled connection for a whole batch, or null when SMTP is not set up.
 * The caller MUST close it — a pooled transport keeps its sockets open.
 */
export function bulkMailer(
  smtp: SmtpConfig | null,
  identity: MailIdentity,
  pacing: BulkPacing = {},
): BulkMailer | null {
  if (!smtp?.host?.trim()) return null;
  const password = smtpPassword(smtp);
  if (!password) return null;
  const from = fromHeader(identity);
  if (!from) return null;

  const port = smtp.port || 587;
  const secure = smtp.encryption === "ssl" || (smtp.encryption === "auto" && port === 465);
  const transport = nodemailer.createTransport({
    host: smtp.host.trim(),
    port,
    secure,
    requireTLS: smtp.encryption === "tls",
    auth: smtp.user.trim() ? { user: smtp.user.trim(), pass: password } : undefined,
    pool: true,
    maxConnections: Math.max(1, Math.min(pacing.connections ?? 1, 5)),
    maxMessages: Math.max(1, Math.min(pacing.messagesPerConnection ?? 50, 500)),
    // nodemailer's own governor. Belt and braces with the worker's pacing:
    // this one holds even if a future caller forgets to sleep between batches.
    rateDelta: Math.max(1000, pacing.deltaMs ?? 60_000),
    rateLimit: Math.max(1, pacing.limit ?? 30),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  const domain = (identity.from_email.split("@")[1] ?? smtp.host)
    .trim().toLowerCase().replace(/[^a-z0-9.-]/g, "") || "localhost";
  const replyTo = identity.reply_to.trim() || undefined;

  return {
    newMessageId: () => `<${randomUUID()}@${domain}>`,
    close: () => { transport.close(); },
    async send(message): Promise<BulkResult> {
      try {
        const info = await transport.sendMail({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          replyTo,
          messageId: message.messageId,
          headers: message.unsubscribeUrl
            ? {
              // RFC 8058: the two together are what makes the mail client
              // offer its own one-click unsubscribe. The mailto: form is the
              // fallback for clients that do not do the POST.
              "List-Unsubscribe": `<${message.unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              // Marks the message as bulk so that autoresponders and
              // out-of-office replies do not answer it.
              "Precedence": "bulk",
              "Auto-Submitted": "auto-generated",
            }
            : undefined,
        });
        const accepted = (info.accepted ?? []).map(String);
        const rejected = (info.rejected ?? []).map(String);
        return {
          // "Sent" here means the server took the address, not that a human
          // received it. The column it lands in is named accordingly.
          sent: accepted.length > 0,
          accepted,
          rejected,
          response: typeof info.response === "string" ? info.response : undefined,
          messageId: info.messageId ?? message.messageId,
        };
      } catch (e) {
        return { sent: false, accepted: [], rejected: [message.to], error: safeError(e) };
      }
    },
  };
}

/** Prove the SMTP settings work, without sending anything to anyone. */
export async function verifySmtp(smtp: SmtpConfig | null): Promise<{ ok: boolean; error?: string }> {
  const transport = smtpTransport(smtp);
  if (!transport) return { ok: false, error: "not_configured" };
  try {
    await transport.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeError(e) };
  } finally {
    transport.close();
  }
}

/** A short, non-leaking description of what went wrong. */
function safeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/\s+/g, " ").slice(0, 200);
}
