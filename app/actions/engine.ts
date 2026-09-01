"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { buildHintCiphertext, embedTexts } from "@/lib/server/knowledge";

/**
 * AI ENGINE — admin actions for the knowledge base, prompt rules and the
 * engine version history. Everything here runs behind requireAdmin AND the
 * admin-only RLS from migration 0042; every mutation lands in the activity
 * log. Rule/hint plaintext is written alongside its AES-256-GCM ciphertext —
 * the ENGINE (running under a customer session) can only ever read the
 * ciphertext through the definer RPCs.
 */

type Result = { ok: boolean; error?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

const s = (v: unknown, cap: number) => typeof v === "string" ? v.trim().slice(0, cap) : "";

async function logAdmin(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>,
) {
  await supabase.rpc("log_activity", {
    p_workspace_id: null as unknown as string,
    p_action: action, p_entity_type: entityType, p_entity_id: entityId,
    p_metadata: (metadata ?? {}) as never,
  });
}

/* ── Knowledge sets ─────────────────────────────────────────────────────── */

export async function updateKnowledgeSetAction(id: string, patch: {
  name?: string; product_category?: string; product_description?: string;
  model?: string; notes?: string;
}): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = s(patch.name, 160) || "Zestaw";
    if (patch.product_category !== undefined) row.product_category = s(patch.product_category, 120) || null;
    if (patch.product_description !== undefined) row.product_description = s(patch.product_description, 2000) || null;
    if (patch.model !== undefined) row.model = s(patch.model, 120) || null;
    if (patch.notes !== undefined) row.notes = s(patch.notes, 8000) || null;
    const { error } = await supabase.from("knowledge_sets").update(row as never).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAdmin(supabase, "admin.knowledge_set_updated", "knowledge_set", id);
    revalidatePath("/admin/engine");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function deleteKnowledgeSetAction(id: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    // Storage first (best-effort): the source zip and both image folders.
    const paths: string[] = [`sets/${id}/source.zip`];
    for (const dir of ["before", "after"]) {
      const { data: files } = await supabase.storage.from("knowledge").list(`sets/${id}/${dir}`, { limit: 400 });
      for (const f of files ?? []) paths.push(`sets/${id}/${dir}/${f.name}`);
    }
    await supabase.storage.from("knowledge").remove(paths);
    const { error } = await supabase.from("knowledge_sets").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAdmin(supabase, "admin.knowledge_set_deleted", "knowledge_set", id, { files: paths.length });
    revalidatePath("/admin/engine");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/* ── Knowledge examples ─────────────────────────────────────────────────── */

export async function updateKnowledgeExampleAction(id: string, patch: {
  prompt_used?: string; what_worked?: string; what_failed?: string; correction?: string;
  result_rating?: number | null; tags?: string[]; enabled?: boolean;
}): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { data: current } = await supabase
      .from("knowledge_examples")
      .select("id, set_id, prompt_used, what_worked, what_failed, correction, knowledge_sets(product_category, product_description)")
      .eq("id", id).maybeSingle();
    if (!current) return { ok: false, error: "not_found" };

    const fields = {
      prompt_used: patch.prompt_used !== undefined ? s(patch.prompt_used, 4000) || null : current.prompt_used,
      what_worked: patch.what_worked !== undefined ? s(patch.what_worked, 1000) || null : current.what_worked,
      what_failed: patch.what_failed !== undefined ? s(patch.what_failed, 1000) || null : current.what_failed,
      correction: patch.correction !== undefined ? s(patch.correction, 1000) || null : current.correction,
    };
    const set = current.knowledge_sets as unknown as { product_category: string | null; product_description: string | null } | null;
    // Curation edits change what the engine should learn → the sealed hint
    // is rebuilt from the new plaintext in the same write.
    const hint = buildHintCiphertext({ category: set?.product_category ?? null, ...fields });
    const row: Record<string, unknown> = {
      ...fields,
      hint_encrypted: hint?.ciphertext ?? null,
      hint_iv: hint?.iv ?? null,
      hint_tag: hint?.authTag ?? null,
    };
    if (patch.result_rating !== undefined) {
      row.result_rating = Number.isInteger(patch.result_rating) && patch.result_rating! >= 1 && patch.result_rating! <= 5
        ? patch.result_rating : null;
    }
    if (patch.tags !== undefined) {
      row.tags = (Array.isArray(patch.tags) ? patch.tags : [])
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim().slice(0, 40)).slice(0, 10);
    }
    if (patch.enabled !== undefined) row.enabled = !!patch.enabled;
    const { error } = await supabase.from("knowledge_examples").update(row as never).eq("id", id);
    if (error) return { ok: false, error: "generic" };

    // Re-embed on the new curation text — best-effort; the old vector keeps
    // serving until the new one lands.
    const text = [set?.product_category, set?.product_description?.slice(0, 800),
      fields.prompt_used, fields.what_worked, fields.correction].filter(Boolean).join("\n");
    if (text.trim()) {
      const vectors = await embedTexts(supabase, [text]);
      const v = vectors?.[0];
      if (v) await supabase.from("knowledge_examples").update({ embedding: JSON.stringify(v) as never }).eq("id", id);
    }
    await logAdmin(supabase, "admin.knowledge_example_updated", "knowledge_example", id);
    revalidatePath("/admin/engine");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function deleteKnowledgeExampleAction(id: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { data: row } = await supabase
      .from("knowledge_examples").select("reference_path, generated_path").eq("id", id).maybeSingle();
    const paths = [row?.reference_path, row?.generated_path].filter((p): p is string => !!p);
    if (paths.length) await supabase.storage.from("knowledge").remove(paths);
    const { error } = await supabase.from("knowledge_examples").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAdmin(supabase, "admin.knowledge_example_deleted", "knowledge_example", id);
    revalidatePath("/admin/engine");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/* ── Prompt engine rules ────────────────────────────────────────────────── */

export async function saveEngineRuleAction(input: {
  id?: string; name: string; rule_type: string; content: string;
  priority: number; enabled: boolean;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!encryptionAvailable()) return { ok: false, error: "encryption_unavailable" };
    const name = s(input.name, 120);
    const content = s(input.content, 1000);
    if (!name || !content) return { ok: false, error: "invalid" };
    const ruleType = ["style", "quality", "avoid"].includes(input.rule_type) ? input.rule_type : "style";
    const priority = Math.min(Math.max(Math.trunc(Number(input.priority) || 100), 1), 999);
    const sealed = encryptSecret(content);
    const row = {
      name, rule_type: ruleType, content,
      content_encrypted: sealed.ciphertext, content_iv: sealed.iv, content_tag: sealed.authTag,
      priority, enabled: !!input.enabled,
      updated_at: new Date().toISOString(),
    };
    if (input.id) {
      // Content changes bump the rule's own version counter.
      const { data: prev } = await supabase.from("prompt_engine_rules")
        .select("version, content").eq("id", input.id).maybeSingle();
      if (!prev) return { ok: false, error: "not_found" };
      const { error } = await supabase.from("prompt_engine_rules").update({
        ...row, version: prev.content !== content ? (prev.version ?? 1) + 1 : prev.version,
      } as never).eq("id", input.id);
      if (error) return { ok: false, error: "generic" };
      await logAdmin(supabase, "admin.engine_rule_updated", "prompt_engine_rule", input.id);
    } else {
      const { data: created, error } = await supabase.from("prompt_engine_rules")
        .insert({ ...row, created_by: adminId } as never).select("id").single();
      if (error || !created) return { ok: false, error: "generic" };
      await logAdmin(supabase, "admin.engine_rule_created", "prompt_engine_rule", created.id);
    }
    revalidatePath("/admin/engine");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message === "encryption_key_missing" ? "encryption_unavailable" : "generic" };
  }
}

export async function toggleEngineRuleAction(id: string, enabled: boolean): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("prompt_engine_rules")
      .update({ enabled: !!enabled, updated_at: new Date().toISOString() } as never).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAdmin(supabase, "admin.engine_rule_toggled", "prompt_engine_rule", id, { enabled });
    revalidatePath("/admin/engine");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function deleteEngineRuleAction(id: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("prompt_engine_rules").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAdmin(supabase, "admin.engine_rule_deleted", "prompt_engine_rule", id);
    revalidatePath("/admin/engine");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/* ── Engine versions ────────────────────────────────────────────────────── */

export async function addEngineVersionAction(input: {
  version: string; changelog: string; activate: boolean;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const version = s(input.version, 40);
    if (!version) return { ok: false, error: "invalid" };
    if (input.activate) {
      await supabase.from("prompt_engine_versions").update({ active: false } as never).eq("active", true);
    }
    const { data: created, error } = await supabase.from("prompt_engine_versions").insert({
      version, changelog: s(input.changelog, 2000) || null,
      active: !!input.activate, created_by: adminId,
    } as never).select("id").single();
    if (error || !created) return { ok: false, error: "generic" };
    await logAdmin(supabase, "admin.engine_version_added", "prompt_engine_version", created.id, { version, active: !!input.activate });
    revalidatePath("/admin/engine");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function activateEngineVersionAction(id: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    await supabase.from("prompt_engine_versions").update({ active: false } as never).eq("active", true);
    const { error } = await supabase.from("prompt_engine_versions").update({ active: true } as never).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAdmin(supabase, "admin.engine_version_activated", "prompt_engine_version", id);
    revalidatePath("/admin/engine");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}
