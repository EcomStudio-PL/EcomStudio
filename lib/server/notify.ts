import "server-only";
import type { Client } from "@/lib/services/workspace";
import { sendAdminNotification } from "@/lib/server/admin-email";
import { decryptWith, encryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { dispatchToken, safeError } from "@/lib/server/integrations";
import type { SmtpConfig } from "@/lib/server/mailer";
import { sendTelegramMessage, tgEscape } from "@/lib/server/telegram";

/**
 * NOTIFICATIONS — from "something happened" to a Telegram message or an e-mail.
 *
 * The hard part is privilege. A waitlist signup runs as anon and a generation
 * failure runs as an ordinary user; neither may read the bot token, yet both
 * must be able to announce themselves. So nothing here reads
 * integration_settings directly: `notify` hands the event to the SECURITY
 * DEFINER function `enqueue_notification` (which drops it unless the admin
 * switched that event on), and the dispatcher claims work back out with a
 * token the server derives from its own encryption key.
 *
 * The second rule is that a notification may never break the thing it reports
 * on. Every export below swallows its failures: a message that cannot go out
 * stays pending in the outbox for the cron, and the signup still succeeds.
 *
 * Since 0055 an event can have TWO destinations. `notify` still says one thing
 * once — the queue decides how many rows that becomes, one per channel the
 * admin enabled — and the claimed row now names its own channel, which is the
 * only thing `dispatchOne` branches on. Telegram's path below is untouched by
 * that split, down to its skip reasons.
 */

export type NotificationEvent =
  | "mail.received"
  | "user.registered"
  | "waitlist.signup"
  | "payment.received"
  | "credits.purchased"
  | "subscription.created"
  | "subscription.renewed"
  | "payment.failed"
  | "subscription.cancelled"
  | "system.error";

export type NotificationCategory = "sales" | "users" | "mail" | "system";

/**
 * The catalogue the admin panel renders, in the same order and with the same
 * categories as the seed in 0052_communications.sql.
 *
 * `wired: false` marks the six events nothing in this codebase can fire yet:
 * `payments` and `subscriptions` exist as tables but no billing module writes
 * to them. They are listed so the switches are ready the day billing lands —
 * and flagged so the UI can say "not active yet" instead of implying that
 * payment alerts already work.
 */
export const NOTIFICATION_EVENTS: readonly {
  type: NotificationEvent;
  category: NotificationCategory;
  sortOrder: number;
  wired: boolean;
}[] = [
  { type: "mail.received", category: "mail", sortOrder: 10, wired: true },
  { type: "user.registered", category: "users", sortOrder: 20, wired: true },
  { type: "waitlist.signup", category: "users", sortOrder: 30, wired: true },
  { type: "payment.received", category: "sales", sortOrder: 40, wired: false },
  { type: "credits.purchased", category: "sales", sortOrder: 50, wired: false },
  { type: "subscription.created", category: "sales", sortOrder: 60, wired: false },
  { type: "subscription.renewed", category: "sales", sortOrder: 70, wired: false },
  { type: "payment.failed", category: "sales", sortOrder: 80, wired: false },
  { type: "subscription.cancelled", category: "sales", sortOrder: 90, wired: false },
  { type: "system.error", category: "system", sortOrder: 100, wired: true },
];

/** The renderable half of a notification — what `formatTelegram` needs. */
export type NotificationMessage = {
  type?: NotificationEvent;
  title: string;
  icon?: string;
  /** Label/value pairs rendered as "Label: value", one per line. */
  rows?: [string, string][];
  /** A short excerpt (a mail preview, an error message) shown in italics. */
  quote?: string;
  footer?: string;
};

export type NotifyInput = NotificationMessage & { type: NotificationEvent; dedupeKey?: string };

/** Outbox statuses the dispatcher writes back. "pending" is the DB's default
 *  and is never set from here. */
type DispatchStatus = "sent" | "failed" | "skipped";

/** Telegram rate-limits a bot to roughly 20 messages a minute in one group, and
 *  a serverless request has a wall clock. Drain a batch, leave the rest. */
const MAX_BATCH = 20;
/** The piggy-backed drain after an enqueue: enough to carry this event and a
 *  couple of stragglers without stretching the request it rides on. */
const IMMEDIATE_BATCH = 5;

/** Per-field caps, applied before escaping so an HTML entity can never be cut
 *  in half — a truncated "&amp;" makes Telegram reject the whole message. */
const TITLE_MAX = 200;
const LABEL_MAX = 80;
const VALUE_MAX = 300;
const QUOTE_MAX = 250;

/**
 * The key the claimed ciphertext was written with. This repeats the resolution
 * rule from integrations.ts deliberately: the claim function returns
 * ciphertext, never plaintext, and the dispatcher often runs for a caller RLS
 * keeps out of integration_settings — so it has to hold the key itself.
 */
function integrationsKeyHex(): string | null {
  for (const candidate of [process.env.GROVBASE_INTEGRATIONS_ENCRYPTION_KEY, process.env.APP_ENCRYPTION_KEY]) {
    const hex = candidate?.trim();
    if (hex && hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex)) return hex;
  }
  return null;
}

/** Stable keys for the partial unique index on notification_outbox.dedupe_key —
 *  the thing that stops one mail from being announced twice when two requests
 *  poll the same folder. */
export function buildDedupeKey(type: NotificationEvent, ...parts: (string | number)[]): string {
  return [type, ...parts.map((part) => String(part).trim()).filter((part) => part !== "")].join(":");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cut to `max`, never leaving half of a surrogate pair behind — a lone half
 *  renders as the replacement character in every Telegram client. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function clean(text: string, max: number): string {
  return truncate(collapse(text), max);
}

/** The card's top and bottom edge. Sixteen box-drawing characters is the widest
 *  rule that still fits one line on a narrow phone without wrapping. */
const RULE = "━".repeat(16);

/**
 * The message body, Polish, HTML parse mode:
 *
 *   🎉 <b>NOWA REJESTRACJA</b>
 *   ━━━━━━━━━━━━━━━━
 *
 *   👤 <b>Użytkownik</b>
 *   Jan Kowalski
 *
 *   📧 <b>E-mail</b>
 *   jan@example.com
 *
 *   ━━━━━━━━━━━━━━━━
 *   GrovBase Admin
 *
 * A label above its value, not "Label: value": Telegram wraps a long line
 * mid-address on a phone, and a value on its own line stays readable and stays
 * tappable. The caller owns the per-row emoji — it is the front of the label —
 * so this formatter never has to know which event it is rendering.
 *
 * Every interpolated value is escaped, and a row whose value is empty is
 * dropped whole rather than printed as a dangling label with nothing under it.
 */
export function formatTelegram(input: NotificationMessage): string {
  const icon = input.icon ? `${tgEscape(collapse(input.icon))} ` : "";
  const blocks = [`${icon}<b>${tgEscape(clean(input.title, TITLE_MAX))}</b>\n${RULE}`];

  for (const [rawLabel, rawValue] of input.rows ?? []) {
    const value = clean(rawValue, VALUE_MAX);
    if (!value) continue;
    const label = clean(rawLabel, LABEL_MAX);
    blocks.push(label ? `<b>${tgEscape(label)}</b>\n${tgEscape(value)}` : tgEscape(value));
  }

  const quote = clean(input.quote ?? "", QUOTE_MAX);
  if (quote) blocks.push(`<i>„${tgEscape(quote)}"</i>`);

  // The closing rule is part of the card, so it is printed even when the caller
  // sent no footer — a message that stops mid-air reads like a truncated one.
  const footer = clean(input.footer ?? "", VALUE_MAX);
  blocks.push(footer ? `${RULE}\n${tgEscape(footer)}` : RULE);

  return blocks.join("\n\n");
}

/**
 * Announce an event. Never throws, never returns a reason — a caller in the
 * middle of a signup has nothing useful to do with one.
 *
 * The row is enqueued first (so it survives even if Telegram is down) and then
 * drained in the same request, because a notification that arrives ten minutes
 * later has already lost most of its value. A failed drain leaves the row
 * pending for the cron.
 */
export async function notify(supabase: Client, input: NotifyInput): Promise<void> {
  try {
    // Most callers here run as anon or as an ordinary customer, so the queue
    // has to be reachable without admin rights — which is exactly why it is
    // gated on the token instead. Our server can always produce it; a stranger
    // holding the publishable anon key cannot, and so cannot post fake events.
    const token = dispatchToken();
    if (!token) return;
    // p_dedupe is optional in SQL and generates as `string | undefined`;
    // leaving it out is what the function's own `default null` means.
    const { error } = await supabase.rpc("enqueue_notification", {
      p_event: input.type,
      p_payload: {
        title: input.title,
        icon: input.icon ?? null,
        rows: input.rows ?? [],
        quote: input.quote ?? null,
        footer: input.footer ?? null,
      },
      p_dedupe: input.dedupeKey,
      p_token: token,
    });
    // The function is a no-op when the admin has that event switched off, so
    // an error here is a real problem (missing grant, missing migration) and
    // worth a line in the server log — scrubbed, like everything else.
    if (error) {
      console.error("notify.enqueue", input.type, safeError(error));
      return;
    }
    await drainNotifications(supabase, IMMEDIATE_BATCH);
  } catch (e) {
    console.error("notify", safeError(e));
  }
}

type SecretBlob = { c: string; i: string; t: string };

/** The two destinations notification_outbox.channel allows (0055). An unknown
 *  value reads as Telegram, which is the column's own default. */
export type NotificationChannel = "telegram" | "admin_email";

/** What the e-mail channel needs off the mail integration's `config`, already
 *  translated into the vocabulary nodemailer speaks. */
type MailDispatchConfig = {
  host: string;
  port: number;
  user: string;
  encryption: SmtpConfig["encryption"];
  fromName: string;
  fromEmail: string;
};

type ClaimedRow = {
  id: string;
  eventType: string;
  createdAt: string;
  channel: NotificationChannel;
  message: NotificationMessage;
  chatId: string;
  /** The BOT TOKEN envelope. The mail password has its own field below — one
   *  claimed row now carries two unrelated secrets, and mixing them up would
   *  mean handing a mail server a Telegram token. */
  blob: SecretBlob | null;
  /** The Telegram integration's own on/off switch, as the claim returns it.
   *  It says nothing about the e-mail channel and must never gate it. */
  enabled: boolean;
  adminEmailTo: string;
  mail: MailDispatchConfig;
  smtpBlob: SecretBlob | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readBlob(value: unknown): SecretBlob | null {
  const blob = asRecord(value);
  return typeof blob.c === "string" && typeof blob.i === "string" && typeof blob.t === "string"
    ? { c: blob.c, i: blob.i, t: blob.t }
    : null;
}

/**
 * The mailbox integration speaks IMAP's vocabulary ("starttls" / "ssl" /
 * "none"); nodemailer speaks the older one. The same translation
 * app/actions/integrations.ts makes for the SMTP tester, repeated here because
 * that one lives in a "use server" module a library must not import: "none"
 * becomes "auto", which is what nodemailer does when nothing was configured —
 * upgrade the connection only if the server offers it.
 */
function smtpEncryption(value: unknown): SmtpConfig["encryption"] {
  const raw = asString(value);
  if (raw === "ssl") return "ssl";
  if (raw === "starttls") return "tls";
  return "auto";
}

/** The mail row's `config`, read defensively: the claim hands back whatever
 *  jsonb the admin panel saved, and a half-filled row must yield a config the
 *  dispatcher can reject cleanly rather than a crash mid-batch. */
function readMail(value: unknown): MailDispatchConfig {
  const config = asRecord(value);
  const port = Math.trunc(Number(config.smtp_port));
  const user = asString(config.smtp_user).trim();
  return {
    host: asString(config.smtp_host).trim(),
    // The submission port is the one every provider offers; a missing or
    // nonsense value is a misconfigured row, not a reason to skip the mail.
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 587,
    user,
    encryption: smtpEncryption(config.smtp_encryption),
    fromName: asString(config.from_name).trim() || "GrovBase",
    // In this deployment the SMTP user IS the mailbox address, so it is the
    // honest fallback when the sender address was never filled in.
    fromEmail: asString(config.email).trim() || user,
  };
}

function readRows(value: unknown): [string, string][] {
  if (!Array.isArray(value)) return [];
  const out: [string, string][] = [];
  for (const entry of value) {
    if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string") {
      out.push([entry[0], entry[1]]);
    }
  }
  return out;
}

/**
 * One row as the claim function hands it back: the outbox entry, the channel it
 * is going out on, and the credentials for that channel.
 *
 * The names that matter are the ones `notification_dispatch_claim` declares in
 * its RETURNS TABLE — channel, telegram_enabled, telegram_config,
 * bot_token_ciphertext, mail_config, smtp_password_ciphertext, admin_email_to
 * (0055_admin_email_channel.sql) — because PostgREST keys the JSON by those. A
 * name that does not match reads as an empty value here, the dispatcher closes
 * the row as "skipped", and NOTHING anywhere reports an error: that is the bug
 * this module already had once, and the reason the fixture in
 * scripts/comm-tests.ts is copied column for column from the migration.
 *
 * The flat and nested variants stay as fallbacks so a later migration may move
 * the values around, but they are fallbacks, not the contract. Anything
 * unreadable yields a row with no credentials, which is skipped rather than
 * crashing the batch.
 *
 * Exported for scripts/comm-tests.ts: the parameter is `unknown`, so a column
 * rename typechecks fine and only an assertion on a real claim shape catches it.
 */
export function readClaim(raw: unknown): ClaimedRow | null {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) return null;
  const payload = asRecord(row.payload);
  const config = asRecord(row.telegram_config ?? row.config);
  const mailConfig = asRecord(row.mail_config);
  const secrets = asRecord(row.secrets);
  const flat = readBlob({
    c: row.bot_token_c ?? row.token_c,
    i: row.bot_token_i ?? row.token_i,
    t: row.bot_token_t ?? row.token_t,
  });
  return {
    id,
    eventType: asString(row.event_type),
    createdAt: asString(row.created_at),
    // Only the value 0055 added switches destination; anything else — a row
    // enqueued before the column existed, a claim shape without it — is the
    // Telegram message this queue has always carried.
    channel: asString(row.channel) === "admin_email" ? "admin_email" : "telegram",
    message: {
      title: asString(payload.title) || asString(row.event_type),
      icon: asString(payload.icon) || undefined,
      rows: readRows(payload.rows),
      quote: asString(payload.quote) || undefined,
      footer: asString(payload.footer) || undefined,
    },
    chatId: (asString(row.chat_id) || asString(config.chat_id)).trim(),
    blob: flat ?? readBlob(row.bot_token_ciphertext) ?? readBlob(row.bot_token) ?? readBlob(secrets.bot_token),
    // Only an explicit false disables delivery: a shape without the column at
    // all (an older claim function) must keep sending, not go silent.
    enabled: row.telegram_enabled !== false,
    // The RPC already trims this and nulls it when blank; the mail config is
    // where the address lives, so it is also where the fallback reads from.
    adminEmailTo: (asString(row.admin_email_to) || asString(mailConfig.admin_notify_to)).trim(),
    mail: readMail(mailConfig),
    smtpBlob: readBlob(row.smtp_password_ciphertext) ?? readBlob(row.smtp_password) ?? readBlob(secrets.smtp_password),
  };
}

/**
 * Send one claimed row down the channel it names. The distinction that matters
 * in both branches is "skipped" vs "failed": a missing chat id, a missing
 * recipient or a key that no longer opens the ciphertext cannot be fixed by
 * trying again, so those rows are closed instead of being retried by every cron
 * run for the rest of time — while a mail server that refused this minute is
 * exactly what the 0053 attempts budget exists for.
 *
 * Exported for scripts/comm-tests.ts alongside `readClaim`.
 */
export async function dispatchOne(row: ClaimedRow, keyHex: string | null): Promise<{ status: DispatchStatus; error: string | null }> {
  return row.channel === "admin_email" ? dispatchAdminEmail(row, keyHex) : dispatchTelegram(row, keyHex);
}

async function dispatchTelegram(row: ClaimedRow, keyHex: string | null): Promise<{ status: DispatchStatus; error: string | null }> {
  // The integration switched off is the admin's decision, not a delivery
  // attempt: checked before the credentials so a leftover token in a disabled
  // row can never post. Same skip reason — from the outbox's point of view
  // there is no Telegram to send to either way.
  if (!row.enabled) return { status: "skipped", error: "telegram_not_configured" };
  if (!row.chatId || !row.blob) return { status: "skipped", error: "telegram_not_configured" };
  if (!keyHex) return { status: "skipped", error: "encryption_unavailable" };
  let botToken: string;
  try {
    botToken = decryptWith(keyHex, row.blob.c, row.blob.i, row.blob.t);
  } catch {
    return { status: "skipped", error: "decrypt_failed" };
  }
  const res = await sendTelegramMessage(botToken, row.chatId, formatTelegram(row.message));
  return res.ok ? { status: "sent", error: null } : { status: "failed", error: res.error ?? "generic" };
}

/**
 * The e-mail branch. `row.enabled` is deliberately NOT consulted: it is the
 * Telegram integration's switch, and gating mail on it would silence every
 * notification on a deployment that never set a bot up. The per-event
 * admin_email_enabled flag already made this decision — it is why the row
 * exists — and the claim's own precondition already refused to hand out an
 * e-mail row until the mailbox was configured.
 */
async function dispatchAdminEmail(row: ClaimedRow, keyHex: string | null): Promise<{ status: DispatchStatus; error: string | null }> {
  if (!row.adminEmailTo) return { status: "skipped", error: "admin_email_not_configured" };
  if (!row.mail.host || !row.mail.user || !row.smtpBlob) return { status: "skipped", error: "smtp_not_configured" };
  if (!keyHex) return { status: "skipped", error: "encryption_unavailable" };

  let password: string;
  try {
    password = decryptWith(keyHex, row.smtpBlob.c, row.smtpBlob.i, row.smtpBlob.t);
  } catch {
    return { status: "skipped", error: "decrypt_failed" };
  }

  // smtpTransport() takes the ciphertext shape email_settings stores and opens
  // it with APP_ENCRYPTION_KEY, while the claim's envelope was sealed with the
  // integrations key — which may be a different one. So the plaintext is
  // re-sealed for the length of one send rather than duplicating the transport
  // builder and its timeouts here. Without the app key there is nothing to
  // re-seal it with, and retrying will not produce one.
  if (!encryptionAvailable()) return { status: "skipped", error: "encryption_unavailable" };
  const sealed = encryptSecret(password);
  const smtp: SmtpConfig = {
    host: row.mail.host,
    port: row.mail.port,
    user: row.mail.user,
    encryption: row.mail.encryption,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    auth_tag: sealed.authTag,
  };

  const result = await sendAdminNotification(
    smtp,
    { from_name: row.mail.fromName, from_email: row.mail.fromEmail, reply_to: row.mail.fromEmail },
    row.adminEmailTo,
    {
      eventType: row.eventType,
      // The queue row's own timestamp, never the payload's footer: a footer is
      // a signature on one event ("GrovBase Admin") and a date on another,
      // while created_at is always the moment the event was recorded. The card
      // signs itself, so nothing is lost by leaving the footer to Telegram.
      occurredAt: stampPL(row.createdAt),
      title: row.message.title,
      icon: row.message.icon,
      // A quote is a mail preview or an error text — content, not decoration,
      // so it becomes a row of its own instead of being dropped in this channel.
      rows: [...(row.message.rows ?? []), ...(row.message.quote ? [["💬 Treść", row.message.quote] as [string, string]] : [])],
    },
  );
  if (result.ok) return { status: "sent", error: null };
  // The two answers sendAdminNotification gives for "there is nothing to send
  // with" close the row; anything else is the mail server talking, and that is
  // worth another attempt. safeError is not optional here: an SMTP failure
  // quotes the session, and the session carries the password.
  if (result.error === "no_recipient") return { status: "skipped", error: "admin_email_not_configured" };
  if (result.error === "not_configured") return { status: "skipped", error: "smtp_not_configured" };
  return { status: "failed", error: safeError(result.error ?? "generic") };
}

/** Warsaw time, short, the way the callers' own footers are written — an
 *  operator reading the mail should not have to convert from UTC. */
function stampPL(iso: string): string {
  const parsed = new Date(iso);
  const when = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return `Data: ${when.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Warsaw" })}`;
}

/**
 * Claim pending rows and send them. Called right after an enqueue and by the
 * cron route; both paths tolerate an empty batch, a missing token and a
 * database that has not seen migration 0052 yet.
 *
 * Sends are sequential on purpose — Telegram rate-limits a bot per chat, and a
 * burst of parallel sends is the fastest way to earn a 429.
 */
export async function drainNotifications(supabase: Client, limit = MAX_BATCH): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const token = dispatchToken();
  // No key means no token, and without one the claim function returns nothing.
  // Skipping the round trip keeps the caller's request cheap.
  if (!token) return { sent, failed };
  try {
    const { data, error } = await supabase.rpc("notification_dispatch_claim", {
      p_token: token,
      p_limit: Math.max(1, Math.min(Math.trunc(limit), MAX_BATCH)),
    });
    if (error) {
      console.error("notify.claim", safeError(error));
      return { sent, failed };
    }
    if (!Array.isArray(data)) return { sent, failed };
    const keyHex = integrationsKeyHex();
    for (const raw of data) {
      const row = readClaim(raw);
      if (!row) continue;
      // One bad row must not cost the rest of the batch its delivery.
      try {
        const outcome = await dispatchOne(row, keyHex);
        if (outcome.status === "sent") sent += 1;
        else if (outcome.status === "failed") failed += 1;
        const { error: finishError } = await supabase.rpc("notification_dispatch_finish", {
          p_token: token,
          p_id: row.id,
          p_status: outcome.status,
          // Optional in SQL, so `string | undefined`: omitting it is the
          // `default null` the function already declares.
          p_error: outcome.error ? safeError(outcome.error) : undefined,
        });
        if (finishError) console.error("notify.finish", safeError(finishError));
      } catch (e) {
        failed += 1;
        console.error("notify.dispatch", safeError(e));
      }
    }
  } catch (e) {
    console.error("notify.drain", safeError(e));
  }
  return { sent, failed };
}
