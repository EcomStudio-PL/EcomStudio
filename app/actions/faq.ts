"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { FAQ_TAG } from "@/lib/server/faq";
import { premiereState } from "@/lib/server/pricing-offer";
import {
  deleteFaqCategory, deleteFaqItem, faqDeleted, faqHistory, listFaqAdmin, reorderFaq, restoreFaqVersion,
  saveFaqCategory, saveFaqItem,
  type FaqAdminData, type FaqCategoryInput, type FaqError, type FaqItemInput, type FaqVersion,
} from "@/lib/services/faq";
import type { FaqCategoryRow, FaqItemRow } from "@/lib/faq";

/**
 * FAQ V1 — THE EDITOR'S WRITES. Thin, as the house rule asks: who is asking,
 * the service, the audit log, then everything the change made stale. RLS
 * (admin only) is the lock; requireAdmin only turns "no rows" into a clear
 * "not_admin". Used by Strony WWW → FAQ and by "Edytuj stronę" on /faq,
 * /plany and /o-nas — the same component, the same actions.
 */

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: FaqError | "not_admin"; field?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not_admin");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

/** Every page that shows the base, and the panel. */
function invalidate() {
  revalidateTag(FAQ_TAG);
  for (const path of ["/faq", "/plany", "/plan", "/o-nas", "/kontakt", "/admin/www/baza-faq"]) revalidatePath(path);
}

async function guarded<T>(run: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await run();
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message === "not_admin" ? "not_admin" : "generic" };
  }
}

export type FaqEditorData = FaqAdminData & { premiere: boolean; deleted: FaqVersion[] };

export async function faqEditorDataAction(): Promise<Result<FaqEditorData>> {
  return guarded(async () => {
    const { supabase } = await requireAdmin();
    const data = await listFaqAdmin(supabase);
    const deleted = await faqDeleted(supabase, { items: data.items.map((i) => i.id), categories: data.categories.map((c) => c.id) });
    return { ok: true, data: { ...data, deleted, premiere: premiereState(Date.now()).status === "active" } };
  });
}

export async function saveFaqItemAction(input: FaqItemInput): Promise<Result<FaqItemRow>> {
  return guarded(async () => {
    const { supabase, adminId } = await requireAdmin();
    const res = await saveFaqItem(supabase, input);
    if (!res.ok) return res;
    await logAudit(supabase, {
      actorId: adminId, action: input.id ? "faq.item.update" : "faq.item.create",
      entityType: "faq_item", entityId: res.data.id,
      after: { slug: res.data.slug, visible: res.data.visible, pages: res.data.pages },
    });
    invalidate();
    return res;
  });
}

export async function deleteFaqItemAction(id: string): Promise<Result<FaqItemRow>> {
  return guarded(async () => {
    const { supabase, adminId } = await requireAdmin();
    const res = await deleteFaqItem(supabase, id);
    if (!res.ok) return res;
    await logAudit(supabase, { actorId: adminId, action: "faq.item.delete", entityType: "faq_item", entityId: id, before: { slug: res.data.slug } });
    invalidate();
    return res;
  });
}

export async function saveFaqCategoryAction(input: FaqCategoryInput): Promise<Result<FaqCategoryRow>> {
  return guarded(async () => {
    const { supabase, adminId } = await requireAdmin();
    const res = await saveFaqCategory(supabase, input);
    if (!res.ok) return res;
    await logAudit(supabase, {
      actorId: adminId, action: input.id ? "faq.category.update" : "faq.category.create",
      entityType: "faq_category", entityId: res.data.id, after: { slug: res.data.slug, visible: res.data.visible },
    });
    invalidate();
    return res;
  });
}

export async function deleteFaqCategoryAction(id: string): Promise<Result<FaqCategoryRow>> {
  return guarded(async () => {
    const { supabase, adminId } = await requireAdmin();
    const res = await deleteFaqCategory(supabase, id);
    if (!res.ok) return res;
    await logAudit(supabase, { actorId: adminId, action: "faq.category.delete", entityType: "faq_category", entityId: id, before: { slug: res.data.slug } });
    invalidate();
    return res;
  });
}

export async function reorderFaqAction(kind: "categories" | "items", ids: string[], categoryId?: string): Promise<Result> {
  return guarded(async () => {
    const { supabase, adminId } = await requireAdmin();
    if (kind !== "categories" && kind !== "items") return { ok: false, error: "invalid" };
    const res = await reorderFaq(supabase, kind, Array.isArray(ids) ? ids.slice(0, 1000) : [], categoryId);
    if (!res.ok) return res;
    await logAudit(supabase, { actorId: adminId, action: "faq.reorder", entityType: kind === "items" ? "faq_category" : "faq", entityId: categoryId, after: { count: ids.length } });
    invalidate();
    return res;
  });
}

export async function faqHistoryAction(kind: "item" | "category", id: string): Promise<Result<FaqVersion[]>> {
  return guarded(async () => {
    const { supabase } = await requireAdmin();
    if (kind !== "item" && kind !== "category") return { ok: false, error: "invalid" };
    return { ok: true, data: await faqHistory(supabase, kind, id) };
  });
}

export async function restoreFaqVersionAction(versionId: string): Promise<Result<{ kind: string; id: string }>> {
  return guarded(async () => {
    const { supabase, adminId } = await requireAdmin();
    const res = await restoreFaqVersion(supabase, versionId);
    if (!res.ok) return res;
    await logAudit(supabase, { actorId: adminId, action: "faq.restore", entityType: `faq_${res.data.kind}`, entityId: res.data.id, after: { version: versionId } });
    invalidate();
    return res;
  });
}
