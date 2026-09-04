"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { LAUNCH_FIELDS, type LaunchField } from "@/lib/server/launch-page";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";

/**
 * THE PUBLIC SITE'S OWN ACTIONS.
 *
 * The block-level CRUD already lives in admin-b2b.ts and is reused as-is.
 * What is new here is the page level: the site-wide settings row, and the one
 * piece of setup the launch page needs — a `launch` section seeded from the
 * copy that already exists, so consolidating the two old editors into one
 * never shows an admin an empty form where their text used to be.
 */

type Result = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

// ---------- GLOBAL PUBLIC-SITE SETTINGS ----------

const httpsOrEmpty = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
};

export async function savePublicSiteAction(input: {
  instagramUrl: string; facebookUrl: string;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const instagram = httpsOrEmpty(input.instagramUrl);
    const facebook = httpsOrEmpty(input.facebookUrl);
    // A link the page will hand to a visitor: https or nothing. Rejecting
    // here means the renderer never has to guess.
    if (instagram === null || facebook === null) return { ok: false, error: "invalid_url" };
    const { error } = await supabase.from("app_settings").upsert(
      { key: "public_site", value: { instagram_url: instagram, facebook_url: facebook } as never },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "public_site.saved", entityType: "app_settings", entityId: "public_site",
      after: { instagram: Boolean(instagram), facebook: Boolean(facebook) },
    });
    revalidatePath("/", "layout");
    revalidatePath("/admin/www");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

// ---------- LAUNCH SECTION ----------

const DICTS: Record<string, Record<string, unknown>> = {
  pl: pl.launch as Record<string, unknown>,
  en: (en as typeof pl).launch as Record<string, unknown>,
  de: (de as typeof pl).launch as Record<string, unknown>,
};

/** Seed the launch page's single section from whatever copy already exists:
 *  the old app_settings overrides first, then the shipped translations. */
export async function ensureLaunchSectionAction(pageId: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { count } = await supabase.from("cms_blocks")
      .select("id", { count: "exact", head: true }).eq("page_id", pageId).eq("type", "launch");
    if ((count ?? 0) > 0) return { ok: true };

    const { data: legacy } = await supabase.from("app_settings")
      .select("value").eq("key", "launch_page").maybeSingle();
    const store = (legacy?.value ?? {}) as { published?: Record<string, Record<string, string>> };
    const published = store.published ?? {};

    const fields: Record<string, Record<string, string>> = {};
    for (const field of LAUNCH_FIELDS) {
      const perLocale: Record<string, string> = {};
      for (const locale of ["pl", "en", "de"]) {
        const fromLegacy = published[locale]?.[field];
        const shipped = DICTS[locale]?.[field];
        const value = fromLegacy ?? (typeof shipped === "string" ? shipped : "");
        // hero.image and hero.consent are intentionally empty by default.
        if (value) perLocale[locale] = value;
      }
      if (Object.keys(perLocale).length > 0) fields[field as LaunchField] = perLocale;
    }

    const { error } = await supabase.from("cms_blocks").insert({
      page_id: pageId, type: "launch", sort_order: 0, visible: true,
      content: { fields } as never,
    });
    if (error) return { ok: false, error: "generic" };
    // Deliberately no revalidatePath here: this runs during the editor's own
    // render, where revalidating throws, and that render already reads the row
    // it just created.
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/** Publish, and refresh the page's own public URL as well as the admin list. */
export async function publishPublicPageAction(pageId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data: blocks } = await supabase.from("cms_blocks")
      .select("type, sort_order, visible, content").eq("page_id", pageId).order("sort_order");
    const { data: page, error } = await supabase.from("cms_pages").update({
      published_snapshot: (blocks ?? []) as never,
      status: "published",
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", pageId).select("slug").single();
    if (error || !page) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "cms.published", entityType: "cms_page", entityId: page.slug,
      after: { blocks: (blocks ?? []).length },
    });
    // "/" covers home and the launch page; the slug route covers the rest.
    // The homepage additionally caches its CMS snapshot behind a tag, so a
    // publish must clear that too or the new copy waits out the TTL.
    revalidateTag("landing-content");
    revalidatePath("/", "layout");
    revalidatePath(`/${page.slug}`);
    revalidatePath("/admin/www");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/** Back to draft: the published snapshot stays on the row, it simply stops
 *  being served, so unpublishing is reversible by publishing again. */
export async function unpublishPublicPageAction(pageId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data: page, error } = await supabase.from("cms_pages")
      .update({ status: "draft", updated_at: new Date().toISOString() })
      .eq("id", pageId).select("slug").single();
    if (error || !page) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "cms.unpublished", entityType: "cms_page", entityId: page.slug,
    });
    revalidateTag("landing-content");
    revalidatePath("/", "layout");
    revalidatePath(`/${page.slug}`);
    revalidatePath("/admin/www");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}
