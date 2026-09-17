import "server-only";
import type { Client } from "@/lib/services/workspace";
import type { CmsBlock } from "@/lib/cms";

/**
 * WHAT THE RENDERER KNOWS ABOUT THE IMAGES ON A PAGE.
 *
 * A block stores an image as a URL, which is the right thing for it to store:
 * an admin may paste an external logo, and the CMS must not insist that every
 * picture be one of ours. But a URL alone cannot tell the renderer how big the
 * picture is or whether smaller copies of it exist — and without those two
 * facts an image cannot be emitted without layout shift or an oversized
 * download.
 *
 * So the page collects every image URL it is about to render and asks for all
 * of their metadata IN ONE QUERY. One round trip per page, not one per image:
 * a twenty-section page must not become twenty selects, which is exactly the
 * "20 requests for 20 sections" the brief refuses.
 *
 * An image with no row here still renders — it simply renders without srcset,
 * which is what an external URL has always done.
 */

export type MediaMeta = {
  width?: number;
  height?: number;
  /** width → url, for srcset. Absent until the derivative job has run. */
  variants?: Record<string, string>;
  alt?: string;
};

export type MediaIndex = Map<string, MediaMeta>;

/** Every field in a block that holds an image or a poster. */
function urlsInBlock(block: CmsBlock): string[] {
  const c = block.content ?? {};
  const out = [c.mediaUrl, c.media2Url, c.posterUrl];
  for (const item of c.items ?? []) out.push(item.mediaUrl, item.media2Url);
  return out.filter((u): u is string => typeof u === "string" && u.length > 0);
}

export function collectMediaUrls(blocks: readonly CmsBlock[]): string[] {
  const seen = new Set<string>();
  for (const block of blocks) for (const url of urlsInBlock(block)) seen.add(url);
  return [...seen];
}

const EMPTY: MediaIndex = new Map();

/**
 * Metadata for the given URLs. Matching is on the PUBLIC URL, which is what a
 * block stores, so the query asks for the rows whose storage path is the tail
 * of one of those URLs — and for external assets, on external_url directly.
 */
export async function loadMediaIndex(supabase: Client, urls: readonly string[]): Promise<MediaIndex> {
  if (urls.length === 0) return EMPTY;

  // The public URL of a stored object ends with `/media/<path>`; the path is
  // what the row holds. Deriving it here means one `in` filter instead of a
  // LIKE per URL.
  const paths = new Set<string>();
  const externals = new Set<string>();
  for (const url of urls) {
    const marker = url.indexOf("/object/public/media/");
    if (marker !== -1) paths.add(decodeURIComponent(url.slice(marker + "/object/public/media/".length)));
    else externals.add(url);
  }

  const index: MediaIndex = new Map();
  const bucketBase = (path: string) => path;

  const queries: Promise<void>[] = [];
  if (paths.size > 0) {
    queries.push((async () => {
      const { data } = await supabase.from("media_assets")
        .select("storage_path, external_url, width, height, variants, alt")
        .in("storage_path", [...paths]);
      for (const row of data ?? []) {
        if (!row.storage_path) continue;
        // Keyed by the tail so the caller can look up by either form.
        index.set(bucketBase(row.storage_path), toMeta(row));
      }
    })());
  }
  if (externals.size > 0) {
    queries.push((async () => {
      const { data } = await supabase.from("media_assets")
        .select("storage_path, external_url, width, height, variants, alt")
        .in("external_url", [...externals]);
      for (const row of data ?? []) {
        if (row.external_url) index.set(row.external_url, toMeta(row));
      }
    })());
  }
  await Promise.all(queries);
  return index;
}

type Row = {
  width: number | null; height: number | null;
  variants: unknown; alt: string | null;
};

function toMeta(row: Row): MediaMeta {
  const variants = row.variants && typeof row.variants === "object" && !Array.isArray(row.variants)
    ? Object.fromEntries(
        Object.entries(row.variants as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string") as [string, string][],
      )
    : undefined;
  return {
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    variants: variants && Object.keys(variants).length > 0 ? variants : undefined,
    alt: row.alt ?? undefined,
  };
}

/** Look one URL up, accepting either the public URL or a bare storage path. */
export function metaFor(index: MediaIndex, url: string | undefined | null): MediaMeta | undefined {
  if (!url) return undefined;
  const marker = url.indexOf("/object/public/media/");
  if (marker !== -1) {
    return index.get(decodeURIComponent(url.slice(marker + "/object/public/media/".length)));
  }
  return index.get(url);
}
