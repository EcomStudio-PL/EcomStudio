import type { CmsBlockContent, CmsItem, LocaleText } from "./cms";
import { lt } from "./cms";
import { hasPlaceholder } from "./about-page";
import { CONTACT_EMAIL_PATTERN } from "./cms-forms";
import { PLAN_FAQ_LEGACY } from "./faq";

/**
 * KONTAKT V2 — ONE PLACE THAT SAYS WHAT THE CONTACT PAGE IS.
 *
 * The page is one CMS section, `contact_page` (components/cms/contact-page.tsx),
 * because on a phone its parts interleave — header, channels, FAQ, the form,
 * the company — while on a desktop the form sits left and the rest right, and
 * two sections cannot share one grid. Everything a visitor reads is content of
 * that section, edited in "Edytuj stronę" and Strony WWW like any other page:
 *
 *   badge / title / subtitle   the header ("Napisz do nas"); the subtitle and
 *                              the success line may say {czas}, the response
 *                              time, which is ONE value (fields["reply.time"]);
 *   items                      the channels — value = kind (email, instagram,
 *                              facebook, tiktok, youtube), title, description,
 *                              url (+ url2: a Messenger link for facebook),
 *                              hidden;
 *   tiles                      the FAQ links ("Zanim napiszesz…"), each a
 *                              question of the FAQ base: url = /faq#<slug>;
 *   company                    "Dane firmy": name, address, NIP, e-mail —
 *                              hidden until somebody types real data;
 *   fields                     every other text: the form's labels, the topic
 *                              names, the success card (CONTACT_TEXT_KEYS).
 *
 * WHAT A VISITOR NEVER SEES. A channel without a valid link, a FAQ link that
 * points at no existing question, a company tile without a name, anything
 * switched off and anything still holding a "[…]" placeholder are dropped on
 * the server — they are not in the HTML at all. The editor still lists them,
 * marked, so they can be fixed.
 *
 * The form's rules (topics, limits, files) are here too, because the browser,
 * the route and the tests must agree on them; the database (0152,
 * contact_submit) checks them again and is the boundary.
 */

export const CONTACT_PAGE_TYPE = "contact_page";
export const isContactPageType = (type: string): boolean => type === CONTACT_PAGE_TYPE;

/* ── topics ─────────────────────────────────────────────────────────────── */

export const TICKET_TOPICS = ["app", "payments", "technical", "cooperation", "other"] as const;
export type TicketTopic = (typeof TICKET_TOPICS)[number];
export const DEFAULT_TOPIC: TicketTopic = "app";

export function isTicketTopic(value: unknown): value is TicketTopic {
  return typeof value === "string" && (TICKET_TOPICS as readonly string[]).includes(value);
}

/** `?temat=` — the words a link may use (the footer's "Zgłoś błąd" sends
 *  `problem`). Diacritics and case do not matter; anything else is ignored. */
export const TOPIC_PARAM: Readonly<Record<TicketTopic, string>> = {
  app: "aplikacja", payments: "platnosci", technical: "problem", cooperation: "wspolpraca", other: "inne",
};

export function topicFromParam(raw: unknown): TicketTopic | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length > 40) return null;
  const word = value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").toLowerCase().trim();
  const hit = (Object.entries(TOPIC_PARAM) as [TicketTopic, string][]).find(([, w]) => w === word);
  return hit ? hit[0] : null;
}

/** The topics the older forms (contact_hub, contact_form) still post. */
export const LEGACY_TOPIC: Readonly<Record<string, TicketTopic>> = {
  question: "app", sales: "payments", support: "technical", partnership: "cooperation", press: "other", other: "other",
};

export const TICKET_STATUSES = ["new", "in_progress", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const isTicketStatus = (v: unknown): v is TicketStatus =>
  typeof v === "string" && (TICKET_STATUSES as readonly string[]).includes(v);

/* ── the form's limits ──────────────────────────────────────────────────── */

export const CONTACT_LIMITS = {
  nameMax: 120,
  emailMax: 254,
  messageMin: 10,
  messageMax: 5000,
  nipMax: 20,
  generationMax: 300,
  files: 3,
  fileBytes: 5 * 1024 * 1024,
} as const;

export const CONTACT_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ContactMime = (typeof CONTACT_MIMES)[number];
export const isContactMime = (v: unknown): v is ContactMime =>
  typeof v === "string" && (CONTACT_MIMES as readonly string[]).includes(v);

/** The bucket (0152): private, 5 MB, these three types. */
export const CONTACT_BUCKET = "contact-attachments";

/** "PL 123-456-78-90", "1234567890", "DE123456789" — the database's own rule. */
export const NIP_PATTERN = /^([A-Za-z]{2,3} ?)?[0-9][0-9 -]{5,18}[0-9]$/;

const EXT: Readonly<Record<ContactMime, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * A file name an operator can be shown and a download can carry: ASCII
 * letters, digits, dot, dash, underscore and space, at most 100 characters,
 * ending in the extension of what the bytes REALLY are. Never a path.
 */
export function safeFileName(name: string, mime: ContactMime): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/[ _]{2,}/g, "_")
    .replace(/^[.\s_-]+|[.\s_-]+$/g, "")
    .slice(0, 90);
  return `${base || "zalacznik"}.${EXT[mime]}`;
}

export type ContactField = "topic" | "name" | "email" | "message" | "nip" | "generation" | "attachments";
export type ContactErrors = Partial<Record<ContactField, string>>;

export type ContactInput = {
  topic: string; name: string; email: string; message: string; nip: string; generation: string;
};

/** Collapse the way the database does before it measures. */
export const cleanMessage = (v: string): string => v.replace(/\r\n?/g, "\n").trim();

/**
 * The form's rules, as error CODES per field (the page turns them into
 * words): `required`, `email`, `short`, `long`, `nip`, `generation`,
 * `topic`. The same function runs in the browser and in the route.
 */
export function validateContact(input: ContactInput): ContactErrors {
  const out: ContactErrors = {};
  if (!isTicketTopic(input.topic)) out.topic = "topic";
  const name = input.name.trim();
  if (name.length > CONTACT_LIMITS.nameMax) out.name = "long";
  else if (/[<>]/.test(name)) out.name = "invalid";
  const email = input.email.trim();
  if (!email) out.email = "required";
  else if (email.length > CONTACT_LIMITS.emailMax || !CONTACT_EMAIL_PATTERN.test(email)) out.email = "email";
  const message = cleanMessage(input.message);
  if (!message) out.message = "required";
  else if (message.length < CONTACT_LIMITS.messageMin) out.message = "short";
  else if (message.length > CONTACT_LIMITS.messageMax) out.message = "long";
  const nip = input.nip.trim();
  if (nip && input.topic === "payments" && (nip.length > CONTACT_LIMITS.nipMax || !NIP_PATTERN.test(nip))) out.nip = "nip";
  const generation = input.generation.trim();
  if (generation && input.topic === "technical" && (generation.length > CONTACT_LIMITS.generationMax || /[<>]/.test(generation))) {
    out.generation = "generation";
  }
  return out;
}

/* ── channels ───────────────────────────────────────────────────────────── */

export const CHANNEL_KINDS = ["email", "instagram", "facebook", "tiktok", "youtube"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export const isChannelKind = (v: unknown): v is ChannelKind =>
  typeof v === "string" && (CHANNEL_KINDS as readonly string[]).includes(v);

/** Where each profile may live. A link to anywhere else is not that channel. */
const CHANNEL_HOSTS: Readonly<Record<Exclude<ChannelKind, "email">, readonly string[]>> = {
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com", "fb.me"],
  tiktok: ["tiktok.com"],
  youtube: ["youtube.com", "youtu.be"],
};
const MESSENGER_HOSTS = ["m.me", "messenger.com"];

function httpsOn(url: string | undefined, hosts: readonly string[]): string | null {
  const raw = (url ?? "").trim();
  if (!raw || raw.length > 300) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    // Subdomains of an allowed host are allowed (www., m., web.) — and so is
    // a host that IS one of them (m.me).
    const host = u.hostname.toLowerCase();
    if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
    // A profile, not the site's front page.
    if (u.pathname.replace(/\/+$/, "") === "" && !u.search) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** The address an e-mail channel names: "mailto:x@y" or a bare "x@y". */
export function mailAddress(url: string | undefined): string | null {
  const raw = (url ?? "").trim().replace(/^mailto:/i, "");
  return raw && raw.length <= CONTACT_LIMITS.emailMax && CONTACT_EMAIL_PATTERN.test(raw) && !/[?&#]/.test(raw)
    ? raw.toLowerCase()
    : null;
}

/** The link a channel card may carry, or null (the card is then not shown). */
export function channelHref(kind: ChannelKind, url: string | undefined): string | null {
  if (kind === "email") {
    const address = mailAddress(url);
    return address ? `mailto:${address}` : null;
  }
  return httpsOn(url, CHANNEL_HOSTS[kind]);
}

export function messengerHref(url: string | undefined): string | null {
  return httpsOn(url, MESSENGER_HOSTS);
}

/** The social profiles the site already knows (Ustawienia → public_site),
 *  and — for the FAQ links — the questions the FAQ base shows (FAQ V1). */
export type ContactSite = { instagramUrl?: string; facebookUrl?: string; faq?: FaqTargets };

export type ShownChannel = {
  index: number;
  kind: ChannelKind;
  title: string;
  description: string;
  href: string;
  /** e-mail only: the address, spelled out and copyable. */
  address?: string;
  /** facebook only: "Napisz na Messengerze". */
  messenger?: string;
};

const visibleText = (text: LocaleText | undefined, locale: string): string => {
  const v = lt(text, locale).trim();
  return v && !hasPlaceholder(v) ? v : "";
};

/**
 * The URL a channel uses: its own, else — for Instagram and Facebook — the
 * profile the site's settings already name. Never an invented one.
 */
export function channelUrl(item: CmsItem, site: ContactSite): string | undefined {
  const own = (item.url ?? "").trim();
  if (own) return own;
  if (item.value === "instagram") return site.instagramUrl;
  if (item.value === "facebook") return site.facebookUrl;
  return undefined;
}

export function shownChannels(content: CmsBlockContent, site: ContactSite, locale: string): ShownChannel[] {
  return (content.items ?? []).flatMap((item, index) => {
    if (item.hidden || !isChannelKind(item.value)) return [];
    const title = visibleText(item.title, locale);
    const href = channelHref(item.value, channelUrl(item, site));
    if (!title || !href) return [];
    const description = visibleText(item.description, locale);
    const out: ShownChannel = { index, kind: item.value, title, description, href };
    if (item.value === "email") out.address = href.slice("mailto:".length);
    if (item.value === "facebook") {
      const m = messengerHref(item.url2);
      if (m) out.messenger = m;
    }
    return [out];
  });
}

/** Why a channel is not on the page — for the editor, never for a visitor. */
export function channelProblem(item: CmsItem, site: ContactSite): "kind" | "title" | "url" | null {
  if (!isChannelKind(item.value)) return "kind";
  if (!visibleText(item.title, "pl")) return "title";
  if (!channelHref(item.value, channelUrl(item, site))) return "url";
  return null;
}

/* ── FAQ links ──────────────────────────────────────────────────────────── */

/**
 * The questions a FAQ tile may point at: those /faq shows (FAQ V1 — the
 * shared base, /faq#<slug>) and, for a tile still on an address from before
 * the base, those /plany shows (/plany#faq-<key>, mapped by PLAN_FAQ_LEGACY).
 * Read on the server from the base (lib/server/faq.ts) and handed in; a page
 * that has none simply links to no question.
 */
export type FaqTargets = { faq: ReadonlySet<string>; plany: ReadonlySet<string> };

export const NO_FAQ_TARGETS: FaqTargets = { faq: new Set(), plany: new Set() };

/**
 * The link a FAQ tile may carry: a question that EXISTS and is shown
 * (/faq#<slug>, or an old /plany#faq-<key>), another page of the site, or an
 * https page. A tile pointing at a question nobody can see is not a link to
 * anything — it stays off the page and the editor marks it "wymaga
 * konfiguracji" until the question is published.
 *
 * `"shape"` checks the form only — what the editor accepts as typed, before
 * anyone knows whether the question is published yet.
 */
export function faqHref(url: string | undefined, targets: FaqTargets | "shape"): string | null {
  const raw = (url ?? "").trim();
  if (!raw || raw.length > 300) return null;
  const faq = /^\/faq#([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(raw);
  if (faq) return faq[1].length <= 80 && (targets === "shape" || targets.faq.has(faq[1])) ? raw : null;
  const plan = /^\/plany#faq-([A-Za-z0-9_-]{1,80})$/.exec(raw);
  if (plan) {
    if (targets === "shape") return raw;
    const slug = targets.plany.has(plan[1]) ? plan[1] : Object.hasOwn(PLAN_FAQ_LEGACY, plan[1]) ? PLAN_FAQ_LEGACY[plan[1]] : null;
    return slug && targets.plany.has(slug) ? raw : null;
  }
  if (raw.includes("#faq-") || raw.startsWith("/faq#")) return null;
  if (/^\/(?!\/)[A-Za-z0-9/_\-.?=&#]*$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

export type ShownFaq = { index: number; title: string; href: string };

export function shownFaq(content: CmsBlockContent, locale: string, targets: FaqTargets): ShownFaq[] {
  return (content.tiles ?? []).flatMap((item, index) => {
    if (item.hidden) return [];
    const title = visibleText(item.title, locale);
    const href = faqHref(item.url, targets);
    return title && href ? [{ index, title, href }] : [];
  });
}

/** A tile that would be shown but has no question to point at: the editor
 *  marks it "wymaga konfiguracji" (the builder, which does not read the base,
 *  checks the address's form only). */
export function faqNeedsConfig(item: CmsItem, targets: FaqTargets | "shape"): boolean {
  return !item.hidden && Boolean(visibleText(item.title, "pl")) && !faqHref(item.url, targets);
}

/* ── the company tile ───────────────────────────────────────────────────── */

export type ShownCompany = { name: string; address: string; nip: string; email: string };

export function shownCompany(content: CmsBlockContent, locale: string): ShownCompany | null {
  const c = content.company;
  if (!c || c.hidden) return null;
  const name = visibleText(c.title, locale);
  if (!name) return null;
  const nip = (c.value ?? "").trim();
  return {
    name,
    address: visibleText(c.description, locale),
    nip: nip && NIP_PATTERN.test(nip) ? nip : "",
    email: mailAddress(c.url) ?? "",
  };
}

/* ── the editor's address fields ────────────────────────────────────────── */

export type LinkFormat = "channel" | "messenger" | "faq" | "nip" | "email" | "page";

/**
 * Whether an address may be saved into a field of this format. EMPTY is
 * always allowed — it takes the element off the page (a channel without a
 * link is not shown). A channel's link is judged by the channel's own kind.
 */
export function linkValueOk(format: LinkFormat, value: string, kind?: string): boolean {
  const v = value.trim();
  if (!v) return true;
  // No control characters, markup or whitespace — a NIP alone may carry spaces.
  const probe = format === "nip" ? v.replace(/ /g, "") : v;
  if (v.length > 300 || /[\u0000-\u001f\u007f<>"\s]/.test(probe)) return false;
  switch (format) {
    case "channel": return isChannelKind(kind) && channelHref(kind, v) !== null;
    case "messenger": return messengerHref(v) !== null;
    case "faq": return faqHref(v, "shape") !== null;
    case "nip": return v.length <= CONTACT_LIMITS.nipMax && NIP_PATTERN.test(v);
    case "email": return mailAddress(v) !== null;
    // FAQ V1: a button of the /faq page — a page of the site or an https page.
    case "page": return /^\/(?!\/)[A-Za-z0-9/_\-.?=&#%]*$/.test(v) || /^https:\/\/[^\s/]+/.test(v);
  }
}

/* ── texts ──────────────────────────────────────────────────────────────── */

/**
 * The section's own words, in content.fields. Every key here is editable in
 * "Edytuj stronę" (the registry's CMS_FIELDS reads this list) and Strony WWW
 * (lib/cms-schema.ts). The REQUIRED ones fall back to the dictionary
 * (contact.text.<key>) when left empty — a form must never lose a label;
 * the others are simply not drawn when empty.
 */
export const CONTACT_TEXT_KEYS = [
  "reply.time",
  "channels.title", "channel.messenger",
  "faq.title",
  "form.title",
  "form.topic",
  "topic.app", "topic.payments", "topic.technical", "topic.cooperation", "topic.other",
  "form.name", "form.email", "form.message",
  "form.generation", "form.files", "form.filesHint", "form.nip",
  "form.consent", "form.privacy", "form.submit", "form.sending",
  "success.title", "success.body", "success.ticket", "success.backHome", "success.backApp",
  "firm.title",
  "email.copy", "email.copied",
] as const;
export type ContactTextKey = (typeof CONTACT_TEXT_KEYS)[number];

export const CONTACT_REQUIRED_TEXTS: ReadonlySet<ContactTextKey> = new Set<ContactTextKey>([
  "channel.messenger", "form.topic", "topic.app", "topic.payments", "topic.technical", "topic.cooperation", "topic.other",
  "form.name", "form.email", "form.message", "form.generation", "form.files", "form.nip",
  "form.privacy", "form.submit", "form.sending",
  "success.title", "success.ticket", "success.backHome", "success.backApp",
  "email.copy", "email.copied",
]);

/** The `{tokens}` a text may carry. */
export const CONTACT_TOKENS: Readonly<Partial<Record<ContactTextKey | "subtitle", readonly string[]>>> = {
  subtitle: ["czas"],
  "success.body": ["czas"],
  "success.ticket": ["numer"],
};

/** Replace {czas} and {numer}; any other {token} is left out of the text. */
export function fillTokens(text: string, vars: { czas?: string; numer?: string }): string {
  return text.replace(/\{([a-z]+)\}/g, (_, name: string) =>
    name === "czas" ? vars.czas ?? "" : name === "numer" ? vars.numer ?? "" : "").replace(/\s{2,}/g, " ").trim();
}

export function contactText(content: CmsBlockContent, key: ContactTextKey, locale: string): string {
  return visibleText(content.fields?.[key], locale);
}
