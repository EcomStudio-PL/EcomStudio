/**
 * GROVBASE SHOT V2 — the PUBLISH GATE for stage templates and the config.
 *
 * Run by the admin's save/publish/restore actions (app/actions/ai-tools.ts
 * `unresolvable`) and again by the engine on the bodies it resolved, so a
 * version that would make every order stop — or that would put customer text
 * into a system message — can never be live:
 *   · the config must parse completely (no defaults are filled in);
 *   · a template may place only its stage's variables, and must place the
 *     ones the stage cannot work without;
 *   · a vision/text template has exactly one `### USER ###` marker, and its
 *     SYSTEM section places no customer- or model-sourced variable.
 */
import { GROVSHOT_V2_REQUIRED, GROVSHOT_V2_SHOT_BLOCKS, TOOL_VARIABLES, parsePlaceholders } from "@/lib/ai/prompt-variables";
import { parseEngineConfig } from "@/lib/grovshot-v2/config";
import { SPLIT_STAGE_KEYS, USER_MARKER, splitStageTemplate, type GrovshotStageKey } from "@/lib/grovshot-v2/stages";

const UNTRUSTED = new Set(["customer", "ai", "knowledge", "workflow"]);

export function grovshotTemplateProblems(key: GrovshotStageKey, body: string): string[] {
  if (key === "grovshot_v2_config") {
    const parsed = parseEngineConfig(body);
    return parsed.ok ? [] : parsed.errors.map((e) => `config:${e}`);
  }
  const defs = TOOL_VARIABLES[key] ?? [];
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const names = parsePlaceholders(body).map((p) => p.name);
  const problems = [...new Set(names.filter((n) => !byKey.has(n)))];
  for (const req of GROVSHOT_V2_REQUIRED[key] ?? []) if (!names.includes(req)) problems.push(`required:${req}`);

  if (SPLIT_STAGE_KEYS.includes(key)) {
    const split = splitStageTemplate(body);
    if (!split) return [...problems, "layout:user_marker"];
    for (const p of parsePlaceholders(split.system)) {
      const def = byKey.get(p.name);
      if (def && UNTRUSTED.has(def.source)) problems.push(`system_section:${p.name}`);
    }
  } else {
    if (body.split(/\r?\n/).some((l) => l.trim() === USER_MARKER)) problems.push("layout:unexpected_marker");
    // The ten blocks in the spec's order: each block's anchor variable first
    // appears after the previous block's.
    const first = (n: string) => names.indexOf(n);
    const at = GROVSHOT_V2_SHOT_BLOCKS.map(first);
    if (at.every((i) => i >= 0) && at.some((i, k) => k > 0 && i < at[k - 1])) problems.push("block_order");
  }
  return [...new Set(problems)];
}
