import "server-only";
import type { Client } from "@/lib/services/workspace";
import { renderEmailTemplate, escapeHtml, type EmailField } from "@/lib/server/email-template";
import { safeError } from "@/lib/server/integrations";

/**
 * ONE TEMPLATE SYSTEM for everything GrovBase says out loud.
 *
 * Two kinds of message, kept honestly apart:
 *
 *  - APP messages (kind "app"): Telegram pings and e-mails the application
 *    sends itself. These render HERE, from the published row in
 *    message_templates when the admin has published one, and from the built-in
 *    defaults below when not — so editing a draft can never touch production,
 *    and a deployment that has never opened the editor behaves exactly as
 *    before.
 *
 *  - AUTH messages (kind "auth"): confirm signup / reset password. GoTrue
 *    renders those from ITS OWN template store, which this codebase cannot
 *    write to (the management API is not reachable and must not be faked).
 *    The editor still lets the admin view and copy their HTML, and marks them
 *    "requires sync with Supabase" — the truth, not a fake publish.
 *
 * The placeholder engine is a whitelist substitution — no eval, no Function,
 * no expressions. `{{name}}` becomes the value; an unknown placeholder is
 * removed and reported, never rendered raw and never a crash. A rendered line
 * whose placeholders were all empty is dropped whole, so a missing phone
 * number never prints as "📱 | ".
 */

export type TemplateChannel = "email" | "telegram";

export type EmailTemplateDef = {
  subject: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footer: string;
  showLogo: boolean;
  showFields: boolean;
  showCta: boolean;
};

export type TelegramTemplateDef = {
  icon: string;
  title: string;
  /** One field per line, e.g. "👤 | {{name}}". Lines with no value are dropped. */
  body: string;
  footer: string;
};

export type TemplateDef =
  | { channel: "email"; email: EmailTemplateDef }
  | { channel: "telegram"; telegram: TelegramTemplateDef };

export type CatalogEntry = {
  /** "user.registered" — matches notification_outbox.event_type for app events. */
  event: string;
  channel: TemplateChannel;
  /** Stable row key: `${event}:${channel}`. */
  key: string;
  kind: "app" | "auth";
  /** i18n label keys for the tiles. */
  nameKey: string;
  groupKey: string;
  /** false = the template exists but no real business flow fires it yet. */
  hooked: boolean;
  placeholders: readonly string[];
};

const CONTEXT_PLACEHOLDERS = ["name", "email", "phone", "date", "time", "source", "ip", "device", "language", "landing"] as const;
const SALES_PLACEHOLDERS = [...CONTEXT_PLACEHOLDERS, "amount", "plan"] as const;

function entry(
  event: string, channel: TemplateChannel, kind: "app" | "auth",
  nameKey: string, groupKey: string, hooked: boolean, placeholders: readonly string[],
): CatalogEntry {
  return { event, channel, key: `${event}:${channel}`, kind, nameKey, groupKey, hooked, placeholders };
}

/** Every editable message, grouped the way the panel lists them. */
export const TEMPLATE_CATALOG: readonly CatalogEntry[] = [
  // Rejestracja
  entry("auth.confirm_signup", "email", "auth", "tpl.confirmSignup", "tpl.gRegistration", true, ["first_name"]),
  entry("user.registered", "telegram", "app", "tpl.userRegistered", "tpl.gRegistration", true, CONTEXT_PLACEHOLDERS),
  entry("user.registered", "email", "app", "tpl.userRegistered", "tpl.gRegistration", true, CONTEXT_PLACEHOLDERS),
  // Logowanie
  entry("login.security_code", "email", "app", "tpl.securityCode", "tpl.gLogin", true, ["code", "device", "date", "time"]),
  entry("login.new_device", "email", "app", "tpl.newDevice", "tpl.gLogin", false, ["device", "date", "time", "ip"]),
  entry("auth.reset_password", "email", "auth", "tpl.resetPassword", "tpl.gLogin", true, []),
  // Marketing
  entry("waitlist.signup", "telegram", "app", "tpl.waitlist", "tpl.gMarketing", true, CONTEXT_PLACEHOLDERS),
  entry("waitlist.signup", "email", "app", "tpl.waitlist", "tpl.gMarketing", true, CONTEXT_PLACEHOLDERS),
  // Poczta
  entry("mail.received", "telegram", "app", "tpl.newMail", "tpl.gMail", true, ["name", "email", "date", "time"]),
  // Płatności — templates ready, business hooks not built yet (no billing).
  entry("payment.received", "telegram", "app", "tpl.payment", "tpl.gPayments", false, SALES_PLACEHOLDERS),
  entry("payment.received", "email", "app", "tpl.payment", "tpl.gPayments", false, SALES_PLACEHOLDERS),
  entry("credits.purchased", "telegram", "app", "tpl.credits", "tpl.gPayments", false, SALES_PLACEHOLDERS),
  entry("subscription.created", "telegram", "app", "tpl.subStarted", "tpl.gPayments", false, SALES_PLACEHOLDERS),
  entry("subscription.renewed", "telegram", "app", "tpl.subRenewed", "tpl.gPayments", false, SALES_PLACEHOLDERS),
  entry("subscription.cancelled", "telegram", "app", "tpl.subCancelled", "tpl.gPayments", false, SALES_PLACEHOLDERS),
];

export function catalogEntry(key: string): CatalogEntry | undefined {
  return TEMPLATE_CATALOG.find((e) => e.key === key);
}

/* ── the placeholder engine ─────────────────────────────────────────────────
 * Whitelist substitution only. The regex admits nothing but a bare identifier,
 * so no expression can ever reach anything executable. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function renderPlaceholders(
  text: string,
  data: Record<string, string>,
): { text: string; unknown: string[]; used: string[] } {
  const unknown: string[] = [];
  const used: string[] = [];
  const rendered = text.replace(PLACEHOLDER, (_, name: string) => {
    if (Object.prototype.hasOwnProperty.call(data, name)) {
      used.push(name);
      return data[name] ?? "";
    }
    if (!unknown.includes(name)) unknown.push(name);
    return "";
  });
  return { text: rendered, unknown, used };
}

/** List the placeholders a piece of text mentions — for the editor's warnings. */
export function listPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER)) found.add(match[1]!);
  return [...found];
}

/* ── defaults ────────────────────────────────────────────────────────────────
 * What production renders when the admin never published anything — the exact
 * messages the app has been sending, expressed as templates. */

function tgDefault(icon: string, title: string, lines: string[], footer = "GrovBase Admin"): TelegramTemplateDef {
  return { icon, title, body: lines.join("\n"), footer };
}

const CONTEXT_LINES = [
  "👤 | {{name}}",
  "📧 | {{email}}",
  "📱 | {{phone}}",
  "🕒 | {{date}} • {{time}}",
  "🌍 | {{source}}",
  "🔗 | {{landing}}",
  "📍 | {{ip}}",
  "💻 | {{device}}",
  "🗣 | {{language}}",
];

function emailDefault(subject: string, heading: string, body: string, footer = "GrovBase Admin"): EmailTemplateDef {
  return {
    subject, heading, body,
    ctaLabel: "", ctaUrl: "",
    footer,
    showLogo: true, showFields: true, showCta: false,
  };
}

const DEFAULTS: Record<string, TemplateDef> = {
  "user.registered:telegram": { channel: "telegram", telegram: tgDefault("🎉", "NOWA REJESTRACJA", CONTEXT_LINES) },
  "user.registered:email": { channel: "email", email: emailDefault(
    "Nowa rejestracja — {{name}}", "Nowa rejestracja",
    "Nowe konto w GrovBase. Szczegóły poniżej.") },
  "waitlist.signup:telegram": { channel: "telegram", telegram: tgDefault("📝", "NOWY ZAPIS NA LISTĘ", CONTEXT_LINES) },
  "waitlist.signup:email": { channel: "email", email: emailDefault(
    "Nowy zapis na listę — {{email}}", "Nowy zapis na listę oczekujących",
    "Ktoś dołączył do listy oczekujących GrovBase.") },
  "mail.received:telegram": { channel: "telegram", telegram: tgDefault("📬", "NOWA WIADOMOŚĆ", [
    "👤 | {{name}}",
    "📧 | {{email}}",
    "🕒 | {{date}} • {{time}}",
  ], "Skrzynka GrovBase") },
  "login.security_code:email": { channel: "email", email: {
    subject: "Kod bezpieczeństwa logowania — GrovBase",
    heading: "Nowe logowanie do GrovBase",
    body: "Otrzymaliśmy próbę logowania na Twoje konto. Podaj poniższy kod, aby ją potwierdzić. Kod wygasa za kilka minut.",
    ctaLabel: "", ctaUrl: "",
    footer: "Jeżeli to nie Ty, nie udostępniaj kodu i zmień hasło.",
    showLogo: true, showFields: true, showCta: false,
  } },
  "login.new_device:email": { channel: "email", email: {
    subject: "Nowe logowanie do GrovBase",
    heading: "Nowe logowanie na Twoim koncie",
    body: "Zalogowano się na Twoje konto GrovBase z nowego urządzenia. Jeżeli to Ty — wszystko w porządku.",
    ctaLabel: "To nie ja — zmień hasło", ctaUrl: "https://grovbase.com/forgot-password",
    footer: "",
    showLogo: true, showFields: true, showCta: true,
  } },
  "payment.received:telegram": { channel: "telegram", telegram: tgDefault("💰", "NOWA PŁATNOŚĆ", [
    "👤 | {{name}}", "📧 | {{email}}", "💳 | {{amount}}", "📦 | {{plan}}", "🕒 | {{date}} • {{time}}",
  ]) },
  "payment.received:email": { channel: "email", email: emailDefault(
    "Nowa płatność — {{amount}}", "Nowa płatność", "Zaksięgowano nową płatność w GrovBase.") },
  "credits.purchased:telegram": { channel: "telegram", telegram: tgDefault("🪙", "ZAKUP KREDYTÓW", [
    "👤 | {{name}}", "📧 | {{email}}", "💳 | {{amount}}", "🕒 | {{date}} • {{time}}",
  ]) },
  "subscription.created:telegram": { channel: "telegram", telegram: tgDefault("⭐", "NOWA SUBSKRYPCJA", [
    "👤 | {{name}}", "📧 | {{email}}", "📦 | {{plan}}", "💳 | {{amount}}", "🕒 | {{date}} • {{time}}",
  ]) },
  "subscription.renewed:telegram": { channel: "telegram", telegram: tgDefault("🔄", "ODNOWIENIE SUBSKRYPCJI", [
    "👤 | {{name}}", "📧 | {{email}}", "📦 | {{plan}}", "💳 | {{amount}}", "🕒 | {{date}} • {{time}}",
  ]) },
  "subscription.cancelled:telegram": { channel: "telegram", telegram: tgDefault("⚠️", "ANULOWANA SUBSKRYPCJA", [
    "👤 | {{name}}", "📧 | {{email}}", "📦 | {{plan}}", "🕒 | {{date}} • {{time}}",
  ]) },
};

export function defaultTemplate(key: string): TemplateDef | null {
  return DEFAULTS[key] ?? null;
}

/* ── sample data for previews ────────────────────────────────────────────────
 * Never written anywhere — it exists so the preview has something human to
 * show. The IP is a documentation range on purpose. */
export const SAMPLE_DATA: Record<string, string> = {
  name: "Jan Kowalski",
  email: "jan@example.com",
  phone: "+48 500 000 000",
  date: "06.09.2026",
  time: "04:46",
  source: "Google",
  ip: "203.0.113.7",
  device: "iPhone · iOS · Safari",
  language: "PL",
  landing: "/home",
  amount: "199,00 zł",
  plan: "Pro",
  code: "482 193",
  first_name: "Jan",
};

/* ── channel renderers ──────────────────────────────────────────────────────*/

const TG_RULE = "━━━━━━━━━━━━━━━━";
const TG_LINE_MAX = 160;

function tgEscapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Long URLs and referrers read better short: protocol stripped, middle cut. */
export function shortenValue(value: string, max = 46): string {
  let v = value.trim().replace(/^https?:\/\//i, "");
  if (v.length <= max) return v;
  return `${v.slice(0, max - 1)}…`;
}

/**
 * Render a Telegram template: title line, rule, one compact line per field,
 * rule, footer. `<code>` wraps the technical lines (📍 IP, 🔗 entry) so they
 * align and copy cleanly; everything else stays plain and readable. A line
 * whose placeholders all rendered empty is dropped whole.
 */
export function renderTemplateTelegram(def: TelegramTemplateDef, data: Record<string, string>): {
  text: string; unknown: string[];
} {
  const unknownAll: string[] = [];
  const icon = def.icon.trim();
  const title = `${icon ? `${tgEscapeText(icon)} ` : ""}<b>${tgEscapeText(def.title.trim() || "GrovBase")}</b>`;
  const lines: string[] = [title, TG_RULE];

  for (const rawLine of def.body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const mentioned = listPlaceholders(line);
    const { text, unknown } = renderPlaceholders(line, data);
    for (const u of unknown) if (!unknownAll.includes(u)) unknownAll.push(u);
    // Every placeholder on the line rendered empty → the line carries nothing.
    if (mentioned.length > 0 && mentioned.every((p) => !(data[p] ?? "").trim())) continue;
    const cleaned = text.replace(/\s+/g, " ").replace(/\s*•\s*$/, "").replace(/\|\s*$/, "|").trim();
    if (!cleaned || /^\S+ \|$/.test(cleaned)) continue;
    const value = shortenValue(cleaned.slice(0, TG_LINE_MAX), TG_LINE_MAX);
    const mono = /^📍|^🔗/.test(cleaned);
    if (mono) {
      const m = /^(\S+)\s*\|\s*(.*)$/.exec(value);
      lines.push(m ? `${tgEscapeText(m[1]!)} | <code>${tgEscapeText(m[2]!)}</code>` : tgEscapeText(value));
    } else {
      lines.push(tgEscapeText(value));
    }
  }

  lines.push(TG_RULE);
  const footer = def.footer.trim();
  if (footer) lines.push(tgEscapeText(shortenValue(footer, 80)));
  return { text: lines.join("\n"), unknown: unknownAll };
}

/**
 * Render an e-mail template through the shared GrovBase Notification Card.
 * `fields` is the compact table (already label/value — the caller decides what
 * belongs there); subject/heading/body/footer run through the placeholder
 * engine, and every value is escaped downstream by renderEmailTemplate.
 */
export function renderTemplateEmail(
  def: EmailTemplateDef,
  data: Record<string, string>,
  opts: { badge?: string; fields?: EmailField[]; timestamp?: string },
): { subject: string; html: string; text: string; unknown: string[] } {
  const unknownAll: string[] = [];
  const roll = (text: string) => {
    const { text: rendered, unknown } = renderPlaceholders(text, data);
    for (const u of unknown) if (!unknownAll.includes(u)) unknownAll.push(u);
    return rendered.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  };

  const subject = roll(def.subject) || "GrovBase";
  const cta = def.showCta && def.ctaLabel.trim() && def.ctaUrl.trim()
    ? { label: roll(def.ctaLabel), url: roll(def.ctaUrl) }
    : undefined;

  const { html, text } = renderEmailTemplate({
    badge: opts.badge,
    title: roll(def.heading) || subject,
    intro: roll(def.body),
    fields: def.showFields ? opts.fields ?? [] : [],
    cta,
    footer: roll(def.footer),
    timestamp: opts.timestamp,
    showLogo: def.showLogo,
  });
  return { subject, html, text, unknown: unknownAll };
}

/** The field table for an e-mail, derived from the same keyed data the
 *  placeholders use — labels in Polish, technical values monospaced. */
const FIELD_LABELS: readonly { key: string; label: string; mono?: boolean }[] = [
  { key: "name", label: "Imię i nazwisko" },
  { key: "email", label: "E-mail", mono: true },
  { key: "phone", label: "Telefon", mono: true },
  { key: "source", label: "Źródło" },
  { key: "plan", label: "Plan" },
  { key: "amount", label: "Kwota" },
  { key: "date", label: "Data" },
  { key: "time", label: "Godzina" },
  { key: "landing", label: "Wejście" },
  { key: "ip", label: "IP", mono: true },
  { key: "device", label: "Urządzenie" },
  { key: "language", label: "Język" },
  { key: "code", label: "Kod", mono: true },
];

export function fieldsFromData(data: Record<string, string>): EmailField[] {
  return FIELD_LABELS
    .filter((f) => (data[f.key] ?? "").trim() !== "")
    .map((f) => ({ label: f.label, value: data[f.key]!, mono: f.mono }));
}

/* ── stored rows ────────────────────────────────────────────────────────────*/

export type TemplateRecord = {
  key: string;
  draft: TemplateDef | null;
  published: TemplateDef | null;
  publishedVersion: number;
  publishedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Parse a stored jsonb into a typed def for the entry's channel; anything
 *  malformed degrades to null (the caller falls back to the default). */
export function parseStoredDef(channel: TemplateChannel, value: unknown): TemplateDef | null {
  const row = asRecord(value);
  if (Object.keys(row).length === 0) return null;
  if (channel === "telegram") {
    return { channel, telegram: {
      icon: str(row.icon), title: str(row.title), body: str(row.body), footer: str(row.footer),
    } };
  }
  return { channel, email: {
    subject: str(row.subject), heading: str(row.heading), body: str(row.body),
    ctaLabel: str(row.ctaLabel), ctaUrl: str(row.ctaUrl), footer: str(row.footer),
    showLogo: flag(row.showLogo, true), showFields: flag(row.showFields, true), showCta: flag(row.showCta, false),
  } };
}

export function storedFromDef(def: TemplateDef): Record<string, unknown> {
  return def.channel === "telegram" ? { ...def.telegram } : { ...def.email };
}

/**
 * The published template for one (event, channel) — for the DISPATCHER, which
 * often runs without an admin session: the read goes through the token-gated
 * lookup function, so the anon key alone still opens nothing else.
 * Returns null on any miss or error; the caller then uses the default.
 */
export async function lookupPublishedTemplate(
  supabase: Client,
  token: string,
  event: string,
  channel: TemplateChannel,
): Promise<TemplateDef | null> {
  try {
    const { data, error } = await supabase.rpc("message_template_lookup", {
      p_token: token, p_event: event, p_channel: channel,
    });
    if (error || !data) return null;
    return parseStoredDef(channel, data);
  } catch (e) {
    console.error("templates.lookup", safeError(e));
    return null;
  }
}

/** Telegram preview needs the same escaping the send path uses — re-exported
 *  so the editor preview and the dispatcher can never disagree. */
export { escapeHtml as escapeForEmail };
