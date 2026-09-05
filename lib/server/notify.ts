import "server-only";
import type { Client } from "@/lib/services/workspace";
import { decryptWith } from "@/lib/server/crypto";
import { dispatchToken, safeError } from "@/lib/server/integrations";
import { sendTelegramMessage, tgEscape } from "@/lib/server/telegram";

/**
 * NOTIFICATIONS — from "something happened" to a Telegram message.
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

/**
 * The message body, Polish, HTML parse mode:
 *
 *   <b>✉️ NOWY E-MAIL</b>
 *
 *   Od: Jan Kowalski
 *   Temat: Pytanie o zamówienie
 *
 *   <i>„Dzień dobry, chciałbym zapytać…"</i>
 *
 *   Otrzymano: 12:43
 *
 * Every interpolated value is escaped; rows with an empty value are dropped
 * rather than rendered as a dangling label.
 */
export function formatTelegram(input: NotificationMessage): string {
  const icon = input.icon ? `${tgEscape(collapse(input.icon))} ` : "";
  const blocks = [`<b>${icon}${tgEscape(clean(input.title, TITLE_MAX))}</b>`];

  const rows = (input.rows ?? [])
    .map(([label, value]) => [collapse(label), clean(value, VALUE_MAX)] as const)
    .filter(([, value]) => value !== "");
  if (rows.length) blocks.push(rows.map(([label, value]) => `${tgEscape(label)}: ${tgEscape(value)}`).join("\n"));

  const quote = clean(input.quote ?? "", QUOTE_MAX);
  if (quote) blocks.push(`<i>„${tgEscape(quote)}"</i>`);

  const footer = clean(input.footer ?? "", VALUE_MAX);
  if (footer) blocks.push(tgEscape(footer));

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

type ClaimedRow = {
  id: string;
  message: NotificationMessage;
  chatId: string;
  blob: SecretBlob | null;
  /** The integration's own on/off switch, as the claim function returns it. */
  enabled: boolean;
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
 * One row as the claim function hands it back: the outbox entry plus the
 * Telegram config and the bot-token ciphertext it takes to send it.
 *
 * The names that matter are the ones `notification_dispatch_claim` declares in
 * its RETURNS TABLE — telegram_enabled, telegram_config, bot_token_ciphertext
 * (0052_communications.sql) — because PostgREST keys the JSON by those. The
 * flat and nested variants stay as fallbacks so a later migration may move the
 * values around, but they are fallbacks, not the contract. Anything unreadable
 * yields a row with no credentials, which the dispatcher records as "skipped"
 * instead of crashing the batch.
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
  const secrets = asRecord(row.secrets);
  const flat = readBlob({
    c: row.bot_token_c ?? row.token_c,
    i: row.bot_token_i ?? row.token_i,
    t: row.bot_token_t ?? row.token_t,
  });
  return {
    id,
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
  };
}

/**
 * Send one claimed row. The distinction that matters is "skipped" vs "failed":
 * a missing chat id or a key that no longer opens the ciphertext cannot be
 * fixed by trying again, so those rows are closed instead of being retried by
 * every cron run for the rest of time.
 *
 * Exported for scripts/comm-tests.ts alongside `readClaim`.
 */
export async function dispatchOne(row: ClaimedRow, keyHex: string | null): Promise<{ status: DispatchStatus; error: string | null }> {
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
