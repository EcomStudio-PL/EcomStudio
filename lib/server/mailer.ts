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
