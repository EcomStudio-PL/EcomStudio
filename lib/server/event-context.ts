import "server-only";
import { cookies, headers } from "next/headers";

/**
 * EVENT CONTEXT — the handful of facts that turn "somebody registered" into a
 * notification an operator can act on: where the visit came from, on what, and
 * from where.
 *
 * Everything here is read on the SERVER, from headers and from our own
 * first-touch cookie. Nothing is accepted from a request body, because a value
 * a client can type is a value a bot can forge, and an attribution report built
 * from forged rows is worse than no report at all.
 *
 * Two things are deliberately NOT collected. The raw User-Agent never leaves
 * this module — it is classified into three coarse labels and dropped, so no
 * fingerprint of a customer's browser is ever stored or messaged. And the
 * referrer is kept as a bare host: the referring URL can carry someone else's
 * search terms or a session token in its query string.
 */

/**
 * Written by `middleware.ts` on the first page view of a visit that arrives
 * without it, as a url-encoded query string (utm_* / ref / path). Both files
 * have to agree on this name and on that encoding; they cannot share a constant
 * because middleware runs in the edge runtime and must not pull `next/headers`
 * in with it.
 */
const FIRST_TOUCH_COOKIE = "ecs_first_touch";

/** Per-value cap. Generous for a real campaign tag, hostile to a padded URL
 *  that would otherwise push a Telegram message over its length limit. */
const VALUE_MAX = 120;

export type EventContext = {
  /** First entry of x-forwarded-for, or "unknown" behind a proxy that omits it. */
  ip: string;
  device?: string;
  os?: string;
  browser?: string;
  language?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  /** Referring HOST only — never the full referring URL. */
  referrer?: string;
  landingPath?: string;
};

/** "" and whitespace mean "the visitor did not give us this", which is never
 *  the same as a value — an empty string must not become an empty row. */
function trimmed(value: string | null | undefined): string | undefined {
  const text = (value ?? "").trim().slice(0, VALUE_MAX);
  return text === "" ? undefined : text;
}

/**
 * The visitor's preferred language from Accept-Language ("pl-PL,pl;q=0.9,en;q=0.8"
 * → "pl-PL"). The first entry is the highest-weighted one in every browser that
 * sends the header, so parsing the q-values would buy nothing.
 */
function preferredLanguage(header: string | null): string | undefined {
  const first = (header ?? "").split(",")[0]?.split(";")[0];
  // Language tags are letters, digits and dashes; anything else is junk or an
  // injection attempt, and we would rather report nothing than repeat it.
  return first && /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/.test(first.trim()) ? first.trim() : undefined;
}

/**
 * A small hand-rolled User-Agent classifier. No dependency: a UA parsing
 * library is a megabyte of regexes and a monthly update treadmill to answer a
 * question a notification only needs three words for.
 *
 * ORDER IS THE WHOLE TRICK. Every Chromium browser claims to be Safari, Edge
 * claims to be Chrome, and Samsung Internet claims to be both — so the most
 * specific token has to win first. Anything unrecognised returns undefined
 * rather than a guess; "Urządzenie: nieznane" is honest, a wrong label is not.
 */
export function describeUserAgent(ua: string): { device?: string; os?: string; browser?: string } {
  if (!ua) return {};

  // iPadOS 13+ reports itself as "Macintosh", so the iPad token is only ever a
  // real iPad; a Mac that is actually an iPad is a miss we accept.
  const device =
    /\biPhone\b/.test(ua) ? "iPhone"
    : /\biPad\b/.test(ua) ? "iPad"
    : /\bAndroid\b/.test(ua) ? "Android"
    : /\b(Macintosh|Mac OS X)\b/.test(ua) ? "Mac"
    : /\bWindows\b/.test(ua) ? "Windows"
    // Checked last: every Android UA also carries "Linux".
    : /\bLinux\b/.test(ua) ? "Linux"
    : undefined;

  const os =
    /\b(iPhone|iPad|iPod)\b/.test(ua) ? "iOS"
    : /\bAndroid\b/.test(ua) ? "Android"
    : /\b(Macintosh|Mac OS X)\b/.test(ua) ? "macOS"
    : /\bWindows\b/.test(ua) ? "Windows"
    : undefined;

  const browser =
    // Edg / EdgA / EdgiOS — all of them also say "Chrome" or "Safari".
    /\bEdg(A|iOS|)\//.test(ua) ? "Edge"
    : /\bSamsungBrowser\//.test(ua) ? "Samsung Internet"
    // FxiOS is Firefox on iOS, where the engine (and the UA) is Safari's.
    : /\b(Firefox|FxiOS)\//.test(ua) ? "Firefox"
    // CriOS is Chrome on iOS. Both variants still claim Safari below.
    : /\b(Chrome|CriOS)\//.test(ua) ? "Chrome"
    : /\bSafari\//.test(ua) ? "Safari"
    : undefined;

  return { device, os, browser };
}

/**
 * "05.09.2026 • 13:19" from a UTC instant.
 *
 * The operator reading the message is in Warsaw, and a server timestamp is in
 * UTC — printing the raw instant is how a 22:40 signup gets discussed as an
 * 20:40 one. Built from parts rather than a locale string so the separators are
 * ours and cannot drift with an ICU update.
 */
export function formatWarsaw(date: Date): string {
  const parts = new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    // h23, not hour12:false: the latter lets ICU pick h24, which prints
    // midnight as "24:05" on the previous day's date.
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}.${part("year")} • ${part("hour")}:${part("minute")}`;
}

/**
 * Everything the request itself can tell us. Safe to call from a server action
 * or a route handler; it only reads request-scoped state, so callers collect it
 * on the request and hand the result to whatever runs in `after()`.
 */
export async function collectEventContext(): Promise<EventContext> {
  const [head, jar] = await Promise.all([headers(), cookies()]);
  // The first hop is the client; everything after it is our own proxy chain.
  // The header is spoofable end-to-end, but Vercel rewrites it, so the first
  // entry is the address the edge actually saw.
  const ip = (head.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || "unknown";
  const { device, os, browser } = describeUserAgent(head.get("user-agent") ?? "");
  const firstTouch = new URLSearchParams(jar.get(FIRST_TOUCH_COOKIE)?.value ?? "");
  return {
    ip,
    device,
    os,
    browser,
    language: preferredLanguage(head.get("accept-language")),
    utmSource: trimmed(firstTouch.get("utm_source")),
    utmMedium: trimmed(firstTouch.get("utm_medium")),
    utmCampaign: trimmed(firstTouch.get("utm_campaign")),
    utmContent: trimmed(firstTouch.get("utm_content")),
    utmTerm: trimmed(firstTouch.get("utm_term")),
    referrer: trimmed(firstTouch.get("ref")),
    landingPath: trimmed(firstTouch.get("path")),
  };
}

/**
 * The context as notification rows, in the emoji-labelled style
 * `formatTelegram` renders as "Label: value".
 *
 * A row whose value we do not have is omitted entirely — a message full of
 * empty labels teaches the operator to stop reading it. The labels are distinct
 * from the ones a caller adds itself (👤 📧 📱 🕒 🌍), so no message can end up
 * with the same label twice.
 */
export function contextRows(ctx: EventContext): [string, string][] {
  const rows: [string, string][] = [];

  // One campaign line instead of five: source / medium / campaign is how the
  // tags are read anyway, and the two rare ones only show up when they exist.
  const campaign = [ctx.utmSource, ctx.utmMedium, ctx.utmCampaign, ctx.utmContent, ctx.utmTerm]
    .filter((part): part is string => Boolean(part))
    .join(" / ");
  if (campaign) rows.push(["📣 Kampania", campaign]);

  const entry = [ctx.referrer, ctx.landingPath].filter((part): part is string => Boolean(part)).join(" → ");
  if (entry) rows.push(["🔗 Wejście", entry]);

  if (ctx.ip && ctx.ip !== "unknown") rows.push(["📍 IP", ctx.ip]);

  // device and os overlap by construction ("Android" is both), so identical
  // parts collapse rather than printing "Android · Android · Chrome".
  const hardware: string[] = [];
  for (const part of [ctx.device, ctx.os, ctx.browser]) {
    if (part && !hardware.some((kept) => kept.toLowerCase() === part.toLowerCase())) hardware.push(part);
  }
  if (hardware.length) rows.push(["💻 Urządzenie", hardware.join(" · ")]);

  if (ctx.language) rows.push(["🗣️ Język", ctx.language]);

  return rows;
}
