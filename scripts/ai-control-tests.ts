/**
 * AI CONTROL CENTER — the invariants.
 *
 * The consolidation's whole promise is that there is now ONE place for each
 * fact. These check the ways that promise could quietly be broken: a second
 * visibility switch, a hidden prompt travelling to a list view, a tool key the
 * feature registry has never heard of, or a retry policy that pays a provider
 * twice.
 */
import { readdirSync, readFileSync } from "node:fs";
import { AI_TOOL_KEYS, ENGINE_MODES, isAiToolKey, toolTabs } from "@/lib/services/ai-tools";
import { costOf, summarise, groupBy, periodStart, monthStart, type UsageEventRow } from "@/lib/services/ai-economics";
import { DEFAULT_BILLING } from "@/lib/images/pricing";
import { FEATURE_KEYS } from "@/lib/features";
import { isNavActive } from "@/lib/nav-active";

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
  // A key with no `ai_tools` row cannot be given a prompt at all:
  // ai_save_tool_prompt (0071) answers `unknown_tool`, and ai_tool_prompts has a
  // foreign key onto ai_tools. So every listed tool must be seeded SOMEWHERE —
  // 0070 for the original ten, a later migration for anything added since.
  // EVERY migration, not a hand-kept list. The list said 0070 and 0081; the
  // fifteenth tool was seeded in 0098 and this array had never heard of it, so
  // the check reported an unconfigurable tool that production has held as a
  // real row since 2026-09-18. The array was a maintenance trap, paid for in
  // 0081 and unpaid in 0098 — a directory read cannot fall behind that way.
  //
  // Two details are load-bearing. Line comments are stripped first: one of
  // 0070's contains a semicolon, which would truncate the statement and make
  // ten tools read as unseeded. And only the text of an
  // `insert into public.ai_tools` statement counts, cut at its first `;` — a
  // key that happens to appear in some other table's insert is not a registry
  // row.
  const seeds = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => read(`supabase/migrations/${f}`).replace(/--[^\n]*/g, ""))
    .flatMap((sql) => sql.split(/insert\s+into\s+public\.ai_tools\b/i).slice(1)
      .map((s) => s.split(";")[0]))
    .join("\n");
  const unseeded = AI_TOOL_KEYS.filter((k) => !seeds.includes(`('${k}'`));
  check("the seed covers every listed tool", unseeded.length === 0, unseeded.join(", "));
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
  /*
    THIS USED TO CLAIM THE CHECK RUNS FROM THE SCHEDULE. It does not, and a
    green test saying it does is worse than no test.

    runBudgetCheckAction() opens with requireAdmin(); the daily cron calls the
    route with a bearer secret and no session, so on a scheduled run the action
    throws, the route catches it, and the budgets are never read. The BUTTON
    works — an admin pressing it has a session. Fixing the schedule half means
    definer reads and writes across every provider's budget and its alert
    markers, on a table that holds no rows yet; it is an open finding, not
    something to paper over here.

    So the assertion is split into what is true today: the wiring exists, and
    the limitation is written down where the next reader will find it.
  */
  const cron = read("app/api/cron/mail/route.ts");
  check("the check is wired into the daily route", cron.includes("runBudgetCheckAction"));
  check("the button is the only caller that can actually run it",
    read("app/actions/ai-budgets.ts").includes("const { supabase, adminId } = await requireAdmin()"));
  check("and the route says so rather than reporting a silent false",
    /KNOWN LIMITATION[\s\S]{0,600}requireAdmin\(\)/.test(cron),
    "a job that never runs must not look like a job with nothing to do");
}

console.log("J. one menu entry highlights at a time");
{
  // The rule moved out of the component into `lib/nav-active.ts`, so this
  // asks it directly rather than grepping for the old variable name: on the
  // deeper screen only the deeper entry lights, and on a sub-page with no menu
  // row of its own the section keeps the highlight instead of going dark.
  check("the longest matching href wins",
    isNavActive("/admin/ai/modele", "/admin/ai/modele") && !isNavActive("/admin/ai/modele", "/admin/ai"));
  check("a sub-page with no entry of its own keeps its section lit",
    isNavActive("/admin/ai/szablony", "/admin/ai"));
  check("the customer menu obeys the same rule",
    isNavActive("/tools/resize", "/tools/resize") && !isNavActive("/tools/resize", "/tools"));
  check("both AI destinations are in the menu",
    read("lib/navigation.ts").includes('"/admin/ai/modele"'));
}

console.log("K. four status colours, and each one means what it says");
{
  const css = read("app/globals.css");
  const badge = read("components/ui/badge.tsx");
  const tones = read("lib/status-tone.ts");
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
  check("maintenance is the warning",
    /MAINTENANCE: "warning"/.test(tones) && /MAINTENANCE: "bg-warning"/.test(tones));
  check("a planned module is not a warning",
    /COMING_SOON: "accent"/.test(tones) && /COMING_SOON: "bg-accent2"/.test(tones));
  check("a module switched off on purpose is not an error",
    /DISABLED: "neutral"/.test(tones) && /DISABLED: "bg-muted"/.test(tones));
  check("every screen that shows a status reads the same map",
    ["components/admin/tool-registry.tsx", "components/admin/feature-availability-panel.tsx",
      "app/admin/ai/[tool]/page.tsx"]
      .every((f) => read(f).includes('from "@/lib/status-tone"')));
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

console.log("M. six menu entries became two, and nothing was dropped on the way");
{
  const nav = read("lib/navigation.ts");
  const aiGroup = nav.slice(nav.indexOf('{ key: "ai", items:'), nav.indexOf('{ key: "marketing"'));
  const retired = ["/admin/models", "/admin/providers", "/admin/engine",
    "/admin/concepts", "/admin/templates", "/admin/tools"];

  check("the AI group is the two destinations plus the output log",
    (aiGroup.match(/href:/g) ?? []).length === 3
    && aiGroup.includes('"/admin/ai"') && aiGroup.includes('"/admin/ai/modele"')
    && aiGroup.includes('"/admin/generations"'));
  check("no retired screen is still in a menu",
    retired.every((href) => !nav.includes(`href: "${href}"`)));

  // A retired route is a redirect, never a 404: a bookmark from last month
  // still has to land on the screen that took the job over.
  for (const href of retired) {
    const file = `app${href}/page.tsx`;
    const src = read(file);
    check(`${href} redirects`, src.includes("redirect(") && !src.includes("createClient"));
  }
  check("a bookmarked concept session still opens",
    read("app/admin/concepts/[id]/page.tsx").includes("/admin/ai/sesje/"));

  // …and the screens they redirect TO must actually do the old job.
  check("the knowledge library moved rather than vanished",
    read("app/admin/ai/wiedza/page.tsx").includes("EngineAdmin")
    && read("app/admin/engine/page.tsx").includes("/admin/ai/wiedza"));
  check("the prompt templates moved rather than vanished",
    read("app/admin/ai/szablony/page.tsx").includes("TemplateManager")
    && read("app/admin/ai/szablony/page.tsx").includes("PromptBlocksManager"));
  check("the shot sessions moved rather than vanished",
    read("app/admin/ai/[tool]/page.tsx").includes("prompt_sessions")
    && read("app/admin/ai/sesje/[id]/page.tsx").includes("decryptConceptPayload"));
  check("the image-tool backends moved rather than vanished",
    read("app/admin/ai/modele/page.tsx").includes("providerStatuses"));
  check("the knowledge tab points at the library's new address",
    read("components/admin/tool-knowledge.tsx").includes("/admin/ai/wiedza"));
  check("no revalidatePath still names a retired screen",
    !["app/actions/admin.ts", "app/actions/engine.ts", "app/actions/credentials.ts",
      "app/actions/admin-generation.ts"]
      .some((f) => retired.some((href) => read(f).includes(`revalidatePath("${href}")`))));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
