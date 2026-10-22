import type { Client } from "@/lib/services/workspace";
import type { ChromeMode, CmsBlock, CmsBlockContent, CmsCode, LocaleText, PagePromo, PageSeo, SectionStyle } from "@/lib/cms";
import { BLOCK_TYPES, isChromeMode } from "@/lib/cms";
import { disallowedTokens } from "@/lib/launch/fields";

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
  /** The single page that answers "/". One row at most, enforced by the
   *  partial unique index in 0110 — the list does not have to police it. */
  isHomepage: boolean;
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
  "id, slug, title, status, kind, sort_order, nav_group, nav_order, seo, published_at, updated_at, updated_by, scheduled_at, header_mode, footer_mode, promo, template, is_homepage";

type RawPage = {
  id: string; slug: string; title: string; status: string; kind: string;
  sort_order: number; nav_group: string | null; nav_order: number;
  seo: unknown; published_at: string | null; updated_at: string;
  updated_by: string | null; scheduled_at: string | null;
  header_mode: string | null; footer_mode: string | null;
  promo: unknown; template: string | null;
  is_homepage: boolean | null;
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
  isHomepage: row.is_homepage === true,
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
  // The public GrovNews blog (/blog) is a static route since Stage 4 (0125).
  "blog",
  // /profile forwards to /settings?tab=profile (0127).
  "profile",
  // The public pricing page /plany is a static route (0136).
  "plany",
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

/**
 * SECTIONS THAT EXIST ONCE, ON ONE PAGE, AND ARE NEVER COPIED.
 *
 * `launch` is the launch page's own copy; `launch_gallery` is one of its three
 * PRZED/PO galleries, one block per gallery key (a unique index in 0144). A
 * duplicate of either is a second answer to "which one does the page show",
 * and a template of either carries one page's pairs onto pages that cannot
 * render them. Duplicate, "Zapisz jako szablon" and "Moje sekcje" refuse both.
 */
export const NOT_COPYABLE_TYPES: ReadonlySet<string> = new Set(["launch", "launch_gallery"]);

/* ── THE LAUNCH BLOCK'S INVARIANT ─────────────────────────────────────────
 *
 * Every launch field exists in the stored `content.fields` as an OBJECT —
 * `{}` at least — so the inline editor can always write one language of it:
 * cms_inline_patch (0141) creates only the LAST key of a path and refuses
 * `bad_path` when `fields.<key>` itself is missing. An empty object reads
 * exactly like an absent key everywhere (no language → the shipped default),
 * so adding one never changes what the page shows.
 *
 * Kept here, pure and with the key list passed in, because the list lives in
 * a server-only module and the client components that import this file must
 * not pull it in.
 */
export function ensureLaunchFieldObjects(content: CmsBlockContent, keys: readonly string[]): CmsBlockContent {
  const bag = content.fields && typeof content.fields === "object" && !Array.isArray(content.fields)
    ? content.fields : {};
  const fields: Record<string, LocaleText> = { ...bag };
  for (const key of keys) {
    const v = fields[key] as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) fields[key] = {};
  }
  return { ...content, fields };
}

/**
 * The first launch line that uses a `{token}` its key does not allow
 * (lib/launch/fields.ts ALLOWED_TOKENS), or null. Checked on every save of the
 * launch block: "{premiera}" typed into the headline would otherwise hide the
 * headline (an unresolvable line is not rendered), and a value token in a line
 * not built for it would publish an unapproved promise.
 */
export function launchTokenProblem(content: CmsBlockContent): { key: string; locale: string; tokens: string[] } | null {
  const bag = (content.fields ?? {}) as Record<string, unknown>;
  for (const [key, text] of Object.entries(bag)) {
    if (!text || typeof text !== "object") continue;
    for (const [locale, value] of Object.entries(text as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      const tokens = disallowedTokens(key, value);
      if (tokens.length > 0) return { key, locale, tokens };
    }
  }
  return null;
}

/**
 * A version's blocks as rows to insert again (Historia → "Przywróć").
 *
 * Every KNOWN type comes back — the launch page's galleries included, which
 * is why `launch_gallery` is in BLOCK_TYPES — with its content and its switch
 * exactly as the version holds them. The launch block is brought up to the
 * invariant above on the way, so an old version restored and published never
 * leaves the inline editor unable to write a field that version predates.
 */
export function versionBlockRows(
  snapshot: unknown, pageId: string, adminId: string, launchKeys: readonly string[],
) {
  const restored = Array.isArray(snapshot) ? snapshot : [];
  return (restored as Record<string, unknown>[]).map((b, i) => {
    const type = String(b.type ?? "text");
    const content = (b.content ?? {}) as CmsBlockContent;
    return {
      page_id: pageId,
      type,
      sort_order: Number(b.sort_order ?? i),
      visible: b.visible !== false,
      content: (type === "launch" ? ensureLaunchFieldObjects(content, launchKeys) : content) as never,
      style: (b.style ?? {}) as never,
      code: (b.code ?? {}) as never,
      analytics_id: typeof b.analytics_id === "string" ? b.analytics_id : null,
      anchor: typeof b.anchor === "string" ? b.anchor : null,
      updated_by: adminId,
    };
  }).filter((r) => isBlockType(r.type));
}

/**
 * A LAUNCH BLOCK SAVED BY THE BUILDER, MERGED FIELD BY FIELD.
 *
 * The builder loaded its copy of the launch block when the page opened and
 * sends the WHOLE content on every autosave. Written as-is, that copy puts
 * back every field somebody changed since in "Edytuj stronę" (a three-way
 * race the inline editor itself guards with a compare-and-set). So the save
 * carries what the builder started from (`base`) and only what the builder
 * actually changed — per field and language, and per other top-level key —
 * goes over what is stored now. Pure; values compared as JSON.
 */
export function mergeLaunchContent(
  stored: CmsBlockContent, base: CmsBlockContent, next: CmsBlockContent,
): CmsBlockContent {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const s = obj(stored), b = obj(base), n = obj(next);
  const out: Record<string, unknown> = { ...s };
  for (const key of new Set([...Object.keys(n), ...Object.keys(b)])) {
    if (key === "fields" || same(n[key], b[key])) continue;
    if (key in n) out[key] = n[key]; else delete out[key];
  }
  const sf = obj(s.fields), bf = obj(b.fields), nf = obj(n.fields);
  const fields: Record<string, unknown> = { ...sf };
  for (const key of new Set([...Object.keys(nf), ...Object.keys(bf)])) {
    const nv = obj(nf[key]), bv = obj(bf[key]);
    let merged: Record<string, unknown> | null = null;
    for (const loc of new Set([...Object.keys(nv), ...Object.keys(bv)])) {
      if (same(nv[loc], bv[loc])) continue;
      merged ??= { ...obj(fields[key]) };
      if (loc in nv) merged[loc] = nv[loc]; else delete merged[loc];
    }
    if (merged) fields[key] = merged;
  }
  out.fields = fields;
  return out as CmsBlockContent;
}

/**
 * THE LAUNCH PAGE'S GALLERIES SURVIVE A RESTORE OF A VERSION THAT PREDATES
 * THEM. A gallery has its own history (the inline editor's "Historia"); a
 * page version from before galleries existed — the 0145 "treści sprzed
 * aktualizacji" one, say — would otherwise drop every gallery from the draft,
 * and the next publish would take them off the page. A gallery the version
 * DOES contain is restored from it as usual.
 */
export function withCurrentGalleries(
  rows: ReturnType<typeof versionBlockRows>, current: CmsBlock[], pageId: string, adminId: string,
) {
  const key = (content: unknown) =>
    content && typeof content === "object" ? String((content as Record<string, unknown>).gallery ?? "") : "";
  const restoredKeys = new Set(rows.filter((r) => r.type === "launch_gallery").map((r) => key(r.content)));
  const kept = current
    .filter((b) => b.type === "launch_gallery" && key(b.content) !== "" && !restoredKeys.has(key(b.content)))
    .map((b) => ({
      page_id: pageId,
      type: b.type,
      sort_order: b.sort_order,
      visible: b.visible,
      content: b.content as never,
      style: (b.style ?? {}) as never,
      code: (b.code ?? {}) as never,
      analytics_id: b.analytics_id ?? null,
      anchor: b.anchor ?? null,
      updated_by: adminId,
    }));
  return [...rows, ...kept];
}

/* ── REDIRECTS ────────────────────────────────────────────────────────────
 *
 * The admin's view of the routing table. The PUBLIC read is a different path
 * entirely (lib/server/redirects.ts, cached, through a definer function) —
 * this one is for the manager and carries the columns the manager shows.
 */

export type RedirectRow = {
  id: string; source: string; target: string; statusCode: number;
  enabled: boolean; note: string | null; hits: number; lastHitAt: string | null;
  createdAt: string;
};

export async function listRedirects(supabase: Client): Promise<RedirectRow[]> {
  const { data } = await supabase.from("cms_redirects")
    .select("id, source, target, status_code, enabled, note, hits, last_hit_at, created_at")
    .order("source");
  return (data ?? []).map((r) => ({
    id: r.id, source: r.source, target: r.target, statusCode: r.status_code,
    enabled: r.enabled, note: r.note, hits: r.hits ?? 0, lastHitAt: r.last_hit_at,
    createdAt: r.created_at,
  }));
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
  // The newest 50, plus every older LABELLED manual version: a named restore
  // point (the 0145 "Landing V2 — treści sprzed aktualizacji" one) must not
  // scroll out of reach because fifty inline saves came after it.
  const oldest = data && data.length === 50 ? data[data.length - 1]!.version : null;
  const { data: pinned } = oldest === null ? { data: [] } : await supabase.from("cms_page_versions")
    .select("id, version, reason, label, created_at, created_by, snapshot")
    .eq("page_id", pageId).eq("reason", "manual").not("label", "is", null).lt("version", oldest)
    .order("version", { ascending: false }).limit(20);
  return [...(data ?? []), ...(pinned ?? [])].map((v) => ({
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

/* ── PUBLISHING ───────────────────────────────────────────────────────────── */

/**
 * The draft, frozen into the shape the public renderer reads.
 *
 * EVERY COLUMN THAT RENDERER LOOKS AT HAS TO BE IN HERE. A visitor never sees
 * cms_blocks — only this snapshot — so a field left out is a setting that
 * works in the preview and silently does nothing once the page is live. The
 * section window and the audience are exactly that kind of field: invisible by
 * design, and impossible to notice missing.
 */
export function snapshotOf(blocks: CmsBlock[]) {
  return blocks.map((b) => ({
    id: b.id, type: b.type, sort_order: b.sort_order, visible: b.visible,
    content: b.content, style: b.style ?? {}, code: b.code ?? {},
    analytics_id: b.analytics_id ?? null, anchor: b.anchor ?? null,
    show_from: b.show_from ?? null, show_until: b.show_until ?? null,
    audience: b.audience ?? "everyone",
  }));
}

export type PublishOutcome =
  | { ok: true; slug: string; version: number; blocks: number; publishedAt: string }
  | { ok: false; error: string };

/**
 * Publish: take a snapshot of the draft, store it as the page's published
 * content AND as a numbered version.
 *
 * The version is written FIRST. If the update fails afterwards nothing is
 * live that is not also in the history; the other order could publish
 * something with no record of it.
 *
 * One implementation for both doors: Strony WWW's "Publikuj"
 * (app/actions/cms.ts publishPageAction) and the inline editor's gallery
 * "Opublikuj" (lib/server/ice/gallery.ts). Each caller decides who may ask,
 * writes its own audit row and clears its own caches.
 */
export async function publishPage(supabase: Client, adminId: string, pageId: string): Promise<PublishOutcome> {
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

  return { ok: true, slug: page.slug, version, blocks: snapshot.length, publishedAt: now };
}
