import "server-only";
import type { Client } from "@/lib/services/workspace";
import { toBlocks } from "@/lib/server/public-site";
import { SLUG_SHAPE } from "@/lib/services/cms";
import {
  LEGAL_DOCS, LEGAL_LOCALES, isLegalLocale, isLegalSlug, type LegalDocDef, type LegalLocale,
} from "@/lib/legal/docs";
import {
  cleanLegalDocInput, legalCharCount, readLegalDoc,
  type LegalDocContent, type LegalDocProblem, type LegalLocaleDoc, type LegalStatus,
} from "@/lib/legal/content";
import { legalSha256 } from "./published";

/**
 * THE LEGAL DOCUMENTS, AS THE ADMIN PANEL HANDLES THEM.
 *
 * Four jobs, all on the one store the public pages read (a `legal` section's
 * `doc` field, lib/legal/content.ts):
 *
 *   1. the SAVE — what the builder sends is cleaned (cleanLegalDocInput) and
 *      every language gets its sha256 and character count written HERE, on
 *      the server, so a digest shown anywhere describes the stored text and
 *      never something a browser claimed about it;
 *   2. the DOWNLOAD — the draft (or published) text of one language, byte for
 *      byte, as a .txt the admin can diff against the source file;
 *   3. the OVERVIEW on /admin/www — which documents exist, what is live, and
 *      whether the draft has moved on since the last publish;
 *   4. the HISTORY — which document each published version carried.
 *
 * Everything reads with the admin's own session: RLS (0051/0085) is what lets
 * an admin see drafts, and what stops anybody else. Who may ask is decided by
 * the callers (saveBlockAction's requireAdmin, the download route's gate).
 */

/* ── 1. THE SAVE ────────────────────────────────────────────────────────── */

/** Each language's digest and length, computed from the text itself. Any
 *  sha256/chars the input carried are replaced, never trusted. */
export function withLegalDigests(doc: LegalDocContent): LegalDocContent {
  const out = {} as LegalDocContent;
  for (const l of LEGAL_LOCALES) {
    const { status, text, version, effective } = doc[l];
    out[l] = { status, text, version, effective, sha256: legalSha256(text), chars: legalCharCount(text) };
  }
  return out;
}

export type LegalSaveOutcome<C> =
  | { ok: true; content: C }
  | { ok: false; error: LegalDocProblem; locale?: LegalLocale };

/**
 * A `legal` section's content as it may be stored. A section without a `doc`
 * key (one created before the documents moved here, or a brand-new empty
 * one) is stored as it came; one WITH a doc is stored only once the document
 * passes cleanLegalDocInput — and then with the server's digests.
 */
export function legalSectionForSave<C extends object>(content: C): LegalSaveOutcome<C> {
  if (!("doc" in content) || (content as { doc?: unknown }).doc === undefined) return { ok: true, content };
  const cleaned = cleanLegalDocInput((content as { doc?: unknown }).doc);
  if (!cleaned.ok) return cleaned;
  return { ok: true, content: { ...content, doc: withLegalDigests(cleaned.doc) } };
}

/* ── 2. THE DOWNLOAD ─────────────────────────────────────────────────────── */

export type LegalTextSource = "draft" | "published";

/** `?locale=` — Polish when absent, null (a 400) when it names anything else. */
export function parseLegalLocaleParam(raw: string | null): LegalLocale | null {
  if (raw === null || raw === "") return "pl";
  return isLegalLocale(raw) ? raw : null;
}

/** `?source=` — the draft unless the published snapshot is asked for. */
export function parseLegalSourceParam(raw: string | null): LegalTextSource | null {
  if (raw === null || raw === "" || raw === "draft") return "draft";
  return raw === "published" ? "published" : null;
}

/** A slug the download may be asked for: the shape every CMS slug has. */
export function isDownloadSlug(slug: string): boolean {
  return slug.length <= 80 && SLUG_SHAPE.test(slug);
}

/**
 * "regulamin_pl_v1.0_szkic.txt" — which document, which language, which of
 * its versions, and whether it is the draft or what is live. The version is
 * the admin's own label, so it is reduced to file-name-safe characters; an
 * empty one is left out rather than spelled "v".
 */
export function legalTextFilename(slug: string, locale: LegalLocale, version: string, source: LegalTextSource): string {
  const v = version.trim().replace(/[^0-9A-Za-z._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 32);
  return `${slug}_${locale}${v ? `_v${v}` : ""}_${source === "draft" ? "szkic" : "opublikowany"}.txt`;
}

/** The headers of the download: UTF-8 text, saved rather than shown, never
 *  cached (a draft is not public and changes with every save). */
export function legalTextHeaders(filename: string, bytes: number): Record<string, string> {
  return {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": String(bytes),
    "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
}

type BlockLike = { type: string; visible: boolean; content: unknown };

/**
 * The document of a list of sections: the first VISIBLE `legal` section with
 * a doc — the public reader's rule (lib/server/legal/published.ts) — and, for
 * the draft only, a hidden one when there is no visible one (an admin may
 * hide the section while working on it and still wants the text).
 */
export function legalDocOf(blocks: BlockLike[], allowHidden: boolean): LegalDocContent | null {
  const legal = blocks.filter((b) => b.type === "legal");
  const pick = (b: BlockLike | undefined) => (b ? readLegalDoc(b.content) : null);
  const visible = pick(legal.find((b) => b.visible && readLegalDoc(b.content)));
  if (visible || !allowHidden) return visible;
  return pick(legal.find((b) => readLegalDoc(b.content)));
}

type PageRowLite = { id: string; slug: string; title: string; status: string; published_at: string | null; published_snapshot: unknown };

async function draftDoc(supabase: Client, pageId: string): Promise<LegalDocContent | null> {
  const { data } = await supabase.from("cms_blocks").select("type, visible, sort_order, content")
    .eq("page_id", pageId).eq("type", "legal").order("sort_order");
  return legalDocOf((data ?? []).map((b) => ({ type: b.type, visible: b.visible, content: b.content })), true);
}

function publishedDoc(snapshot: unknown): LegalDocContent | null {
  return legalDocOf(toBlocks(snapshot).map((b) => ({ type: b.type, visible: b.visible, content: b.content })), false);
}

export type LegalTextFile = { filename: string; text: string; entry: LegalLocaleDoc };

/** One language of one page's document, draft or published — or null when
 *  the page, the section or that language's text does not exist. */
export async function readLegalTextFile(
  supabase: Client, slug: string, locale: LegalLocale, source: LegalTextSource,
): Promise<LegalTextFile | null> {
  if (!isDownloadSlug(slug)) return null;
  const { data: page } = await supabase.from("cms_pages")
    .select("id, slug, published_snapshot").eq("slug", slug).maybeSingle();
  if (!page) return null;
  const doc = source === "draft" ? await draftDoc(supabase, page.id) : publishedDoc(page.published_snapshot);
  const entry = doc?.[locale];
  if (!entry || entry.text === "") return null;
  return { filename: legalTextFilename(slug, locale, entry.version, source), text: entry.text, entry };
}

/* ── 3. THE OVERVIEW ────────────────────────────────────────────────────── */

export type LegalLocaleFacts = {
  status: LegalStatus;
  version: string;
  effective: string | null;
  chars: number;
  sha256: string | null;
};

export type LegalOverviewRow = {
  def: LegalDocDef;
  /** null: no CMS page with this slug yet ("brak strony"). */
  page: { id: string; title: string; status: string; publishedAt: string | null } | null;
  /** The highest cms_page_versions.version of the page, or null. */
  cmsVersion: number | null;
  /** What visitors read now, per language — null when the published page has
   *  no document (never published, or published before the import). */
  published: Record<LegalLocale, LegalLocaleFacts> | null;
  /** Whether the draft has a document at all. */
  draftHasDoc: boolean;
  /** The draft's document differs from the published one: a text (by
   *  sha256), a status, a version or a date. */
  unpublished: boolean;
};

/** The facts of one language — the stored digests when the save wrote them,
 *  computed from the text otherwise (a document stored before digests). */
export function localeFacts(entry: LegalLocaleDoc): LegalLocaleFacts {
  return {
    status: entry.status,
    version: entry.version,
    effective: entry.effective,
    chars: entry.chars ?? legalCharCount(entry.text),
    sha256: entry.text === "" ? null : entry.sha256 ?? legalSha256(entry.text),
  };
}

function docFacts(doc: LegalDocContent): Record<LegalLocale, LegalLocaleFacts> {
  const out = {} as Record<LegalLocale, LegalLocaleFacts>;
  for (const l of LEGAL_LOCALES) out[l] = localeFacts(doc[l]);
  return out;
}

/** Whether two documents differ in anything a visitor would see. */
export function legalDocsDiffer(a: LegalDocContent | null, b: LegalDocContent | null): boolean {
  if (!a || !b) return a !== b;
  const fa = docFacts(a);
  const fb = docFacts(b);
  return LEGAL_LOCALES.some((l) => fa[l].sha256 !== fb[l].sha256 || fa[l].status !== fb[l].status
    || fa[l].version !== fb[l].version || fa[l].effective !== fb[l].effective);
}

export async function legalOverview(supabase: Client): Promise<LegalOverviewRow[]> {
  const slugs = LEGAL_DOCS.map((d) => d.slug);
  const { data: pageRows, error } = await supabase.from("cms_pages")
    .select("id, slug, title, status, published_at, published_snapshot").in("slug", slugs);
  // A failed read is not "no page": saying "brak strony" about a live
  // Regulamin would be worse than saying nothing (the caller leaves it out).
  if (error) throw new Error(error.message);
  const pages = new Map(((pageRows ?? []) as PageRowLite[]).map((p) => [p.slug, p]));

  return Promise.all(LEGAL_DOCS.map(async (def): Promise<LegalOverviewRow> => {
    const page = pages.get(def.slug);
    if (!page) return { def, page: null, cmsVersion: null, published: null, draftHasDoc: false, unpublished: false };
    const [draft, version] = await Promise.all([
      draftDoc(supabase, page.id),
      supabase.from("cms_page_versions").select("version").eq("page_id", page.id)
        .order("version", { ascending: false }).limit(1).maybeSingle(),
    ]);
    // An unpublished page may still hold its last snapshot; it is not what
    // anybody reads, so it is not "the published document".
    const published = page.status === "published" ? publishedDoc(page.published_snapshot) : null;
    return {
      def,
      page: { id: page.id, title: page.title, status: page.status, publishedAt: page.published_at },
      cmsVersion: version.data?.version ?? null,
      published: published ? docFacts(published) : null,
      draftHasDoc: draft !== null,
      unpublished: draft !== null && legalDocsDiffer(draft, published),
    };
  }));
}

/* ── 4. THE HISTORY ─────────────────────────────────────────────────────── */

/** "Dokument v1.0 · 75 255 znaków · sha 151b56da…" of one published version,
 *  per CMS version id — for the versions whose snapshot holds a document. */
export type LegalVersionFacts = Partial<Record<LegalLocale, LegalLocaleFacts>>;

export async function legalVersionFacts(
  supabase: Client, page: { id: string; slug: string }, versionIds: string[],
): Promise<Record<string, LegalVersionFacts>> {
  if (versionIds.length === 0) return {};
  // Snapshots are read a second time only for a page that is, or holds, a
  // legal document — an ordinary page's history costs nothing extra.
  if (!isLegalSlug(page.slug)) {
    const { data: legal } = await supabase.from("cms_blocks").select("id")
      .eq("page_id", page.id).eq("type", "legal").limit(1);
    if (!legal || legal.length === 0) return {};
  }
  const { data } = await supabase.from("cms_page_versions").select("id, snapshot")
    .eq("page_id", page.id).in("id", versionIds);
  const out: Record<string, LegalVersionFacts> = {};
  for (const row of data ?? []) {
    const doc = publishedDoc(row.snapshot);
    if (!doc) continue;
    const facts: LegalVersionFacts = {};
    for (const l of LEGAL_LOCALES) if (doc[l].text !== "") facts[l] = localeFacts(doc[l]);
    out[row.id] = facts;
  }
  return out;
}
