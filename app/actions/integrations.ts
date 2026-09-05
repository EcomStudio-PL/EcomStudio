"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { encryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { verifySmtp, deliver, type SmtpConfig } from "@/lib/server/mailer";
import { verifyImap } from "@/lib/server/imap";
import { getTelegramChats, sendTelegramMessage, tgEscape, type TelegramError } from "@/lib/server/telegram";
import { NOTIFICATION_EVENTS } from "@/lib/server/notify";
import {
  ensureDispatchHash, readIntegration, readIntegrationSecrets, setIntegrationStatus, writeIntegration,
  type MailConfig, type TelegramConfig,
} from "@/lib/server/integrations";

/**
 * KOMUNIKACJA — everything the admin panel does to the mailbox, the Telegram
 * bot and the list of events that reach it.
 *
 * Three rules run through the whole file.
 *
 * 1. Each action re-checks the role itself. The admin layout guards the screens,
 *    but a server action is its own entry point: a session that is no longer an
 *    admin must not be able to rewrite the mail password by replaying a call.
 * 2. A password or a bot token enters here and never comes back. It is handed
 *    straight to writeIntegration (which encrypts it) or to the provider, and an
 *    empty field means KEEP — retyping a working credential to change a port is
 *    the one thing this screen must never demand.
 * 3. Nothing driver-shaped reaches the browser. Every failure is reduced to a
 *    STABLE CODE from the vocabulary below, which the UI maps to a translated
 *    string; the fuller (already scrubbed) message goes to last_error_safe,
 *    where the admin can read it deliberately.
 *
 * Error codes: forbidden · invalid_email · invalid_host · invalid_port ·
 * invalid_encryption · invalid_chat_id · invalid_token · encryption_unavailable ·
 * not_configured · auth · tls · network · chat_not_found · send_failed · generic
 */

type Result = { ok: true } | { ok: false; error: string };
/** Tests answer with the same shape as testEmailConnectionAction so the two
 *  admin screens can share their button logic. */
type TestResult = { ok: boolean; error?: string };

/** The screen these actions belong to; mirroring additionally touches the older
 *  e-mail screen, which reads the row we write there. */
const ADMIN_PATH = "/admin/communications";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

/** requireAdmin throws so no action body can forget it; this is where that
 *  throw becomes a code, and anything else becomes "generic" rather than a
 *  message that might quote the request that failed. */
function reason(e: unknown): string {
  const message = e instanceof Error ? e.message : "";
  return message === "unauthenticated" || message === "not_admin" ? "forbidden" : "generic";
}

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;
/** Numeric ids (groups are negative and long) or a public @username. */
const CHAT_ID = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/;
/** Telegram's own shape: <bot id>:<35-char secret>. Checked so an obviously
 *  mistyped token is refused here instead of turning into a 401 later. */
const BOT_TOKEN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

const SMTP_ENCRYPTIONS: readonly MailConfig["smtp_encryption"][] = ["starttls", "ssl", "none"];

/**
 * The mailbox integration speaks IMAP's vocabulary; email_settings and
 * nodemailer speak the older one from 0048. "none" has no counterpart there —
 * "auto" is the honest translation, because nodemailer then upgrades only if
 * the server offers it, which is what "no encryption configured" means in
 * practice.
 */
const LEGACY_ENCRYPTION: Record<MailConfig["smtp_encryption"], SmtpConfig["encryption"]> = {
  starttls: "tls",
  ssl: "ssl",
  none: "auto",
};

// ---------- MAIL ----------

export type MailIntegrationInput = {
  config: MailConfig;
  /** Absent keeps whatever the row already says. */
  enabled?: boolean;
  /** Only sent when the admin typed a new one; empty means "keep the stored
   *  password", so the form never has to echo a secret back to the browser. */
  imapPassword?: string;
  smtpPassword?: string;
};

/** Trim and clamp before anything is validated, so a pasted host with a
 *  trailing space is accepted rather than reported as empty. */
function normaliseMail(input: MailConfig): MailConfig {
  return {
    account_name: input.account_name.trim().slice(0, 120),
    email: input.email.trim().toLowerCase().slice(0, 254),
    from_name: input.from_name.trim().slice(0, 120),
    imap_host: input.imap_host.trim().slice(0, 255),
    imap_port: Math.trunc(Number(input.imap_port)),
    imap_secure: input.imap_secure === true,
    imap_user: input.imap_user.trim().slice(0, 255),
    smtp_host: input.smtp_host.trim().slice(0, 255),
    smtp_port: Math.trunc(Number(input.smtp_port)),
    smtp_encryption: input.smtp_encryption,
    smtp_user: input.smtp_user.trim().slice(0, 255),
    smtp_same_as_imap: input.smtp_same_as_imap === true,
    mirror_to_email_settings: input.mirror_to_email_settings === true,
    sent_folder: input.sent_folder.trim().slice(0, 200),
  };
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Which non-secret fields the admin actually changed — the audit trail records
 *  that and never a value that could be a credential. */
function changedMailFields(before: MailConfig, after: MailConfig): string[] {
  return (Object.keys(after) as (keyof MailConfig)[]).filter((key) => before[key] !== after[key]);
}

export async function saveMailIntegrationAction(input: MailIntegrationInput): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const config = normaliseMail(input.config);

    if (!EMAIL.test(config.email)) return { ok: false, error: "invalid_email" };
    if (!config.imap_host || !config.smtp_host) return { ok: false, error: "invalid_host" };
    if (!validPort(config.imap_port) || !validPort(config.smtp_port)) return { ok: false, error: "invalid_port" };
    if (!SMTP_ENCRYPTIONS.includes(config.smtp_encryption)) return { ok: false, error: "invalid_encryption" };

    // Trimmed for the "did the admin type anything?" decision AND for storage:
    // a password pasted with a trailing newline is a support ticket, not a
    // deliberate credential.
    const typedImap = (input.imapPassword ?? "").trim();
    const typedSmtp = (input.smtpPassword ?? "").trim();
    const secrets: Record<string, string | null> = {};
    if (typedImap) secrets.imap_password = typedImap;

    if (config.smtp_same_as_imap) {
      // "Same as IMAP" is resolved HERE, not in the UI and not at send time, so
      // every consumer (the tester, the mailer, the cron) reads one truth off
      // the row. When no new password was typed the stored IMAP one is copied
      // across, otherwise flipping the checkbox alone would leave SMTP holding
      // a stale password from before.
      config.smtp_user = config.imap_user;
      const mirrored = typedImap || (await readIntegrationSecrets<MailConfig>(supabase, "mail")).secrets.imap_password;
      if (mirrored) secrets.smtp_password = mirrored;
    } else if (typedSmtp) {
      secrets.smtp_password = typedSmtp;
    }

    const before = await readIntegration<MailConfig>(supabase, "mail");
    const written = await writeIntegration<MailConfig>(supabase, "mail", {
      config,
      enabled: input.enabled,
      secrets,
    });
    if (!written.ok) {
      return { ok: false, error: written.error === "encryption_unavailable" ? "encryption_unavailable" : "generic" };
    }

    // The waitlist mailer still reads email_settings. Mirroring keeps that one
    // working when the admin decides this mailbox is also the sender, and is
    // read back from the row we just wrote so it carries the merged secret
    // rather than whatever happened to be in the form.
    let mirrored = false;
    if (config.mirror_to_email_settings) {
      const stored = await readIntegrationSecrets<MailConfig>(supabase, "mail");
      mirrored = await mirrorToEmailSettings(supabase, adminId, config, stored.secrets.smtp_password ?? "");
    }

    // Arm the dispatcher: the SECURITY DEFINER functions refuse everything
    // until sha256(token) is published, and a save is the natural moment.
    await ensureDispatchHash(supabase);
    await logAudit(supabase, {
      actorId: adminId, action: "integration.mail_saved", entityType: "integration_settings", entityId: "mail",
      after: {
        fields: changedMailFields(before.config, config),
        enabled: input.enabled ?? before.enabled,
        imap_password_replaced: Boolean(typedImap),
        smtp_password_replaced: Boolean(secrets.smtp_password),
        mirrored_to_email_settings: mirrored,
      },
    });
    revalidatePath(ADMIN_PATH);
    if (config.mirror_to_email_settings) revalidatePath("/admin/email");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}

/**
 * Copy the transport half of the mailbox into email_settings.
 *
 * Only the transport: from_name / from_email / reply_to belong to the e-mail
 * screen and an admin who set a different sender identity there must not lose
 * it to a checkbox here. The password is re-encrypted with APP_ENCRYPTION_KEY
 * because that is the key smtpTransport() decrypts with, and it is written only
 * when we actually hold one — a missing password must never blank the working
 * credential that row already has.
 */
async function mirrorToEmailSettings(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  adminId: string,
  config: MailConfig,
  password: string,
): Promise<boolean> {
  const row: Record<string, unknown> = {
    id: true,
    smtp_host: config.smtp_host,
    smtp_port: config.smtp_port,
    smtp_user: config.smtp_user,
    smtp_encryption: LEGACY_ENCRYPTION[config.smtp_encryption],
    updated_by: adminId,
    updated_at: new Date().toISOString(),
  };
  if (password && encryptionAvailable()) {
    const { ciphertext, iv, authTag } = encryptSecret(password);
    row.smtp_secret_ciphertext = ciphertext;
    row.smtp_secret_iv = iv;
    row.smtp_secret_auth_tag = authTag;
  }
  const { error } = await supabase.from("email_settings").upsert(row as never, { onConflict: "id" });
  if (error) {
    // A refused mirror does not undo a saved integration, so it is reported in
    // the audit trail instead of failing the whole save.
    console.error("integrations.mirror");
    return false;
  }
  return true;
}

/**
 * Mail servers phrase failure in a hundred ways and none of them are safe to
 * put on a screen verbatim. Four buckets are all an admin needs to know what to
 * do next: fix the password, fix the encryption setting, fix the host, or read
 * the stored detail.
 */
function classifyMailError(message: string): string {
  const m = message.toLowerCase();
  if (!m) return "generic";
  // Codes this module raised itself pass straight through; only text that came
  // off a wire needs interpreting.
  if (m === "not_configured" || m === "send_failed") return m;
  if (/auth|credential|login|invalid user|5\.7\.\d|\b53[045]\b/.test(m)) return "auth";
  if (/certificat|ssl|tls|eproto|wrong version number|self.signed/.test(m)) return "tls";
  if (/timeout|timed out|etimedout|enotfound|econnrefused|econnreset|ehostunreach|eai_again|getaddrinfo|socket|network|dns/.test(m)) {
    return "network";
  }
  return "generic";
}

/** The credentials a test needs, or null when nothing is stored yet. */
async function mailCredentials(supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"]) {
  const { config, secrets } = await readIntegrationSecrets<MailConfig>(supabase, "mail");
  // The mirror is resolved at save time, but a row saved before that (or by an
  // older build) can still be missing it — falling back keeps "same as IMAP"
  // true even then.
  const smtpPassword = secrets.smtp_password ?? (config.smtp_same_as_imap ? secrets.imap_password : undefined);
  return { config, imapPassword: secrets.imap_password ?? "", smtpPassword: smtpPassword ?? "" };
}

/** Record the verdict, and give the UI a code rather than the server's words. */
async function finishMailTest(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  adminId: string,
  channel: "imap" | "smtp" | "send",
  result: { ok: boolean; error?: string },
): Promise<TestResult> {
  const code = result.ok ? undefined : classifyMailError(result.error ?? "");
  await setIntegrationStatus(supabase, "mail", result.ok ? "connected" : "error", result.error ?? null);
  await logAudit(supabase, {
    actorId: adminId, action: "integration.tested", entityType: "integration_settings", entityId: "mail",
    after: { channel, ok: result.ok, code: code ?? null },
  });
  revalidatePath(ADMIN_PATH);
  return result.ok ? { ok: true } : { ok: false, error: code };
}

export async function testImapAction(): Promise<TestResult> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { config, imapPassword } = await mailCredentials(supabase);
    if (!imapPassword) {
      // Nothing stored is not a failed test: leave the row saying so instead of
      // stamping an error the admin cannot act on.
      await setIntegrationStatus(supabase, "mail", "not_configured", null);
      return { ok: false, error: "not_configured" };
    }
    const result = await verifyImap({
      host: config.imap_host,
      port: config.imap_port,
      secure: config.imap_secure,
      user: config.imap_user,
      pass: imapPassword,
    });
    return finishMailTest(supabase, adminId, "imap", result);
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}

/**
 * verifySmtp() takes the ciphertext shape email_settings stores, so the
 * plaintext is re-encrypted with APP_ENCRYPTION_KEY for the length of one call.
 * That is deliberate reuse: the transport builder, its timeouts and its
 * "auto/tls/ssl" handling are already proven by the waitlist mailer.
 */
function smtpConfigFor(config: MailConfig, password: string): SmtpConfig | null {
  if (!password || !encryptionAvailable()) return null;
  const { ciphertext, iv, authTag } = encryptSecret(password);
  return {
    host: config.smtp_host,
    port: config.smtp_port,
    user: config.smtp_user,
    encryption: LEGACY_ENCRYPTION[config.smtp_encryption],
    ciphertext,
    iv,
    auth_tag: authTag,
  };
}

export async function testSmtpAction(): Promise<TestResult> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { config, smtpPassword } = await mailCredentials(supabase);
    if (!smtpPassword) {
      await setIntegrationStatus(supabase, "mail", "not_configured", null);
      return { ok: false, error: "not_configured" };
    }
    const smtp = smtpConfigFor(config, smtpPassword);
    if (!smtp) return { ok: false, error: "encryption_unavailable" };
    return finishMailTest(supabase, adminId, "smtp", await verifySmtp(smtp));
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}

export async function sendTestEmailAction(to: string): Promise<TestResult> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const recipient = to.trim().toLowerCase().slice(0, 254);
    if (!EMAIL.test(recipient)) return { ok: false, error: "invalid_email" };

    const { config, smtpPassword } = await mailCredentials(supabase);
    if (!smtpPassword) {
      await setIntegrationStatus(supabase, "mail", "not_configured", null);
      return { ok: false, error: "not_configured" };
    }
    const smtp = smtpConfigFor(config, smtpPassword);
    if (!smtp) return { ok: false, error: "encryption_unavailable" };

    const result = await deliver(
      {
        to: recipient,
        subject: "GrovBase — test SMTP",
        text: "To jest wiadomość testowa z panelu GrovBase. Jeśli ją widzisz, wysyłka e-mail działa poprawnie.",
      },
      { from_name: config.from_name, from_email: config.email, reply_to: config.email },
      smtp,
    );
    // deliver() falls back to Resend when the transport cannot be built. That is
    // right for a real send and wrong for a test: a message that went out
    // through somebody else's service proves nothing about THIS mailbox.
    const sent = result.sent && result.via === "smtp";
    return finishMailTest(supabase, adminId, "send", {
      ok: sent,
      error: sent ? undefined : result.error ?? "send_failed",
    });
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}

// ---------- TELEGRAM ----------

export type TelegramIntegrationInput = {
  chat_id: string;
  channel_name: string;
  enabled?: boolean;
  /** Empty means "keep the stored token", exactly like the mail passwords. */
  botToken?: string;
};

/** The bot API's codes are already a closed set; they pass through unchanged so
 *  the UI needs one mapping table, not two. */
function telegramCode(error: TelegramError | undefined): string {
  return error ?? "generic";
}

export async function saveTelegramIntegrationAction(input: TelegramIntegrationInput): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const config: TelegramConfig = {
      chat_id: input.chat_id.trim().slice(0, 64),
      channel_name: input.channel_name.trim().slice(0, 120),
    };
    // Empty is allowed: the admin saves the bot token first and picks the chat
    // afterwards, because detecting chats needs a working token.
    if (config.chat_id && !CHAT_ID.test(config.chat_id)) return { ok: false, error: "invalid_chat_id" };

    const typedToken = (input.botToken ?? "").trim();
    if (typedToken && !BOT_TOKEN.test(typedToken)) return { ok: false, error: "invalid_token" };

    const before = await readIntegration<TelegramConfig>(supabase, "telegram");
    const written = await writeIntegration<TelegramConfig>(supabase, "telegram", {
      config,
      enabled: input.enabled,
      secrets: typedToken ? { bot_token: typedToken } : {},
    });
    if (!written.ok) {
      return { ok: false, error: written.error === "encryption_unavailable" ? "encryption_unavailable" : "generic" };
    }

    await ensureDispatchHash(supabase);
    await logAudit(supabase, {
      actorId: adminId, action: "integration.telegram_saved", entityType: "integration_settings", entityId: "telegram",
      after: {
        enabled: input.enabled ?? before.enabled,
        chat_id_changed: before.config.chat_id !== config.chat_id,
        channel_name_changed: before.config.channel_name !== config.channel_name,
        bot_token_replaced: Boolean(typedToken),
      },
    });
    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}

export async function testTelegramAction(): Promise<TestResult> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { config, secrets } = await readIntegrationSecrets<TelegramConfig>(supabase, "telegram");
    const token = secrets.bot_token ?? "";
    if (!token || !config.chat_id) {
      await setIntegrationStatus(supabase, "telegram", "not_configured", null);
      return { ok: false, error: "not_configured" };
    }
    // A real message, not a getMe: it is the only thing that proves the bot can
    // actually post in the chat the admin picked.
    const result = await sendTelegramMessage(token, config.chat_id, tgEscape("✅ GrovBase połączony z Telegramem"));
    const code = result.ok ? null : telegramCode(result.error);
    await setIntegrationStatus(supabase, "telegram", result.ok ? "connected" : "error", code);
    await logAudit(supabase, {
      actorId: adminId, action: "integration.tested", entityType: "integration_settings", entityId: "telegram",
      after: { ok: result.ok, code },
    });
    revalidatePath(ADMIN_PATH);
    return result.ok ? { ok: true } : { ok: false, error: code ?? "generic" };
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}

export type TelegramChat = { id: string; title: string; type: string };

/**
 * The chat picker's data source. The token stays on the server: what comes back
 * is the ids and titles of chats the bot has recently seen, which is public
 * information to anyone already in those chats.
 */
export async function detectTelegramChatsAction(): Promise<
  { ok: true; chats: TelegramChat[] } | { ok: false; error: string }
> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { secrets } = await readIntegrationSecrets<TelegramConfig>(supabase, "telegram");
    const token = secrets.bot_token ?? "";
    if (!token) return { ok: false, error: "not_configured" };

    const result = await getTelegramChats(token);
    await logAudit(supabase, {
      actorId: adminId, action: "integration.telegram_chats_detected",
      entityType: "integration_settings", entityId: "telegram",
      after: { ok: result.ok, chats: result.chats.length },
    });
    // An empty list is a normal answer — Telegram only reports recent traffic —
    // so it is success, and the UI explains how to make a chat appear.
    if (!result.ok) return { ok: false, error: telegramCode(result.error) };
    return { ok: true, chats: result.chats };
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}

// ---------- NOTIFICATION PREFERENCES ----------

const KNOWN_EVENTS: readonly string[] = NOTIFICATION_EVENTS.map((event) => event.type);

/**
 * Save the whole switchboard in one call.
 *
 * Two statements, not ten: the enabled events in one UPDATE and everything else
 * in another, so a screen with all ten switches costs the same as a screen with
 * one. Unknown keys are dropped rather than rejected — the seed owns the list of
 * events, and a stale tab must not be able to invent rows.
 */
export async function saveNotificationPreferencesAction(prefs: Record<string, boolean>): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const enabled: string[] = [];
    const disabled: string[] = [];
    for (const event of KNOWN_EVENTS) {
      const value = prefs[event];
      if (value === undefined) continue;
      (value === true ? enabled : disabled).push(event);
    }
    if (enabled.length === 0 && disabled.length === 0) return { ok: false, error: "invalid" };

    if (enabled.length > 0) {
      const { error } = await supabase
        .from("notification_preferences")
        .update({ telegram_enabled: true })
        .in("event_type", enabled);
      if (error) return { ok: false, error: "generic" };
    }
    if (disabled.length > 0) {
      const { error } = await supabase
        .from("notification_preferences")
        .update({ telegram_enabled: false })
        .in("event_type", disabled);
      if (error) return { ok: false, error: "generic" };
    }

    // Switching an event on is the moment delivery starts to matter, and the
    // dispatch functions refuse to hand out work until the hash is published.
    await ensureDispatchHash(supabase);
    await logAudit(supabase, {
      actorId: adminId, action: "notifications.prefs_saved", entityType: "notification_preferences",
      after: { enabled, disabled: disabled.length },
    });
    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}
