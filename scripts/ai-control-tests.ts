/**
 * AI CONTROL CENTER — the invariants.
 *
 * The consolidation's whole promise is that there is now ONE place for each
 * fact. These check the ways that promise could quietly be broken: a second
 * visibility switch, a hidden prompt travelling to a list view, a tool key the
 * feature registry has never heard of, or a retry policy that pays a provider
 * twice.
 */
import { readFileSync } from "node:fs";
import { AI_TOOL_KEYS, ENGINE_MODES, isAiToolKey, toolTabs } from "@/lib/services/ai-tools";
import { costOf, summarise, groupBy, periodStart, monthStart, type UsageEventRow } from "@/lib/services/ai-economics";
import { DEFAULT_BILLING } from "@/lib/images/pricing";
import { FEATURE_KEYS } from "@/lib/features";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { console.log(`  ok   ${name}`); return; }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}
const read = (p: string) => readFileSync(p, "utf8");

console.log("A. the registry is the feature registry, not a second list");
{
  const unknown = AI_TOOL_KEYS.filter((k) => !(FEATURE_KEYS as readonly string[]).includes(k));
  check("every tool key exists in lib/features.ts", unknown.length === 0, unknown.join(", "));
  check("an unknown key is refused", !isAiToolKey("not_a_tool"));
  check("the seed covers every listed tool", AI_TOOL_KEYS.every((k) =>
    read("supabase/migrations/0070_ai_control_center.sql").includes(`('${k}'`)));
}

console.log("B. a tool only gets the tabs it can answer for");
{
  const compress = toolTabs({ key: "compress", engineMode: "off", serviceSlug: "tool_compress" });
  check("a sharp tool has no engine tab", !compress.includes("engine"));
  check("a sharp tool has no model tab", !compress.includes("models"));
  check("a sharp tool still has economics", compress.includes("economics") && compress.includes("history"));

  const generator = toolTabs({ key: "generator", engineMode: "hybrid", serviceSlug: "image_generation" });
  check("a model-driven tool gets engine + models",
    generator.includes("engine") && generator.includes("models"));
  check("an engine means a knowledge tab", generator.includes("knowledge"));

  const video = toolTabs({ key: "video", engineMode: "off", serviceSlug: "video_generation" });
  check("a tool with no engine yet can still be given one", video.includes("engine"));
  check("…but has no knowledge tab until it has one", !video.includes("knowledge"));

  const unbilled = toolTabs({ key: "editor", engineMode: "off", serviceSlug: null });
  check("no service means no economics", !unbilled.includes("economics"));
}

console.log("C. the hidden prompt stays on the server");
{
  const engine = read("lib/server/ai-engine.ts");
  const actions = read("app/actions/ai-tools.ts");
  const service = read("lib/services/ai-tools.ts");
  const editor = read("components/admin/tool-prompt.tsx");
  const page = read("app/admin/ai/[tool]/page.tsx");

  check("the runtime module is server-only", engine.startsWith('import "server-only"'));
  check("the runtime read is token-guarded", engine.includes("dispatchToken()")
    && engine.includes("ai_tool_runtime"));
  check("the history query never selects a body", !/select\([^)]*body_encrypted/.test(service));
  check("only one action opens a body", (actions.match(/openPrompt\(/g) ?? []).length === 1);
  check("the editor receives versions, never bodies", !/body:\s*/.test(page)
    && editor.includes("readPromptBodyAction"));
  check("a body is sealed before it is stored", actions.includes("sealPrompt(body)"));
  check("publishing records the reason, not the text",
    /after: \{ version: result\.version, reason/.test(actions));
}

console.log("D. one source of truth per fact");
{
  const actions = read("app/actions/ai-tools.ts");
  const page = read("app/admin/ai/[tool]/page.tsx");
  check("the tool config never writes feature_availability",
    !actions.includes("feature_availability"));
  check("status is edited where it lives", page.includes("/admin/settings/features"));
  check("the price comes from the catalogue, and is only pointed at",
    actions.includes('from("service_catalog")') && !actions.includes("credits_cost:"));
  check("no wallet write anywhere in this surface",
    !actions.includes("credit_wallets") && !actions.includes("apply_credit_transaction"));
}

console.log("E. publishing is append-only and atomic");
{
  const sql = read("supabase/migrations/0071_ai_prompt_publishing.sql");
  const schema = read("supabase/migrations/0070_ai_control_center.sql");
  const actions = read("app/actions/ai-tools.ts");

  check("at most one published version per tool",
    schema.includes("ai_tool_prompts_one_published"));
  check("a publish supersedes rather than deletes",
    sql.includes("set status = 'superseded'") && !/delete from public\.ai_tool_prompts/.test(sql));
  check("restore copies forward into a new version",
    sql.includes("v_src.body_encrypted") && sql.includes("'restore v'"));
  check("every function checks is_admin first",
    (sql.match(/is_admin\(v_actor\)/g) ?? []).length === 3);
  check("publishing requires a reason", actions.includes('error: "reason_required"'));
}

console.log("F. retries cannot quietly double an invoice");
{
  const schema = read("supabase/migrations/0070_ai_control_center.sql");
  const actions = read("app/actions/ai-tools.ts");
  check("attempts are capped in the database", schema.includes("max_attempts between 1 and 3"));
  check("attempts are clamped in the action again", actions.includes("Math.min(Math.max(Math.trunc(input.maxAttempts) || 1, 1), 3)"));
  check("a fallback identical to the primary is refused", actions.includes('error: "same_model"'));
}

console.log("G. the seed describes the code, not a guess");
{
  const seed = read("supabase/migrations/0070_ai_control_center.sql");
  const retouch = read("lib/server/retouch.ts");
  const identifier = retouch.match(/RETOUCH_MODEL_IDENTIFIER = "([^"]+)"/)?.[1] ?? "";
  check("retouch's seeded model is the one its source asks for",
    identifier.length > 0 && seed.includes(identifier), identifier);
  check("every engine mode in the code is allowed by the constraint",
    ENGINE_MODES.every((m) => seed.includes(`'${m}'`)));
}

console.log("H. an API cost is measured, estimated or unknown — never invented");
{
  const base = {
    id: "1", created_at: "2026-09-07T10:00:00Z", status: "succeeded",
    service_slug: "image_generation", provider_slug: "openai", model_slug: "gpt-image-2",
    user_id: null,
  };
  const measured = costOf({ ...base, credits_charged: 4, actual_api_cost_usd_micros: 42000, api_cost_usd_micros_snapshot: 40000 } as UsageEventRow);
  check("a figure from the provider wins", measured.basis === "measured" && measured.usdMicros === 42000);

  const estimated = costOf({ ...base, credits_charged: 4, actual_api_cost_usd_micros: null, api_cost_usd_micros_snapshot: 40000 } as UsageEventRow);
  check("without one, the catalogue snapshot is used and labelled",
    estimated.basis === "estimated" && estimated.usdMicros === 40000);

  const unknown = costOf({ ...base, credits_charged: 4, actual_api_cost_usd_micros: null, api_cost_usd_micros_snapshot: 0 } as UsageEventRow);
  check("a paid call with neither is unknown, not zero",
    unknown.basis === "unknown" && unknown.usdMicros === 0);

  const free = costOf({ ...base, credits_charged: 0, actual_api_cost_usd_micros: null, api_cost_usd_micros_snapshot: 0 } as UsageEventRow);
  check("a free local tool is not flagged unknown", free.basis === "measured");

  const refunded = summarise([
    { ...base, credits_charged: 4, actual_api_cost_usd_micros: 42000, api_cost_usd_micros_snapshot: 0 },
    { ...base, id: "2", status: "refunded", credits_charged: 4, actual_api_cost_usd_micros: 42000, api_cost_usd_micros_snapshot: 0 },
  ] as UsageEventRow[], DEFAULT_BILLING);
  check("a refund gives the credits back but keeps the provider cost",
    refunded.credits === 4 && refunded.costUsdMicros === 84000);
  check("failures are counted", refunded.failed === 1);
  check("the basis counts are reported", refunded.measured === 2 && refunded.unknown === 0);

  const noRevenue = summarise([{ ...base, credits_charged: 0, actual_api_cost_usd_micros: 1000, api_cost_usd_micros_snapshot: 0 }] as UsageEventRow[], DEFAULT_BILLING);
  check("no revenue means no margin, not 0%", noRevenue.marginPercent === null);

  const grouped = groupBy([
    { ...base, credits_charged: 1, actual_api_cost_usd_micros: 1000, api_cost_usd_micros_snapshot: 0 },
    { ...base, id: "2", model_slug: "nano", credits_charged: 1, actual_api_cost_usd_micros: 9000, api_cost_usd_micros_snapshot: 0 },
  ] as UsageEventRow[], (e) => e.model_slug, DEFAULT_BILLING);
  check("grouping puts the most expensive first", grouped[0].key === "nano");

  const now = new Date("2026-09-07T15:00:00Z");
  check("'today' means midnight, not 24 hours ago",
    periodStart("today", now).getHours() === 0 && periodStart("today", now).getDate() === now.getDate());
  check("a budget month starts on the 1st", monthStart(now).getDate() === 1);
}

console.log("I. the budget is ours, and the panel says so");
{
  const budgets = read("lib/server/provider-budgets.ts");
  const actions = read("app/actions/ai-budgets.ts");
  const pl = JSON.parse(read("lib/i18n/dictionaries/pl.json"));

  // Behaviour, not prose: the module never calls a provider at all, so it
  // cannot be reading — or inventing — an account balance.
  check("no provider is contacted for a balance",
    !budgets.includes("fetch(") && !budgets.includes("http"));
  check("the copy tells the operator it is our budget",
    /nie jest saldo u dostawcy/i.test(pl.aicc["providers.monthNote"])
    && /nie odczytuje salda/i.test(pl.aicc["alerts.note"]));
  check("alerts ride the existing notification transport",
    budgets.includes("notify(") && budgets.includes('type: "system.error"'));
  check("no second Telegram client",
    !budgets.includes("api.telegram") && !/from "@\/lib\/server\/telegram/.test(budgets));
  check("one alert per provider, level and month",
    budgets.includes("buildDedupeKey") && budgets.includes("month.toISOString().slice(0, 7)"));
  check("a new month re-arms the alert", budgets.includes("stale"));
  check("thresholds must be in order", actions.includes("thresholds_out_of_order"));
  check("the check runs from the schedule and the button",
    read("app/api/cron/mail/route.ts").includes("runBudgetCheckAction"));
}

console.log("J. one menu entry highlights at a time");
{
  const navLink = read("components/layout/nav-link.tsx");
  check("the longest matching href wins", navLink.includes("ALL_HREFS.some")
    && navLink.includes("other.startsWith(`${href}/`)"));
  check("both AI destinations are in the menu",
    read("lib/navigation.ts").includes('"/admin/ai/modele"'));
}

console.log("K. four status colours, and each one means what it says");
{
  const css = read("app/globals.css");
  const badge = read("components/ui/badge.tsx");
  const registry = read("components/admin/tool-registry.tsx");
  const features = read("components/admin/feature-availability-panel.tsx");
  const budgets = read("components/admin/provider-budget.tsx");

  // The token itself: orange means red > green > blue in the triplet, which is
  // true of orange and false of both the magenta it used to be and of yellow
  // (where red and green are close together).
  const triplets = [...css.matchAll(/--warning:\s*(\d+)\s+(\d+)\s+(\d+)/g)]
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  check("both themes define a warning colour", triplets.length === 2);
  check("warning is orange, not magenta",
    triplets.every(([r, g, b]) => r > g && g > b), JSON.stringify(triplets));
  check("warning is not yellow", triplets.every(([r, g]) => r - g > 60), JSON.stringify(triplets));

  check("the badge has a tone for it", badge.includes("warning:") && badge.includes("var(--warning)"));
  check("maintenance is the warning, everywhere it is shown",
    /MAINTENANCE: "warning"/.test(registry) && /MAINTENANCE: "bg-warning"/.test(features));
  check("a planned module is not a warning",
    /COMING_SOON: "accent"/.test(registry) && /COMING_SOON: "bg-accent2"/.test(features));
  check("a module switched off on purpose is not an error",
    /DISABLED: "neutral"/.test(registry) && /DISABLED: "bg-muted"/.test(features));
  check("a budget over its warn threshold reads as a warning",
    budgets.includes('"warn" ? "warning"') && budgets.includes('"warn" ? "bg-warning"'));
}

console.log("L. the admin panel fits the screen it is on");
{
  const table = read("components/ui/admin-table.tsx");
  const layout = read("app/admin/layout.tsx");
  const generations = read("app/admin/generations/page.tsx");

  check("a phone card pairs its fields into two columns",
    table.includes("grid grid-cols-2"));
  check("every admin page reserves the dock plus margin",
    layout.includes("pb-[calc(var(--dock-h)+2rem+env(safe-area-inset-bottom))]"));
  check("the generation log is paginated, not loaded whole",
    generations.includes(".range(from, from + PAGE_SIZE - 1)")
    && generations.includes('{ count: "exact" }'));
  check("it reads the columns it shows, not every column",
    !generations.includes('select("*'));
  check("a failed job is red and a queued one is not",
    /failed: "danger"/.test(generations) && /queued: "neutral"/.test(generations));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
