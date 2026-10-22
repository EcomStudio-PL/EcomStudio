/**
 * THE FOUR LEGAL DOCUMENTS GROVBASE PUBLISHES.
 *
 * One list, read by the public routes, the PDF routes, the admin overview,
 * the inline editor's exclusion and the import. Each document is an ordinary
 * CMS page (cms_pages, slug below) whose text lives in ONE `legal` section's
 * `doc` field (lib/legal/content.ts) — there is no second document store.
 *
 * The slugs are the public URLs and the keys the pre-launch consent records
 * already use for the first two (prelaunch_consents.doc_versions), so they
 * must never change.
 */

export const LEGAL_LOCALES = ["pl", "en", "de"] as const;
export type LegalLocale = (typeof LEGAL_LOCALES)[number];

export type LegalDocDef = {
  slug: string;
  /** i18n key of the document's name (H1 fallback, links, metadata). */
  titleKey: string;
  /** The PDF file name, without the version suffix or extension. */
  pdfName: string;
  /** Footer / navigation order (also cms_pages.nav_order on import). */
  navOrder: number;
  /** A document that is an annex of another one (the DPA is Załącznik nr 2
   *  to the Regulamin): the slug it belongs to and the i18n key naming it. */
  annexOf?: { slug: string; labelKey: string };
};

export const LEGAL_DOCS: readonly LegalDocDef[] = [
  { slug: "regulamin", titleKey: "legal.termsTitle", pdfName: "Regulamin_GrovBase", navOrder: 10 },
  { slug: "polityka-prywatnosci", titleKey: "legal.privacyTitle", pdfName: "Polityka_Prywatnosci_GrovBase", navOrder: 20 },
  { slug: "polityka-cookies", titleKey: "legal.cookiesTitle", pdfName: "Polityka_Cookies_GrovBase", navOrder: 30 },
  {
    slug: "umowa-powierzenia-danych", titleKey: "legal.dpaTitle", pdfName: "Umowa_Powierzenia_Danych_GrovBase", navOrder: 40,
    annexOf: { slug: "regulamin", labelKey: "legal.annex2" },
  },
] as const;

export const LEGAL_SLUGS: readonly string[] = LEGAL_DOCS.map((d) => d.slug);

export function isLegalSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && LEGAL_SLUGS.includes(slug);
}

export function legalDoc(slug: string): LegalDocDef | null {
  return LEGAL_DOCS.find((d) => d.slug === slug) ?? null;
}

/** The documents that are annexes of `slug` (the Regulamin → the DPA). */
export function annexesOf(slug: string): LegalDocDef[] {
  return LEGAL_DOCS.filter((d) => d.annexOf?.slug === slug);
}

export function isLegalLocale(value: unknown): value is LegalLocale {
  return typeof value === "string" && (LEGAL_LOCALES as readonly string[]).includes(value);
}
