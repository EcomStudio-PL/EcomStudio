/**
 * PLANY V3 — WHAT A PLAN CARD LISTS, AS AN EDITABLE DOCUMENT.
 *
 * The feature lines under each plan card ("Wyróżnione możliwości", "Narzędzia",
 * …) used to be fixed in code (PLAN_PRESENTATION.highlights + CARD_GROUPS).
 * An admin now edits them per plan in „Edytuj stronę”: text, order, hiding,
 * adding and deleting lines, the group names, hiding a whole group. That is
 * ONE document, `public.pricing_cards` (0179), read by the page through
 * `pricing_cards_published()`.
 *
 * PRESENTATION ONLY. This file never decides a price, a credit amount, a
 * seat count or whether a capability is sold — those stay in
 * `subscription_plans` (and featureOn). Two rules keep the card honest:
 *
 *   1. A line BOUND to a feature (`feature`) shows the truth of featureOn —
 *      the same table the comparison reads. An admin may change its words and
 *      hide it, never its mark: a stored status that disagrees with the truth
 *      is ignored (the line falls back to the truth). The one choice the
 *      truth leaves open: a feature the plan does NOT have is either left off
 *      the card (default) or shown with ✕.
 *   2. A CUSTOM line (no `feature`) is the admin's own sentence and mark; it
 *      claims nothing the comparison table shows.
 *
 * Text in a language the admin has not written is never filled with another
 * language: a bound line falls back to its own translated label, a custom line
 * is simply not shown in that language. No document, or a broken one → the
 * code default below, which renders exactly the cards as they were.
 */
import { CARD_GROUPS, featureOn, planPresentation, type Availability, type FeatureKey } from "./pricing-config";

export const CARD_LOCALES = ["pl", "en", "de"] as const;
export type CardLocale = (typeof CARD_LOCALES)[number];
export type CardText = Partial<Record<CardLocale, string>>;

/** "auto" = follow the truth (bound lines only). */
export type CardStatus = "auto" | Availability;

export type CardItem = {
  /** Stable: `f:<feature>` for a bound line, `c:<8 chars>` for a custom one. */
  id: string;
  feature?: FeatureKey;
  /** Per-language words; absent language → the default (bound) or not shown (custom). */
  label?: CardText;
  status: CardStatus;
  hidden?: boolean;
};

export type CardGroupId = "highlights" | "tools" | "output" | "team" | "support";
export const CARD_GROUP_IDS: readonly CardGroupId[] = ["highlights", "tools", "output", "team", "support"];
export const CARD_GROUP_TITLE: Readonly<Record<CardGroupId, string>> = {
  highlights: "pricing.group.highlights",
  tools: "pricing.group.tools",
  output: "pricing.group.output",
  team: "pricing.group.team",
  support: "pricing.group.support",
};

export type CardGroup = { id: CardGroupId; title?: CardText; hidden?: boolean; items: CardItem[] };
export type PlanCardConfig = { groups: CardGroup[] };
export type PricingCardsDoc = { v: 1; plans: Record<string, PlanCardConfig> };

/** The features a card line may be bound to (the comparison's money rows are not card lines). */
export const CARD_FEATURES: readonly FeatureKey[] = [
  "noExpiry", "topups", "allTools", "customPrompts", "video", "quality", "library",
  "seats", "priority", "operator", "supportEmail", "supportDedicated", "commercial",
];

export const CARD_LIMITS = { text: 140, itemsPerGroup: 20, plans: 16, bytes: 64_000 } as const;
/** Values a line may quote from the plan's own row. */
export const CARD_PLACEHOLDERS = ["seats", "credits"] as const;

const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const CUSTOM_ID = /^c:[a-z0-9]{8}$/;

/* ── the default: exactly the cards as they were ─────────────────────────── */

export function defaultPlanCard(slug: string): PlanCardConfig {
  const highlights = planPresentation(slug).highlights;
  const bound = (f: FeatureKey): CardItem => ({ id: `f:${f}`, feature: f, status: "auto" });
  return {
    groups: [
      { id: "highlights", items: highlights.map(bound) },
      ...CARD_GROUPS.map((g) => ({
        id: g.key as CardGroupId,
        items: g.features.filter((f) => !highlights.includes(f)).map(bound),
      })),
    ],
  };
}

export const emptyCardsDoc = (): PricingCardsDoc => ({ v: 1, plans: {} });

/** The plan's card as the document has it, else the default. */
export function planCardConfig(doc: PricingCardsDoc | null | undefined, slug: string): PlanCardConfig {
  return doc?.plans[slug] ?? defaultPlanCard(slug);
}

/* ── the truth a line may show ───────────────────────────────────────────── */

/**
 * What a line shows on this plan: ✓ / Wkrótce / ✕, or null (not on the card).
 * Bound lines can never contradict featureOn.
 */
export function lineState(item: CardItem, slug: string, caps: Record<string, number | boolean>): Availability | null {
  if (!item.feature) return item.status === "auto" ? "yes" : item.status;
  const truth = featureOn(item.feature, slug, caps);
  if (truth !== "no") return truth;
  return item.status === "no" ? "no" : null;
}

/** The marks the editor may offer for a line on this plan. */
export function allowedStatuses(item: Pick<CardItem, "feature">, slug: string, caps: Record<string, number | boolean>): CardStatus[] {
  if (!item.feature) return ["yes", "soon", "no"];
  const truth = featureOn(item.feature, slug, caps);
  return truth === "no" ? ["auto", "no"] : ["auto"];
}

/* ── placeholders ────────────────────────────────────────────────────────── */

const PLACEHOLDER = /\{([a-z]+)\}/g;

export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/** Fill {seats} / {credits}; null when a value is missing or a name unknown. */
export function fillPlaceholders(text: string, values: Partial<Record<(typeof CARD_PLACEHOLDERS)[number], string>>): string | null {
  let ok = true;
  const out = text.replace(PLACEHOLDER, (_, name: string) => {
    const v = (values as Record<string, string | undefined>)[name];
    if (v === undefined) ok = false;
    return v ?? "";
  });
  return ok ? out : null;
}

/* ── reading and checking a document ─────────────────────────────────────── */

export type CardsCheck = { ok: true; doc: PricingCardsDoc } | { ok: false; error: string; at?: string };

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
// Control characters and the bidi overrides: never part of a card line.
const BAD_CHARS = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/;

function cleanText(raw: unknown, at: string): { ok: true; text: CardText | undefined } | { ok: false; error: string; at: string } {
  if (raw === undefined || raw === null) return { ok: true, text: undefined };
  if (!isObj(raw)) return { ok: false, error: "bad_text", at };
  const out: CardText = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(CARD_LOCALES as readonly string[]).includes(k)) return { ok: false, error: "bad_locale", at };
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return { ok: false, error: "bad_text", at };
    const s = v.replace(/\s+/g, " ").trim();
    if (!s) continue;
    if (s.length > CARD_LIMITS.text) return { ok: false, error: "text_too_long", at: `${at}.${k}` };
    if (BAD_CHARS.test(s)) return { ok: false, error: "bad_text", at: `${at}.${k}` };
    const unknown = placeholdersIn(s).filter((p) => !(CARD_PLACEHOLDERS as readonly string[]).includes(p));
    if (unknown.length) return { ok: false, error: "bad_placeholder", at: `${at}.${k}` };
    out[k as CardLocale] = s;
  }
  return { ok: true, text: Object.keys(out).length ? out : undefined };
}

/**
 * The one validator — the editor before it saves, the server before it
 * writes, the page before it renders. Whatever it returns is canonical: all
 * five groups in their fixed order, trimmed text, no empty fields, plans equal
 * to their default left out.
 */
export function checkCardsDoc(raw: unknown): CardsCheck {
  if (!isObj(raw) || raw.v !== 1 || !isObj(raw.plans)) return { ok: false, error: "bad_doc" };
  const slugs = Object.keys(raw.plans);
  if (slugs.length > CARD_LIMITS.plans) return { ok: false, error: "too_many_plans" };
  const plans: Record<string, PlanCardConfig> = {};
  for (const slug of slugs.sort()) {
    if (!SLUG.test(slug)) return { ok: false, error: "bad_plan", at: slug };
    const plan = raw.plans[slug];
    if (!isObj(plan) || !Array.isArray(plan.groups)) return { ok: false, error: "bad_plan", at: slug };
    const byId = new Map<string, Record<string, unknown>>();
    for (const g of plan.groups) {
      if (!isObj(g) || typeof g.id !== "string" || !(CARD_GROUP_IDS as readonly string[]).includes(g.id) || byId.has(g.id)) {
        return { ok: false, error: "bad_group", at: slug };
      }
      byId.set(g.id, g);
    }
    if (byId.size !== CARD_GROUP_IDS.length) return { ok: false, error: "bad_group", at: slug };
    const ids = new Set<string>();
    const features = new Set<string>();
    const groups: CardGroup[] = [];
    for (const gid of CARD_GROUP_IDS) {
      const g = byId.get(gid)!;
      const at = `${slug}.${gid}`;
      const title = cleanText(g.title, `${at}.title`);
      if (!title.ok) return title;
      if (!Array.isArray(g.items) || g.items.length > CARD_LIMITS.itemsPerGroup) return { ok: false, error: "bad_items", at };
      const items: CardItem[] = [];
      for (const it of g.items) {
        if (!isObj(it) || typeof it.id !== "string" || ids.has(it.id)) return { ok: false, error: "bad_item", at };
        ids.add(it.id);
        const status = it.status;
        if (status !== "auto" && status !== "yes" && status !== "no" && status !== "soon") return { ok: false, error: "bad_status", at: `${at}.${it.id}` };
        const label = cleanText(it.label, `${at}.${it.id}`);
        if (!label.ok) return label;
        const item: CardItem = { id: it.id, status };
        if (it.feature !== undefined) {
          const f = it.feature;
          if (typeof f !== "string" || !(CARD_FEATURES as readonly string[]).includes(f) || features.has(f) || it.id !== `f:${f}`) {
            return { ok: false, error: "bad_feature", at: `${at}.${it.id}` };
          }
          features.add(f);
          item.feature = f as FeatureKey;
        } else {
          if (!CUSTOM_ID.test(it.id)) return { ok: false, error: "bad_item", at: `${at}.${it.id}` };
          // A custom line is its own words: one language at least, and a mark.
          if (!label.text) return { ok: false, error: "custom_needs_text", at: `${at}.${it.id}` };
          if (status === "auto") item.status = "yes";
        }
        if (label.text) item.label = label.text;
        if (it.hidden === true) item.hidden = true;
        items.push(item);
      }
      const group: CardGroup = { id: gid, items };
      if (title.text) group.title = title.text;
      if (g.hidden === true) group.hidden = true;
      groups.push(group);
    }
    const config = { groups };
    if (cardKey(config) !== cardKey(defaultPlanCard(slug))) plans[slug] = config;
  }
  const doc: PricingCardsDoc = { v: 1, plans };
  if (JSON.stringify(doc).length > CARD_LIMITS.bytes) return { ok: false, error: "too_large" };
  return { ok: true, doc };
}

/** A broken or missing document renders as the default — never as an error. */
export function readCardsDoc(raw: unknown): PricingCardsDoc | null {
  const r = checkCardsDoc(raw);
  return r.ok ? r.doc : null;
}

/** A stable comparison key (property order fixed by construction). */
export function cardKey(config: PlanCardConfig): string {
  return JSON.stringify(config.groups.map((g) => [g.id, g.title ?? null, g.hidden ?? false,
    g.items.map((i) => [i.id, i.feature ?? null, i.label ?? null, i.status, i.hidden ?? false])]));
}

/** Languages a custom line or a renamed group lacks — the editor warns. */
export function missingLocales(text: CardText | undefined): CardLocale[] {
  return CARD_LOCALES.filter((l) => !text?.[l]);
}

/* ── what the card draws ─────────────────────────────────────────────────── */

/** `suffix`: the seat count drawn bold after the words, as the card always did. */
export type ResolvedLine = { id: string; feature?: FeatureKey; text: string; suffix?: string; state: Availability };
export type ResolvedGroup = { id: CardGroupId; title: string; lines: ResolvedLine[] };

export type CardFacts = {
  slug: string;
  caps: Record<string, number | boolean>;
  locale: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Formatted values for {seats} / {credits}; a missing one hides the line. */
  values: Partial<Record<(typeof CARD_PLACEHOLDERS)[number], string>>;
  featureLabel: (f: FeatureKey) => string;
};

/**
 * The groups and lines one plan's card shows, in order. Hidden lines, lines
 * the plan does not have (unless shown as ✕), custom lines without words in
 * this language and groups left empty are all dropped — so a group whose
 * every line is hidden leaves no heading, divider or gap behind.
 */
export function resolveCard(config: PlanCardConfig, f: CardFacts): ResolvedGroup[] {
  const lang = (CARD_LOCALES as readonly string[]).includes(f.locale) ? (f.locale as CardLocale) : "pl";
  const out: ResolvedGroup[] = [];
  for (const g of config.groups) {
    if (g.hidden) continue;
    const lines: ResolvedLine[] = [];
    for (const item of g.items) {
      if (item.hidden) continue;
      const state = lineState(item, f.slug, f.caps);
      if (!state) continue;
      const own = item.label?.[lang];
      let text: string | null;
      if (own) text = fillPlaceholders(own, f.values);
      else if (item.feature) text = f.featureLabel(item.feature);
      else text = null;
      if (!text) continue;
      // The seat count beside the seats line, as before — unless the admin's
      // words already quote it with {seats}.
      const suffix = item.feature === "seats" && f.values.seats && !own?.includes("{seats}") ? f.values.seats : undefined;
      lines.push({ id: item.id, ...(item.feature ? { feature: item.feature } : {}), text, ...(suffix ? { suffix } : {}), state });
    }
    if (lines.length === 0) continue;
    out.push({ id: g.id, title: g.title?.[lang] ?? f.t(CARD_GROUP_TITLE[g.id]), lines });
  }
  return out;
}

/* ── editing (pure; the editor and the tests share them) ─────────────────── */

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function newCustomId(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    let id = "c:";
    for (let i = 0; i < 8; i++) id += abc[Math.floor(random() * abc.length)];
    if (!taken.has(id)) return id;
  }
}

export const itemIds = (config: PlanCardConfig) => new Set(config.groups.flatMap((g) => g.items.map((i) => i.id)));

export function editGroup(config: PlanCardConfig, gid: CardGroupId, fn: (g: CardGroup) => void): PlanCardConfig {
  const next = clone(config);
  const g = next.groups.find((x) => x.id === gid);
  if (g) fn(g);
  return next;
}

export function moveItem(config: PlanCardConfig, gid: CardGroupId, from: number, to: number): PlanCardConfig {
  return editGroup(config, gid, (g) => {
    if (from < 0 || from >= g.items.length || to < 0 || to >= g.items.length || from === to) return;
    const [it] = g.items.splice(from, 1);
    g.items.splice(to, 0, it);
  });
}

/** Features no group of this plan lists any more — offered back by "Dodaj". */
export function missingFeatures(config: PlanCardConfig): FeatureKey[] {
  const have = new Set(config.groups.flatMap((g) => g.items.map((i) => i.feature).filter(Boolean)));
  return CARD_FEATURES.filter((f) => !have.has(f));
}

/** The document with one plan replaced (or dropped back to its default). */
export function withPlan(doc: PricingCardsDoc, slug: string, config: PlanCardConfig): PricingCardsDoc {
  const plans = { ...doc.plans };
  if (cardKey(config) === cardKey(defaultPlanCard(slug))) delete plans[slug];
  else plans[slug] = config;
  return { v: 1, plans };
}
