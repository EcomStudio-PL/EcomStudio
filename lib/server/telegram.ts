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

async function call(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; body: TelegramBody } | { ok: false; error: TelegramError }> {
  try {
    const res = await fetch(`${API_ROOT}/bot${token}/${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await res.json().catch(() => null)) as TelegramBody | null;
    // Telegram answers 200 with ok:false for some errors, so both checks matter.
    if (res.ok && body?.ok === true) return { ok: true, body };
    return { ok: false, error: classify(res.status, body?.description) };
  } catch {
    // Timeout, DNS, TLS — one answer for the caller: it did not reach Telegram.
    // The thrown error is dropped unread because its message quotes the URL,
    // and the URL carries the token.
    return { ok: false, error: "network" };
  }
}

/** Send one already-formatted HTML message. `html` must be escaped by the
 *  caller (see tgEscape / formatTelegram in notify.ts). */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  html: string,
): Promise<{ ok: boolean; error?: TelegramError }> {
  const t = token.trim();
  const chat = chatId.trim();
  if (!t || !chat) return { ok: false, error: "not_configured" };
  const res = await call(t, "sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text: html,
      parse_mode: "HTML",
      // A notification is a summary. Previews would double its height and make
      // Telegram fetch links on our behalf, which is not what a link in a
      // stranger's e-mail deserves.
      disable_web_page_preview: true,
    }),
  });
  if (res.ok) return { ok: true };
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
