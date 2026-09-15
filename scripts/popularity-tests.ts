/**
 * THE POPULARITY RANKING — the parts that go wrong quietly.
 *
 * The global search opens with "najpopularniejsze narzędzia" and "popularne
 * narzędzia". If this module is wrong, nothing crashes: the modal still opens,
 * still shows nine tiles, and still looks measured. It just shows the wrong
 * nine, or sends people to a tool that is switched off, or quietly describes a
 * quarter under a heading that says "most used". Each of those is checked here,
 * because none of them is visible from the outside.
 *
 *   · THE MAPPING. One service_slug covers several screens — `image_generation`
 *     is the custom generator, the prompt engine, Retusz and every Moda tool —
 *     so a missed tag credits four products to one. Every tag shape production
 *     actually writes is asserted against the feature it belongs to.
 *   · THE ORDER, on the real production distribution. The counts below are the
 *     ones the live ledger holds, so a regression shows up as the wrong tool in
 *     first place rather than as an abstract sort bug.
 *   · DETERMINISM. Two tools with equal usage must not swap places between
 *     deploys; ties fall to a declared order, never to Map insertion order.
 *   · SEVEN DAYS, AND ONLY SEVEN. The window never widens. A quiet week falls
 *     back to the last week that ranked — not to a month, not to a quarter —
 *     and the stored row says which of the three it is. This is the whole
 *     decision table, run against a stand-in database.
 *   · NEVER EMPTY, NEVER A LIE. No usage at all still yields a full list, and
 *     it is labelled `fallback` — "nigdy pusty modal" and "NIE KŁAM W UI" are
 *     the same requirement from two directions.
 *
 * Run:  npm run test:popularity
 */
import {
  FALLBACK_ORDER, POPULAR_COUNT, TOP_COUNT, WINDOW_DAYS, featureForUsage, fallbackPopularity,
  parsePopularity, popularityIsStale, rankFromCounts, refreshToolPopularity,
  type UsageCount,
} from "@/lib/server/tool-popularity";
import { FEATURE_REGISTRY, isFeatureKey, type FeatureKey } from "@/lib/features";
import type { Client } from "@/lib/services/workspace";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n     ${detail}`}`);
}

const row = (p: Partial<UsageCount> & { service_slug: string; uses: number }): UsageCount => ({
  tool: null, operation: null, prompt_origin: null, ...p,
});

/* ── the mapping ─────────────────────────────────────────────────────────── */

const CASES: [UsageCount, FeatureKey | null, string][] = [
  [row({ service_slug: "image_generation", prompt_origin: "ecomstudio", uses: 1 }), "prompts",
    "engine prompt → the prompt engine"],
  [row({ service_slug: "image_generation", prompt_origin: "custom", uses: 1 }), "generator",
    "customer's own prompt → the custom generator"],
  [row({ service_slug: "image_generation", uses: 1 }), "generator",
    "historical rows carry no origin — they are the generator, not the engine"],
  [row({ service_slug: "image_generation", operation: "image_retouch", prompt_origin: "ecomstudio", uses: 1 }),
    "retouch", "Retusz is charged as image_generation and only `operation` says so"],
  [row({ service_slug: "image_generation", operation: "fashion_iron", prompt_origin: "ecomstudio", uses: 1 }),
    "fashion_iron", "a Moda tool names its own feature key"],
  [row({ service_slug: "prompt_generation", uses: 1 }), "prompts", "planning prompts → the engine"],
  [row({ service_slug: "video_generation", uses: 1 }), "video", "video"],
  [row({ service_slug: "tool_compress", tool: "compress", uses: 1 }), "compress", "compress"],
  [row({ service_slug: "tool_format", tool: "format", uses: 1 }), "resize", "format is the Resize screen"],
  [row({ service_slug: "tool_watermark", tool: "watermark", uses: 1 }), "tool_watermark", "watermark"],
  [row({ service_slug: "tool_upscale", tool: "upscale", uses: 1 }), "tool_upscale", "upscale"],
  [row({ service_slug: "tool_expand", tool: "expand", uses: 1 }), "tool_expand", "expand"],
  [row({ service_slug: "tool_remove_bg", tool: "remove_bg", uses: 1 }), "editor",
    "remove-bg is a section of the editor, not a screen"],
  [row({ service_slug: "tool_ai_background", tool: "ai_background", uses: 1 }), "editor",
    "the generative edits are editor sections — asked of the tool registry, not re-listed"],
  [row({ service_slug: "tool_ghost_mannequin", tool: "ghost_mannequin", uses: 1 }), "editor",
    "an edit-capability tool with no screen of its own falls to the editor"],
  [row({ service_slug: "something_else", uses: 1 }), null, "an unknown service ranks nothing"],
  [row({ service_slug: "image_generation", operation: "not_a_feature", uses: 1 }), "generator",
    "an operation tag from a build that no longer exists falls back to the service"],
];
for (const [input, expected, label] of CASES) {
  const got = featureForUsage(input);
  check(`mapping: ${label}`, got === expected, `expected ${expected}, got ${got}`);
}
check(
  "the catalogue page is never ranked as a tool",
  CASES.every(([, expected]) => expected !== "tools")
  && featureForUsage(row({ service_slug: "tool_nonsense", tool: "nonsense", uses: 1 })) === null,
  "/tools is where you go when you do not know which tool you want",
);

/* ── the order, on the real distribution ─────────────────────────────────── */

// Exactly what the production ledger holds for succeeded events (2026-08-12 →
// 2026-09-07). Kept here verbatim so a regression reads as "the wrong tool is
// first" rather than as an abstract sorting failure.
const PRODUCTION: UsageCount[] = [
  row({ service_slug: "image_generation", uses: 58 }),
  row({ service_slug: "prompt_generation", uses: 39 }),
  row({ service_slug: "image_generation", prompt_origin: "ecomstudio", uses: 27 }),
  row({ service_slug: "tool_compress", tool: "compress", uses: 18 }),
  row({ service_slug: "tool_format", tool: "format", uses: 6 }),
  row({ service_slug: "tool_watermark", tool: "watermark", uses: 1 }),
];
const ranked = rankFromCounts(PRODUCTION);
check(
  "the two prompt-engine signals are summed, not counted twice",
  ranked.sample === 149,
  `sample ${ranked.sample}, expected 149 (58+39+27+18+6+1)`,
);
// The engine wins BECAUSE its two signals are summed: 39 planning runs + 27
// engine-prompted generations = 66, against the custom generator's 58. Counting
// either signal alone would put the generator first and be wrong.
check(
  "production order: engine, generator, compress, resize, watermark",
  ranked.keys.slice(0, 5).join(",") === "prompts,generator,compress,resize,tool_watermark",
  ranked.keys.slice(0, 5).join(", "),
);
check("five distinct tools were measured, the rest is padding", ranked.measured === 5,
  `measured ${ranked.measured}`);
check(
  "the ranking is long enough to survive availability filtering",
  ranked.keys.length >= TOP_COUNT + POPULAR_COUNT + 2,
  `${ranked.keys.length} keys for ${TOP_COUNT} + ${POPULAR_COUNT} slots`,
);
check("no key appears twice", new Set(ranked.keys).size === ranked.keys.length);

/* ── determinism ─────────────────────────────────────────────────────────── */

const tiedA = rankFromCounts([
  row({ service_slug: "tool_compress", tool: "compress", uses: 5 }),
  row({ service_slug: "tool_upscale", tool: "upscale", uses: 5 }),
  row({ service_slug: "tool_format", tool: "format", uses: 5 }),
]);
const tiedB = rankFromCounts([
  row({ service_slug: "tool_upscale", tool: "upscale", uses: 5 }),
  row({ service_slug: "tool_format", tool: "format", uses: 5 }),
  row({ service_slug: "tool_compress", tool: "compress", uses: 5 }),
]);
check(
  "equal usage breaks on a declared order, not on the order rows arrived in",
  tiedA.keys.join(",") === tiedB.keys.join(","),
  `${tiedA.keys.slice(0, 3).join(", ")}  vs  ${tiedB.keys.slice(0, 3).join(", ")}`,
);
check(
  "…and that order is the declared one",
  tiedA.keys.slice(0, 3).join(",") === "compress,resize,tool_upscale",
  tiedA.keys.slice(0, 3).join(", "),
);
check(
  "a row with no uses cannot take a ranked position",
  rankFromCounts([row({ service_slug: "tool_watermark", tool: "watermark", uses: 0 })]).measured === 0,
  "zero successful runs is not popularity",
);

/* ── never empty, never a lie ────────────────────────────────────────────── */

const empty = rankFromCounts([]);
check("no usage still produces a full list", empty.keys.length >= TOP_COUNT + POPULAR_COUNT);
check("…and reports nothing measured", empty.sample === 0 && empty.measured === 0);

const fb = fallbackPopularity();
check("the fallback is full", fb.keys.length >= TOP_COUNT + POPULAR_COUNT, `${fb.keys.length} keys`);
check("the fallback says it is a fallback", fb.source === "fallback" && fb.computedAt === null
  && fb.windowDays === null && fb.sample === 0 && fb.measured === 0);

/* ── what comes back out of the settings row ─────────────────────────────── */

check("a missing row degrades to the fallback", parsePopularity(undefined).source === "fallback");
check("garbage degrades to the fallback", parsePopularity({ keys: "nope" }).source === "fallback");
check(
  "a key that is not a feature is dropped",
  !parsePopularity({ keys: ["generator", "not_a_key", "prompts"], source: "weekly_usage" }).keys
    .includes("not_a_key" as FeatureKey),
);
check(
  "a key that is not rankable is dropped",
  !parsePopularity({ keys: ["generator", "tools", "credits"], source: "weekly_usage" }).keys
    .some((k) => k === "tools" || k === "credits"),
  "the catalogue and the account pages are not tools",
);
const short = parsePopularity({ keys: ["generator"], source: "weekly_usage", sample: 3 });
check(
  "a ranking stored before a tool existed is padded, not left short",
  short.keys.length >= TOP_COUNT + POPULAR_COUNT && short.keys[0] === "generator",
  `${short.keys.length} keys, first ${short.keys[0]}`,
);
check(
  "an empty stored ranking is reported as a fallback, not as measured",
  parsePopularity({ keys: [], source: "weekly_usage", sample: 99 }).source === "fallback",
  "claiming 99 measured runs behind the registry's default order would be a lie",
);
check(
  "an unrecognised source is not trusted",
  parsePopularity({ keys: ["generator"], source: "all_time" }).source === "fallback",
  "a value this module never writes must not be echoed back as if it had",
);
const real = parsePopularity({
  keys: ["compress", "generator"], source: "weekly_usage", sample: 12, measured: 2,
  computed_at: "2026-09-15T04:00:00.000Z", checked_at: "2026-09-15T04:00:00.000Z", window_days: 7,
});
check(
  "a real ranking survives the round trip intact",
  real.source === "weekly_usage" && real.sample === 12 && real.measured === 2 && real.windowDays === 7
  && real.computedAt === "2026-09-15T04:00:00.000Z" && real.checkedAt === "2026-09-15T04:00:00.000Z"
  && real.keys[0] === "compress" && real.keys[1] === "generator",
);

/* ── the weekly cadence ──────────────────────────────────────────────────── */

const now = Date.parse("2026-09-15T12:00:00.000Z");
const days = (n: number) => new Date(now - n * 86_400_000).toISOString();
check("never checked → due now", popularityIsStale(null, now));
check("unparseable timestamp → due now", popularityIsStale("whenever", now));
check("checked yesterday → not due", !popularityIsStale(days(1), now));
check("checked six days ago → not due", !popularityIsStale(days(6), now));
check("checked eight days ago → due", popularityIsStale(days(8), now));
check(
  "the boundary is seven days, not eight",
  popularityIsStale(days(7), now) && WINDOW_DAYS === 7,
  "a daily schedule with a 7-day check is what makes this weekly",
);

/* ── seven days, and only seven ──────────────────────────────────────────── */

/**
 * A stand-in for Supabase: enough of the surface that refreshToolPopularity
 * exercises its real decision table. The point is not the plumbing — it is that
 * the window is asked for ONCE, always for seven days, and that what happens
 * when the week is thin is the PREVIOUS RANKING rather than a wider search.
 */
function fakeClient(opts: { counts: UsageCount[]; stored?: unknown }) {
  const calls: { since: string[]; stored: Record<string, unknown>[] } = { since: [], stored: [] };
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: opts.stored ? { value: opts.stored } : null }) }),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "tool_usage_counts") {
        calls.since.push(String(args.p_since));
        return { data: opts.counts, error: null };
      }
      calls.stored.push(args.p_value as Record<string, unknown>);
      return { data: null, error: null };
    },
  };
  return { client: client as unknown as Client, calls };
}

// refreshToolPopularity refuses without the server key, which is correct and
// which the fake cannot supply from the database. This is the test harness
// standing in for the deployment's own secret, and it is not a real one.
process.env.GROVBASE_SERVER_KEY = "popularity-tests-not-a-real-server-key";

const WEEK: UsageCount[] = [
  row({ service_slug: "tool_compress", tool: "compress", uses: 9 }),
  row({ service_slug: "tool_format", tool: "format", uses: 4 }),
  row({ service_slug: "image_generation", uses: 2 }),
];
const THIN: UsageCount[] = [row({ service_slug: "tool_compress", tool: "compress", uses: 1 })];

const LAST_WEEK = {
  version: 2, source: "weekly_usage", window_days: 7, sample: 41, measured: 4,
  computed_at: "2026-09-01T04:00:00.000Z", checked_at: "2026-09-01T04:00:00.000Z",
  keys: ["retouch", "editor", "compress", "resize"],
};

{
  const { client, calls } = fakeClient({ counts: WEEK });
  const result = await refreshToolPopularity(client);
  const stored = calls.stored[0];
  check("a week with enough tools ranks itself",
    result.ok && result.source === "weekly_usage",
    result.ok ? result.source : result.error);
  check("…over exactly one window", calls.since.length === 1, `${calls.since.length} queries`);
  check("…and that window is seven days",
    Math.round((now - Date.parse(calls.since[0])) / 86_400_000) >= 6
    && Date.now() - Date.parse(calls.since[0]) <= 7.01 * 86_400_000,
    calls.since[0]);
  check("…recorded as window_days 7", stored?.window_days === 7, String(stored?.window_days));
  check("…with compress first", (stored?.keys as string[])[0] === "compress",
    (stored?.keys as string[]).slice(0, 3).join(", "));
}

{
  const { client, calls } = fakeClient({ counts: THIN, stored: LAST_WEEK });
  const result = await refreshToolPopularity(client);
  const stored = calls.stored[0];
  check("a thin week does NOT widen the window",
    calls.since.length === 1,
    `${calls.since.length} queries — a second one would be a 30/90-day fallback`);
  check("…it falls back to the previous week",
    result.ok && result.source === "previous_week",
    result.ok ? result.source : result.error);
  // The previous week's four measured tools keep their positions; everything
  // after them is the same registry padding every stored ranking carries, so
  // the grid stays full. What must not change is the measured prefix.
  check("…keeping that week's order at the front",
    (stored?.keys as string[]).slice(0, LAST_WEEK.keys.length).join(",") === LAST_WEEK.keys.join(","),
    (stored?.keys as string[]).slice(0, 6).join(", "));
  check("…and that week's timestamp, not today's",
    stored?.computed_at === LAST_WEEK.computed_at,
    `computed_at ${String(stored?.computed_at)}`);
  check("…while recording that it was checked today",
    typeof stored?.checked_at === "string" && stored.checked_at !== LAST_WEEK.checked_at);
}

{
  const { client, calls } = fakeClient({ counts: [] });
  const result = await refreshToolPopularity(client);
  const stored = calls.stored[0];
  check("no usage and no history → the registry order, called a fallback",
    result.ok && result.source === "fallback",
    result.ok ? result.source : result.error);
  check("…still a full list", (stored?.keys as string[]).length >= TOP_COUNT + POPULAR_COUNT,
    `${(stored?.keys as string[]).length} keys`);
  check("…with no measured timestamp to point at", stored?.computed_at === null);
}

{
  const { client } = fakeClient({ counts: THIN, stored: { ...LAST_WEEK, source: "fallback", computed_at: null } });
  const result = await refreshToolPopularity(client);
  check("a stored FALLBACK is not mistaken for a previous week",
    result.ok && result.source === "fallback",
    result.ok ? result.source : result.error);
}

{
  delete process.env.GROVBASE_SERVER_KEY;
  const { client, calls } = fakeClient({ counts: WEEK });
  const result = await refreshToolPopularity(client);
  check("without the server key it refuses rather than overwriting a good ranking",
    !result.ok && result.error === "server_unconfigured",
    result.ok ? "it wrote something" : result.error);
  check("…and touches nothing", calls.since.length === 0 && calls.stored.length === 0);
}

/* ── every ranked key opens something real ───────────────────────────────── */

for (const key of [...FALLBACK_ORDER, ...ranked.keys]) {
  const descriptor = FEATURE_REGISTRY.find((f) => f.key === key);
  check(
    `${key} is a registry entry with a route`,
    Boolean(isFeatureKey(key) && descriptor?.path?.startsWith("/")),
    `no path for ${key} — the search would offer a tile that 404s`,
  );
}
check(
  "the fallback order carries no duplicates",
  new Set(FALLBACK_ORDER).size === FALLBACK_ORDER.length,
);

console.log(failed === 0 ? "\npopularity: all checks passed" : `\npopularity: ${failed} check(s) failed`);
process.exit(failed > 0 ? 1 : 0);
