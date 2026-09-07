import "server-only";
import { absoluteUrl } from "@/lib/site";
import { tgEscape, type TelegramKeyboard } from "@/lib/server/telegram";

/**
 * GROVBASE ADMIN NOTIFICATIONS — the one Telegram design system.
 *
 * Every administrative ping (registration, waitlist, mail, generation failure,
 * and the billing events that will exist the day billing does) is described
 * here as STRUCTURE — icon, title, subtitle, locale, rows, meta, actions — and
 * rendered by one function. No event owns a formatter of its own any more, and
 * nothing here talks to the network: the transport is lib/server/telegram.ts.
 *
 * WHAT TELEGRAM ACTUALLY GIVES US
 * The Bot API has no tables, no headings and no horizontal rules. Its message
 * entities are a fixed set — bold, italic, underline, strikethrough, spoiler,
 * code, pre, blockquote, links — plus a real inline keyboard. So the "table"
 * in the reference design is built the only honest way: one line per field,
 * the icon standing in for the label column, the value carrying the weight,
 * and two spaces holding the gutter. No box-drawing characters, no ASCII art —
 * those wrap into rubble on a narrow phone, which is exactly why they are gone.
 *
 * The layout, top to bottom:
 *
 *   🎉 <b>NOWA REJESTRACJA</b> · 🇵🇱 PL
 *   <i>Nowy użytkownik w GrovBase</i>
 *                                        ← one blank line separates the blocks
 *   💰  <b>299,00 PLN</b>                 ← optional highlight, first and loud
 *   👤  <b>Take Digit</b>                 ← primary row, bold
 *   📧  takedigital7@gmail.com
 *   📱  123 456 789
 *
 *   📍 <code>31.175.22.11</code> · iPhone · iOS · Safari
 *   <b>06.09.2026 · 14:02</b>
 *
 *   [ Otwórz klienta ]                    ← inline keyboard, real routes only
 */

/* ── the vocabulary ─────────────────────────────────────────────────────────*/

export type TgRow = {
  /** Stands in for the label column. */
  icon: string;
  /** Short text label, used only when an icon cannot carry the meaning alone. */
  label?: string;
  value: string;
  /** The row a human looks at first — bold. */
  strong?: boolean;
  /** Technical values (IP, ids, paths): monospace, so they align and copy. */
  mono?: boolean;
};

export type TgAction = { label: string; url: string };

export type TgNotification = {
  /** The event type, for the action registry. */
  event?: string;
  icon: string;
  title: string;
  subtitle?: string;
  /** "PL" | "EN" | "DE" — the app's own locale, never guessed from an IP. */
  locale?: string;
  /** The number the message is really about (amount, credits). */
  highlight?: TgRow;
  rows: TgRow[];
  /** Bottom line: address, device, and the moment it happened. */
  meta?: { ip?: string; device?: string; stamp?: string };
  /** A short excerpt — a mail preview, an error message. */
  quote?: string;
  /** Long technical text, folded into an expandable quote. Capped hard. */
  details?: string;
  footer?: string;
  actions?: TgAction[];
};

/* ── budgets ────────────────────────────────────────────────────────────────
 * Telegram refuses a message over 4096 characters outright, so every field is
 * capped on the way in and the whole card is capped on the way out. A cut can
 * never fall inside an HTML entity, because it happens BEFORE escaping. */
export const TG_MESSAGE_MAX = 4096;
const TITLE_MAX = 90;
const SUBTITLE_MAX = 120;
const VALUE_MAX = 96;
const MONO_MAX = 64;
const QUOTE_MAX = 240;
const DETAILS_MAX = 480;
const FOOTER_MAX = 80;
/** Compact mode: an alert is scanned in seconds, not read. Anything past this
 *  belongs in the admin panel, and the card says so rather than going silent. */
export const TG_ROWS_MAX = 8;

function collapse(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** Cut without leaving half a surrogate pair behind — a lone half renders as
 *  the replacement glyph in every Telegram client. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function clean(text: string, max: number): string {
  return truncate(collapse(text), max);
}

/** One line stays one line: a URL loses its protocol before it loses its tail. */
function compactValue(value: string, max = VALUE_MAX): string {
  return truncate(collapse(value).replace(/^https?:\/\//i, ""), max);
}

/* ── the field registry ─────────────────────────────────────────────────────
 * ONE place decides what a field is called, which icon carries it, where it
 * belongs and how loud it is. This is what makes a payment and a registration
 * look like the same product instead of two people's formatters. */

type FieldSpec = {
  icon: string;
  /** Shown only when the icon alone would be ambiguous in context. */
  label?: string;
  strong?: boolean;
  mono?: boolean;
  /** Highlights lead the card; meta sinks to the footer line; hidden never
   *  becomes a row (the locale is drawn as a flag in the header instead). */
  slot?: "highlight" | "meta" | "hidden";
  order: number;
};

const FIELDS: Record<string, FieldSpec> = {
  // What the message is about — money first, it is why an operator opens it.
  amount: { icon: "💰", strong: true, slot: "highlight", order: 1 },
  credits: { icon: "🪙", strong: true, slot: "highlight", order: 2 },
  // Who.
  name: { icon: "👤", strong: true, order: 10 },
  email: { icon: "📧", order: 11 },
  phone: { icon: "📱", order: 12 },
  // Where they came from. Two different questions, two different icons —
  // exactly how the reference design tells them apart.
  source: { icon: "🌍", order: 20 },
  referral: { icon: "👥", order: 21 },
  campaign: { icon: "📣", order: 22 },
  // Commerce.
  plan: { icon: "📦", order: 30 },
  period: { icon: "🗓", order: 31 },
  status: { icon: "✅", order: 32 },
  next_payment: { icon: "🔁", label: "Następna płatność", order: 33 },
  method: { icon: "🏦", order: 34 },
  balance: { icon: "🧮", label: "Saldo po zakupie", order: 35 },
  transaction: { icon: "🧾", mono: true, order: 36 },
  // Mail.
  subject: { icon: "📨", order: 40 },
  // AI / failures.
  provider: { icon: "🔌", order: 50 },
  model: { icon: "🧠", order: 51 },
  cost: { icon: "🪙", order: 52 },
  error: { icon: "⛔", mono: true, order: 53 },
  request_id: { icon: "🆔", mono: true, order: 54 },
  // Context.
  landing: { icon: "🔗", mono: true, order: 60 },
  // Footer line.
  ip: { icon: "📍", mono: true, slot: "meta", order: 90 },
  device: { icon: "💻", slot: "meta", order: 91 },
  date: { icon: "🕒", slot: "meta", order: 92 },
  time: { icon: "🕒", slot: "meta", order: 93 },
  // Drawn as the header flag, never repeated as a row.
  language: { icon: "🗣", slot: "hidden", order: 99 },
  // Never leaves the server, whatever a caller passes.
  code: { icon: "🔑", slot: "hidden", order: 99 },
};

/**
 * The registry, read backwards. A row that arrives as a legacy pair —
 * `["👤 Użytkownik", "Jan"]` — is recognised by its icon and inherits the same
 * weight the keyed path would have given it, so a published template and a
 * built-in card bold the same things. First spec wins, in registry order.
 */
const BY_ICON = new Map<string, FieldSpec>();
for (const spec of Object.values(FIELDS).sort((a, b) => a.order - b.order)) {
  if (!BY_ICON.has(spec.icon)) BY_ICON.set(spec.icon, spec);
}

/** The flags we can state as fact: the app's own locale, not an IP guess. */
const FLAGS: Record<string, string> = { PL: "🇵🇱", EN: "🇬🇧", DE: "🇩🇪" };

export function localeFlag(locale: string | undefined): string {
  const key = collapse(locale ?? "").toUpperCase().slice(0, 2);
  return FLAGS[key] ? `${FLAGS[key]} ${key}` : "";
}

/* ── the action registry ────────────────────────────────────────────────────
 * A button is only ever offered for a route that exists in this app. Telegram
 * rejects a whole message whose button URL is not absolute http(s), and on a
 * developer machine SITE_URL is http://localhost — so a non-https URL yields
 * NO button rather than a failed send. */

const ACTIONS: Record<string, { label: string; path: (ctx: Record<string, string>) => string }> = {
  "user.registered": { label: "Otwórz klienta", path: (c) => (c.user_id ? `/admin/users/${c.user_id}` : "/admin/users") },
  "waitlist.signup": { label: "Otwórz listę", path: () => "/admin/waitlist" },
  "mail.received": { label: "Otwórz skrzynkę", path: () => "/admin/communication" },
  "system.error": { label: "Otwórz log", path: () => "/admin/logs" },
};

/* ── one voice per event ────────────────────────────────────────────────────
 * The subtitle is the single line under the headline. It says what KIND of
 * thing happened; it never repeats a value from the table below. Keeping it
 * here rather than at the call sites is what stops eight events from being
 * written in eight tones of voice. */
const SUBTITLES: Record<string, string> = {
  "user.registered": "Nowy użytkownik w GrovBase",
  "waitlist.signup": "Nowy kontakt zainteresowany GrovBase",
  "mail.received": "Nowa wiadomość w skrzynce GrovBase",
  "payment.received": "Płatność zakończona powodzeniem",
  "payment.failed": "Płatność nie została zrealizowana",
  "credits.purchased": "Doładowanie konta kredytami",
  "subscription.created": "Subskrypcja została aktywowana",
  "subscription.renewed": "Subskrypcja odnowiona na kolejny okres",
  "subscription.cancelled": "Subskrypcja anulowana",
  "system.error": "Zdarzenie wymagające uwagi operatora",
};

export function subtitleFor(event: string | undefined): string {
  return event ? SUBTITLES[event] ?? "" : "";
}

/** Is this a URL Telegram will accept on a button? */
export function buttonUrlOk(url: string): boolean {
  return /^https:\/\/[^\s]+$/i.test(url.trim());
}

export function actionsFor(event: string | undefined, ctx: Record<string, string> = {}): TgAction[] {
  const spec = event ? ACTIONS[event] : undefined;
  if (!spec) return [];
  const url = absoluteUrl(spec.path(ctx));
  return buttonUrlOk(url) ? [{ label: spec.label, url }] : [];
}

/* ── building a notification from keyed event data ──────────────────────────*/

/** Split "👤 Użytkownik" into its leading emoji and the rest, so the rows a
 *  caller already writes as `["👤 Telefon", "…"]` keep working unchanged. */
export function splitIconLabel(label: string): { icon: string; text: string } {
  const trimmed = collapse(label);
  const first = trimmed.split(" ")[0] ?? "";
  if (first && !/[\p{L}\p{N}]/u.test(first)) {
    return { icon: first, text: trimmed.slice(first.length).trim() };
  }
  return { icon: "", text: trimmed };
}

export type BuildInput = {
  event?: string;
  icon?: string;
  title: string;
  subtitle?: string;
  /** Keyed facts — the canonical path, resolved through the field registry. */
  data?: Record<string, string>;
  /** Legacy label/value pairs, for events that never gained keyed data. */
  rows?: [string, string][];
  /** Locale for the header flag, when it does not come from `data.language`. */
  locale?: string;
  quote?: string;
  details?: string;
  footer?: string;
  /** Extra context for the action registry (user_id…). */
  actionContext?: Record<string, string>;
};

/**
 * Event → structure. Keyed `data` wins because it is what makes every event
 * share one order, one icon set and one voice; legacy `rows` are folded in
 * afterwards for anything the registry does not know, so no call site had to
 * be rewritten to look like the rest of the family.
 */
export function buildNotification(input: BuildInput): TgNotification {
  const data = input.data ?? {};
  const meta: TgNotification["meta"] = {};
  let highlight: TgRow | undefined;
  const known: (TgRow & { order: number })[] = [];

  for (const [key, rawValue] of Object.entries(data)) {
    const spec = FIELDS[key];
    const value = collapse(rawValue);
    if (!value || !spec || spec.slot === "hidden") continue;
    if (spec.slot === "meta") {
      if (key === "ip") meta.ip = compactValue(value, MONO_MAX);
      else if (key === "device") meta.device = compactValue(value, MONO_MAX);
      // date and time are one stamp, not two rows.
      else meta.stamp = [meta.stamp, value].filter(Boolean).join(" · ");
      continue;
    }
    const row: TgRow = {
      icon: spec.icon,
      label: spec.label,
      value: spec.mono ? compactValue(value, MONO_MAX) : compactValue(value),
      strong: spec.strong,
      mono: spec.mono,
    };
    if (spec.slot === "highlight" && !highlight) highlight = row;
    else known.push({ ...row, order: spec.order });
  }

  // Legacy rows: anything the keyed data did not already say. Matching on the
  // value keeps a row from appearing twice when a call site sends both.
  const seen = [highlight?.value, ...known.map((r) => r.value)].filter(Boolean) as string[];
  /**
   * A legacy row repeats a keyed fact whenever either value contains the
   * other — "Take Digit <jan@x.pl>" and "Take Digit" are one person, not two
   * rows. Substring, not equality: the two paths phrase the same fact
   * differently, and printing it twice is what makes a card look assembled by
   * two people.
   */
  const alreadySaid = (value: string): boolean => {
    const v = value.toLowerCase();
    return seen.some((s) => { const t = s.toLowerCase(); return t === v || t.includes(v) || v.includes(t); });
  };
  const extra: (TgRow & { order: number })[] = [];
  let legacyLocale = "";
  for (const [rawLabel, rawValue] of input.rows ?? []) {
    const value = compactValue(rawValue);
    if (!value || alreadySaid(value)) continue;
    const { icon, text } = splitIconLabel(rawLabel);
    // A legacy row that is plainly the address, the device or the clock belongs
    // on the meta line, not in the table — same fact, one place. The language
    // becomes the header flag for the same reason.
    // These four never become rows. When the keyed data already said it, the
    // legacy copy is dropped outright — that is how "🕒 06.09.2026 • 14:02"
    // stopped being printed once as a row and again as the meta stamp.
    if (icon === "📍") { meta.ip = meta.ip || compactValue(value, MONO_MAX); continue; }
    if (icon === "💻") { meta.device = meta.device || compactValue(value, MONO_MAX); continue; }
    if (icon === "🕒") { meta.stamp = meta.stamp || value; continue; }
    if (icon === "🗣") { legacyLocale = legacyLocale || value; continue; }
    seen.push(value);
    const spec = icon ? BY_ICON.get(icon) : undefined;
    const row: TgRow = {
      icon: icon || "•",
      label: icon ? spec?.label : text,
      value: spec?.mono ? compactValue(value, MONO_MAX) : value,
      strong: spec?.strong,
      mono: spec?.mono,
    };
    // A legacy row can lead the card too: "💰 Kwota" is the headline number
    // whether it arrived keyed or as a pair.
    if (spec?.slot === "highlight" && !highlight) highlight = row;
    else extra.push({ ...row, order: spec?.order ?? 70 + extra.length });
  }

  const rows = [...known, ...extra]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...row }) => row);

  return {
    event: input.event,
    icon: collapse(input.icon ?? "") || "🔔",
    title: input.title,
    subtitle: input.subtitle ?? subtitleFor(input.event),
    locale: input.locale || data.language || legacyLocale,
    highlight,
    rows,
    meta: meta.ip || meta.device || meta.stamp ? meta : undefined,
    quote: input.quote,
    details: input.details,
    footer: input.footer,
    actions: actionsFor(input.event, { ...input.actionContext, ...data }),
  };
}

/* ── the renderer ───────────────────────────────────────────────────────────*/

function renderRow(row: TgRow): string {
  const value = row.mono
    ? `<code>${tgEscape(row.value)}</code>`
    : row.strong
      ? `<b>${tgEscape(row.value)}</b>`
      : tgEscape(row.value);
  // Two spaces after the icon are the gutter — the only "column" Telegram can
  // actually hold without a monospace block swallowing the whole card.
  const head = row.icon ? `${tgEscape(row.icon)}  ` : "";
  return row.label ? `${head}<b>${tgEscape(row.label)}:</b> ${value}` : `${head}${value}`;
}

/**
 * Structure → the exact text sent to Telegram, plus the keyboard.
 *
 * `expandable` says whether the caller may use an expandable blockquote for
 * the details block. The transport turns it off after Telegram has once
 * refused to parse one, so an older Bot API costs a single message its folded
 * details — never the message itself.
 */
export function renderTelegramNotification(
  n: TgNotification,
  opts: { expandable?: boolean } = {},
): { text: string; keyboard?: TelegramKeyboard } {
  const blocks: string[] = [];

  const flag = localeFlag(n.locale);
  const head = [
    `${tgEscape(collapse(n.icon))} <b>${tgEscape(clean(n.title, TITLE_MAX))}</b>`,
    flag ? ` · ${flag}` : "",
  ].join("");
  const subtitle = clean(n.subtitle ?? "", SUBTITLE_MAX);
  blocks.push(subtitle ? `${head}\n<i>${tgEscape(subtitle)}</i>` : head);

  // The data block: highlight first, then the table, capped for scannability.
  const body: string[] = [];
  if (n.highlight?.value) body.push(renderRow(n.highlight));
  const rows = n.rows.filter((r) => collapse(r.value) !== "");
  for (const row of rows.slice(0, TG_ROWS_MAX)) body.push(renderRow(row));
  const hidden = rows.length - Math.min(rows.length, TG_ROWS_MAX);
  // Never silently drop data: say how much is waiting in the panel.
  if (hidden > 0) body.push(`➕  <i>+${hidden} więcej w panelu</i>`);
  if (body.length > 0) blocks.push(body.join("\n"));

  const quote = clean(n.quote ?? "", QUOTE_MAX);
  if (quote) blocks.push(`💬  <i>„${tgEscape(quote)}"</i>`);

  const details = clean(n.details ?? "", DETAILS_MAX);
  if (details) {
    // A real Telegram entity when the client supports it, a plain monospace
    // block when it does not — both readable, neither an ASCII drawing.
    blocks.push(opts.expandable === false
      ? `<pre>${tgEscape(details)}</pre>`
      : `<blockquote expandable>${tgEscape(details)}</blockquote>`);
  }

  const metaLine: string[] = [];
  if (n.meta?.ip) metaLine.push(`📍 <code>${tgEscape(n.meta.ip)}</code>`);
  if (n.meta?.device) metaLine.push(tgEscape(n.meta.device));
  const metaBlock: string[] = [];
  if (metaLine.length > 0) metaBlock.push(metaLine.join(" · "));
  // The moment it happened is the one meta value that gets weight.
  if (n.meta?.stamp) metaBlock.push(`<b>${tgEscape(collapse(n.meta.stamp))}</b>`);
  const footer = clean(n.footer ?? "", FOOTER_MAX);
  if (footer) metaBlock.push(`<i>${tgEscape(footer)}</i>`);
  if (metaBlock.length > 0) blocks.push(metaBlock.join("\n"));

  let text = blocks.join("\n\n");
  if (text.length > TG_MESSAGE_MAX) {
    // Last resort: a card too long for Telegram is still a card that must
    // arrive. Cut on a line boundary so no tag is ever left half-open.
    const lines = text.slice(0, TG_MESSAGE_MAX - 2).split("\n");
    lines.pop();
    text = `${lines.join("\n")}\n…`;
  }

  const actions = (n.actions ?? []).filter((a) => a.label.trim() && buttonUrlOk(a.url));
  const keyboard: TelegramKeyboard | undefined = actions.length > 0
    ? { inline_keyboard: [actions.map((a) => ({ text: clean(a.label, 32), url: a.url.trim() }))] }
    : undefined;

  return { text, keyboard };
}

/** Build and render in one call — what every event path uses. */
export function renderNotification(
  input: BuildInput,
  opts: { expandable?: boolean } = {},
): { text: string; keyboard?: TelegramKeyboard } {
  return renderTelegramNotification(buildNotification(input), opts);
}
