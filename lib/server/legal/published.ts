import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getPublishedPage, type PublicPage } from "@/lib/server/public-site";
import { readLegalDoc, type LegalDocContent } from "@/lib/legal/content";

/**
 * A PUBLISHED LEGAL DOCUMENT — the one reader the public page and the PDF
 * route share, so the two can never show different text.
 *
 * The document is the first VISIBLE `legal` section of the published page
 * that carries a `doc` field (lib/legal/content.ts). A page published before
 * the import has no such section: `doc` is null and the caller falls back to
 * whatever it showed before.
 */
export type PublishedLegal = {
  page: PublicPage | null;
  doc: LegalDocContent | null;
};

export async function getPublishedLegal(slug: string): Promise<PublishedLegal> {
  const supabase = await createClient();
  const page = await getPublishedPage(supabase, slug);
  const block = page?.blocks.find((b) => b.visible && b.type === "legal" && readLegalDoc(b.content));
  return { page, doc: block ? readLegalDoc(block.content) : null };
}

/** sha256 of a text as stored (UTF-8), hex — the same digest the editor's
 *  save writes into the document and the import checks. */
export function legalSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The short version tag a PDF URL carries (`?v=`): the first 12 hex
 *  characters of the text's digest, so a new text is a new URL. */
export function legalVersionTag(text: string, stored?: string): string {
  return (stored && /^[0-9a-f]{64}$/.test(stored) ? stored : legalSha256(text)).slice(0, 12);
}
