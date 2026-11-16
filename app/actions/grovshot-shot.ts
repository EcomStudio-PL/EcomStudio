"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { readKb, type KbIssue, type KbParsed, type KbReadSummary } from "@/lib/grovshot-shot/kb";
import { buildKbImport } from "@/lib/grovshot-shot/kb-import";
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

/**
 * Import a knowledge file. Only technical checks: a .md file, readable text,
 * not empty, within the size, a change note (buildKbImport). The structure is
 * never a reason to refuse: the file is saved byte for byte as a NEW INACTIVE
 * version and read here (no model call); one the engine cannot run on is a
 * draft that cannot be activated — an import never touches the active version.
 */
export async function importKbAction(input: {
  fileName: string; content: string; note: string; original?: { fileName: string; content: string } | null;
}): Promise<Result<{ id: string; version: number; duplicate: boolean; ready: boolean; blockers: string[]; read: KbReadSummary }>> {
  const a = await adminClient();
  if (!a) return { ok: false, error: "forbidden" };
  const built = buildKbImport({ fileName: input?.fileName, content: input?.content, note: input?.note });
  if (!built.ok) return { ok: false, error: built.error };
  const original = input.original?.content ? { title: String(input.original.fileName).slice(0, 200), content: input.original.content, sha256: sha(input.original.content) } : null;
  const { data, error } = await a.supabase.rpc("grovshot_shot_kb_import", { p_file: built.file as unknown as Json, p_original: original as Json });
  if (error) return { ok: false, error: "generic" };
  const r = data as { id?: string; version?: number; duplicate?: boolean; error?: string } | null;
  if (!r || r.error || !r.id) return { ok: false, error: r?.error ?? "generic" };
  revalidatePath(PAGE);
  return { ok: true, id: r.id, version: Number(r.version), duplicate: Boolean(r.duplicate), ready: built.ready, blockers: built.blockers, read: built.read };
}

/**
 * Activate a version for NEW orders; an earlier one is a rollback (both
 * recorded). A version the engine cannot run on is refused here AND in the
 * database (0182), so the working active version is never replaced by it.
 */
export async function activateKbAction(versionId: string, note: string): Promise<Result<{ version: number; action: string }>> {
  const a = await adminClient();
  if (!a) return { ok: false, error: "forbidden" };
  const { data: row } = await a.supabase.from("knowledge_versions").select("parsed").eq("id", versionId).eq("tool_key", "grovshot_shot").maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  if (!readKb(row.parsed)) return { ok: false, error: "not_engine_ready" };
  const { data, error } = await a.supabase.rpc("grovshot_shot_kb_activate", { p_version_id: versionId, p_note: String(note ?? "").slice(0, 2000) });
  if (error) return { ok: false, error: "generic" };
  const r = data as { version?: number; action?: string; unchanged?: boolean; error?: string } | null;
  if (!r || r.error) return { ok: false, error: r?.error ?? "generic" };
  revalidatePath(PAGE);
  return { ok: true, version: Number(r.version), action: r.unchanged ? "unchanged" : String(r.action) };
}

/** One version's parse and file (preview, comparison, download — the file exactly as uploaded). */
export async function readKbVersionAction(versionId: string): Promise<Result<{
  version: number; kb: KbParsed; ready: boolean; source: string; fileName: string | null; original: { title: string; content: string } | null;
}>> {
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
