import "server-only";
import { dispatchToken } from "./server-token";
import { toolBySlug } from "@/lib/images/tools";
import {
  FEATURE_REGISTRY, featureForToolSlug, isFeatureKey, type FeatureKey,
} from "@/lib/features";
import type { Client } from "@/lib/services/workspace";

/**
 * WHICH TOOLS GROVBASE ACTUALLY USES MOST — computed weekly, read instantly.
 *
 * The global search opens with "Najpopularniejsze narzędzia" (3) and "Popularne
 * narzędzia" (6). Neither may be an array somebody typed into a component: the
 * order has to come from what sellers really run. This module is the whole
 * pipeline between those two facts.
 *
 *   RAW USAGE            usage_events, the ledger every paid and free run
 *                        already writes. No new table — the signal exists.
 *   AGGREGATION          tool_usage_counts(), SECURITY DEFINER because RLS
 *                        (correctly) shows a client only its own workspace.
 *   RANKING              this file: usage tags → FEATURE_REGISTRY keys, ordered.
 *   FAST READ            one jsonb row in app_settings, world-readable, read
 *                        by the customer layout inside a batch it already ran.
 *
 * SUCCESSFUL RUNS, NOT VISITS. `status = 'succeeded'` is the only thing
 * counted. Opening /tools is not using a tool; a tile click is not using a
 * tool; a generation that failed and was refunded is not using a tool. Those
 * would all measure curiosity or breakage, and the list is supposed to answer
 * "what do people get work done with".
 *
 * THE WINDOW IS SEVEN DAYS AND ONLY SEVEN DAYS.
 *
 * It does not widen. A quiet week is not a reason to quietly start describing a
 * quarter while the heading still says "most used" — that is the same lie as a
 * hardcoded list, only harder to notice. When the last seven days do not carry
 * enough usage to rank, the answer is the LAST RANKING THAT DID: the keys stay,
 * `source` becomes "previous_week", and the timestamp still points at the week
 * they were measured in. Only when no ranking has ever been computed does the
 * registry's own order stand in, as `source: "fallback"`.
 *
 * So the stored row always says three things: which order, where it came from,
 * and when it was measured. Nothing in the interface can claim a popularity the
 * database cannot back up.
 *
 * WHY ONE SERVICE SLUG IS NOT ENOUGH. `image_generation` covers the custom
 * generator, the prompt engine, Retusz and every Moda tool — they differ only
 * by the tags the run carried (`operation`, `prompt_origin`). The SQL returns
 * those tags untouched and `featureForUsage` below is the ONE place that turns
 * them into a feature key, so the route a search result opens is the route the
 * registry says, never a second opinion.
 */

/** The app_settings row this module owns. */
export const POPULARITY_KEY = "tool_popularity";

/** The brief's two lists: positions 1–3, then the next 6. */
export const TOP_COUNT = 3;
export const POPULAR_COUNT = 6;

/**
 * How many keys the stored ranking carries. More than TOP + POPULAR on
 * purpose: the search filters the list through the availability map before
 * showing it, and a tool switched to "Wkrótce" this morning must not leave a
 * hole in the grid. The spare keys are the depth that absorbs that.
 */
const RANKING_SIZE = 14;

/** "Co 7 dni" — the one window, and how often it is recomputed. */
export const WINDOW_DAYS = 7;
const REFRESH_AFTER_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * What makes a week rankable at all.
 *
 * The headline row is three cards. A week in which two tools ran once each
 * cannot fill it from evidence — the other seven positions would be registry
 * padding wearing a "most used" heading. So a week has to have produced at
 * least as many distinct tools as that row has slots; below that the previous
 * ranking is the more truthful answer, and the stored row says which it is.
 */
const MIN_TOOLS_FOR_A_WEEK = TOP_COUNT;

/**
 * What may appear in the ranking: the tools and workspaces a person would
 * search for. Derived from the registry rather than listed again, minus the
 * catalogue page itself — /tools is where you go when you do NOT know which
 * tool you want, so offering it as a popular tool is circular.
 */
const RANKABLE_GROUPS: readonly string[] = ["image", "create", "edit", "video"];
const RANKABLE: ReadonlySet<FeatureKey> = new Set(
  FEATURE_REGISTRY
    .filter((f) => f.key !== "tools" && RANKABLE_GROUPS.includes(f.group))
    .map((f) => f.key),
);

/**
 * The order used when nothing has ever been measured, and the tie-break for
 * keys with equal usage. It is a starting position, not a claim: the stored row
 * says `source: "fallback"` whenever this is what the customer is seeing.
 */
export const FALLBACK_ORDER: readonly FeatureKey[] = [
  "generator", "prompts", "retouch",
  "editor", "compress", "resize", "image_moda", "tool_upscale", "image_ecommerce",
  "tool_expand", "tool_watermark", "image_social", "image_mailing", "image_inne",
];

/**
 * Where the order on screen came from.
 *
 *   weekly_usage   the last seven days, measured.
 *   previous_week  an earlier week that was; this one had too little to rank.
 *   fallback       nothing has ever been measured — the registry's own order.
 */
export type PopularitySource = "weekly_usage" | "previous_week" | "fallback";

export type ToolPopularity = {
  /** Feature keys, most-used first. Never empty. */
  keys: FeatureKey[];
  source: PopularitySource;
  /** ISO-8601 UTC — when the KEYS were measured. Null for the fallback. */
  computedAt: string | null;
  /** ISO-8601 UTC — when the weekly job last looked. */
  checkedAt: string | null;
  /** The period the ranking describes, in days. Always 7 when measured. */
  windowDays: number | null;
  /** Successful runs behind the ranking. */
  sample: number;
  /** Distinct tools the measured week actually produced. */
  measured: number;
};

/* ── usage tag → feature ──────────────────────────────────────────────────── */

export type UsageCount = {
  service_slug: string;
  tool: string | null;
  operation: string | null;
  prompt_origin: string | null;
  uses: number;
};

/**
 * Which feature one aggregated usage row belongs to. Read in order of how
 * specific the tag is, because a run can carry more than one:
 *
 *   operation      "image_retouch", "fashion_iron" — written by the tools that
 *                  generate through the shared pipeline, and the only thing
 *                  that tells Retusz apart from the plain generator.
 *   tool           the image-tool slug, written by every /tools run.
 *   service_slug   the catalogue entry that was charged — the fallback, and
 *                  for `image_generation` it needs prompt_origin to say
 *                  whether the prompt came from the engine or the customer.
 *
 * null means "not a tool we rank": a service that has no screen of its own, or
 * a tag from a build that no longer exists.
 */
export function featureForUsage(row: UsageCount): FeatureKey | null {
  const claim = (key: FeatureKey | null): FeatureKey | null =>
    key && RANKABLE.has(key) ? key : null;

  // 1. operation — the Moda tools name their own feature key exactly.
  const operation = row.operation?.trim();
  if (operation) {
    if (operation === "image_retouch") return claim("retouch");
    if (isFeatureKey(operation)) return claim(operation);
  }

  // 2. tool slug — the canonical map in lib/features.ts owns this.
  const tool = row.tool?.trim();
  if (tool) {
    const mapped = featureForToolSlug(tool);
    // "tools" is that function's default for a slug it has no screen for. The
    // generative edits (ai_background, relight, beautify…) are exactly that
    // case and they are sections of the editor, not of the catalogue — asked
    // of the tool registry rather than re-listed here.
    if (mapped !== "tools") return claim(mapped);
    if (toolBySlug(tool)?.capability === "edit") return claim("editor");
  }

  // 3. the charged service.
  const service = row.service_slug;
  if (service === "image_generation") {
    // "ecomstudio" = GrovBase wrote the prompt (the engine). Anything else,
    // including the historical rows that carry no origin at all, is the
    // customer's own prompt — which is the custom generator.
    return claim(row.prompt_origin === "ecomstudio" ? "prompts" : "generator");
  }
  if (service === "prompt_generation") return claim("prompts");
  if (service === "video_generation") return claim("video");
  if (service.startsWith("tool_")) {
    const slug = service.slice("tool_".length);
    const mapped = featureForToolSlug(slug);
    if (mapped !== "tools") return claim(mapped);
    if (toolBySlug(slug)?.capability === "edit") return claim("editor");
  }
  return null;
}

/* ── ranking ──────────────────────────────────────────────────────────────── */

/** Registry order, used as the last tie-break so the result is deterministic. */
const REGISTRY_ORDER = new Map<FeatureKey, number>(
  FEATURE_REGISTRY.map((f, i) => [f.key, i]),
);
const FALLBACK_RANK = new Map<FeatureKey, number>(
  FALLBACK_ORDER.map((k, i) => [k, i]),
);

/** Every rankable key, in the order used to pad a short ranking. */
function paddingOrder(): FeatureKey[] {
  const rest = [...RANKABLE].filter((k) => !FALLBACK_RANK.has(k));
  rest.sort((a, b) => (REGISTRY_ORDER.get(a) ?? 0) - (REGISTRY_ORDER.get(b) ?? 0));
  return [...FALLBACK_ORDER.filter((k) => RANKABLE.has(k)), ...rest];
}

/**
 * Counts → an ordered list of RANKING_SIZE keys. Ties break on the fallback
 * order and then the registry, never on Map insertion order: two tools with
 * one use each must not swap places between deployments.
 *
 * `measured` is how many positions came from real usage before the padding
 * started — the number that decides whether the week is rankable at all.
 */
export function rankFromCounts(
  rows: readonly UsageCount[],
): { keys: FeatureKey[]; sample: number; measured: number } {
  const totals = new Map<FeatureKey, number>();
  let sample = 0;
  for (const row of rows) {
    const key = featureForUsage(row);
    const uses = Number(row.uses) || 0;
    if (!key || uses <= 0) continue;
    totals.set(key, (totals.get(key) ?? 0) + uses);
    sample += uses;
  }
  const ranked = [...totals.entries()]
    .sort((a, b) =>
      b[1] - a[1]
      || (FALLBACK_RANK.get(a[0]) ?? 99) - (FALLBACK_RANK.get(b[0]) ?? 99)
      || (REGISTRY_ORDER.get(a[0]) ?? 0) - (REGISTRY_ORDER.get(b[0]) ?? 0))
    .map(([key]) => key);

  const keys = [...ranked];
  for (const key of paddingOrder()) {
    if (keys.length >= RANKING_SIZE) break;
    if (!keys.includes(key)) keys.push(key);
  }
  return { keys: keys.slice(0, RANKING_SIZE), sample, measured: ranked.length };
}

/** The ranking when nothing has ever been measured. Never empty, never a lie. */
export function fallbackPopularity(): ToolPopularity {
  return {
    keys: paddingOrder().slice(0, RANKING_SIZE),
    source: "fallback",
    computedAt: null,
    checkedAt: null,
    windowDays: null,
    sample: 0,
    measured: 0,
  };
}

/* ── the fast read ────────────────────────────────────────────────────────── */

type StoredPopularity = {
  version?: unknown; source?: unknown; computed_at?: unknown; checked_at?: unknown;
  window_days?: unknown; sample?: unknown; measured?: unknown; keys?: unknown;
};

const SOURCES: readonly PopularitySource[] = ["weekly_usage", "previous_week", "fallback"];

/**
 * ONE ROW, ONE ROUND TRIP. app_settings is world-readable (settings_select_all)
 * and the customer layout already runs a batch of reads, so this rides along
 * with them: opening the search costs no request at all. Any shape it does not
 * recognise degrades to the fallback rather than throwing — a stale or
 * hand-edited settings row must not take the header down.
 */
export async function readToolPopularity(supabase: Client): Promise<ToolPopularity> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", POPULARITY_KEY).maybeSingle();
  return parsePopularity(data?.value);
}

export function parsePopularity(value: unknown): ToolPopularity {
  const row = (value ?? {}) as StoredPopularity;
  const stored = Array.isArray(row.keys)
    ? row.keys.filter((k): k is FeatureKey => typeof k === "string" && isFeatureKey(k) && RANKABLE.has(k))
    : [];
  if (stored.length === 0) return fallbackPopularity();

  // Padded on read as well as on write: a ranking stored before a tool was
  // added to the registry would otherwise get shorter every release.
  const keys = [...new Set(stored)];
  for (const key of paddingOrder()) {
    if (keys.length >= RANKING_SIZE) break;
    if (!keys.includes(key)) keys.push(key);
  }
  const source = SOURCES.find((s) => s === row.source) ?? "fallback";
  return {
    keys: keys.slice(0, RANKING_SIZE),
    source,
    computedAt: typeof row.computed_at === "string" ? row.computed_at : null,
    checkedAt: typeof row.checked_at === "string" ? row.checked_at : null,
    windowDays: typeof row.window_days === "number" ? row.window_days : null,
    sample: typeof row.sample === "number" ? row.sample : 0,
    measured: typeof row.measured === "number" ? row.measured : 0,
  };
}

/**
 * Whether the weekly recompute is due. Measured against the last time the job
 * LOOKED, not the last time it found something: a quiet week must not make the
 * job retry every day.
 */
export function popularityIsStale(checkedAt: string | null, now: number): boolean {
  if (!checkedAt) return true;
  const at = Date.parse(checkedAt);
  return !Number.isFinite(at) || now - at >= REFRESH_AFTER_MS;
}

/* ── the weekly recompute ─────────────────────────────────────────────────── */

export type RefreshResult =
  | { ok: true; source: PopularitySource; sample: number; measured: number; keys: FeatureKey[] }
  | { ok: false; error: string };

/**
 * Recompute and store. Called from the scheduled run, never from a page — the
 * search reads the stored row and nothing else, so a customer opening the
 * modal can never trigger an aggregation.
 *
 * ONE query, over ONE window: the last seven days. What happens next depends
 * only on what that week contained, never on a wider search for something more
 * flattering.
 */
export async function refreshToolPopularity(supabase: Client): Promise<RefreshResult> {
  const token = dispatchToken();
  // Fails closed and says so. Without the server key the aggregation is
  // refused by the database anyway, and writing a "fallback" row here would
  // erase a good ranking because of a missing environment variable.
  if (!token) return { ok: false, error: "server_unconfigured" };

  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("tool_usage_counts", { p_token: token, p_since: since });
  if (error) {
    console.error("tool-popularity.count", error.code, error.message);
    return { ok: false, error: "aggregation_failed" };
  }
  const week = rankFromCounts((data ?? []) as UsageCount[]);
  const previous = await readToolPopularity(supabase);
  const checkedAt = new Date(now).toISOString();

  // THE WEEK RANKS. Its order, its timestamp, its sample.
  if (week.measured >= MIN_TOOLS_FOR_A_WEEK) {
    return store(supabase, token, {
      source: "weekly_usage",
      computed_at: checkedAt,
      checked_at: checkedAt,
      window_days: WINDOW_DAYS,
      sample: week.sample,
      measured: week.measured,
      keys: week.keys,
    });
  }

  // IT DOES NOT, BUT AN EARLIER ONE DID. Keep those keys and that timestamp —
  // they describe the week they were measured in, not this one — and record
  // that the interface is showing an older ranking.
  if (previous.source !== "fallback" && previous.computedAt) {
    return store(supabase, token, {
      source: "previous_week",
      computed_at: previous.computedAt,
      checked_at: checkedAt,
      window_days: WINDOW_DAYS,
      sample: previous.sample,
      measured: previous.measured,
      keys: previous.keys,
    });
  }

  // NOTHING HAS EVER RANKED. The registry order, labelled as exactly that.
  return store(supabase, token, {
    source: "fallback",
    computed_at: null,
    checked_at: checkedAt,
    window_days: WINDOW_DAYS,
    sample: week.sample,
    measured: week.measured,
    keys: fallbackPopularity().keys,
  });
}

type StoreInput = {
  source: PopularitySource;
  computed_at: string | null;
  checked_at: string;
  window_days: number;
  sample: number;
  measured: number;
  keys: FeatureKey[];
};

async function store(supabase: Client, token: string, value: StoreInput): Promise<RefreshResult> {
  const { error } = await supabase.rpc("tool_popularity_store", {
    p_token: token,
    // Written in UTC, like every other timestamp in this database. The UI is
    // what converts to Europe/Warsaw.
    p_value: { version: 2, ...value },
  });
  if (error) {
    console.error("tool-popularity.store", error.code, error.message);
    return { ok: false, error: "store_failed" };
  }
  return { ok: true, source: value.source, sample: value.sample, measured: value.measured, keys: value.keys };
}
