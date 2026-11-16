import { createHash } from "node:crypto";
import { KB_FORMAT, canonicalJson, parseKb, type KbParsed, type KbReadSummary } from "@/lib/grovshot-shot/kb";

/**
 * GROVBASE SHOT — what an upload of the knowledge file sends to the database
 * (grovshot_shot_kb_import, 0166). Only technical checks refuse a file: a .md
 * name, readable text, not empty, within the size, a change note. Its
 * structure never does: the content goes byte for byte, the reader's parse
 * and summary go with it, and `ready` tells whether the engine can run on it
 * (activation needs that — 0182 and the action check it again). Pure apart
 * from hashing; no model call.
 */

export type KbImportFile = {
  title: string; file_name: string; content: string; sha256: string; parsed: unknown; summary: Record<string, unknown>;
  change_note: string; format_version: 1;
};
export type KbImportBuild =
  | { ok: false; error: "change_note_required" | "change_note_too_long" | "not_markdown" | "empty_file" | "file_too_large" | "unreadable" }
  | { ok: true; file: KbImportFile; ready: boolean; blockers: string[]; read: KbReadSummary };

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function buildKbImport(input: { fileName: unknown; content: unknown; note: unknown }): KbImportBuild {
  const note = String(input?.note ?? "").trim();
  if (note.length < 3) return { ok: false, error: "change_note_required" };
  if (note.length > 2000) return { ok: false, error: "change_note_too_long" };
  const fileName = String(input?.fileName ?? "");
  if (!/\.(md|markdown)$/i.test(fileName)) return { ok: false, error: "not_markdown" };
  const content = typeof input?.content === "string" ? input.content : "";
  if (content.trim().length === 0) return { ok: false, error: "empty_file" };
  if (content.length > KB_FORMAT.maxChars) return { ok: false, error: "file_too_large" };
  // Text, not a binary file renamed .md: no NUL, no undecodable bytes.
  if (/[\u0000\uFFFD]/.test(content)) return { ok: false, error: "unreadable" };
  const parsed = parseKb(content);
  if (!parsed.ok) return { ok: false, error: parsed.errors[0]?.code === "file_too_large" ? "file_too_large" : "empty_file" };
  const kb: KbParsed = parsed.kb;
  const read: KbReadSummary = {
    recipes: kb.recipes.length, flags: kb.special.length, always: parsed.always.length, footers: kb.footers.length,
    planRules: kb.planRules.length, negative: kb.negativeItems.length, sections: kb.sections.length,
    defaultFooter: kb.footers.find((f) => f.when.isDefault)?.text ?? null,
  };
  const blockers = parsed.blockers.map((b) => b.code);
  const summary = {
    recipes: kb.recipes.length, derived_recipes: kb.recipes.filter((r) => r.derived).length, flags: kb.special.length,
    prompt_blocks: kb.special.filter((s) => s.block).length, footers: kb.footers.length, plan_rules: kb.planRules.length,
    negative_items: kb.negativeItems.length, directions: kb.directions.length, sections: kb.sections.length, always_rules: read.always,
    engine_ready: parsed.ready, blockers,
    // How the file was read (for diagnosis; never shown as an error list).
    reading: parsed.warnings.map((w) => `${w.code}${w.detail ? `:${w.detail}` : ""}`.slice(0, 200)).slice(0, 40),
    file_name: fileName.slice(0, 200), reader: 2,
  };
  return {
    ok: true, ready: parsed.ready, blockers, read,
    file: {
      title: kb.title || fileName, file_name: fileName, content, sha256: sha256(content),
      // The canonical parse (sorted keys) — the database hashes exactly this.
      parsed: JSON.parse(canonicalJson(kb)) as unknown, summary, change_note: note, format_version: 1,
    },
  };
}
