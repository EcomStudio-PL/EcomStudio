"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { cleanPatch, readRuleHistory, testCaseSet, type RulePatch } from "@/lib/server/grovshot-v2/knowledge";
import { cleanRuleText, slug } from "@/lib/grovshot-v2/knowledge";

/**
 * GROVBASE SHOT V2 — the admin's actions on the knowledge base (/admin/ai/
 * wiedza → GrovShot V2). Admin only, checked on every call; the database
 * checks it again (RLS is_admin(), the review/publish functions) and logs
 * every review, publish and rollback. Nothing here changes a prompt until a
 * VERSION is published, and an order keeps the version it started with.
 */

type Result = { ok: boolean; error?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}
const failure = (e: unknown) => (e instanceof Error && (e.message === "unauthenticated" || e.message === "not_admin") ? "forbidden" : "generic");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const done = () => revalidatePath("/admin/ai/wiedza");

/** Approve, reject, retire (cofnięcie) or reopen rules — one or many. */
export async function reviewRulesAction(ids: string[], status: string, note: string): Promise<Result & { count?: number }> {
  try {
    const { supabase } = await requireAdmin();
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every((x) => UUID.test(x))) return { ok: false, error: "invalid_input" };
    if (!["approved", "rejected", "retired", "pending"].includes(status)) return { ok: false, error: "invalid_input" };
    const { data, error } = await supabase.rpc("grovshot_knowledge_review", { p_ids: ids, p_status: status, p_note: note.trim().slice(0, 1000) });
    if (error) return { ok: false, error: "generic" };
    done();
    return { ok: true, count: typeof data === "number" ? data : 0 };
  } catch (e) { return { ok: false, error: failure(e) }; }
}

/** Edit a PENDING rule (scope, stages, topic, delivery, text). */
export async function updateRuleAction(id: string, patch: RulePatch): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!UUID.test(id)) return { ok: false, error: "invalid_input" };
    const clean = cleanPatch(patch);
    if (!clean || Object.keys(clean).length === 0) return { ok: false, error: "invalid_input" };
    const { data: rule } = await supabase.from("knowledge_rules").select("status, delivery, stages, scope_kind, scope_values").eq("id", id).maybeSingle();
    if (!rule) return { ok: false, error: "not_found" };
    if (rule.status !== "pending") return { ok: false, error: "rule_immutable" };
    const next = { delivery: rule.delivery, stages: rule.stages, scope_kind: rule.scope_kind, scope_values: rule.scope_values, ...clean } as Record<string, unknown>;
    if (next.delivery === "knowledge" && (next.stages as string[]).length === 0) return { ok: false, error: "stages_required" };
    if (next.scope_kind !== "global" && (next.scope_values as string[]).length === 0) return { ok: false, error: "scope_values_required" };
    const { error } = await supabase.from("knowledge_rules").update(clean as never).eq("id", id).eq("status", "pending");
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, { actorId: adminId, action: "grovshot_v2.knowledge_rule_edited", entityType: "knowledge_rule", entityId: id, after: clean });
    await supabase.rpc("log_activity", { p_workspace_id: null as unknown as string, p_action: "admin.knowledge_rule_edited", p_entity_type: "knowledge_rule", p_entity_id: id, p_metadata: { fields: Object.keys(clean) } });
    done();
    return { ok: true };
  } catch (e) { return { ok: false, error: failure(e) }; }
}

/** Change an APPROVED rule: a new pending revision that supersedes it once
 *  approved (the approved text itself never changes). */
export async function reviseRuleAction(id: string, patch: RulePatch): Promise<Result & { id?: string }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!UUID.test(id)) return { ok: false, error: "invalid_input" };
    const clean = cleanPatch(patch);
    if (!clean) return { ok: false, error: "invalid_input" };
    const { data: base } = await supabase.from("knowledge_rules").select("*").eq("id", id).maybeSingle();
    if (!base) return { ok: false, error: "not_found" };
    const { data: latest } = await supabase.from("knowledge_rules").select("revision").eq("rule_key", base.rule_key).order("revision", { ascending: false }).limit(1);
    const row = {
      rule_key: base.rule_key, revision: (latest?.[0]?.revision ?? base.revision) + 1, source_id: base.source_id, example_id: base.example_id,
      origin: "admin", section: base.section, page: base.page, position: base.position, source_date: new Date().toISOString().slice(0, 10),
      topic: base.topic, stages: base.stages, scope_kind: base.scope_kind, scope_values: base.scope_values, delivery: base.delivery,
      is_correction: base.is_correction, title: base.title, body: base.body, body_sha256: base.body_sha256,
      ...clean, supersedes: [base.id], status: "pending", created_by: adminId,
    };
    const { data, error } = await supabase.from("knowledge_rules").insert(row as never).select("id").single();
    if (error || !data) return { ok: false, error: "generic" };
    await supabase.rpc("log_activity", { p_workspace_id: null as unknown as string, p_action: "admin.knowledge_rule_revised", p_entity_type: "knowledge_rule", p_entity_id: id, p_metadata: { revision: row.revision, new_id: data.id } });
    done();
    return { ok: true, id: data.id };
  } catch (e) { return { ok: false, error: failure(e) }; }
}

/** Publish the approved rules as the next knowledge version (new orders use it). */
export async function publishKnowledgeAction(changelog: string): Promise<Result & { version?: number; rules?: number; delivered?: number }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data, error } = await supabase.rpc("grovshot_knowledge_publish", { p_changelog: changelog.trim().slice(0, 2000) });
    if (error) return { ok: false, error: "generic" };
    const out = (data ?? {}) as { error?: string; version?: number; rules?: number; delivered?: number };
    if (out.error) return { ok: false, error: out.error };
    await logAudit(supabase, { actorId: adminId, action: "grovshot_v2.knowledge_published", entityType: "knowledge_version", entityId: String(out.version ?? ""), after: out as Record<string, unknown> });
    done();
    revalidatePath("/admin/ai/[tool]", "page");
    return { ok: true, version: out.version, rules: out.rules, delivered: out.delivered };
  } catch (e) { return { ok: false, error: failure(e) }; }
}

/** Activate an earlier version (rollback) — new orders use it from now on. */
export async function activateKnowledgeVersionAction(versionId: string): Promise<Result & { version?: number }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!UUID.test(versionId)) return { ok: false, error: "invalid_input" };
    const { data, error } = await supabase.rpc("grovshot_knowledge_activate", { p_version_id: versionId });
    if (error) return { ok: false, error: "generic" };
    const out = (data ?? {}) as { version?: number };
    await logAudit(supabase, { actorId: adminId, action: "grovshot_v2.knowledge_activated", entityType: "knowledge_version", entityId: versionId, after: out as Record<string, unknown> });
    done();
    revalidatePath("/admin/ai/[tool]", "page");
    return { ok: true, version: out.version };
  } catch (e) { return { ok: false, error: failure(e) }; }
}

/** One rule's history (reviews, edits, revisions). */
export async function ruleHistoryAction(id: string) {
  try {
    const { supabase } = await requireAdmin();
    if (!UUID.test(id)) return { ok: false as const, error: "invalid_input" };
    return { ok: true as const, history: await readRuleHistory(supabase, id) };
  } catch (e) { return { ok: false as const, error: failure(e) }; }
}

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_IMAGE = 10 * 1024 * 1024;
const str = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").trim().slice(0, max);

/** A test case (sekcja „Przypadki testowe”): product, photos, prompt, result,
 *  rating, what worked / failed, the correction and its scope. Saved as
 *  PENDING; a negatively rated case is never a pattern. */
export async function createTestCaseAction(form: FormData): Promise<Result & { id?: string }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const setId = await testCaseSet(supabase, adminId);
    if (!setId) return { ok: false, error: "generic" };
    const ratingRaw = Number(form.get("rating"));
    const rating = Number.isInteger(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : null;
    const category = str(form, "category", 120);
    const description = str(form, "description", 4000);
    if (!category || !description) return { ok: false, error: "invalid_input" };
    const scopeKind = str(form, "scope_kind", 20);
    const scope = ["global", "category", "recipe", "shot_type", "product_type"].includes(scopeKind)
      ? { kind: scopeKind, values: str(form, "scope_values", 400).split(",").map((v) => v.trim().toLowerCase()).filter(Boolean).slice(0, 20), stages: form.getAll("stages").map(String).filter((s) => ["validate", "card", "plan", "prompt", "qc"].includes(s)) }
      : null;
    const id = crypto.randomUUID();
    const upload = async (key: string, kind: "ref" | "gen") => {
      const f = form.get(key);
      if (!(f instanceof File) || f.size === 0) return null;
      const ext = IMAGE_TYPES[f.type];
      if (!ext || f.size > MAX_IMAGE) throw new Error("bad_image");
      const path = `sets/${setId}/cases/${id}-${kind}.${ext}`;
      const { error } = await supabase.storage.from("knowledge").upload(path, Buffer.from(await f.arrayBuffer()), { contentType: f.type, upsert: true });
      return error ? null : path;
    };
    let refPath: string | null; let genPath: string | null;
    try { [refPath, genPath] = await Promise.all([upload("reference", "ref"), upload("result", "gen")]); }
    catch { return { ok: false, error: "bad_image" }; }
    const { error } = await supabase.from("knowledge_examples").insert({
      id, set_id: setId, source_kind: "manual", review_status: "pending", product_category: category, description,
      prompt_used: str(form, "prompt", 4000) || null, result_rating: rating, what_worked: str(form, "worked", 1000) || null,
      what_failed: str(form, "failed", 1000) || null, correction: str(form, "correction", 1000) || null, correction_scope: scope,
      reference_path: refPath, generated_path: genPath, created_by: adminId, tags: ["grovshot_v2"],
    } as never);
    if (error) return { ok: false, error: "generic" };
    await supabase.rpc("log_activity", { p_workspace_id: null as unknown as string, p_action: "admin.knowledge_case_created", p_entity_type: "knowledge_example", p_entity_id: id, p_metadata: { category, rating } });
    done();
    return { ok: true, id };
  } catch (e) { return { ok: false, error: failure(e) }; }
}

/** Accept / reject a test case, or change its category. */
export async function updateTestCaseAction(id: string, patch: { status?: string; category?: string }): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!UUID.test(id)) return { ok: false, error: "invalid_input" };
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) {
      if (!["pending", "approved", "rejected"].includes(patch.status)) return { ok: false, error: "invalid_input" };
      update.review_status = patch.status; update.reviewed_by = adminId; update.reviewed_at = new Date().toISOString();
    }
    if (patch.category !== undefined) { const c = patch.category.trim().slice(0, 120); if (!c) return { ok: false, error: "invalid_input" }; update.product_category = c; }
    if (Object.keys(update).length === 0) return { ok: false, error: "invalid_input" };
    const { error } = await supabase.from("knowledge_examples").update(update as never).eq("id", id).eq("source_kind", "manual");
    if (error) return { ok: false, error: "generic" };
    await supabase.rpc("log_activity", { p_workspace_id: null as unknown as string, p_action: "admin.knowledge_case_reviewed", p_entity_type: "knowledge_example", p_entity_id: id, p_metadata: update as never });
    done();
    return { ok: true };
  } catch (e) { return { ok: false, error: failure(e) }; }
}

/** „Zamień poprawkę w regułę”: the case's correction as a PENDING rule in
 *  the scope the admin chose (never global by default, never published here). */
export async function ruleFromTestCaseAction(id: string, patch: RulePatch): Promise<Result & { ruleId?: string }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!UUID.test(id)) return { ok: false, error: "invalid_input" };
    const { data: ex } = await supabase.from("knowledge_examples").select("id, product_category, correction, correction_scope, created_at").eq("id", id).maybeSingle();
    if (!ex || !ex.correction) return { ok: false, error: "no_correction" };
    const scope = (ex.correction_scope ?? {}) as { kind?: string; values?: string[]; stages?: string[] };
    const clean = cleanPatch({
      title: patch.title ?? `Korekta z testu: ${ex.product_category ?? ""}`.slice(0, 200),
      body: patch.body ?? ex.correction,
      topic: patch.topic ?? "errors",
      stages: patch.stages ?? (scope.stages?.length ? scope.stages : ["plan", "prompt"]),
      scope_kind: patch.scope_kind ?? (scope.kind || "category"),
      scope_values: patch.scope_values ?? (scope.values?.length ? scope.values : (ex.product_category ? [ex.product_category.toLowerCase()] : [])),
      delivery: patch.delivery ?? "knowledge", is_correction: true,
    });
    if (!clean || !clean.body) return { ok: false, error: "invalid_input" };
    if ((clean.scope_kind as string) !== "global" && (clean.scope_values as string[]).length === 0) return { ok: false, error: "scope_values_required" };
    const body = clean.body as string;
    const { data, error } = await supabase.from("knowledge_rules").insert({
      rule_key: `case:${slug(ex.product_category ?? "test", 30)}:${String(ex.id).slice(0, 8)}`, revision: 1, example_id: ex.id, origin: "test_case",
      section: "Przypadki testowe", position: 0, source_date: String(ex.created_at).slice(0, 10), ...clean,
      body_sha256: createHash("sha256").update(body, "utf8").digest("hex"), status: "pending", created_by: adminId,
    } as never).select("id").single();
    if (error || !data) return { ok: false, error: error?.code === "23505" ? "rule_exists" : "generic" };
    await supabase.rpc("log_activity", { p_workspace_id: null as unknown as string, p_action: "admin.knowledge_rule_from_case", p_entity_type: "knowledge_rule", p_entity_id: data.id, p_metadata: { example_id: ex.id } });
    done();
    return { ok: true, ruleId: data.id };
  } catch (e) { return { ok: false, error: failure(e) }; }
}

/** A rule an admin writes directly (e.g. after a test) — pending like any other. */
export async function createRuleAction(patch: RulePatch): Promise<Result & { id?: string }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const clean = cleanPatch({ delivery: "knowledge", topic: "errors", scope_kind: "global", stages: ["plan", "prompt"], ...patch });
    if (!clean || !clean.title || !clean.body) return { ok: false, error: "invalid_input" };
    if (clean.delivery === "knowledge" && (clean.stages as string[]).length === 0) return { ok: false, error: "stages_required" };
    if (clean.scope_kind !== "global" && (clean.scope_values as string[]).length === 0) return { ok: false, error: "scope_values_required" };
    const { data, error } = await supabase.from("knowledge_rules").insert({
      rule_key: `admin:${slug(cleanRuleText(String(clean.title)), 50)}:${Date.now().toString(36)}`, revision: 1, origin: "admin",
      section: "Reguły admina", position: 0, source_date: new Date().toISOString().slice(0, 10), ...clean, status: "pending", created_by: adminId,
    } as never).select("id").single();
    if (error || !data) return { ok: false, error: "generic" };
    await supabase.rpc("log_activity", { p_workspace_id: null as unknown as string, p_action: "admin.knowledge_rule_created", p_entity_type: "knowledge_rule", p_entity_id: data.id, p_metadata: {} });
    done();
    return { ok: true, id: data.id };
  } catch (e) { return { ok: false, error: failure(e) }; }
}
