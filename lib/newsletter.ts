/**
 * NEWSLETTER — the shapes both halves of the module agree on.
 *
 * Isomorphic on purpose: the admin editor, the server renderer and the worker
 * all need the same idea of what a block is and what a merge tag means, and a
 * second copy of that idea is how a preview stops matching what was sent.
 *
 * Nothing here touches the database or the network. `lib/services/newsletter.ts`
 * does the reading and writing; `lib/server/newsletter/render.ts` turns these
 * structures into an email.
 */

/* ── STATUS ──────────────────────────────────────────────────────────────── */

export const CAMPAIGN_STATUSES = [
  "draft", "scheduled", "sending", "paused", "sent", "cancelled", "failed",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_KINDS = ["one_off", "sequence", "automation"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

export const RECIPIENT_STATUSES = [
  "pending", "sending", "sent", "failed", "skipped", "cancelled",
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

/** Every event the module records. `sent` and `accepted` are deliberately two
 *  different things — see the note on DELIVERY below. */
export const EVENT_TYPES = [
  "sent", "accepted", "opened", "clicked", "replied",
  "unsubscribed", "bounced", "complained", "converted", "failed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * WHY THERE IS NO "DELIVERED".
 *
 * An SMTP server answering `250 OK` has accepted responsibility for a message.
 * It has not told us a human received it, and this transport gives back no
 * bounce webhook, no delivery receipt and no complaint feed. Every number in
 * this module is therefore labelled for what it actually is: the campaign
 * report says "przyjęte przez serwer pocztowy", never "dostarczone".
 */
export const DELIVERY_IS_ACCEPTANCE = true;

export const SUPPRESSION_REASONS = ["unsubscribed", "bounced", "complained", "blocked"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const AB_METRICS = ["click", "conversion", "open"] as const;
export type AbMetric = (typeof AB_METRICS)[number];

export const AUTOMATION_TRIGGERS = [
  "group_joined", "form_submitted", "account_created", "no_click", "clicked", "converted",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export type Locale = "pl" | "en" | "de";
export const LOCALES: readonly Locale[] = ["pl", "en", "de"];

/* ── THE MAIL BUILDER ────────────────────────────────────────────────────── */

/**
 * Ten block types, and deliberately not eleven. §23 of the brief asks for a
 * simple builder, not a second page builder — the CMS already owns that job
 * and an email cannot use most of what it offers anyway. Anything these blocks
 * cannot express is what the HTML mode is for.
 */
export const BLOCK_TYPES = [
  "logo", "heading", "text", "image", "button",
  "columns", "divider", "spacer", "social", "footer",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type MailBlock = {
  id: string;
  type: BlockType;
  /** Free-form per type; every reader treats a missing field as empty. */
  text?: string;
  /** Second column's text, for `columns`. */
  text2?: string;
  url?: string;
  imageUrl?: string;
  imageUrl2?: string;
  alt?: string;
  label?: string;
  align?: "left" | "center" | "right";
  /** Pixels, for `spacer`. */
  size?: number;
  /** Background for this block only. A hex string or empty. */
  background?: string;
};

export const isBlockType = (v: unknown): v is BlockType =>
  typeof v === "string" && (BLOCK_TYPES as readonly string[]).includes(v);

/** A stored blocks array, made safe to render. A campaign saved by an older
 *  version of the editor must still send. */
export function toBlocks(value: unknown): MailBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
    .filter((b) => isBlockType(b.type))
    .map((b, i) => ({
      id: typeof b.id === "string" && b.id ? b.id : `b${i}`,
      type: b.type as BlockType,
      text: typeof b.text === "string" ? b.text : undefined,
      text2: typeof b.text2 === "string" ? b.text2 : undefined,
      url: typeof b.url === "string" ? b.url : undefined,
      imageUrl: typeof b.imageUrl === "string" ? b.imageUrl : undefined,
      imageUrl2: typeof b.imageUrl2 === "string" ? b.imageUrl2 : undefined,
      alt: typeof b.alt === "string" ? b.alt : undefined,
      label: typeof b.label === "string" ? b.label : undefined,
      align: b.align === "left" || b.align === "center" || b.align === "right" ? b.align : undefined,
      size: typeof b.size === "number" && Number.isFinite(b.size) ? b.size : undefined,
      background: typeof b.background === "string" ? b.background : undefined,
    }));
}

/* ── MERGE VARIABLES ─────────────────────────────────────────────────────── */

/**
 * `{{first_name}}` and `{{first_name | default:"Cześć"}}`.
 *
 * A FALLBACK IS COMPULSORY IN PRACTICE, which is why the renderer supplies one
 * even when the author forgot: "Cześć ," with a hole where a name should be is
 * the single most recognisable sign of a broken mailing, and it is always the
 * contact who never filled in their name who gets it.
 *
 * The allowlist below is the whole vocabulary. It is an allowlist rather than
 * "any column" because these values are interpolated into an email that goes
 * to a third party — `{{password_hash}}` must not be one typo away from being
 * a valid tag.
 */
export const MERGE_FIELDS = [
  "first_name", "last_name", "email", "locale", "source", "unsubscribe_url",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export type MergeValues = Partial<Record<MergeField, string>>;

const TAG = /\{\{\s*([a-z_]+)\s*(?:\|\s*default\s*:\s*"([^"]{0,60})"\s*)?\}\}/gi;

/** Default fallbacks, used when the author gave none. Per field, because
 *  "Cześć" is a reasonable stand-in for a first name and a terrible one for an
 *  email address. */
const IMPLICIT_FALLBACK: Record<MergeField, string> = {
  first_name: "",
  last_name: "",
  email: "",
  locale: "pl",
  source: "",
  unsubscribe_url: "",
};

export function applyMerge(template: string, values: MergeValues): string {
  return template.replace(TAG, (whole, rawField: string, fallback?: string) => {
    const field = rawField.toLowerCase() as MergeField;
    if (!(MERGE_FIELDS as readonly string[]).includes(field)) {
      // An unknown tag is left exactly as typed rather than silently deleted:
      // a visible `{{frist_name}}` in the preview is how the author finds it.
      return whole;
    }
    const value = (values[field] ?? "").trim();
    if (value) return value;
    return (fallback ?? IMPLICIT_FALLBACK[field]).trim();
  });
}

/** Which merge tags a body actually uses, for the editor's own warning. */
export function usedMergeFields(template: string): MergeField[] {
  const out = new Set<MergeField>();
  for (const m of template.matchAll(TAG)) {
    const field = m[1].toLowerCase() as MergeField;
    if ((MERGE_FIELDS as readonly string[]).includes(field)) out.add(field);
  }
  return [...out];
}

/** Tags that are spelled wrong, so the editor can say so before the send. */
export function unknownMergeTags(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(TAG)) {
    const field = m[1].toLowerCase();
    if (!(MERGE_FIELDS as readonly string[]).includes(field)) out.add(m[1]);
  }
  return [...out];
}

/* ── SEGMENTS ────────────────────────────────────────────────────────────── */

/**
 * A dynamic group is a saved filter. The vocabulary is small on purpose —
 * §10 asks for AND/OR, not for Salesforce — and every field here is one this
 * module can answer from its own tables plus profiles, so a segment can never
 * quietly depend on data that does not exist yet.
 */
export const SEGMENT_FIELDS = [
  "source", "group", "tag", "locale", "consent",
  "has_account", "opened_campaign", "clicked_campaign", "not_clicked_campaign",
  "created_before", "created_after", "never_sent",
] as const;
export type SegmentField = (typeof SEGMENT_FIELDS)[number];

export type SegmentCondition = {
  field: SegmentField;
  /** A group key, a source key, a tag, a locale, a campaign id or an ISO date,
   *  depending on `field`. Booleans arrive as "true"/"false". */
  value: string;
};

export type SegmentRules = {
  match: "all" | "any";
  conditions: SegmentCondition[];
};

export function toSegmentRules(value: unknown): SegmentRules {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as
    Record<string, unknown>;
  const conditions = Array.isArray(raw.conditions) ? raw.conditions : [];
  return {
    match: raw.match === "any" ? "any" : "all",
    conditions: conditions
      .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
      .filter((c) => (SEGMENT_FIELDS as readonly string[]).includes(String(c.field)))
      .map((c) => ({ field: c.field as SegmentField, value: String(c.value ?? "") }))
      .slice(0, 12),
  };
}

/* ── AUDIENCE ────────────────────────────────────────────────────────────── */

export type Audience = { include: string[]; exclude: string[] };

export function toAudience(value: unknown): Audience {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as
    Record<string, unknown>;
  const ids = (v: unknown): string[] =>
    (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string").slice(0, 50);
  return { include: ids(raw.include), exclude: ids(raw.exclude) };
}

/**
 * What a recipient count is made of, and why it is smaller than the groups
 * suggest. Every number here is a real count, never an estimate — the confirm
 * screen shows them side by side so an operator can see the gap before they
 * send rather than afterwards.
 */
export type AudienceBreakdown = {
  /** Rows in the chosen groups, before anything is removed. */
  selected: number;
  /** After the same address in several groups collapses to one contact. */
  deduplicated: number;
  /** The final number of messages. */
  mailable: number;
  noConsent: number;
  unsubscribed: number;
  suppressed: number;
  excludedByGroup: number;
};

/* ── UTM ─────────────────────────────────────────────────────────────────── */

export type Utm = { source?: string; medium?: string; campaign?: string; content?: string };

export const DEFAULT_UTM: Required<Pick<Utm, "source" | "medium">> = {
  source: "grovbase",
  medium: "email",
};

export function toUtm(value: unknown): Utm {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as
    Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : undefined);
  return {
    source: str(raw.source), medium: str(raw.medium),
    campaign: str(raw.campaign), content: str(raw.content),
  };
}

/* ── RATES ───────────────────────────────────────────────────────────────── */

/** A percentage of a base that may be zero. Returns null rather than 0 % so
 *  the UI can print "—" instead of a rate that was never measured. */
export function rate(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return (part / whole) * 100;
}

export function formatRate(value: number | null, locale = "pl"): string {
  if (value === null) return "—";
  return `${value.toLocaleString(locale === "pl" ? "pl-PL" : locale, {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  })}%`;
}

/* ── REPORTING RANGE ─────────────────────────────────────────────────────── */

/**
 * WHICH WINDOW THE DASHBOARD IS ASKING ABOUT.
 *
 * Lives here, with the other pure helpers, rather than next to the picker that
 * sets it — and that is not filing preference. The picker is a `"use client"`
 * component, and a Server Component importing a plain function out of a client
 * module does not get the function: it gets a client reference that throws the
 * moment it is called. The server pages are the only callers of `resolveRange`
 * — they have to be, since the boundaries have to exist before the queries run
 * — so the function belongs in the isomorphic module both halves can import.
 *
 * The range travels in the URL, which is what makes a dashboard linkable and
 * server-renderable at once, and one function decides the boundaries so the
 * control's caption and the query behind it can never disagree.
 */
/**
 * `since: null` MEANS UNBOUNDED, and it is null rather than an old date on
 * purpose. "Cały okres" has to start where the DATA starts, and only the
 * database knows that — the oldest contact in production predates the oldest
 * waitlist row, which predates the newsletter module itself. Any constant
 * picked here would be either a lie that hides rows older than it or a guess
 * that makes every query scan from 1970. A null tells the service layer to
 * leave the lower bound off the query entirely, which is the only version of
 * "everything" that is actually true.
 */
export type ResolvedRange = {
  key: "7d" | "30d" | "all" | "custom";
  since: string | null;
  until: string;
};

const DAY_MS = 86_400_000;

export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  now = Date.now(),
): ResolvedRange {
  if (params.range === "all") {
    return { key: "all", since: null, until: new Date(now).toISOString() };
  }
  if (params.range === "custom") {
    const from = Date.parse(params.from ?? "");
    const to = Date.parse(params.to ?? "");
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
      // The `to` date is INCLUSIVE: somebody picking 1–7 September means the
      // whole of the 7th, not up to its first second. Without the day's worth
      // of milliseconds, a campaign sent on the last day of a custom range
      // vanishes from the report that was built to look at it.
      return {
        key: "custom",
        since: new Date(from).toISOString(),
        until: new Date(to + DAY_MS - 1).toISOString(),
      };
    }
  }
  // Anything unparseable falls back to 30 days rather than erroring: a
  // hand-edited URL should give an operator the default view, not a stack
  // trace. `formatWindow` then states which window they actually got.
  const days = params.range === "7d" ? 7 : 30;
  return {
    key: days === 7 ? "7d" : "30d",
    since: new Date(now - days * DAY_MS).toISOString(),
    until: new Date(now).toISOString(),
  };
}

/**
 * The window written out for the operator.
 *
 * Dates only, and in Europe/Warsaw for the same reason `formatInstant` in
 * lib/utils uses that zone: the database stores UTC and a Vercel server
 * renders in UTC, so a range that reads "1–30 September" must not silently
 * begin at 02:00 on the 1st for the person deciding whether a send fell
 * inside it.
 */
export function formatWindow(range: ResolvedRange, locale = "pl"): string {
  const fmt = new Intl.DateTimeFormat(
    locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB",
    { dateStyle: "medium", timeZone: "Europe/Warsaw" },
  );
  // An unbounded range has no start to print. The caption becomes an open
  // interval rather than an invented date, which is the same promise the null
  // makes to the query.
  if (range.since === null) return `… – ${fmt.format(new Date(range.until))}`;
  return `${fmt.format(new Date(range.since))} – ${fmt.format(new Date(range.until))}`;
}
