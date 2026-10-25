"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import type { Json } from "@/lib/database.types";
import {
  validateAnnouncement, type AnnouncementAudience, type AnnouncementDraft, type AnnouncementError,
} from "@/lib/notifications/announcement";

/**
 * KOMUNIKATY — the admin's side. Every action re-checks the role here (the
 * admin layout is not a security boundary), every SQL function re-checks it
 * again (is_admin), and every write leaves an audit_logs row. The audience
 * is resolved by the DATABASE at publication, never from a list the browser
 * sends: a plan means exactly the customers on that plan at that moment.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; fields?: AnnouncementError[] };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only what the database's resolver reads — never a stray field. */
function cleanAudience(a: AnnouncementAudience): Json {
  switch (a.kind) {
    case "plans": return { kind: "plans", plan_ids: [...new Set(a.plan_ids)].filter((id) => UUID.test(id)) };
    case "user": return { kind: "user", user_id: a.user_id };
    default: return { kind: a.kind };
  }
}

/** How many customers this audience is right now (the preview's figure). */
export async function audienceCountAction(audience: AnnouncementAudience): Promise<Result<{ count: number }>> {
  try {
    const { supabase } = await requireAdmin();
    const { data, error } = await supabase.rpc("announcement_audience_count", { p_audience: cleanAudience(audience) });
    if (error || typeof data !== "number") return { ok: false, error: "generic" };
    return { ok: true, count: data };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/** One customer by e-mail, for "Konkretny użytkownik". At most five matches. */
export async function findUserByEmailAction(query: string): Promise<Result<{ users: { id: string; email: string; name: string | null }[] }>> {
  try {
    const { supabase } = await requireAdmin();
    const q = query.trim().toLowerCase().replace(/[%_,()]/g, "");
    if (q.length < 3) return { ok: true, users: [] };
    const { data } = await supabase.from("profiles").select("id, email, full_name").ilike("email", `%${q}%`).limit(5);
    return { ok: true, users: (data ?? []).map((u) => ({ id: u.id, email: u.email, name: u.full_name })) };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/** What the list shows under "Odbiorcy", written down at save time. */
async function audienceLabel(
  supabase: Awaited<ReturnType<typeof createClient>>, a: AnnouncementAudience,
): Promise<string> {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  if (a.kind === "all") return t("comm.ann.aud.all");
  if (a.kind === "no_plan") return t("comm.ann.aud.noPlan");
  if (a.kind === "user") {
    const { data } = await supabase.from("profiles").select("email").eq("id", a.user_id).maybeSingle();
    return t("comm.ann.aud.userLabel", { email: data?.email ?? "—" });
  }
  const { data } = await supabase.from("subscription_plans").select("id, name").in("id", a.plan_ids);
  return t("comm.ann.aud.plansLabel", { plans: (data ?? []).map((p) => p.name).join(", ") || "—" });
}

export async function saveAnnouncementAction(draft: AnnouncementDraft): Promise<Result<{ id: string; status: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const fields = validateAnnouncement(draft);
    if (fields.length > 0) return { ok: false, error: "invalid", fields };
    if (draft.audience.kind === "user") {
      const { data: target } = await supabase.from("profiles").select("id").eq("id", draft.audience.user_id).maybeSingle();
      if (!target) return { ok: false, error: "invalid", fields: ["user"] };
    }
    if (draft.audience.kind === "plans") {
      const { data: plans } = await supabase.from("subscription_plans").select("id").in("id", draft.audience.plan_ids);
      if ((plans ?? []).length !== new Set(draft.audience.plan_ids).size) return { ok: false, error: "invalid", fields: ["plans"] };
    }
    const label = draft.ctaLabel.trim();
    const href = draft.ctaHref.trim();
    const publishAt = draft.mode === "schedule" ? new Date(draft.publishAt as string).toISOString()
      : draft.mode === "now" ? new Date().toISOString() : null;
    const { data: row, error } = await supabase.from("admin_announcements").insert({
      title: draft.title.trim(),
      body: draft.body.trim(),
      cta_label: label || null,
      cta_href: href || null,
      priority: draft.priority,
      audience: cleanAudience(draft.audience),
      audience_label: await audienceLabel(supabase, draft.audience),
      status: draft.mode === "draft" ? "draft" : "scheduled",
      publish_at: publishAt,
      expires_at: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
      created_by: adminId,
    }).select("id, status").single();
    if (error || !row) return { ok: false, error: "generic" };
    let status = row.status;
    if (draft.mode === "now") {
      const { data: done } = await supabase.rpc("announcement_process", { p_id: row.id });
      const s = (done as { status?: string } | null)?.status;
      if (s) status = s;
    }
    await logAudit(supabase, {
      actorId: adminId,
      action: draft.mode === "now" ? "announcement.published" : draft.mode === "schedule" ? "announcement.scheduled" : "announcement.drafted",
      entityType: "admin_announcement", entityId: row.id,
      after: { title: draft.title.trim(), priority: draft.priority, audience: draft.audience.kind, publish_at: publishAt, expires_at: draft.expiresAt },
    });
    revalidatePath("/admin/communication/komunikaty");
    return { ok: true, id: row.id, status };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/** A draft goes out now (the audience is resolved at this moment). */
export async function publishDraftAction(id: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!UUID.test(id)) return { ok: false, error: "invalid" };
    const { data: row } = await supabase.from("admin_announcements").select("id, status, expires_at").eq("id", id).maybeSingle();
    if (!row || row.status !== "draft") return { ok: false, error: "not_draft" };
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return { ok: false, error: "expired" };
    const now = new Date().toISOString();
    const { error } = await supabase.from("admin_announcements")
      .update({ status: "scheduled", publish_at: now, updated_at: now }).eq("id", id).eq("status", "draft");
    if (error) return { ok: false, error: "generic" };
    await supabase.rpc("announcement_process", { p_id: id });
    await logAudit(supabase, { actorId: adminId, action: "announcement.published", entityType: "admin_announcement", entityId: id });
    revalidatePath("/admin/communication/komunikaty");
    return { ok: true };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/** Gone from every recipient's bell and bar; kept here with its read count. */
export async function withdrawAnnouncementAction(id: string): Promise<Result<{ removed: number }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!UUID.test(id)) return { ok: false, error: "invalid" };
    const { data, error } = await supabase.rpc("announcement_withdraw", { p_id: id });
    if (error) return { ok: false, error: "generic" };
    const res = (data ?? {}) as { status?: string; removed?: number; reads?: number };
    if (res.status === "not_found") return { ok: false, error: "not_found" };
    await logAudit(supabase, {
      actorId: adminId, action: "announcement.withdrawn", entityType: "admin_announcement", entityId: id,
      after: { removed: res.removed ?? 0, reads: res.reads ?? 0 },
    });
    revalidatePath("/admin/communication/komunikaty");
    return { ok: true, removed: res.removed ?? 0 };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}
