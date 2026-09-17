import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import type { Client } from "@/lib/services/workspace";
import {
  isChromeMode,
  type ChromeMode, type CmsBlock, type CmsBlockContent, type CmsCode,
  type PagePromo, type PageSeo, type SectionStyle,
} from "@/lib/cms";

/**
 * READING THE PUBLIC SITE.
 *
 * Every public page is a cms_pages row and every visitor sees its
 * `published_snapshot` — never the live blocks, which are the admin's draft.
 * That rule lives here so no route can accidentally read the wrong column.
 *
 * CACHING. A published page is identical for every visitor, so it is read once
 * and served from the cache until somebody publishes. Publishing clears the
 * `cms-pages` tag, so the new copy is live immediately rather than after a
 * TTL — see app/actions/public-pages.ts. The cached client is ANONYMOUS on
 * purpose: nothing user-scoped may ever end up inside a shared cache entry.
 */

export const CMS_TAG = "cms-pages";

export type PublicSite = {
  instagramUrl: string;
  facebookUrl: string;
  linkedinUrl: string;
  xUrl: string;
};

const httpsOnly = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    // Rendered as a link a visitor clicks, so only https ever survives.
    return url.protocol === "https:" ? url.toString() : "";
  } catch { return ""; }
};

/** Social profiles shown on the public pages. Empty means "no button". */
export async function getPublicSite(supabase: Client): Promise<PublicSite> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "public_site").maybeSingle();
  const v = (data?.value ?? {}) as Record<string, unknown>;
  return {
    instagramUrl: httpsOnly(v.instagram_url),
    facebookUrl: httpsOnly(v.facebook_url),
    linkedinUrl: httpsOnly(v.linkedin_url),
    xUrl: httpsOnly(v.x_url),
  };
}

export type PublicPage = {
  slug: string;
  title: string;
  kind: string;
  blocks: CmsBlock[];
  seo: PageSeo;
  /** What the page wears. A campaign landing usually asks for `minimal`. */
  headerMode: ChromeMode;
  footerMode: ChromeMode;
  /** Set only on a campaign page; decides whether the page is still open. */
  promo: PagePromo | undefined;
  publishedAt: string | null;
  updatedAt: string | null;
};

/**
 * Normalise a stored block. A snapshot is jsonb that was written by an older
 * version of this code, so every field is treated as possibly absent — a page
 * published before the builder existed has no `style` and must still render.
 */
export function toBlocks(snapshot: unknown): CmsBlock[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
    .map((b) => ({
      id: typeof b.id === "string" ? b.id : undefined,
      type: String(b.type ?? ""),
      sort_order: Number(b.sort_order ?? 0),
      visible: b.visible !== false,
      content: (b.content ?? {}) as CmsBlockContent,
      style: (b.style ?? undefined) as SectionStyle | undefined,
      code: (b.code ?? undefined) as CmsCode | undefined,
      analytics_id: typeof b.analytics_id === "string" ? b.analytics_id : null,
      anchor: typeof b.anchor === "string" ? b.anchor : null,
      // A snapshot written before section windows existed has none of these,
      // which reads as "always, to everybody" — the behaviour it had.
      show_from: typeof b.show_from === "string" ? b.show_from : null,
      show_until: typeof b.show_until === "string" ? b.show_until : null,
      audience: typeof b.audience === "string" ? b.audience : "everyone",
    }));
}

function toSeo(value: unknown): PageSeo {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as PageSeo) : {};
}

/** A promotion is only a promotion when it says so. An `{}` in the column —
 *  which is what a page that was never a campaign carries — must not make the
 *  renderer think there is a window to close. */
function toPromo(value: unknown): PagePromo | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const promo = value as PagePromo;
  return promo.active ? promo : undefined;
}

const PAGE_COLUMNS = "slug, title, kind, status, published_snapshot, published_at, updated_at, seo, header_mode, footer_mode, promo, scheduled_at";

/**
 * Is this row public RIGHT NOW? Published, or scheduled for a moment that has
 * already passed — the same rule the read policy enforces in 0093, written
 * once more here because this file is the one responsible for the answer.
 *
 * A page whose schedule has arrived is live within a few minutes rather than
 * at the second: the row is read through a five-minute cache, and the cached
 * answer for "not yet" is what has to expire first. The settings screen says
 * so in as many words rather than promising a precision that is not there.
 */
function isLive(row: { status: string; scheduled_at?: string | null }): boolean {
  if (row.status === "published") return true;
  if (row.status !== "scheduled") return false;
  const at = row.scheduled_at ? Date.parse(row.scheduled_at) : NaN;
  return Number.isFinite(at) && Date.now() >= at;
}

/**
 * One page's published content, or null when it was never published. A draft
 * page is not "coming soon" to a visitor — it simply does not exist yet.
 *
 * Read through the cache: the row is the same for everybody, and a marketing
 * page should not cost a database round trip per visit.
 */
export async function getPublishedPage(_supabase: Client, slug: string): Promise<PublicPage | null> {
  return readPublishedPage(slug);
}

const readPublishedPage = unstable_cache(
  async (slug: string): Promise<PublicPage | null> => {
    const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await anon.from("cms_pages").select(PAGE_COLUMNS).eq("slug", slug).maybeSingle();
    // RLS already refuses a draft to an anonymous reader; the status check is
    // the second lock on the same door, and the one this file is responsible
    // for. An 'archived' page is not public, and a 'scheduled' one is public
    // only once its moment has passed.
    if (!data || !isLive(data)) return null;
    return {
      slug: data.slug,
      title: data.title,
      kind: (data.kind as string | null) ?? "standard",
      blocks: toBlocks(data.published_snapshot),
      seo: toSeo(data.seo),
      headerMode: isChromeMode(data.header_mode) ? data.header_mode : "global",
      footerMode: isChromeMode(data.footer_mode) ? data.footer_mode : "global",
      promo: toPromo(data.promo),
      publishedAt: data.published_at,
      updatedAt: data.updated_at,
    };
  },
  ["cms-published-page"],
  { revalidate: 300, tags: [CMS_TAG] },
);

/** The draft blocks, for the admin-only preview. Never cached: the point of a
 *  preview is that it shows what was typed a second ago. */
export async function getDraftBlocks(supabase: Client, slug: string): Promise<CmsBlock[]> {
  const { data: page } = await supabase
    .from("cms_pages").select("id").eq("slug", slug).maybeSingle();
  if (!page) return [];
  const { data } = await supabase
    .from("cms_blocks")
    .select("id, type, sort_order, visible, content, style, code, analytics_id, anchor")
    .eq("page_id", page.id).order("sort_order");
  return toBlocks(data);
}

/* ── GLOBAL SECTIONS ─────────────────────────────────────────────────────── */

export type GlobalSlot = "header" | "footer" | "announcement" | "global_cta";

export type GlobalSection = {
  slot: GlobalSlot;
  visible: boolean;
  content: CmsBlockContent;
};

export type GlobalSections = Partial<Record<GlobalSlot, GlobalSection>>;

/**
 * The header, footer, announcement bar and closing CTA every public page
 * shares. Published like a page: a visitor sees the snapshot, an admin's
 * unsaved edits stay in the admin's browser.
 *
 * THESE ARE FOR PUBLIC PAGES ONLY. The signed-in dashboard and the admin panel
 * render their own layouts and never call this.
 */
export async function getGlobalSections(): Promise<GlobalSections> {
  return readGlobalSections();
}

const readGlobalSections = unstable_cache(
  async (): Promise<GlobalSections> => {
    const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await anon.from("cms_global_sections")
      .select("slot, visible, published_snapshot");
    const out: GlobalSections = {};
    for (const row of data ?? []) {
      const slot = row.slot as GlobalSlot;
      out[slot] = {
        slot,
        visible: row.visible !== false,
        content: (row.published_snapshot ?? {}) as CmsBlockContent,
      };
    }
    return out;
  },
  ["cms-global-sections"],
  { revalidate: 300, tags: [CMS_TAG] },
);

/** The draft copy of the global sections, for the admin editor and preview. */
export async function getGlobalDrafts(supabase: Client): Promise<GlobalSections> {
  const { data } = await supabase.from("cms_global_sections")
    .select("slot, visible, content");
  const out: GlobalSections = {};
  for (const row of data ?? []) {
    const slot = row.slot as GlobalSlot;
    out[slot] = { slot, visible: row.visible !== false, content: (row.content ?? {}) as CmsBlockContent };
  }
  return out;
}

/* ── THE PAGE LIST ───────────────────────────────────────────────────────── */

export type NavPage = { slug: string; title: string; navGroup: string | null; navOrder: number };

/** Published pages that asked to be in a menu, for the footer and the header.
 *  Built from the page list rather than from links hardcoded in ten places. */
export async function getNavPages(): Promise<NavPage[]> {
  return readNavPages();
}

const readNavPages = unstable_cache(
  async (): Promise<NavPage[]> => {
    const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await anon.from("cms_pages")
      .select("slug, title, nav_group, nav_order, kind, status, scheduled_at")
      // Both statuses the read policy can hand back; `isLive` decides which of
      // them is really live, so a menu entry and the page behind it can never
      // disagree about whether the page exists.
      .in("status", ["published", "scheduled"])
      .not("nav_group", "is", null)
      .order("nav_order");
    return (data ?? [])
      .filter(isLive)
      // A launch page answers "/" through the homepage switch and has no URL
      // of its own, so it can never be a menu entry.
      .filter((p) => p.kind !== "launch")
      .map((p) => ({
        slug: p.slug, title: p.title,
        navGroup: p.nav_group, navOrder: p.nav_order ?? 100,
      }));
  },
  ["cms-nav-pages"],
  { revalidate: 300, tags: [CMS_TAG] },
);
