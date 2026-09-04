import "server-only";
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
 * The password never exists at rest: the row holds AES-256-GCM ciphertext and
 * it is decrypted here, in the server process, for the duration of one send.
 */

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  encryption: "auto" | "tls" | "ssl";
  ciphertext: string | null;
  iv: string | null;
  auth_tag: string | null;
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

/** A transport built from the admin's row, or null when SMTP is not set up
 *  (no host, no password, or no key to decrypt it with). */
export function smtpTransport(cfg: SmtpConfig | null) {
  if (!cfg?.host?.trim() || !cfg.ciphertext || !cfg.iv || !cfg.auth_tag) return null;
  if (!encryptionAvailable()) return null;
  let password: string;
  try { password = decryptSecret(cfg.ciphertext, cfg.iv, cfg.auth_tag); }
  catch { return null; }
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
