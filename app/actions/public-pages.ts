"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { LAUNCH_FIELDS, launchDefault, launchDefaultsFrom, type LaunchField } from "@/lib/server/launch-page";
import { ensureLaunchFieldObjects } from "@/lib/services/cms";
import { canonicalJson, type CmsBlockContent, type LocaleText } from "@/lib/cms";
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
  instagramUrl: string; facebookUrl: string; linkedinUrl: string; xUrl: string;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const instagram = httpsOrEmpty(input.instagramUrl);
    const facebook = httpsOrEmpty(input.facebookUrl);
    const linkedin = httpsOrEmpty(input.linkedinUrl);
    const x = httpsOrEmpty(input.xUrl);
    // A link the page will hand to a visitor: https or nothing. Rejecting
    // here means the renderer never has to guess.
    if (instagram === null || facebook === null || linkedin === null || x === null) {
      return { ok: false, error: "invalid_url" };
    }
    const { error } = await supabase.from("app_settings").upsert(
      {
        key: "public_site",
        value: {
          instagram_url: instagram, facebook_url: facebook,
          linkedin_url: linkedin, x_url: x,
        } as never,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "public_site.saved", entityType: "app_settings", entityId: "public_site",
      after: {
        instagram: Boolean(instagram), facebook: Boolean(facebook),
        linkedin: Boolean(linkedin), x: Boolean(x),
      },
    });
    revalidatePath("/", "layout");
    revalidatePath("/admin/www");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

// ---------- LAUNCH SECTION ----------

/** The shipped copy per language — `launch` with the V2 keys of `prelaunch`
 *  underneath (launchDefaultsFrom), the same map the page itself falls back
 *  to, so a freshly seeded block says what the page would have said. */
const DICTS: Record<string, Record<string, unknown>> = {
  pl: launchDefaultsFrom(pl as Record<string, unknown>),
  en: launchDefaultsFrom(en as Record<string, unknown>),
  de: launchDefaultsFrom(de as Record<string, unknown>),
};

/**
 * THE LAUNCH PAGE'S SECTION, AND ITS ONE INVARIANT.
 *
 * The first time the page is opened its single `launch` section is created
 * from whatever copy already exists: the old app_settings overrides first,
 * then the shipped translations.
 *
 * Every time it is opened, every launch field is made to exist in the stored
 * `content.fields` as an object — `{}` at least (lib/services/cms.ts
 * ensureLaunchFieldObjects) — so "Edytuj stronę" can write any of them; a
 * field added by a release after the block was created would otherwise be
 * refused there as `bad_path`. An empty object renders exactly like a missing
 * key, so nothing a visitor sees changes.
 *
 * THE PUBLISHED COPY IS KEPT IN STEP. The inline editor refuses to touch a
 * block whose draft differs from what is published (`draft_diverged`, 0141),
 * so adding the empty objects to the draft alone would lock the inline editor
 * out of the live page merely because somebody opened Strony WWW. When the
 * draft equals the published block, the same objects are added to both; the
 * snapshot write is compare-and-set on `published_at` (every publish and every
 * inline edit moves it), and when it loses that race nothing is touched — the
 * next opening tries again. A draft that already differs is only normalised
 * itself: its next publish carries the objects out.
 *
 * Never creates or touches a gallery: those belong to the inline editor.
 */
export async function ensureLaunchSectionAction(pageId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data: existing } = await supabase.from("cms_blocks")
      .select("id, content, updated_at").eq("page_id", pageId).eq("type", "launch")
      .order("sort_order").limit(1);
    const block = (existing ?? [])[0] as { id: string; content: unknown; updated_at: string } | undefined;
    if (block) return await normaliseLaunchBlock(supabase, pageId, adminId, block);

    const { data: legacy } = await supabase.from("app_settings")
      .select("value").eq("key", "launch_page").maybeSingle();
    const store = (legacy?.value ?? {}) as { published?: Record<string, Record<string, string>> };
    const published = store.published ?? {};

    const fields: Record<string, LocaleText> = {};
    for (const field of LAUNCH_FIELDS) {
      const perLocale: LocaleText = {};
      for (const locale of ["pl", "en", "de"] as const) {
        const fromLegacy = published[locale]?.[field];
        const shipped = launchDefault(DICTS[locale] ?? {}, field as LaunchField);
        const value = fromLegacy ?? shipped;
        // hero.image is empty by default, and so are the optional second
        // lines: those keys are seeded as `{}` (the invariant) and read as
        // "use the shipped text", which for them is no text.
        if (value) perLocale[locale] = value;
      }
      fields[field] = perLocale;
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

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function normaliseLaunchBlock(
  supabase: Supabase, pageId: string, adminId: string,
  block: { id: string; content: unknown; updated_at: string },
): Promise<Result> {
  const current = (block.content && typeof block.content === "object" ? block.content : {}) as CmsBlockContent;
  const normalised = ensureLaunchFieldObjects(current, LAUNCH_FIELDS);
  if (canonicalJson(normalised) === canonicalJson(current)) return { ok: true };

  const { data: page } = await supabase.from("cms_pages")
    .select("published_snapshot, published_at").eq("id", pageId).maybeSingle();
  const snapshot = Array.isArray(page?.published_snapshot) ? (page.published_snapshot as Record<string, unknown>[]) : null;
  const at = snapshot ? snapshot.findIndex((b) => b && b.id === block.id) : -1;
  const live = at >= 0 && snapshot ? snapshot[at] : null;
  if (snapshot && live && page?.published_at && canonicalJson(live.content ?? {}) === canonicalJson(current)) {
    const next = snapshot.map((b, i) => (i === at ? { ...b, content: normalised } : b));
    const { data: moved } = await supabase.from("cms_pages")
      .update({ published_snapshot: next as never })
      .eq("id", pageId).eq("published_at", page.published_at).select("id");
    // Somebody published or edited inline in between: leave both alone.
    if (!moved || moved.length === 0) return { ok: true };
  }
  await supabase.from("cms_blocks")
    .update({ content: normalised as never, updated_at: new Date().toISOString(), updated_by: adminId })
    .eq("id", block.id).eq("updated_at", block.updated_at);
  return { ok: true };
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
