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

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
