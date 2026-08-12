"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import type { Json } from "@/lib/database.types";

type Result = { ok: boolean; error?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

// ---------- CRM ----------

export async function blockUserAction(userId: string, blocked: boolean): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (userId === adminId) return { ok: false, error: "self" };
    const { error } = await supabase.from("profiles").update({ blocked }).eq("id", userId);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: blocked ? "user.blocked" : "user.unblocked",
      entityType: "profile", entityId: userId, after: { blocked },
    });
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function assignManagerAction(userId: string, managerId: string | null): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { error } = await supabase.from("profiles").update({ account_manager_id: managerId }).eq("id", userId);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "user.manager_assigned",
      entityType: "profile", entityId: userId, after: { account_manager_id: managerId },
    });
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function saveCrmNoteAction(input: {
  id?: string; userId: string; body: string; pinned: boolean; reminderDate?: string | null;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!input.body.trim()) return { ok: false, error: "invalid" };
    const row = {
      user_id: input.userId, body: input.body.trim(), pinned: input.pinned,
      reminder_date: input.reminderDate || null,
    };
    const { error } = input.id
      ? await supabase.from("crm_notes").update(row).eq("id", input.id)
      : await supabase.from("crm_notes").insert({ ...row, author_id: adminId });
    if (error) return { ok: false, error: "generic" };
    revalidatePath(`/admin/users/${input.userId}`);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function deleteCrmNoteAction(noteId: string, userId: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("crm_notes").delete().eq("id", noteId);
    if (error) return { ok: false, error: "generic" };
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

// ---------- SERVICE CATALOG ----------

export async function saveServiceAction(input: {
  id?: string; slug: string; name: string; category: string; service_type: string; unit: string;
  credits_cost: number; api_cost_usd_micros: number; sale_value_cents: number;
  min_margin_percent: number; markup_percent: number | null; plan_slugs: string[] | null;
  enabled: boolean; featured: boolean; maintenance_mode: boolean; sort_order: number;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!input.slug.trim() || !input.name.trim() || input.credits_cost < 0) return { ok: false, error: "invalid" };
    const row = {
      slug: input.slug.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
      name: input.name.trim(), category: input.category, service_type: input.service_type,
      unit: input.unit, credits_cost: input.credits_cost, api_cost_usd_micros: input.api_cost_usd_micros,
      sale_value_cents: input.sale_value_cents, min_margin_percent: input.min_margin_percent,
      markup_percent: input.markup_percent, plan_slugs: input.plan_slugs,
      enabled: input.enabled, featured: input.featured, maintenance_mode: input.maintenance_mode,
      sort_order: input.sort_order,
    };
    const { error } = input.id
      ? await supabase.from("service_catalog").update(row).eq("id", input.id)
      : await supabase.from("service_catalog").insert(row);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: input.id ? "service.updated" : "service.created",
      entityType: "service", entityId: input.id ?? row.slug, after: row as unknown as Record<string, unknown>,
    });
    revalidatePath("/admin/services");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

// ---------- FEATURE FLAGS ----------

export async function saveFlagAction(input: {
  id?: string; flag: string; enabled: boolean; plans: string[] | null; roles: string[] | null;
  rollout_percent: number | null; description: string | null;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!input.flag.trim()) return { ok: false, error: "invalid" };
    const row = {
      flag: input.flag.trim(), enabled: input.enabled, plans: input.plans, roles: input.roles,
      rollout_percent: input.rollout_percent, description: input.description,
    };
    const { error } = input.id
      ? await supabase.from("feature_flags").update(row).eq("id", input.id)
      : await supabase.from("feature_flags").insert(row);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "flag.saved", entityType: "feature_flag",
      entityId: row.flag, after: row as unknown as Record<string, unknown>,
    });
    revalidatePath("/admin/system");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function deleteFlagAction(id: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("feature_flags").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/system");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

// ---------- MEDIA LIBRARY ----------

const SAFE_URL = /^https:\/\//;

export async function saveMediaAssetAction(input: {
  id?: string; kind: "image" | "video" | "file"; storagePath?: string | null;
  externalUrl?: string | null; posterUrl?: string | null; alt?: string; title?: string;
  mime?: string; sizeBytes?: number;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!input.storagePath && !input.externalUrl) return { ok: false, error: "invalid" };
    if (input.externalUrl && !SAFE_URL.test(input.externalUrl)) return { ok: false, error: "invalid_url" };
    if (input.posterUrl && !SAFE_URL.test(input.posterUrl)) return { ok: false, error: "invalid_url" };
    const row = {
      kind: input.kind, storage_path: input.storagePath ?? null, external_url: input.externalUrl ?? null,
      poster_url: input.posterUrl ?? null, alt: input.alt ?? null, title: input.title ?? null,
      mime: input.mime ?? null, size_bytes: input.sizeBytes ?? null,
    };
    const { error } = input.id
      ? await supabase.from("media_assets").update(row).eq("id", input.id)
      : await supabase.from("media_assets").insert({ ...row, created_by: adminId });
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/media");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function deleteMediaAssetAction(id: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { data: asset } = await supabase.from("media_assets").select("storage_path").eq("id", id).maybeSingle();
    if (asset?.storage_path) await supabase.storage.from("media").remove([asset.storage_path]);
    const { error } = await supabase.from("media_assets").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/media");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

// ---------- CMS ----------

export async function saveCmsBlockAction(input: {
  id?: string; pageId: string; type: string; content: Json; visible: boolean; sortOrder?: number;
}): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    if (input.id) {
      const { error } = await supabase.from("cms_blocks")
        .update({ type: input.type, content: input.content, visible: input.visible, updated_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) return { ok: false, error: "generic" };
    } else {
      const { count } = await supabase.from("cms_blocks")
        .select("id", { count: "exact", head: true }).eq("page_id", input.pageId);
      const { error } = await supabase.from("cms_blocks").insert({
        page_id: input.pageId, type: input.type, content: input.content,
        visible: input.visible, sort_order: input.sortOrder ?? (count ?? 0),
      });
      if (error) return { ok: false, error: "generic" };
    }
    revalidatePath("/admin/www");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function moveCmsBlockAction(blockId: string, direction: "up" | "down"): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { data: block } = await supabase.from("cms_blocks").select("id, page_id, sort_order").eq("id", blockId).maybeSingle();
    if (!block) return { ok: false, error: "not_found" };
    const { data: siblings } = await supabase.from("cms_blocks")
      .select("id, sort_order").eq("page_id", block.page_id).order("sort_order");
    if (!siblings) return { ok: false, error: "generic" };
    const idx = siblings.findIndex((s) => s.id === block.id);
    const swapWith = direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
    if (!swapWith) return { ok: true };
    // Normalize orders to indexes, then swap the two neighbours.
    await Promise.all(siblings.map((s, i) => {
      let order = i;
      if (s.id === block.id) order = direction === "up" ? idx - 1 : idx + 1;
      if (s.id === swapWith.id) order = idx;
      return supabase.from("cms_blocks").update({ sort_order: order }).eq("id", s.id);
    }));
    revalidatePath("/admin/www");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function duplicateCmsBlockAction(blockId: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { data: block } = await supabase.from("cms_blocks").select("*").eq("id", blockId).maybeSingle();
    if (!block) return { ok: false, error: "not_found" };
    const { error } = await supabase.from("cms_blocks").insert({
      page_id: block.page_id, type: block.type, content: block.content,
      visible: false, sort_order: block.sort_order + 1,
    });
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/www");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function deleteCmsBlockAction(blockId: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("cms_blocks").delete().eq("id", blockId);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/www");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/** Publish = copy the CURRENT block list into an immutable snapshot the
 *  public site renders from. Draft edits never touch production until the
 *  next publish. */
export async function publishCmsPageAction(pageId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data: blocks } = await supabase.from("cms_blocks")
      .select("type, sort_order, visible, content")
      .eq("page_id", pageId).order("sort_order");
    const { data: page, error } = await supabase.from("cms_pages")
      .update({
        published_snapshot: (blocks ?? []) as never,
        status: "published",
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", pageId).select("slug").single();
    if (error || !page) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "cms.published", entityType: "cms_page", entityId: page.slug,
      after: { blocks: (blocks ?? []).length },
    });
    revalidatePath("/");
    revalidatePath("/admin/www");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

// ---------- INSPIRATIONS ----------

export async function saveInspirationAction(input: {
  id?: string; title: string; description: string | null; category: string; use_case: string | null;
  prompt: string; negative_prompt: string | null; model_slug: string | null; format: string | null;
  tags: string[]; premium: boolean; featured: boolean; sort_order: number;
  status: "draft" | "published"; locale: string | null;
  before_url: string | null; after_urls: string[]; video_url: string | null;
}): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    if (!input.title.trim() || !input.prompt.trim()) return { ok: false, error: "invalid" };
    for (const u of [input.before_url, input.video_url, ...input.after_urls]) {
      if (u && !SAFE_URL.test(u)) return { ok: false, error: "invalid_url" };
    }
    const row = {
      title: input.title.trim(), description: input.description, category: input.category,
      use_case: input.use_case, prompt: input.prompt, negative_prompt: input.negative_prompt,
      model_slug: input.model_slug, format: input.format, tags: input.tags,
      premium: input.premium, featured: input.featured, sort_order: input.sort_order,
      status: input.status, locale: input.locale, before_url: input.before_url,
      after_urls: input.after_urls, video_url: input.video_url, updated_at: new Date().toISOString(),
    };
    const { error } = input.id
      ? await supabase.from("inspirations").update(row).eq("id", input.id)
      : await supabase.from("inspirations").insert(row);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/inspirations");
    revalidatePath("/inspirations");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function deleteInspirationAction(id: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("inspirations").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/inspirations");
    revalidatePath("/inspirations");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function seedHomeBlocksAction(pageId: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { DEFAULT_HOME_BLOCKS } = await import("@/lib/cms-defaults");
    const { count } = await supabase.from("cms_blocks").select("id", { count: "exact", head: true }).eq("page_id", pageId);
    if ((count ?? 0) > 0) return { ok: false, error: "not_empty" };
    const { error } = await supabase.from("cms_blocks").insert(
      DEFAULT_HOME_BLOCKS.map((b) => ({
        page_id: pageId, type: b.type, sort_order: b.sort_order,
        visible: b.visible, content: b.content as never,
      }))
    );
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/www");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function createCmsPageAction(slug: string, title: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/(^-|-$)/g, "");
    if (!clean || !title.trim()) return { ok: false, error: "invalid" };
    const { error } = await supabase.from("cms_pages").insert({ slug: clean, title: title.trim() });
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/www");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}
