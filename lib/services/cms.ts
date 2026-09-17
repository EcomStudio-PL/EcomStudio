import type { Client } from "@/lib/services/workspace";
import type { ChromeMode, CmsBlock, CmsCode, PagePromo, PageSeo, SectionStyle } from "@/lib/cms";
import { BLOCK_TYPES, isChromeMode } from "@/lib/cms";

/**
 * THE CMS, AS BUSINESS LOGIC.
 *
 * Everything here takes a SupabaseClient and returns data — no `next/cache`,
 * no cookies, no React. That is the house rule (CLAUDE.md: services are
 * transport-agnostic so a future client can reuse them behind an API), and it
 * is also what makes these functions testable without a request.
 *
 * The server actions in app/actions/cms.ts are the thin wrappers: auth →
 * service call → log_activity → revalidate.
 *
 * SECURITY IS NOT HERE. Every write below is an ordinary PostgREST call made
 * with the CALLER'S client, so the `to authenticated using (is_admin())`
 * policies from 0051 and 0085 decide what actually happens. A bug in this file
 * cannot grant anyone anything.
 */

export type PageRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  kind: string;
  sortOrder: number;
  navGroup: string | null;
  navOrder: number;
  seo: PageSeo;
  publishedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
  scheduledAt: string | null;
  headerMode: ChromeMode;
  footerMode: ChromeMode;
  promo: PagePromo;
  template: string | null;
};

export type BlockRow = CmsBlock & { id: string };

const asSeo = (value: unknown): PageSeo =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as PageSeo) : {};

const asPromo = (value: unknown): PagePromo =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as PagePromo) : {};

const asStyle = (value: unknown): SectionStyle =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as SectionStyle) : {};

const asCode = (value: unknown): CmsCode =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as CmsCode) : {};

const PAGE_SELECT =
  "id, slug, title, status, kind, sort_order, nav_group, nav_order, seo, published_at, updated_at, updated_by, scheduled_at, header_mode, footer_mode, promo, template";

type RawPage = {
  id: string; slug: string; title: string; status: string; kind: string;
  sort_order: number; nav_group: string | null; nav_order: number;
  seo: unknown; published_at: string | null; updated_at: string;
  updated_by: string | null; scheduled_at: string | null;
  header_mode: string | null; footer_mode: string | null;
  promo: unknown; template: string | null;
};

const toPage = (row: RawPage): PageRow => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  status: row.status,
  kind: row.kind ?? "standard",
  sortOrder: row.sort_order ?? 100,
  navGroup: row.nav_group,
  navOrder: row.nav_order ?? 100,
  seo: asSeo(row.seo),
  publishedAt: row.published_at,
  updatedAt: row.updated_at,
  updatedBy: row.updated_by,
  scheduledAt: row.scheduled_at,
  headerMode: isChromeMode(row.header_mode) ? row.header_mode : "global",
  footerMode: isChromeMode(row.footer_mode) ? row.footer_mode : "global",
  promo: asPromo(row.promo),
  template: row.template,
});

export async function listPages(supabase: Client): Promise<PageRow[]> {
  const { data } = await supabase.from("cms_pages").select(PAGE_SELECT)
    .order("sort_order").order("created_at");
  return (data ?? []).map(toPage);
}

export async function getPage(supabase: Client, slug: string): Promise<PageRow | null> {
  const { data } = await supabase.from("cms_pages").select(PAGE_SELECT).eq("slug", slug).maybeSingle();
  return data ? toPage(data) : null;
}

const BLOCK_SELECT = "id, type, sort_order, visible, content, style, code, analytics_id, anchor, show_from, show_until, audience";

export async function listBlocks(supabase: Client, pageId: string): Promise<BlockRow[]> {
  const { data } = await supabase.from("cms_blocks").select(BLOCK_SELECT)
    .eq("page_id", pageId).order("sort_order");
  return (data ?? []).map((b) => ({
    id: b.id,
    type: b.type,
    sort_order: b.sort_order,
    visible: b.visible,
    content: (b.content ?? {}) as CmsBlock["content"],
    style: asStyle(b.style),
    code: asCode(b.code),
    analytics_id: b.analytics_id,
    anchor: b.anchor,
    show_from: b.show_from,
    show_until: b.show_until,
    audience: b.audience ?? "everyone",
  }));
}

/* ── VALIDATION ───────────────────────────────────────────────────────────
 *
 * The database refuses a reserved or malformed slug (0085) and refuses a write
 * from a non-admin (0051). These checks exist so the EDITOR can say why before
 * the round trip, not because the database needs help.
 */

export const SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Kept in step with `public.cms_slug_is_reserved()` by the test in
 *  scripts/cms-tests.ts, which compares the two lists. */
export const RESERVED = [
  "api", "auth", "admin", "login", "register", "logout",
  "home", "dashboard", "settings", "generator", "library", "products",
  "prompts", "history", "credits", "plan", "tools", "inspirations",
  "support", "retusz", "wideo", "k", "forgot-password", "reset-password",
  "sitemap.xml", "robots.txt", "manifest.webmanifest", "_next", "favicon.ico",
];

export type SlugProblem = "empty" | "shape" | "reserved" | "taken" | null;

export function slugProblem(slug: string): Exclude<SlugProblem, "taken"> {
  const value = slug.trim().toLowerCase();
  if (!value) return "empty";
  if (!SLUG_SHAPE.test(value)) return "shape";
  if (RESERVED.includes(value)) return "reserved";
  return null;
}

/** Turn a page title into a usable slug: "Polityka prywatności" →
 *  "polityka-prywatnosci". Polish letters are folded rather than dropped. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    // `ł` has no combining mark, so NFD leaves it whole and the ASCII filter
    // below would delete it. Same trap as lib/save-image.ts.
    .replace(/ł/g, "l").replace(/đ/g, "d").replace(/ø/g, "o").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function isBlockType(value: string): boolean {
  return (BLOCK_TYPES as readonly string[]).includes(value);
}

/* ── OWN TEMPLATES ────────────────────────────────────────────────────────
 *
 * "Zapisz sekcję jako szablon", read back for the picker's «Moje sekcje».
 * Admin-only by RLS; the payload is a copy, so a template survives the page
 * it was cut from.
 */

export type SectionTemplateRow = {
  id: string; name: string; sectionType: string | null; createdAt: string;
};

export async function listSectionTemplates(supabase: Client): Promise<SectionTemplateRow[]> {
  const { data } = await supabase.from("cms_templates")
    .select("id, name, section_type, created_at")
    .eq("kind", "section").order("created_at", { ascending: false }).limit(60);
  return (data ?? []).map((r) => ({
    id: r.id, name: r.name, sectionType: r.section_type, createdAt: r.created_at,
  }));
}

/* ── VERSIONS ─────────────────────────────────────────────────────────────── */

export type VersionRow = {
  id: string;
  version: number;
  reason: string;
  label: string | null;
  createdAt: string;
  createdBy: string | null;
  blocks: number;
};

export async function listVersions(supabase: Client, pageId: string): Promise<VersionRow[]> {
  const { data } = await supabase.from("cms_page_versions")
    .select("id, version, reason, label, created_at, created_by, snapshot")
    .eq("page_id", pageId).order("version", { ascending: false }).limit(50);
  return (data ?? []).map((v) => ({
    id: v.id,
    version: v.version,
    reason: v.reason,
    label: v.label,
    createdAt: v.created_at,
    createdBy: v.created_by,
    blocks: Array.isArray(v.snapshot) ? v.snapshot.length : 0,
  }));
}

/** The next version number for a page. Reads the highest and adds one; the
 *  unique constraint on (page_id, version) is what makes two simultaneous
 *  publishes fail loudly instead of silently sharing a number. */
export async function nextVersion(supabase: Client, pageId: string): Promise<number> {
  const { data } = await supabase.from("cms_page_versions")
    .select("version").eq("page_id", pageId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  return (data?.version ?? 0) + 1;
}
