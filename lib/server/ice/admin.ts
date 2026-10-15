import "server-only";
import type { Client } from "@/lib/services/workspace";
import { lookup } from "@/lib/i18n/t";
import pl from "@/lib/i18n/dictionaries/pl.json";
import { ICE_PAGES, ICE_UNSUPPORTED, icePageFor } from "@/lib/ice/registry";
import type { IceElementKind, IcePage, IcePageType } from "@/lib/ice/types";
import { UPLOAD_TOOLS } from "@/lib/seller-home-config";
import { toBlocks } from "@/lib/server/public-site";
import { blockFields } from "./cms";
import { applicableOverrides } from "./overrides";

/**
 * ADMIN → STRONY WWW → EDYTOR WIZUALNY — what the entry screen lists.
 *
 * Every page the visual editor can open (the registry's pages and the
 * published CMS pages, exactly the set `iceSupportedPaths` gives the
 * launcher), with what can be changed on it and when it last was. Plain data
 * only: the screen (a server component) translates the labels, and nothing
 * from the registry reaches a client component — which is also why this file
 * is a server-only boundary for scripts/i18n-scope-tests.ts: the i18n keys it
 * returns (`titleKey`, `detailKey`) are data the server translates, not copy
 * any client is sent.
 *
 * "Last change" is the newest content_versions row among the page's own keys
 * (text keys and slot keys for a registry page, `<pageId>:…` for a CMS page —
 * plus cms_pages.updated_at there). It is read as ONE window of the most
 * recent history rows, matched to pages in memory; only when that window is
 * full does a page with no row in it get a narrow query of its own, so the
 * answer is exact however long the history grows.
 */

export type IceAdminPageType = IcePageType | "launch";

export type IceAdminPage = {
  /** "registry:<page key>" | "cms:<page id>". */
  id: string;
  source: "registry" | "cms";
  /** The registry page key ("home", "plans", "tools", "tool.<slug>"). */
  registryKey: string | null;
  /** A CMS page's own title. */
  title: string | null;
  /** A tool page: the i18n key of the tool's name, as its header shows it. */
  titleKey: string | null;
  path: string;
  type: IceAdminPageType;
  texts: number;
  media: number;
  /** ISO timestamp, or null when nothing was ever changed. */
  lastChange: string | null;
};

export type IceAdminElement = {
  /** The page it is on. */
  path: string;
  /** The element id the editor opens from `#ice=<id>`. */
  id: string;
  kind: IceElementKind;
  /** The registry section key (iceAdmin.sec.<key>). */
  section: string;
  /** The role's first segment (iceAdmin.role.<role>): `samples.retouch` → `samples`. */
  role: string;
  index: number | null;
  /** An i18n key that tells same-role elements apart (a sample group: its tool). */
  detailKey: string | null;
  /** A text: the Polish copy visitors see now — the admin's change, else the shipped text. */
  value: string | null;
  /** A picture or clip: the media_slots keys it fills. */
  slots: string[];
};

export type IceAdminOverview = {
  pages: IceAdminPage[];
  elements: IceAdminElement[];
  unsupported: readonly { path: string; reason: string }[];
};

type Dict = Record<string, unknown>;
const PL = pl as Dict;

/** Rows of history read in one go before any per-page query is needed. */
const WINDOW = 500;

type CmsRow = {
  id: string; slug: string; title: string; kind: string; is_homepage: boolean;
  updated_at: string; published_snapshot: unknown;
};

const newer = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
};

/** The admin's Polish overrides that the site really applies (registered,
 *  not denied, valid) — the same filter the dictionary layer uses. */
async function polishOverrides(supabase: Client): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("content_overrides").select("key, value").eq("locale", "pl").limit(5000);
  if (error) {
    console.warn("ice admin: overrides unavailable", error.message);
    return {};
  }
  const rows: Record<string, string> = {};
  for (const r of data ?? []) rows[r.key] = r.value;
  return applicableOverrides(rows, PL);
}

async function publishedCmsPages(supabase: Client): Promise<CmsRow[]> {
  const { data, error } = await supabase.from("cms_pages")
    .select("id, slug, title, kind, is_homepage, updated_at, published_snapshot")
    .eq("status", "published").neq("kind", "app")
    .order("sort_order").order("created_at");
  if (error) {
    console.warn("ice admin: cms pages unavailable", error.message);
    return [];
  }
  return (data ?? []) as CmsRow[];
}

type Owned = { id: string; texts: string[]; slots: string[] };

async function lastChanges(supabase: Client, registry: Owned[], cmsIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { data, error } = await supabase.from("content_versions").select("target, key, created_at")
    .order("created_at", { ascending: false }).limit(WINDOW);
  if (error) {
    console.warn("ice admin: history unavailable", error.message);
    return out;
  }
  const rows = data ?? [];

  const byText = new Map<string, string[]>();
  const bySlot = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, key: string, id: string) => m.set(key, [...(m.get(key) ?? []), id]);
  for (const p of registry) {
    for (const k of p.texts) add(byText, k, p.id);
    for (const k of p.slots) add(bySlot, k, p.id);
  }
  const cms = new Set(cmsIds);

  // Newest first, so the first row a page owns is its last change.
  for (const r of rows) {
    let owners: string[] | undefined;
    if (r.target === "text") owners = byText.get(r.key);
    else if (r.target === "slot") owners = bySlot.get(r.key);
    else if (r.target === "cms") {
      const pageId = r.key.split(":")[0];
      owners = cms.has(pageId) ? [`cms:${pageId}`] : undefined;
    }
    for (const id of owners ?? []) if (!out.has(id)) out.set(id, r.created_at);
  }
  if (rows.length < WINDOW) return out;

  // The window was full: a page with no row in it may still have older ones.
  const newest = async (q: PromiseLike<{ data: { created_at: string }[] | null }>) => (await q).data?.[0]?.created_at ?? null;
  const versions = () => supabase.from("content_versions").select("created_at");
  await Promise.all([
    ...registry.filter((p) => !out.has(p.id)).map(async (p) => {
      const [text, slot] = await Promise.all([
        p.texts.length ? newest(versions().eq("target", "text").in("key", p.texts).order("created_at", { ascending: false }).limit(1)) : null,
        p.slots.length ? newest(versions().eq("target", "slot").in("key", p.slots).order("created_at", { ascending: false }).limit(1)) : null,
      ]);
      const at = newer(text, slot);
      if (at) out.set(p.id, at);
    }),
    ...cmsIds.filter((id) => !out.has(`cms:${id}`)).map(async (id) => {
      const at = await newest(versions().eq("target", "cms").like("key", `${id}:%`).order("created_at", { ascending: false }).limit(1));
      if (at) out.set(`cms:${id}`, at);
    }),
  ]);
  return out;
}

/** The page's elements, once each (a tile shared by two sections is listed
 *  where it first appears — where the editor opens it). */
function elementsOf(page: IcePage, polish: (key: string) => string | null): IceAdminElement[] {
  const seen = new Set<string>();
  const out: IceAdminElement[] = [];
  for (const s of page.sections) for (const e of s.elements) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const [role, sub] = e.role.split(".");
    out.push({
      path: page.path,
      id: e.id,
      kind: e.kind,
      section: s.key,
      role,
      index: e.index ?? null,
      detailKey: e.kind === "samples" && sub ? UPLOAD_TOOLS.find((u) => u.key === sub)?.pillKey ?? null : null,
      value: e.kind === "text" && e.text ? polish(e.text.key) : null,
      slots: (e.slots ?? []).map((x) => x.key),
    });
  }
  return out;
}

export async function iceAdminOverview(supabase: Client): Promise<IceAdminOverview> {
  const [overrides, cmsRows] = await Promise.all([polishOverrides(supabase), publishedCmsPages(supabase)]);
  const polish = (key: string): string | null => overrides[key] ?? lookup(PL, key) ?? null;

  const elements: IceAdminElement[] = [];
  const pages: IceAdminPage[] = [];
  const owned: Owned[] = [];

  for (const page of ICE_PAGES) {
    const els = elementsOf(page, polish);
    elements.push(...els);
    const id = `registry:${page.key}`;
    const texts = els.filter((e) => e.kind === "text");
    const media = els.filter((e) => e.kind !== "text");
    owned.push({ id, texts: texts.map((e) => e.id), slots: [...new Set(media.flatMap((e) => e.slots))] });
    pages.push({
      id,
      source: "registry",
      registryKey: page.key,
      title: null,
      titleKey: page.type === "tool"
        ? page.sections[0]?.elements.find((e) => e.kind === "text")?.text?.key ?? null
        : null,
      path: page.path,
      type: page.type,
      texts: texts.length,
      media: media.length,
      lastChange: null,
    });
  }

  const cmsIds: string[] = [];
  for (const row of cmsRows) {
    const path = row.is_homepage ? "/" : `/${row.slug}`;
    // A path the registry serves opens the registry page (setEdit checks it
    // first), so the CMS row would only be a second, unreachable entry.
    if (icePageFor(path)) continue;
    // What an admin can click: the fields of the blocks the page shows.
    const fields = toBlocks(row.published_snapshot).filter((b) => b.visible).flatMap((b) => blockFields(b, null));
    cmsIds.push(row.id);
    pages.push({
      id: `cms:${row.id}`,
      source: "cms",
      registryKey: null,
      title: row.title,
      titleKey: null,
      path,
      type: row.kind === "launch" ? "launch" : "cms",
      texts: fields.filter((f) => f.kind === "text").length,
      media: fields.filter((f) => f.kind === "media").length,
      lastChange: row.updated_at,
    });
  }

  const changes = await lastChanges(supabase, owned, cmsIds);
  for (const p of pages) p.lastChange = newer(p.lastChange, changes.get(p.id) ?? null);

  return { pages, elements, unsupported: ICE_UNSUPPORTED };
}
