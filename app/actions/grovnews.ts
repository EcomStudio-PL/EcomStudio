"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import type { Json } from "@/lib/database.types";
import {
  ADMIN_GRANT_SOURCES, POST_STATUSES, SLUG_RE, extendExpiry, isUuid, presetExpiry, slugify,
  validatePostInput, type EntitlementSource, type GrantPreset, type PostInputError, type PostStatus,
} from "@/lib/grovnews";

/**
 * GROVNEWS — admin writes. Every action here re-checks the ADMIN ROLE on the
 * server before anything else; the RLS policies in 0119 enforce it a second
 * time underneath. Nothing the browser sends is trusted as-is — ids are
 * checked as uuids, statuses and sources against their lists, dates parsed,
 * text bounded. A customer calling these directly gets "forbidden" and the
 * database would refuse them anyway.
 */

type Fail<E extends string = never> = { ok: false; error: "forbidden" | "invalid" | "generic" | E };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("forbidden");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("forbidden");
  return { supabase, adminId: user.id };
}

const forbidden = (e: unknown) => e instanceof Error && e.message === "forbidden";

/** A post an edition waiting to be sent relies on cannot be unpublished or
 *  renamed (trigger in migration 0121) — said as such, not as "error". */
const inEdition = (e: { message?: string }) => (e.message ?? "").includes("grovnews_post_in_edition");

function revalidateAll() {
  revalidatePath("/admin/newsletter/grovnews", "layout");
  revalidatePath("/grovnews", "layout");
}

/* ── posts ─────────────────────────────────────────────────────────────────── */

export async function savePostAction(id: string | null, raw: unknown):
  Promise<{ ok: true; id: string; slug: string } | Fail<PostInputError | "slug_taken" | "in_edition">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (id !== null && !isUuid(id)) return { ok: false, error: "invalid" };
    const parsed = validatePostInput(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const v = parsed.value;
    const row = {
      title: v.title, slug: v.slug, excerpt: v.excerpt, content: v.content, category_id: v.categoryId,
      tags: v.tags, cover_url: v.coverUrl, sources: v.sources, estimated_read_minutes: v.readMinutes,
      language: v.language, email_summary: v.emailSummary, seo_title: v.seoTitle, seo_description: v.seoDescription,
    };
    const res = id
      ? await supabase.from("grovnews_posts").update(row).eq("id", id).select("id, slug").maybeSingle()
      : await supabase.from("grovnews_posts").insert({ ...row, status: "DRAFT", created_by: adminId }).select("id, slug").single();
    if (res.error) return { ok: false, error: res.error.code === "23505" ? "slug_taken" : inEdition(res.error) ? "in_edition" : "generic" };
    if (!res.data) return { ok: false, error: "invalid" };
    await logAudit(supabase, {
      actorId: adminId, action: id ? "grovnews.post_updated" : "grovnews.post_created",
      entityType: "grovnews_post", entityId: res.data.id, after: { slug: v.slug, title: v.title },
    });
    revalidateAll();
    return { ok: true, id: res.data.id, slug: res.data.slug };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}

/**
 * Publish, back to draft, archive. Publishing stamps `published_at` the first
 * time only, so re-publishing an archived post does not move it to the top of
 * everyone's feed as if it were news.
 */
export async function setPostStatusAction(id: string, status: PostStatus): Promise<{ ok: true } | Fail<"in_edition">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id) || !(POST_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "invalid" };
    const { data: current } = await supabase.from("grovnews_posts").select("status, published_at").eq("id", id).maybeSingle();
    if (!current) return { ok: false, error: "invalid" };
    const patch: { status: PostStatus; published_at?: string } = { status };
    if (status === "PUBLISHED" && !current.published_at) patch.published_at = new Date().toISOString();
    const { error } = await supabase.from("grovnews_posts").update(patch).eq("id", id);
    if (error) return { ok: false, error: inEdition(error) ? "in_edition" : "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.post_status", entityType: "grovnews_post", entityId: id,
      before: { status: current.status }, after: { status },
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}

/* ── categories ────────────────────────────────────────────────────────────── */

export async function saveCategoryAction(id: string | null, input: { name: string; slug?: string; sortOrder?: number }):
  Promise<{ ok: true } | Fail<"slug_taken">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (id !== null && !isUuid(id)) return { ok: false, error: "invalid" };
    const name = String(input?.name ?? "").trim().slice(0, 80);
    const slug = (String(input?.slug ?? "").trim() || slugify(name, 60)).toLowerCase();
    if (!name || !SLUG_RE.test(slug) || slug.length > 60) return { ok: false, error: "invalid" };
    const sortOrder = Number.isFinite(Number(input?.sortOrder)) ? Math.round(Number(input.sortOrder)) : undefined;
    const row = { name, slug, ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}) };
    const { error } = id
      ? await supabase.from("grovnews_categories").update(row).eq("id", id)
      : await supabase.from("grovnews_categories").insert(row);
    if (error) return { ok: false, error: error.code === "23505" ? "slug_taken" : "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: id ? "grovnews.category_updated" : "grovnews.category_created",
      entityType: "grovnews_category", entityId: id ?? undefined, after: { name, slug },
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}

export async function setCategoryActiveAction(id: string, active: boolean): Promise<{ ok: true } | Fail> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    const { error } = await supabase.from("grovnews_categories").update({ is_active: Boolean(active) }).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.category_active", entityType: "grovnews_category", entityId: id,
      after: { active: Boolean(active) },
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}

/** Move a category one place up or down: swap sort orders with its neighbour,
 *  then renumber in steps of ten so ties can never make the order ambiguous. */
export async function moveCategoryAction(id: string, direction: "up" | "down"): Promise<{ ok: true } | Fail> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id) || (direction !== "up" && direction !== "down")) return { ok: false, error: "invalid" };
    const { data } = await supabase.from("grovnews_categories").select("id").order("sort_order").order("name");
    const ids = (data ?? []).map((r) => r.id);
    const i = ids.indexOf(id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return { ok: true };
    [ids[i], ids[j]] = [ids[j], ids[i]];
    for (const [n, cid] of ids.entries()) {
      const { error } = await supabase.from("grovnews_categories").update({ sort_order: (n + 1) * 10 }).eq("id", cid);
      if (error) return { ok: false, error: "generic" };
    }
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.category_moved", entityType: "grovnews_category", entityId: id, after: { direction },
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}

/* ── entitlements ──────────────────────────────────────────────────────────── */

export type UserHit = { id: string; email: string; name: string | null };

/** Find a customer to grant to. Admin-only: profiles are only fully readable
 *  to an admin, and the role is checked here before the query runs. */
export async function searchGrovNewsUsersAction(query: string): Promise<{ ok: true; users: UserHit[] } | Fail> {
  try {
    const { supabase } = await requireAdmin();
    const q = String(query ?? "").trim().slice(0, 120);
    if (q.length < 2) return { ok: true, users: [] };
    // Escape the LIKE wildcards and the or() separators the user typed.
    const safe = q.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[,()]/g, " ");
    const { data, error } = await supabase
      .from("profiles").select("id, email, full_name")
      .or(`email.ilike.%${safe}%,full_name.ilike.%${safe}%`).order("email").limit(10);
    if (error) return { ok: false, error: "generic" };
    return { ok: true, users: (data ?? []).map((p) => ({ id: p.id, email: p.email, name: p.full_name })) };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}

/** Resolve a preset or a custom date into an expiry, or an error. */
function resolveExpiry(preset: GrantPreset, customDate: string | null, from: Date): Date | null | "invalid" {
  const out = presetExpiry(preset, from);
  if (out !== "custom") return out;
  if (!customDate) return "invalid";
  const d = new Date(customDate);
  return Number.isNaN(d.getTime()) || d.getTime() <= from.getTime() ? "invalid" : d;
}

const PRESETS: readonly string[] = ["7", "30", "90", "365", "forever", "custom"];

async function recordEntitlement(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  adminId: string, entitlementId: string, userId: string, action: string, metadata: { [key: string]: Json | undefined },
) {
  // An admin acting on a CUSTOMER'S account: the activity log records whose.
  await supabase.rpc("log_activity", {
    p_workspace_id: null as unknown as string, p_action: `admin.${action}`,
    p_entity_type: "grovnews_entitlement", p_entity_id: entitlementId, p_metadata: metadata, p_on_behalf_of: userId,
  });
  await logAudit(supabase, {
    actorId: adminId, action, entityType: "grovnews_entitlement", entityId: entitlementId, after: metadata,
  });
}

/**
 * Grant access. One row per (user, source): granting the same source again
 * re-activates and re-dates that row rather than stacking duplicates.
 */
export async function grantGrovNewsAction(input: {
  userId: string; source: EntitlementSource; preset: GrantPreset; customDate?: string | null; note?: string | null;
}): Promise<{ ok: true } | Fail> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(input?.userId) || !ADMIN_GRANT_SOURCES.includes(input.source) || !PRESETS.includes(input.preset)) {
      return { ok: false, error: "invalid" };
    }
    const now = new Date();
    const expires = resolveExpiry(input.preset, input.customDate ?? null, now);
    if (expires === "invalid") return { ok: false, error: "invalid" };
    const note = input.note ? String(input.note).trim().slice(0, 1000) || null : null;
    const { data, error } = await supabase.from("grovnews_entitlements").upsert({
      user_id: input.userId, source: input.source, status: "ACTIVE", starts_at: now.toISOString(),
      expires_at: expires ? expires.toISOString() : null, granted_by: adminId,
      ...(note !== null ? { internal_note: note } : {}),
    }, { onConflict: "user_id,source" }).select("id").single();
    if (error || !data) return { ok: false, error: "generic" };
    await recordEntitlement(supabase, adminId, data.id, input.userId, "grovnews.access_granted", {
      source: input.source, preset: input.preset, expires_at: expires ? expires.toISOString() : null,
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}

type EntitlementChange =
  | { kind: "extend"; days: number }
  | { kind: "setExpiry"; preset: GrantPreset; customDate?: string | null }
  | { kind: "revoke" }
  | { kind: "restore" }
  | { kind: "note"; note: string };

/** Every change to an existing entitlement, by id. The target row is read
 *  first, so the user id recorded in the log is the row's own — never one the
 *  browser supplied. */
export async function updateGrovNewsEntitlementAction(id: string, change: EntitlementChange): Promise<{ ok: true } | Fail> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id) || !change || typeof change !== "object") return { ok: false, error: "invalid" };
    const { data: row } = await supabase.from("grovnews_entitlements")
      .select("id, user_id, status, starts_at, expires_at").eq("id", id).maybeSingle();
    if (!row) return { ok: false, error: "invalid" };

    const now = new Date();
    let patch: { status?: string; expires_at?: string | null; internal_note?: string | null; starts_at?: string };
    switch (change.kind) {
      case "extend": {
        if (![7, 30, 90, 365].includes(change.days)) return { ok: false, error: "invalid" };
        const next = extendExpiry(row.expires_at, change.days, now);
        // Extending re-opens one that was explicitly ended; it never quietly
        // undoes a revoke — that takes "restore", on purpose.
        patch = { expires_at: next ? next.toISOString() : null, ...(row.status === "EXPIRED" ? { status: "ACTIVE" } : {}) };
        break;
      }
      case "setExpiry": {
        if (!PRESETS.includes(change.preset)) return { ok: false, error: "invalid" };
        const exp = resolveExpiry(change.preset, change.customDate ?? null, now);
        if (exp === "invalid") return { ok: false, error: "invalid" };
        // The window must stay valid: a start in the future keeps its start.
        if (exp && exp.getTime() <= new Date(row.starts_at).getTime()) return { ok: false, error: "invalid" };
        patch = { expires_at: exp ? exp.toISOString() : null };
        break;
      }
      case "revoke": patch = { status: "REVOKED" }; break;
      case "restore": patch = { status: "ACTIVE" }; break;
      case "note": patch = { internal_note: String(change.note ?? "").trim().slice(0, 1000) || null }; break;
      default: return { ok: false, error: "invalid" };
    }
    const { error } = await supabase.from("grovnews_entitlements").update(patch).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await recordEntitlement(supabase, adminId, id, row.user_id, `grovnews.access_${change.kind}`, {
      ...patch, before: { status: row.status, expires_at: row.expires_at },
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}
