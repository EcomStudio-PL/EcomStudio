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
 *     SYSTEM section places no customer- or model-sourced variable;
 *   · the shot template has the writer's SYSTEM and USER sections and then
 *     `### PROMPT ###`: the writer's blocks appear only in PROMPT (they are its
 *     output), the PROMPT section places the ten blocks in the spec's order,
 *     and the USER section gives the writer the card, the shot and the photos.
 */
import {
  GROVSHOT_V2_REQUIRED, GROVSHOT_V2_SHOT_BLOCKS, GROVSHOT_V2_WRITER_OUTPUTS, TOOL_VARIABLES, parsePlaceholders,
} from "@/lib/ai/prompt-variables";
import { parseEngineConfig } from "@/lib/grovshot-v2/config";
import { SPLIT_STAGE_KEYS, splitShotTemplate, splitStageTemplate, type GrovshotStageKey } from "@/lib/grovshot-v2/stages";

/** What the shot template's USER section must give the writer. */
const WRITER_INPUTS = ["product_card", "shot_spec", "reference_map"] as const;

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
    const split = splitShotTemplate(body);
    if (!split) return [...problems, "layout:prompt_marker"];
    for (const p of parsePlaceholders(split.system)) {
      const def = byKey.get(p.name);
      if (def && UNTRUSTED.has(def.source)) problems.push(`system_section:${p.name}`);
    }
    const userNames = parsePlaceholders(split.user).map((p) => p.name);
    for (const n of [...parsePlaceholders(split.system).map((p) => p.name), ...userNames]) {
      if (GROVSHOT_V2_WRITER_OUTPUTS.has(n)) problems.push(`writer_output_outside_prompt:${n}`);
    }
    for (const req of WRITER_INPUTS) if (!userNames.includes(req)) problems.push(`user_section_required:${req}`);
    // The ten blocks in the spec's order, all in the PROMPT section: each
    // block's anchor variable first appears after the previous block's.
    const promptNames = parsePlaceholders(split.prompt).map((p) => p.name);
    const at = GROVSHOT_V2_SHOT_BLOCKS.map((n) => promptNames.indexOf(n));
    if (at.some((i) => i < 0)) for (const [k, n] of GROVSHOT_V2_SHOT_BLOCKS.entries()) { if (at[k] < 0) problems.push(`prompt_section_required:${n}`); }
    else if (at.some((i, k) => k > 0 && i < at[k - 1])) problems.push("block_order");
  }
  return [...new Set(problems)];
}
