"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { parseKb, canonicalJson, type KbIssue, type KbParsed } from "@/lib/grovshot-shot/kb";
import { parseShotSettings, type ShotSettings } from "@/lib/grovshot-shot/settings";
import { readKbVersion } from "@/lib/server/grovshot-shot/admin";

/**
 * GROVBASE SHOT → Baza wiedzy / Testy — the admin's writes. Every one checks
 * the role (profiles.role, never a client claim) and goes through the same
 * database door an operator would use: an import is a DRAFT (never active
 * by itself), activation and rollback are audited in the version history,
 * the engine settings and the test set are admin-only rows.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; errors?: KbIssue[] };
const PAGE = "/admin/ai/prompts";

async function adminClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return profile?.role === "admin" ? { supabase, userId: user.id } : null;
}
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Import a knowledge file: checked and parsed HERE (the browser's preview is never trusted), saved as a draft. */
export async function importKbAction(input: {
  fileName: string; content: string; note: string; original?: { fileName: string; content: string } | null;
}): Promise<Result<{ id: string; version: number; duplicate: boolean; warnings: KbIssue[] }>> {
  const a = await adminClient();
  if (!a) return { ok: false, error: "forbidden" };
  const note = String(input?.note ?? "").trim();
  if (note.length < 3) return { ok: false, error: "change_note_required" };
  const content = String(input?.content ?? "");
  if (!/\.(md|markdown)$/i.test(String(input?.fileName ?? ""))) return { ok: false, error: "not_markdown" };
  const parsed = parseKb(content);
  if (!parsed.ok) return { ok: false, error: "invalid_file", errors: parsed.errors };
  const kb = parsed.kb;
  const summary = {
    recipes: kb.recipes.length, derived_recipes: kb.recipes.filter((r) => r.derived).length, flags: kb.special.length,
    prompt_blocks: kb.special.filter((s) => s.block).length, footers: kb.footers.length, plan_rules: kb.planRules.length,
    negative_items: kb.negativeItems.length, directions: kb.directions.length, sections: kb.sections.length,
    warnings: parsed.warnings.map((w) => `${w.code}${w.detail ? `:${w.detail}` : ""}`).slice(0, 20),
    file_name: String(input.fileName).slice(0, 200),
  };
  const original = input.original?.content ? { title: String(input.original.fileName).slice(0, 200), content: input.original.content, sha256: sha(input.original.content) } : null;
  const { data, error } = await a.supabase.rpc("grovshot_shot_kb_import", {
    p_file: {
      title: kb.title || input.fileName, file_name: input.fileName, content, sha256: sha(content),
      // The canonical parse (sorted keys) — the database hashes exactly this.
      parsed: JSON.parse(canonicalJson(kb)) as Json, summary, change_note: note, format_version: 1,
    } as Json,
    p_original: original as Json,
  });
  if (error) return { ok: false, error: "generic" };
  const r = data as { id?: string; version?: number; duplicate?: boolean; error?: string } | null;
  if (!r || r.error || !r.id) return { ok: false, error: r?.error ?? "generic" };
  revalidatePath(PAGE);
  return { ok: true, id: r.id, version: Number(r.version), duplicate: Boolean(r.duplicate), warnings: parsed.warnings };
}

/** Activate a version for NEW orders; an earlier one is a rollback (both recorded). */
export async function activateKbAction(versionId: string, note: string): Promise<Result<{ version: number; action: string }>> {
  const a = await adminClient();
  if (!a) return { ok: false, error: "forbidden" };
  const { data, error } = await a.supabase.rpc("grovshot_shot_kb_activate", { p_version_id: versionId, p_note: String(note ?? "").slice(0, 2000) });
  if (error) return { ok: false, error: "generic" };
  const r = data as { version?: number; action?: string; unchanged?: boolean; error?: string } | null;
  if (!r || r.error) return { ok: false, error: r?.error ?? "generic" };
  revalidatePath(PAGE);
  return { ok: true, version: Number(r.version), action: r.unchanged ? "unchanged" : String(r.action) };
}

/** One version's parse and file (preview, comparison). */
export async function readKbVersionAction(versionId: string): Promise<Result<{ version: number; kb: KbParsed; source: string }>> {
  const a = await adminClient();
  if (!a) return { ok: false, error: "forbidden" };
  const v = await readKbVersion(a.supabase, versionId);
  return v ? { ok: true, ...v } : { ok: false, error: "not_found" };
}

/** The engine settings (models per step, global limits, spend, scenarios). */
export async function saveShotSettingsAction(next: ShotSettings): Promise<Result> {
  const a = await adminClient();
  if (!a) return { ok: false, error: "forbidden" };
  const parsed = parseShotSettings(next);
  if (!parsed.ok) return { ok: false, error: `invalid:${parsed.errors.join(",")}` };
  const { data: before } = await a.supabase.from("app_settings").select("value").eq("key", "grovshot_shot").maybeSingle();
  const { error } = await a.supabase.from("app_settings").upsert({ key: "grovshot_shot", value: parsed.settings as unknown as Json });
  if (error) return { ok: false, error: "generic" };
  await a.supabase.rpc("log_activity", {
    p_workspace_id: null as unknown as string, p_action: "admin.grovshot_shot_settings_saved", p_entity_type: "app_settings",
    p_metadata: { before: before?.value ?? null, after: parsed.settings } as never,
  });
  revalidatePath(PAGE);
  return { ok: true };
}

/* ── the test set ─────────────────────────────────────────────────────────*/

async function shotSet(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string | null> {
  const { data } = await supabase.from("knowledge_sets").select("id").eq("scope", "grovshot_shot").order("created_at").limit(1).maybeSingle();
  if (data?.id) return data.id;
  const { data: made } = await supabase.from("knowledge_sets").insert({
    name: "GrovBase Shot – baza wiedzy silnika (pliki)", status: "ready", scope: "grovshot_shot", created_by: userId,
    notes: "Wersjonowane pliki bazy wiedzy i zestaw testowy silnika lifestyle (0166).",
  }).select("id").single();
  return made?.id ?? null;
}

export async function saveTestProductAction(p: { id?: string | null; title: string; photos: string[]; description: string; notes: string }): Promise<Result<{ id: string }>> {
  const a = await adminClient();
  if (!a) return { ok: false, error: "forbidden" };
  const title = String(p?.title ?? "").trim().slice(0, 200);
  const photos = Array.isArray(p?.photos) ? p.photos.filter((x) => typeof x === "string" && x.length > 5 && !x.includes("..")).slice(0, 10) : [];
  if (!title || photos.length === 0) return { ok: false, error: "invalid_input" };
  const row = { title, photo_paths: photos, description: String(p.description ?? "").slice(0, 20_000), notes: String(p.notes ?? "").slice(0, 1000) };
  if (p.id) {
    const { error } = await a.supabase.from("knowledge_examples").update(row).eq("id", p.id);
    if (error) return { ok: false, error: "generic" };
    revalidatePath(PAGE);
    return { ok: true, id: p.id };
  }
  const setId = await shotSet(a.supabase, a.userId);
  if (!setId) return { ok: false, error: "generic" };
  const { data, error } = await a.supabase.from("knowledge_examples").insert({ ...row, set_id: setId, created_by: a.userId }).select("id").single();
  if (error || !data) return { ok: false, error: "generic" };
  revalidatePath(PAGE);
  return { ok: true, id: data.id };
}

export async function deleteTestProductAction(id: string): Promise<Result> {
  const a = await adminClient();
  if (!a) return { ok: false, error: "forbidden" };
  const { error } = await a.supabase.from("knowledge_examples").delete().eq("id", id).not("photo_paths", "is", null);
  if (error) return { ok: false, error: "generic" };
  revalidatePath(PAGE);
  return { ok: true };
}
