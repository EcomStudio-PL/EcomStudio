import "server-only";

/**
 * TELEGRAM BOT API — the only place the bot token touches the network.
 *
 * The token travels in the URL path, so it can turn up inside a fetch error
 * message or an error body quoted back by a proxy. That is why nothing here
 * returns or logs text from the wire: a caller gets one of a closed set of
 * codes, the UI maps that code to a translated string, and the token has no
 * route out of this file.
 */

export type TelegramError = "not_configured" | "auth" | "chat_not_found" | "network" | "generic";

/** An inline keyboard — the only rich UI the Bot API actually offers. Buttons
 *  carry a URL and nothing else: no callback data means no webhook to answer. */
export type TelegramKeyboard = { inline_keyboard: { text: string; url: string }[][] };

const API_ROOT = "https://api.telegram.org";
/** Telegram is fast when it answers at all; a serverless request must not hang
 *  waiting for one that does not. */
const TIMEOUT_MS = 10_000;

/** & < > are the only characters Telegram's HTML parse mode reserves. Anything
 *  interpolated into a message must go through this or the send fails with a
 *  parse error — and a subject line containing "<" is not rare. */
export function tgEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type TelegramBody = { ok?: boolean; description?: string; result?: unknown };

/**
 * HTTP status + Telegram's own description → a code the admin panel can
 * explain. 403 means the bot was blocked or thrown out of the chat, which is
 * the same fix as "chat not found": re-add the bot and pick the chat again.
 * 404 lands on "auth" because the token is part of the path — a token that
 * names no bot makes the whole endpoint disappear.
 */
function classify(status: number, description?: string): TelegramError {
  const d = (description ?? "").toLowerCase();
  if (status === 403 || d.includes("chat not found") || d.includes("chat_id is empty")) return "chat_not_found";
  if (status === 401 || status === 404 || d.includes("unauthorized")) return "auth";
  return "generic";
}

/**
 * Did Telegram refuse to PARSE the message rather than refuse to send it?
 * That is the one failure a different rendering can fix — an entity this Bot
 * API version does not know (an expandable blockquote on an older server, say).
 * Only the boolean escapes this file; the description itself never does.
 */
function isParseFailure(description?: string): boolean {
  const d = (description ?? "").toLowerCase();
  return d.includes("can't parse entities") || d.includes("unsupported start tag")
    || d.includes("unmatched end tag") || d.includes("can't parse message text");
}

async function call(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; body: TelegramBody } | { ok: false; error: TelegramError; parseFailure?: boolean }> {
  try {
    const res = await fetch(`${API_ROOT}/bot${token}/${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await res.json().catch(() => null)) as TelegramBody | null;
    // Telegram answers 200 with ok:false for some errors, so both checks matter.
    if (res.ok && body?.ok === true) return { ok: true, body };
    return { ok: false, error: classify(res.status, body?.description), parseFailure: isParseFailure(body?.description) };
  } catch {
    // Timeout, DNS, TLS — one answer for the caller: it did not reach Telegram.
    // The thrown error is dropped unread because its message quotes the URL,
    // and the URL carries the token.
    return { ok: false, error: "network" };
  }
}

/* ── entity capability, learned from the wire ───────────────────────────────
 * The Bot API publishes no version endpoint, so the only honest way to find
 * out whether this bot's server understands an expandable blockquote is to
 * send one and watch. A single refusal switches the richer entity off for the
 * rest of the process; the plainer rendering is already built and waiting, so
 * the message still arrives. This is a capability probe, not a retry loop:
 * exactly one second attempt, and only when the first failed on PARSING. */
let expandableEntities = true;

/** Should the renderer use the richer entity on the next message? */
export function richEntitiesEnabled(): boolean {
  return expandableEntities;
}

/** Test seam — the suites assert both branches of the renderer. */
export function setRichEntitiesEnabled(value: boolean): void {
  expandableEntities = value;
}

/**
 * Send one already-rendered HTML message — THE transport, used by every
 * notification. `html` must be escaped by the caller (the renderer in
 * telegram-notification.ts does it).
 *
 * `keyboard` attaches inline buttons; `plainHtml` is the same card rendered
 * without the optional rich entity, used once if Telegram rejects the first
 * body as unparseable. Nothing else is ever retried here — the outbox owns
 * delivery retries, and repeating a send that failed for any other reason is
 * how one event becomes five messages.
 */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  html: string,
  opts: { keyboard?: TelegramKeyboard; plainHtml?: string } = {},
): Promise<{ ok: boolean; error?: TelegramError; degraded?: boolean }> {
  const t = token.trim();
  const chat = chatId.trim();
  if (!t || !chat) return { ok: false, error: "not_configured" };

  const post = (text: string) => call(t, "sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text,
      parse_mode: "HTML",
      // A notification is a summary. Previews would double its height and make
      // Telegram fetch links on our behalf, which is not what a link in a
      // stranger's e-mail deserves.
      disable_web_page_preview: true,
      ...(opts.keyboard ? { reply_markup: opts.keyboard } : {}),
    }),
  });

  const res = await post(html);
  if (res.ok) return { ok: true };

  // The one recoverable failure: this Bot API could not parse an entity we
  // used. Remember it, fall back to the plainer card, and let the message
  // through — a fancier quote block is never worth a lost alert.
  if (res.parseFailure && opts.plainHtml && opts.plainHtml !== html) {
    expandableEntities = false;
    const retry = await post(opts.plainHtml);
    if (retry.ok) {
      console.warn("telegram.send: rich entity unsupported, sent plain rendering");
      return { ok: true, degraded: true };
    }
    console.error("telegram.send", retry.error);
    return { ok: false, error: retry.error };
  }

  console.error("telegram.send", res.error);
  return { ok: false, error: res.error };
}

type TelegramChat = {
  id?: number | string;
  title?: string;
  username?: string;
  first_name?: string;
  type?: string;
};
type TelegramUpdate = { message?: { chat?: TelegramChat }; channel_post?: { chat?: TelegramChat } };

/**
 * The chat picker's data source. Telegram has no "list my chats" endpoint, so
 * the admin writes anything in the group and the last updates reveal its id.
 * Only recent traffic is visible — an empty list is a normal answer, not an
 * error, and the UI says so.
 */
export async function getTelegramChats(
  token: string,
): Promise<{ ok: boolean; chats: { id: string; title: string; type: string }[]; error?: TelegramError }> {
  const t = token.trim();
  if (!t) return { ok: false, chats: [], error: "not_configured" };
  const res = await call(t, "getUpdates?limit=50");
  if (!res.ok) {
    console.error("telegram.chats", res.error);
    return { ok: false, chats: [], error: res.error };
  }
  const updates = Array.isArray(res.body.result) ? (res.body.result as TelegramUpdate[]) : [];
  // Keyed by id: one chatty group produces dozens of updates for one chat.
  const seen = new Map<string, { id: string; title: string; type: string }>();
  for (const update of updates) {
    for (const chat of [update.message?.chat, update.channel_post?.chat]) {
      if (!chat || chat.id === undefined || chat.id === null) continue;
      const id = String(chat.id);
      if (seen.has(id)) continue;
      // Groups and channels have a title, private chats a first name, some
      // channels only a username. The id is the last resort so the admin can
      // still tell the entries apart and pick one.
      seen.set(id, {
        id,
        title: chat.title?.trim() || chat.username?.trim() || chat.first_name?.trim() || id,
        type: chat.type ?? "unknown",
      });
    }
  }
  return { ok: true, chats: [...seen.values()] };
}
