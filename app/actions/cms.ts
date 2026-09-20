"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { CMS_TAG } from "@/lib/server/public-site";
import {
  listBlocks, nextVersion, slugProblem, slugify, isBlockType,
} from "@/lib/services/cms";
import { SEED_PAGES } from "@/lib/cms-seed";
import { TEMPLATE_KEYS, templateBlocks } from "@/lib/cms-templates";
import { normalizePath, normalizeTarget, sourceIsProtected } from "@/lib/server/redirects";
import type { CmsBlock, CmsBlockContent, CmsCode, PagePromo, PageSeo, SectionStyle } from "@/lib/cms";
import { isChromeMode } from "@/lib/cms";

/**
 * EVERY WRITE THE CMS MAKES.
 *
 * Thin wrappers, as the house rule requires: establish who is asking, call the
 * service, record what happened, invalidate what is now stale. The security
 * decision is NOT taken here — it is taken by RLS, using the caller's own
 * client. `requireAdmin` exists so the editor gets a clean "not_admin" instead
 * of an empty result set, not as the lock itself.
 *
 * INVALIDATION. Public pages are read through a tagged cache (CMS_TAG), so a
 * publish clears every cached page in one call rather than trusting a list of
 * paths to stay in step with the pages that exist.
 */

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

/** Everything a CMS change can make stale, in one place so no action forgets
 *  half of it. The tag covers the public pages; the paths cover the panel. */
function invalidate(slug?: string) {
  revalidateTag(CMS_TAG);
  // The launch page's own cached content, which predates this feature.
  revalidateTag("landing-content");
  revalidatePath("/", "layout");
  if (slug && slug !== "home") revalidatePath(`/${slug}`);
  revalidatePath("/admin/www");
}

/* ── PAGES ───────────────────────────────────────────────────────────────── */

export async function createPageAction(input: {
  title: string; slug?: string; navGroup?: string | null;
  /** One of lib/cms-templates.ts. The page is created with that skeleton —
   *  the right sections in the right order, every one of them empty. */
  template?: string | null;
}): Promise<Result<{ slug: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const title = input.title.trim().slice(0, 120);
    if (!title) return { ok: false, error: "title" };
    const slug = (input.slug?.trim() || slugify(title)).toLowerCase();
    const problem = slugProblem(slug);
    if (problem) return { ok: false, error: problem };

    const { data: existing } = await supabase.from("cms_pages")
      .select("id").eq("slug", slug).maybeSingle();
    if (existing) return { ok: false, error: "taken" };

    const template = input.template && TEMPLATE_KEYS.includes(input.template)
      ? input.template : null;

    const { data: created, error } = await supabase.from("cms_pages").insert({
      slug, title, status: "draft", kind: "standard",
      nav_group: input.navGroup ?? null,
      template,
      updated_by: adminId,
    }).select("id").single();
    // A race against the unique index, or the database's own slug guard.
    if (error || !created) {
      return { ok: false, error: error?.code === "23505" ? "taken" : "generic" };
    }

    // THE SKELETON, IF ONE WAS ASKED FOR. A failure here leaves the page —
    // an empty page you can add sections to beats no page and a lost title.
    const blocks = template ? templateBlocks(template) : [];
    if (blocks.length > 0) {
      await supabase.from("cms_blocks").insert(blocks.map((b) => ({
        page_id: created.id,
        type: b.type,
        sort_order: b.sort_order,
        visible: b.visible,
        content: b.content as never,
        style: b.style as never,
        anchor: b.anchor,
        updated_by: adminId,
      })));
    }

    await logAudit(supabase, {
      actorId: adminId, action: "cms.page_created", entityType: "cms_page", entityId: slug,
      after: { title, template, sections: blocks.length },
    });
    invalidate(slug);
    return { ok: true, data: { slug } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── REDIRECTS ───────────────────────────────────────────────────────────
 *
 * The validation lives here rather than only in the database because the
 * admin deserves to be told WHY: "that address is already redirected", "that
 * would point at itself", "you cannot redirect the admin panel". The database
 * still enforces uniqueness and the loop check independently.
 */

export async function saveRedirectAction(input: {
  id?: string;
  source: string;
  target: string;
  statusCode: number;
  enabled: boolean;
  note?: string | null;
}): Promise<Result<{ id: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();

    const source = normalizePath(input.source);
    const target = normalizeTarget(input.target);
    if (!source || source === "/") return { ok: false, error: "redirectSource" };
    if (!target) return { ok: false, error: "redirectTarget" };
    // Redirecting the app's own routes would take the product off the air.
    if (sourceIsProtected(source)) return { ok: false, error: "redirectReserved" };
    if (source === normalizePath(target)) return { ok: false, error: "redirectLoop" };
    const status = [301, 302, 307, 308].includes(input.statusCode) ? input.statusCode : 307;

    // A page that exists AND a redirect from the same path is a rule nobody
    // can reason about later; the redirect would silently win.
    const { data: clashPage } = await supabase.from("cms_pages")
      .select("id").eq("slug", source.replace(/^\//, "")).maybeSingle();
    if (clashPage) return { ok: false, error: "redirectIsPage" };

    const { data: existing } = await supabase.from("cms_redirects")
      .select("id").eq("source", source).maybeSingle();
    if (existing && existing.id !== input.id) return { ok: false, error: "redirectTaken" };

    // Ask the database to walk the chain: A→B→C→A is not visible from here.
    const { data: loops } = await supabase.rpc("cms_redirect_would_loop", {
      p_source: source, p_target: target, p_ignore_id: input.id ?? undefined,
    });
    if (loops === true) return { ok: false, error: "redirectLoop" };

    const row = {
      source, target, status_code: status, enabled: input.enabled,
      note: clean(input.note, 200), updated_at: new Date().toISOString(),
    };

    if (input.id) {
      const { error } = await supabase.from("cms_redirects").update(row).eq("id", input.id);
      if (error) return { ok: false, error: error.code === "23505" ? "redirectTaken" : "generic" };
      await logAudit(supabase, {
        actorId: adminId, action: "cms.redirect_saved", entityType: "cms_redirect",
        entityId: input.id, after: { source, target, status },
      });
      revalidatePath("/admin/www/przekierowania");
      return { ok: true, data: { id: input.id } };
    }

    const { data: created, error } = await supabase.from("cms_redirects")
      .insert({ ...row, created_by: adminId }).select("id").single();
    if (error || !created) {
      return { ok: false, error: error?.code === "23505" ? "redirectTaken" : "generic" };
    }
    await logAudit(supabase, {
      actorId: adminId, action: "cms.redirect_created", entityType: "cms_redirect",
      entityId: created.id, after: { source, target, status },
    });
    revalidatePath("/admin/www/przekierowania");
    return { ok: true, data: { id: created.id } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

export async function deleteRedirectAction(id: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { error } = await supabase.from("cms_redirects").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "cms.redirect_deleted", entityType: "cms_redirect", entityId: id,
    });
    revalidatePath("/admin/www/przekierowania");
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── OWN TEMPLATES ───────────────────────────────────────────────────────
 *
 * "Zapisz sekcję jako szablon" and the picker's «Moje sekcje». A saved
 * template is a copy of the block's own payload — not a reference to it, so
 * editing the page it came from does not rewrite the template, and deleting
 * that page does not empty it.
 */

export async function saveSectionTemplateAction(input: {
  name: string; blockId: string;
}): Promise<Result<{ id: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const name = input.name.trim().slice(0, 80);
    if (!name) return { ok: false, error: "title" };

    const { data: block } = await supabase.from("cms_blocks")
      .select("type, content, style, code, anchor").eq("id", input.blockId).maybeSingle();
    if (!block) return { ok: false, error: "missing" };

    const { data: created, error } = await supabase.from("cms_templates").insert({
      kind: "section",
      name,
      section_type: block.type,
      payload: [{
        type: block.type,
        content: block.content,
        style: block.style,
        code: block.code,
        anchor: block.anchor,
      }] as never,
      created_by: adminId,
    }).select("id").single();
    if (error || !created) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "cms.template_saved", entityType: "cms_template",
      entityId: created.id, after: { name, type: block.type },
    });
    revalidatePath("/admin/www");
    return { ok: true, data: { id: created.id } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/** Put a saved section on a page, at the end, as a new block. */
export async function applySectionTemplateAction(input: {
  pageId: string; templateId: string;
}): Promise<Result<{ id: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data: tpl } = await supabase.from("cms_templates")
      .select("payload, kind").eq("id", input.templateId).maybeSingle();
    if (!tpl || tpl.kind !== "section") return { ok: false, error: "missing" };

    const payload = Array.isArray(tpl.payload) ? tpl.payload : [];
    const first = payload[0] as {
      type?: string; content?: unknown; style?: unknown; code?: unknown; anchor?: string | null;
    } | undefined;
    if (!first?.type || !isBlockType(first.type)) return { ok: false, error: "type" };

    const { data: last } = await supabase.from("cms_blocks")
      .select("sort_order").eq("page_id", input.pageId)
      .order("sort_order", { ascending: false }).limit(1).maybeSingle();

    const { data: created, error } = await supabase.from("cms_blocks").insert({
      page_id: input.pageId,
      type: first.type,
      sort_order: (last?.sort_order ?? -1) + 1,
      visible: true,
      content: (first.content ?? {}) as never,
      style: (first.style ?? {}) as never,
      code: (first.code ?? {}) as never,
      // DELIBERATELY NOT the anchor: two sections answering to #cennik is a
      // broken link, and the copy is the one that should give way.
      anchor: null,
      updated_by: adminId,
    }).select("id").single();
    if (error || !created) return { ok: false, error: "generic" };

    await touchPage(supabase, input.pageId, adminId);
    return { ok: true, data: { id: created.id } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

export async function deleteTemplateAction(templateId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { error } = await supabase.from("cms_templates").delete().eq("id", templateId);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "cms.template_deleted", entityType: "cms_template",
      entityId: templateId,
    });
    revalidatePath("/admin/www");
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/** Title, slug, menu placement and SEO — everything about the page that is not
 *  one of its sections. */
export async function savePageSettingsAction(input: {
  pageId: string;
  title: string;
  slug: string;
  navGroup: string | null;
  navOrder: number;
  seo: PageSeo;
  /** What the page wears, and whether it is a campaign with an end. */
  headerMode?: string;
  footerMode?: string;
  promo?: PagePromo;
}): Promise<Result<{ slug: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const title = input.title.trim().slice(0, 120);
    if (!title) return { ok: false, error: "title" };

    const { data: current } = await supabase.from("cms_pages")
      .select("slug, kind").eq("id", input.pageId).maybeSingle();
    if (!current) return { ok: false, error: "missing" };

    const slug = input.slug.trim().toLowerCase();
    // `home` and the launch page own their slugs — they are addressed by name
    // from the homepage switch, and renaming one would break the front door.
    const slugLocked = current.slug === "home" || current.kind === "launch";
    if (!slugLocked && slug !== current.slug) {
      const problem = slugProblem(slug);
      if (problem) return { ok: false, error: problem };
      const { data: clash } = await supabase.from("cms_pages")
        .select("id").eq("slug", slug).maybeSingle();
      if (clash) return { ok: false, error: "taken" };
    }

    const { error } = await supabase.from("cms_pages").update({
      title,
      ...(slugLocked ? {} : { slug }),
      nav_group: input.navGroup || null,
      nav_order: Number.isFinite(input.navOrder) ? Math.round(input.navOrder) : 100,
      seo: input.seo as never,
      header_mode: isChromeMode(input.headerMode) ? input.headerMode : "global",
      footer_mode: isChromeMode(input.footerMode) ? input.footerMode : "global",
      promo: (input.promo ?? {}) as never,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    }).eq("id", input.pageId);
    if (error) return { ok: false, error: error.code === "23505" ? "taken" : "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "cms.page_saved", entityType: "cms_page",
      entityId: slugLocked ? current.slug : slug, after: { title },
    });
    invalidate(current.slug);
    if (!slugLocked) invalidate(slug);
    return { ok: true, data: { slug: slugLocked ? current.slug : slug } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── THE FRONT DOOR ──────────────────────────────────────────────────────── */

/**
 * MOVE THE HOMEPAGE TO THIS PAGE.
 *
 * The work is done by `cms_set_homepage()` (migration 0110) rather than here,
 * and that is not an implementation detail. Clearing the old flag and setting
 * the new one has to be ONE transaction: the partial unique index means the two
 * updates cannot both be "true" for a moment, and PostgREST gives every call its
 * own transaction — so doing it from here would leave "/" briefly belonging to
 * nobody, and permanently so if the second call failed.
 *
 * The function re-checks `is_admin()` on the caller's own JWT and refuses a page
 * that is not live. This wrapper adds nothing to that; it translates the result
 * for the panel and clears the caches.
 */
export async function setHomepageAction(pageId: string): Promise<Result<{ slug: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data, error } = await supabase.rpc("cms_set_homepage", { p_page_id: pageId });
    if (error) {
      // The function raises a bare word; anything else is a real fault.
      const known = ["not_admin", "not_published", "missing"];
      return { ok: false, error: known.find((k) => error.message?.includes(k)) ?? "generic" };
    }
    const slug = typeof data === "string" ? data : "";
    await logAudit(supabase, {
      actorId: adminId, action: "cms.homepage_set", entityType: "cms_page", entityId: slug,
      after: { slug },
    });
    invalidate(slug);
    return { ok: true, data: { slug } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/** Is this page the one answering "/"? Asked before anything that would take it
 *  off the air, so the panel can say why instead of surfacing a trigger. */
async function isHomepage(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  pageId: string,
): Promise<boolean> {
  const { data } = await supabase.from("cms_pages")
    .select("is_homepage").eq("id", pageId).maybeSingle();
  return data?.is_homepage === true;
}

/**
 * Copy a page: its sections, their styles, their code, its SEO and the options
 * that decide how it is dressed and when it runs — as a new DRAFT with a new
 * id. Nothing about the original changes, and the copy is not published —
 * duplicating a live page must never put a second live page up.
 *
 * WHAT IS DELIBERATELY NOT COPIED, each for its own reason:
 *   is_homepage    a second front door is not a thing that can exist
 *   status         a copy is always a draft
 *   kind           a copy of the launch page is an ordinary page
 *   nav_group      two entries with the same name in one menu is a mistake
 *   anchor         a #hash is a per-page identifier
 *   analytics_id   so is an event name
 *   version history the copy starts its own; the original's belongs to it
 *   media files    the copy references the same library objects, it does not
 *                  duplicate megabytes in storage
 *   global sections they are the site's, not the page's — a copy links to the
 *                  same ones rather than forking them
 */
export async function duplicatePageAction(pageId: string): Promise<Result<{ slug: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data: source } = await supabase.from("cms_pages")
      .select("slug, title, kind, seo, nav_group, header_mode, footer_mode, promo, template")
      .eq("id", pageId).maybeSingle();
    if (!source) return { ok: false, error: "missing" };

    // "kontakt" → "kontakt-kopia", then -kopia-2 … so duplicating twice works.
    let slug = `${source.slug}-kopia`.slice(0, 60);
    for (let n = 2; n < 50; n++) {
      const { data: clash } = await supabase.from("cms_pages")
        .select("id").eq("slug", slug).maybeSingle();
      if (!clash) break;
      slug = `${source.slug}-kopia-${n}`.slice(0, 60);
    }

    const { data: created, error } = await supabase.from("cms_pages").insert({
      slug,
      title: `${source.title} (kopia)`.slice(0, 120),
      status: "draft",
      // A copy of the launch page would be a second front door; a copy is
      // always an ordinary page.
      kind: "standard",
      // Spelled out rather than left to the column default: "a copy is never
      // the homepage" is a rule, and a rule nobody wrote down is a default
      // somebody can change.
      is_homepage: false,
      seo: (source.seo ?? {}) as never,
      // The page's own options travel with it. A campaign landing copied to
      // make next month's campaign must arrive wearing the same chrome and
      // carrying the same offer window, or the copy is a different page.
      header_mode: source.header_mode ?? "global",
      footer_mode: source.footer_mode ?? "global",
      promo: (source.promo ?? {}) as never,
      template: source.template,
      // Deliberately NOT copied: two pages in the same menu slot with the same
      // name is a mistake every time.
      nav_group: null,
      updated_by: adminId,
    }).select("id").single();
    if (error || !created) return { ok: false, error: "generic" };

    const blocks = await listBlocks(supabase, pageId);
    if (blocks.length > 0) {
      const { error: blockError } = await supabase.from("cms_blocks").insert(
        blocks.map((b) => ({
          page_id: created.id,
          type: b.type,
          sort_order: b.sort_order,
          visible: b.visible,
          content: b.content as never,
          style: (b.style ?? {}) as never,
          code: (b.code ?? {}) as never,
          // The section's own schedule and audience are part of how it was
          // configured. Leaving them behind turned a copy of a page with three
          // time-boxed sections into a page that shows all three at once.
          show_from: b.show_from,
          show_until: b.show_until,
          // The column is NOT NULL with a default; a block read back before
          // the column existed reports it as null, which means "everyone".
          audience: b.audience ?? "everyone",
          // An anchor and an analytics name are per-page identifiers; copying
          // them would give two pages the same event and the same #hash.
          analytics_id: null,
          anchor: null,
          updated_by: adminId,
        })),
      );
      if (blockError) return { ok: false, error: "generic" };
    }

    await logAudit(supabase, {
      actorId: adminId, action: "cms.page_duplicated", entityType: "cms_page", entityId: slug,
      after: { from: source.slug, blocks: blocks.length },
    });
    invalidate();
    return { ok: true, data: { slug } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/** Archive rather than delete: the page stops being public and leaves the
 *  menus, and its history survives. A true delete is below and is explicit. */
export async function archivePageAction(pageId: string, archived: boolean): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    // Archiving the front door would put "/" on the built-in default while the
    // panel still showed a homepage. The trigger in 0110 refuses it anyway;
    // this is so the admin reads a sentence instead of a database error.
    if (archived && await isHomepage(supabase, pageId)) return { ok: false, error: "homepage" };
    const { data: page, error } = await supabase.from("cms_pages")
      .update({
        status: archived ? "archived" : "draft",
        nav_group: archived ? null : undefined,
        updated_at: new Date().toISOString(),
        updated_by: adminId,
      })
      .eq("id", pageId).select("slug").single();
    if (error || !page) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: archived ? "cms.page_archived" : "cms.page_restored",
      entityType: "cms_page", entityId: page.slug,
    });
    invalidate(page.slug);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Delete a page for good, with its sections and its history.
 *
 * Refused for `home` and for the launch page: both are addressed by name by
 * the homepage switch, and deleting either would take the front door with it.
 * Everything else is the admin's to remove — with the slug typed back as
 * confirmation, the same shape the account deletion uses.
 */
export async function deletePageAction(pageId: string, confirmSlug: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data: page } = await supabase.from("cms_pages")
      .select("slug, kind, is_homepage").eq("id", pageId).maybeSingle();
    if (!page) return { ok: false, error: "missing" };
    // The page answering "/" cannot be deleted while it is answering it —
    // point the homepage somewhere else first. `home` and the launch page stay
    // protected on top of that: both are seeded, both are addressed by name
    // from the seed and the preview links, and neither is a page anybody meant
    // to remove.
    if (page.is_homepage) return { ok: false, error: "homepage" };
    if (page.slug === "home" || page.kind === "launch") return { ok: false, error: "protected" };
    if (confirmSlug.trim().toLowerCase() !== page.slug) return { ok: false, error: "confirm" };

    // cms_blocks and cms_page_versions cascade from the page row.
    const { error } = await supabase.from("cms_pages").delete().eq("id", pageId);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "cms.page_deleted", entityType: "cms_page", entityId: page.slug,
    });
    invalidate(page.slug);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── SECTIONS ────────────────────────────────────────────────────────────── */

export async function saveBlockAction(input: {
  id?: string;
  pageId: string;
  type: string;
  content: CmsBlockContent;
  style?: SectionStyle;
  code?: CmsCode;
  visible: boolean;
  analyticsId?: string | null;
  anchor?: string | null;
  /** The window this section is live in, and who it is for. Both are
   *  enforced by the PUBLIC renderer, which is why they are columns. */
  showFrom?: string | null;
  showUntil?: string | null;
  audience?: string | null;
}): Promise<Result<{ id: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isBlockType(input.type)) return { ok: false, error: "type" };

    const row = {
      page_id: input.pageId,
      type: input.type,
      content: input.content as never,
      style: (input.style ?? {}) as never,
      code: (input.code ?? {}) as never,
      visible: input.visible,
      analytics_id: clean(input.analyticsId, 80),
      anchor: clean(input.anchor, 64),
      show_from: instant(input.showFrom),
      show_until: instant(input.showUntil),
      // An unknown value is not a new audience, it is a typo: fall back to
      // the one that shows the section to everybody rather than to nobody.
      audience: AUDIENCES.has(input.audience ?? "") ? (input.audience as string) : "everyone",
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    };

    if (input.id) {
      const { error } = await supabase.from("cms_blocks").update(row).eq("id", input.id);
      if (error) return { ok: false, error: "generic" };
      await touchPage(supabase, input.pageId, adminId);
      revalidatePath(`/admin/www`);
      return { ok: true, data: { id: input.id } };
    }

    // A new section goes last. Reading the current maximum rather than
    // counting rows: a page whose middle section was deleted must not reuse
    // an order that already exists.
    const { data: last } = await supabase.from("cms_blocks")
      .select("sort_order").eq("page_id", input.pageId)
      .order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { data: created, error } = await supabase.from("cms_blocks")
      .insert({ ...row, sort_order: (last?.sort_order ?? -1) + 1 })
      .select("id").single();
    if (error || !created) return { ok: false, error: "generic" };
    await touchPage(supabase, input.pageId, adminId);
    return { ok: true, data: { id: created.id } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Put the sections in this order. The whole list is sent rather than "move
 * this one up", because a drag can move a section three places and because a
 * single write is atomic where six swaps are not.
 */
export async function reorderBlocksAction(pageId: string, ids: string[]): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const current = await listBlocks(supabase, pageId);
    // Every id must belong to THIS page: the ids arrive from a browser, and
    // renumbering a section of some other page is not a thing this may do.
    const known = new Set(current.map((b) => b.id));
    if (ids.length !== current.length || ids.some((id) => !known.has(id))) {
      return { ok: false, error: "mismatch" };
    }
    // Sequential rather than Promise.all: a handful of rows, and a partial
    // failure that leaves a coherent prefix beats one that interleaves.
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabase.from("cms_blocks")
        .update({ sort_order: i }).eq("id", ids[i]).eq("page_id", pageId);
      if (error) return { ok: false, error: "generic" };
    }
    await touchPage(supabase, pageId, adminId);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

export async function duplicateBlockAction(blockId: string): Promise<Result<{ id: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data: source } = await supabase.from("cms_blocks")
      .select("page_id, type, visible, content, style, code, sort_order")
      .eq("id", blockId).maybeSingle();
    if (!source) return { ok: false, error: "missing" };

    // Straight after the original, and everything below it shifts down, so a
    // copy lands where a person expects rather than at the bottom.
    const { data: below } = await supabase.from("cms_blocks")
      .select("id, sort_order").eq("page_id", source.page_id)
      .gt("sort_order", source.sort_order).order("sort_order");
    for (const row of below ?? []) {
      await supabase.from("cms_blocks").update({ sort_order: row.sort_order + 1 }).eq("id", row.id);
    }

    const { data: created, error } = await supabase.from("cms_blocks").insert({
      page_id: source.page_id,
      type: source.type,
      visible: source.visible,
      content: source.content as never,
      style: (source.style ?? {}) as never,
      code: (source.code ?? {}) as never,
      sort_order: source.sort_order + 1,
      // An anchor is an id; two sections cannot share one.
      analytics_id: null,
      anchor: null,
      updated_by: adminId,
    }).select("id").single();
    if (error || !created) return { ok: false, error: "generic" };
    await touchPage(supabase, source.page_id, adminId);
    return { ok: true, data: { id: created.id } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

export async function deleteBlockAction(blockId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data: block } = await supabase.from("cms_blocks")
      .select("page_id").eq("id", blockId).maybeSingle();
    const { error } = await supabase.from("cms_blocks").delete().eq("id", blockId);
    if (error) return { ok: false, error: "generic" };
    if (block) await touchPage(supabase, block.page_id, adminId);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── PUBLISH AND HISTORY ─────────────────────────────────────────────────── */

/**
 * The draft, frozen into the shape the public renderer reads.
 *
 * EVERY COLUMN THAT RENDERER LOOKS AT HAS TO BE IN HERE. A visitor never sees
 * cms_blocks — only this snapshot — so a field left out is a setting that
 * works in the preview and silently does nothing once the page is live. The
 * section window and the audience are exactly that kind of field: invisible by
 * design, and impossible to notice missing.
 */
function snapshotOf(blocks: CmsBlock[]) {
  return blocks.map((b) => ({
    id: b.id, type: b.type, sort_order: b.sort_order, visible: b.visible,
    content: b.content, style: b.style ?? {}, code: b.code ?? {},
    analytics_id: b.analytics_id ?? null, anchor: b.anchor ?? null,
    show_from: b.show_from ?? null, show_until: b.show_until ?? null,
    audience: b.audience ?? "everyone",
  }));
}

/**
 * Publish: take a snapshot of the draft, store it as the page's published
 * content AND as a numbered version, and clear the public cache.
 *
 * The version is written FIRST. If the update fails afterwards nothing is
 * live that is not also in the history; the other order could publish
 * something with no record of it.
 */
export async function publishPageAction(pageId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const blocks = await listBlocks(supabase, pageId);
    const { data: page } = await supabase.from("cms_pages")
      .select("slug, seo").eq("id", pageId).maybeSingle();
    if (!page) return { ok: false, error: "missing" };

    const snapshot = snapshotOf(blocks);

    const version = await nextVersion(supabase, pageId);
    const { error: versionError } = await supabase.from("cms_page_versions").insert({
      page_id: pageId, version, snapshot: snapshot as never,
      seo: (page.seo ?? {}) as never, reason: "publish", created_by: adminId,
    });
    if (versionError) return { ok: false, error: "generic" };

    const now = new Date().toISOString();
    const { error } = await supabase.from("cms_pages").update({
      published_snapshot: snapshot as never,
      status: "published",
      published_at: now,
      updated_at: now,
      updated_by: adminId,
      // Publishing now clears a pending schedule — it has happened.
      scheduled_at: null,
    }).eq("id", pageId);
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "cms.published", entityType: "cms_page", entityId: page.slug,
      after: { blocks: snapshot.length, version },
    });
    invalidate(page.slug);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/** Back to draft: the published snapshot stays on the row, it simply stops
 *  being served, so unpublishing is reversible by publishing again. */
export async function unpublishPageAction(pageId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    // Same rule as archiving: the front door stays live until another page
    // takes over. Otherwise the panel would badge a homepage that "/" is not
    // serving, which is the whole failure this module was rebuilt to remove.
    if (await isHomepage(supabase, pageId)) return { ok: false, error: "homepage" };
    const { data: page, error } = await supabase.from("cms_pages")
      .update({ status: "draft", updated_at: new Date().toISOString(), updated_by: adminId })
      .eq("id", pageId).select("slug").single();
    if (error || !page) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "cms.unpublished", entityType: "cms_page", entityId: page.slug,
    });
    invalidate(page.slug);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * PUBLISH LATER, WITHOUT A CRON JOB.
 *
 * Scheduling takes the same snapshot publishing does and stores it on the row
 * with a moment attached; migration 0093 lets the read policy hand that row
 * out once the moment passes. So what goes live on Friday is what the page
 * looked like when the admin scheduled it — not whatever the draft happens to
 * contain on Friday, which is the trap in every "publish at" that re-reads the
 * blocks at fire time.
 *
 * Nothing runs in between. There is no job to miss, no worker to be down, and
 * cancelling is an UPDATE.
 */
export async function schedulePageAction(pageId: string, at: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const when = Date.parse(at);
    if (!Number.isFinite(when)) return { ok: false, error: "date" };
    // A time in the past is a publish somebody typed wrong, and publishing on
    // their behalf is not this action's decision to make.
    if (when <= Date.now()) return { ok: false, error: "past" };
    // Scheduling the homepage forward would take "/" off the air until the
    // date arrives. Publish it, or move the homepage first.
    if (await isHomepage(supabase, pageId)) return { ok: false, error: "homepage" };

    const blocks = await listBlocks(supabase, pageId);
    if (blocks.length === 0) return { ok: false, error: "noSections" };
    const { data: page } = await supabase.from("cms_pages")
      .select("slug, seo").eq("id", pageId).maybeSingle();
    if (!page) return { ok: false, error: "missing" };

    const snapshot = snapshotOf(blocks);
    const version = await nextVersion(supabase, pageId);
    const { error: versionError } = await supabase.from("cms_page_versions").insert({
      page_id: pageId, version, snapshot: snapshot as never,
      seo: (page.seo ?? {}) as never, reason: "schedule", created_by: adminId,
    });
    if (versionError) return { ok: false, error: "generic" };

    const { error } = await supabase.from("cms_pages").update({
      published_snapshot: snapshot as never,
      status: "scheduled",
      scheduled_at: new Date(when).toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    }).eq("id", pageId);
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "cms.scheduled", entityType: "cms_page", entityId: page.slug,
      after: { at: new Date(when).toISOString(), blocks: snapshot.length, version },
    });
    invalidate(page.slug);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/** Call off a pending schedule. The page goes back to being a draft; the
 *  snapshot it would have shown stays on the row and in the history. */
export async function cancelScheduleAction(pageId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    // Cancelling drops the page back to draft, which the homepage may not be.
    if (await isHomepage(supabase, pageId)) return { ok: false, error: "homepage" };
    const { data: page, error } = await supabase.from("cms_pages")
      .update({
        status: "draft", scheduled_at: null,
        updated_at: new Date().toISOString(), updated_by: adminId,
      })
      .eq("id", pageId).eq("status", "scheduled").select("slug").maybeSingle();
    if (error) return { ok: false, error: "generic" };
    // Nothing matched: the page is not scheduled, which is the state the
    // caller wanted anyway.
    if (!page) return { ok: true };
    await logAudit(supabase, {
      actorId: adminId, action: "cms.schedule_cancelled", entityType: "cms_page", entityId: page.slug,
    });
    invalidate(page.slug);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * ROLL BACK TO A VERSION.
 *
 * The version's blocks replace the DRAFT. Nothing goes live until the admin
 * publishes, which is the same rule as every other edit — a rollback is an
 * edit, not a deploy, and being able to look at it first is the point.
 *
 * The superseded draft is snapshotted first, so rolling back is itself
 * reversible. Nothing in this feature destroys a version.
 */
export async function rollbackPageAction(pageId: string, versionId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data: version } = await supabase.from("cms_page_versions")
      .select("version, snapshot, seo").eq("id", versionId).eq("page_id", pageId).maybeSingle();
    if (!version) return { ok: false, error: "missing" };

    // Keep what is about to be replaced.
    const current = await listBlocks(supabase, pageId);
    const { data: page } = await supabase.from("cms_pages")
      .select("slug, seo").eq("id", pageId).maybeSingle();
    if (!page) return { ok: false, error: "missing" };
    const keep = await nextVersion(supabase, pageId);
    await supabase.from("cms_page_versions").insert({
      page_id: pageId, version: keep, reason: "rollback",
      label: `przed przywróceniem v${version.version}`,
      snapshot: current.map((b) => ({
        id: b.id, type: b.type, sort_order: b.sort_order, visible: b.visible,
        content: b.content, style: b.style ?? {}, code: b.code ?? {},
        analytics_id: b.analytics_id ?? null, anchor: b.anchor ?? null,
      })) as never,
      seo: (page.seo ?? {}) as never,
      created_by: adminId,
    });

    const restored = Array.isArray(version.snapshot) ? version.snapshot : [];
    await supabase.from("cms_blocks").delete().eq("page_id", pageId);
    if (restored.length > 0) {
      const rows = (restored as Record<string, unknown>[]).map((b, i) => ({
        page_id: pageId,
        type: String(b.type ?? "text"),
        sort_order: Number(b.sort_order ?? i),
        visible: b.visible !== false,
        content: (b.content ?? {}) as never,
        style: (b.style ?? {}) as never,
        code: (b.code ?? {}) as never,
        analytics_id: typeof b.analytics_id === "string" ? b.analytics_id : null,
        anchor: typeof b.anchor === "string" ? b.anchor : null,
        updated_by: adminId,
      })).filter((r) => isBlockType(r.type));
      const { error } = await supabase.from("cms_blocks").insert(rows);
      if (error) return { ok: false, error: "generic" };
    }
    await supabase.from("cms_pages").update({
      seo: (version.seo ?? {}) as never,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    }).eq("id", pageId);

    await logAudit(supabase, {
      actorId: adminId, action: "cms.rollback", entityType: "cms_page", entityId: page.slug,
      after: { to: version.version, blocks: restored.length },
    });
    revalidatePath("/admin/www");
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── SEEDING THE PUBLIC WEBSITE ──────────────────────────────────────────── */

/**
 * Create the seven public pages, as DRAFTS, with a starting set of sections.
 *
 * NON-DESTRUCTIVE BY CONSTRUCTION, which is what makes it safe to leave a
 * button on this in the panel:
 *
 *   · a page that already exists is not recreated and its title, slug, status
 *     and SEO are left exactly as they are;
 *   · sections are added ONLY to a page that has none. A page somebody has
 *     already worked on is skipped entirely — this never overwrites work;
 *   · nothing is published. The homepage mode is not touched, so the waiting
 *     list stays the front door until an admin decides otherwise.
 */
export async function seedPublicPagesAction(): Promise<Result<{ pages: number; sections: number }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    let pagesCreated = 0;
    let sectionsCreated = 0;

    for (const seed of SEED_PAGES) {
      let { data: page } = await supabase.from("cms_pages")
        .select("id, slug").eq("slug", seed.slug).maybeSingle();

      if (!page) {
        const { data: created, error } = await supabase.from("cms_pages").insert({
          slug: seed.slug,
          title: seed.title,
          status: "draft",
          kind: "standard",
          nav_group: seed.navGroup,
          nav_order: seed.navOrder,
          seo: seed.seo as never,
          updated_by: adminId,
        }).select("id, slug").single();
        if (error || !created) continue;
        page = created;
        pagesCreated++;
      }

      const existing = await listBlocks(supabase, page.id);
      if (existing.length > 0) {
        // Somebody has already arranged this page. Leave it alone — unless it
        // is the homepage, which this brief asks to be rebuilt.
        if (!seed.replaceExisting) continue;
        // Already rebuilt: a marker only the new layout carries.
        const marker = seed.sections.find((s) => s.analyticsId)?.analyticsId;
        if (marker && existing.some((b) => b.analytics_id === marker)) continue;

        // KEEP WHAT IS BEING REPLACED, as a numbered version, so the old
        // layout is one click away in Historia and nothing is destroyed.
        const version = await nextVersion(supabase, page.id);
        await supabase.from("cms_page_versions").insert({
          page_id: page.id, version, reason: "manual",
          label: "poprzedni układ strony głównej",
          snapshot: existing.map((b) => ({
            id: b.id, type: b.type, sort_order: b.sort_order, visible: b.visible,
            content: b.content, style: b.style ?? {}, code: b.code ?? {},
            analytics_id: b.analytics_id ?? null, anchor: b.anchor ?? null,
          })) as never,
          created_by: adminId,
        });
        await supabase.from("cms_blocks").delete().eq("page_id", page.id);
      }

      const rows = seed.sections.map((section, i) => ({
        page_id: page.id,
        type: section.type,
        sort_order: i,
        visible: true,
        content: section.content as never,
        style: (section.style ?? {}) as never,
        code: {} as never,
        analytics_id: section.analyticsId ?? null,
        anchor: section.anchor ?? null,
        updated_by: adminId,
      }));
      if (rows.length === 0) continue;
      const { error } = await supabase.from("cms_blocks").insert(rows);
      if (!error) sectionsCreated += rows.length;
    }

    await logAudit(supabase, {
      actorId: adminId, action: "cms.seeded", entityType: "cms_page", entityId: "public_site",
      after: { pages: pagesCreated, sections: sectionsCreated },
    });
    invalidate();
    return { ok: true, data: { pages: pagesCreated, sections: sectionsCreated } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── GLOBAL SECTIONS ─────────────────────────────────────────────────────── */

const SLOTS = new Set(["header", "footer", "announcement", "global_cta"]);

/** Header, footer, announcement bar and closing CTA. Saved and published in
 *  one step: they are four small objects, not a page, and a draft header
 *  nobody can see is not worth the second button. */
export async function saveGlobalSectionAction(input: {
  slot: string; content: CmsBlockContent; visible: boolean;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!SLOTS.has(input.slot)) return { ok: false, error: "slot" };
    const now = new Date().toISOString();
    const { error } = await supabase.from("cms_global_sections").update({
      content: input.content as never,
      published_snapshot: input.content as never,
      visible: input.visible,
      published_at: now,
      updated_at: now,
      updated_by: adminId,
    }).eq("slot", input.slot);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "cms.global_saved", entityType: "cms_global_section",
      entityId: input.slot, after: { visible: input.visible },
    });
    invalidate();
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── SHARED ──────────────────────────────────────────────────────────────── */

/** A page's "last modified" and "changed by" follow its sections, so the list
 *  shows when the CONTENT last moved rather than when the row was renamed. */
async function touchPage(
  supabase: Awaited<ReturnType<typeof createClient>>, pageId: string, adminId: string,
) {
  await supabase.from("cms_pages")
    .update({ updated_at: new Date().toISOString(), updated_by: adminId })
    .eq("id", pageId);
}

const clean = (value: string | null | undefined, max: number): string | null => {
  const v = (value ?? "").trim().slice(0, max);
  return v || null;
};

/** The three audiences a section can be written for. Anything else is a
 *  typo, and a typo must not hide a section from everybody. */
const AUDIENCES = new Set(["everyone", "anon", "user"]);

/** A timestamp the database will accept, or null. An unparseable date is
 *  stored as "no limit" rather than as a constraint violation — a scheduling
 *  field left half-typed must not fail the whole save. */
const instant = (value: string | null | undefined): string | null => {
  const v = (value ?? "").trim();
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

function message(e: unknown): string {
  const text = e instanceof Error ? e.message : "";
  return text === "not_admin" || text === "unauthenticated" ? text : "generic";
}
