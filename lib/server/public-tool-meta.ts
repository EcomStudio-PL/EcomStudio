import "server-only";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { stegaStrip } from "@/lib/ice/stega";
import { PUBLIC_CATALOGUE_PATH, PUBLIC_TOOLS, toolPageTextKeys, type PublicTool } from "@/lib/public-tools";
import { getPublicToolsFlag, listedToolPaths } from "@/lib/server/public-tools";

/**
 * A PUBLIC TOOL PAGE'S <title>, description, canonical and robots (Public
 * Tools V1).
 *
 * The title and description ARE the tool block's headline and paragraph —
 * the copy "Edytuj stronę" edits under the panel — so one edit changes the
 * page and its search snippet together, and there is no second place SEO copy
 * is kept. Stripped of the editor's invisible markers: a <title> is not a
 * place to paint them.
 *
 * Indexable only while the switch is on AND the catalogue lists the tool for
 * customers. Switched off (or hidden), the page says noindex — and a visitor
 * is sent to the sign-in dialog anyway — so nothing that was meant to be
 * closed stays in an index.
 */
export async function publicToolMetadata(tool: PublicTool): Promise<Metadata> {
  const [{ dict }, supabase] = await Promise.all([getDictionary(), createClient()]);
  const t = makeT(dict);
  const keys = toolPageTextKeys(tool.key);
  const title = stegaStrip(t(keys.headline));
  const description = stegaStrip(t(keys.lead));
  const indexable = (await getPublicToolsFlag(supabase)).enabled && (await listedToolPaths(supabase)).has(tool.path);
  return {
    title,
    description,
    alternates: { canonical: tool.path },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title, description, url: tool.path, type: "website", siteName: "GrovBase" },
  };
}

/** The catalogue's own: one canonical address, the same switch. */
export async function publicCatalogueMetadata(): Promise<Metadata> {
  const [{ dict }, supabase] = await Promise.all([getDictionary(), createClient()]);
  const t = makeT(dict);
  const title = stegaStrip(t("toolPage.catalogue.title"));
  const description = stegaStrip(t("toolPage.catalogue.description"));
  const indexable = (await getPublicToolsFlag(supabase)).enabled;
  return {
    title,
    description,
    alternates: { canonical: PUBLIC_CATALOGUE_PATH },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title, description, url: PUBLIC_CATALOGUE_PATH, type: "website", siteName: "GrovBase" },
  };
}

/** Every address the sitemap may list right now: none while the switch is
 *  off; the catalogue and the listed, adapted tools while it is on. */
export async function publicToolSitemapPaths(): Promise<string[]> {
  try {
    const supabase = await createClient();
    if (!(await getPublicToolsFlag(supabase)).enabled) return [];
    const listed = await listedToolPaths(supabase);
    return [PUBLIC_CATALOGUE_PATH, ...PUBLIC_TOOLS.filter((x) => listed.has(x.path)).map((x) => x.path)];
  } catch {
    return [];
  }
}
