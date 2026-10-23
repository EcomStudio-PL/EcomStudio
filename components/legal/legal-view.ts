import { LEGAL_DOCS, LEGAL_LOCALES, annexesOf, legalDoc, type LegalLocale } from "@/lib/legal/docs";
import type { LegalDocContent } from "@/lib/legal/content";
import type { LegalHeading } from "@/lib/legal/document";

/**
 * WHAT THE PUBLIC DOCUMENT PAGE SHOWS AROUND THE TEXT — as plain data.
 *
 * The text itself is LegalText's job (every source line, verbatim). This
 * module decides everything next to it: the table of contents, the document
 * switcher, the language row, the related documents and the PDF address.
 * Pure and isomorphic, so the page (server), the table of contents (client)
 * and scripts/legal-render-tests.ts all read the same answers.
 */

/* ── TABLE OF CONTENTS ───────────────────────────────────────────────────── */

export type LegalTocChild = { id: string; text: string };
export type LegalTocEntry = { id: string; text: string; children: LegalTocChild[] };

/**
 * The document's own headings as a two-level tree: every h2 with the h3s that
 * follow it (Rozdział I → § 1 … § 6). An h3 with no h2 before it stands on
 * its own rather than disappearing — the ToC lists every heading the text has.
 */
export function legalTocTree(headings: readonly LegalHeading[]): LegalTocEntry[] {
  const out: LegalTocEntry[] = [];
  let parent: LegalTocEntry | null = null;
  for (const h of headings) {
    if (h.level === 3 && parent) {
      parent.children.push({ id: h.id, text: h.text });
      continue;
    }
    const entry: LegalTocEntry = { id: h.id, text: h.text, children: [] };
    out.push(entry);
    parent = h.level === 2 ? entry : null;
  }
  return out;
}

/** Every id the tree links to, in document order. */
export function legalTocIds(tree: readonly LegalTocEntry[]): string[] {
  return tree.flatMap((e) => [e.id, ...e.children.map((c) => c.id)]);
}

/* ── THE FOUR DOCUMENTS ──────────────────────────────────────────────────── */

/** The short names the switcher and the footer use ("Regulamin", not
 *  "Regulamin GrovBase"). Spelled out so every key is a literal the i18n
 *  checks can see. */
const SHORT_KEYS: Record<string, string> = {
  regulamin: "legal.termsShort",
  "polityka-prywatnosci": "legal.privacyShort",
  "polityka-cookies": "legal.cookiesShort",
  "umowa-powierzenia-danych": "legal.dpaShort",
};

export function legalShortKey(slug: string): string {
  return SHORT_KEYS[slug] ?? legalDoc(slug)?.titleKey ?? "legal.termsShort";
}

/** The public address of a document. `polish` keeps a visitor who chose the
 *  Polish text (?lang=pl) on it while they move between documents. */
export function legalHref(slug: string, polish = false): string {
  return `/${slug}${polish ? "?lang=pl" : ""}`;
}

export type LegalSwitchItem = { slug: string; href: string; labelKey: string; current: boolean };

export function legalSwitcher(current: string, polish = false): LegalSwitchItem[] {
  return [...LEGAL_DOCS]
    .sort((a, b) => a.navOrder - b.navOrder)
    .map((d) => ({ slug: d.slug, href: legalHref(d.slug, polish), labelKey: legalShortKey(d.slug), current: d.slug === current }));
}

export type LegalRelatedItem = {
  slug: string;
  href: string;
  /** The document's name. */
  titleKey: string;
  /** What ties the two together ("Załącznik nr 2 do Regulaminu"). */
  labelKey: string;
  relation: "annex" | "parent";
};

/**
 * The documents bound to this one: the Regulamin lists its annexes (the DPA
 * is Załącznik nr 2), an annex points back to the document it belongs to.
 */
export function legalRelated(slug: string, polish = false): LegalRelatedItem[] {
  const annexes: LegalRelatedItem[] = annexesOf(slug).flatMap((d) => d.annexOf
    ? [{ slug: d.slug, href: legalHref(d.slug, polish), titleKey: d.titleKey, labelKey: d.annexOf.labelKey, relation: "annex" as const }]
    : []);
  const of = legalDoc(slug)?.annexOf;
  const parent = of ? legalDoc(of.slug) : null;
  return parent && of
    ? [...annexes, { slug: parent.slug, href: legalHref(parent.slug, polish), titleKey: parent.titleKey, labelKey: of.labelKey, relation: "parent" }]
    : annexes;
}

/* ── VERSION, DATE, LANGUAGES, PDF ───────────────────────────────────────── */

/**
 * The PDF of exactly this text: `?v=` is its PDF tag (legalPdfTag,
 * lib/server/legal/published.ts — text, version, date, language), so any
 * change is a new address and no cache can hand out the old file; `&lang=` only for a
 * language other than Polish, the route's default.
 */
export function legalPdfHref(slug: string, tag: string, locale: LegalLocale = "pl"): string {
  return `/${slug}/pdf?v=${encodeURIComponent(tag)}${locale === "pl" ? "" : `&lang=${locale}`}`;
}

const INTL: Record<string, string> = { pl: "pl-PL", en: "en-GB", de: "de-DE" };

/** "2026-10-20" → "20 października 2026" / "20 October 2026" / "20. Oktober
 *  2026". A calendar date, not a moment: formatted in UTC so no server time
 *  zone can move it to the day before. */
export function legalDateLabel(iso: string, locale: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(INTL[locale] ?? "pl-PL", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** A language has a text a visitor can read: published as active, and not
 *  blank. The same test legalViewFor makes before it shows a text. */
export function legalHasText(doc: LegalDocContent, locale: LegalLocale): boolean {
  return doc[locale].status === "active" && doc[locale].text.trim() !== "";
}

export type LegalLanguageItem = {
  locale: LegalLocale;
  /** The language has a published text. */
  active: boolean;
  /** The text on screen is this language. */
  current: boolean;
  /** Where to read it, or null when no address leads there (the interface
   *  language decides which translation a visitor gets; only the Polish
   *  text can be asked for by URL). */
  href: string | null;
};

/**
 * PL • EN • DE as the page shows them: which exist, which one is on screen,
 * and the one link each can honestly offer.
 */
export function legalLanguages(
  doc: LegalDocContent, slug: string, shown: LegalLocale, visitor: string,
): LegalLanguageItem[] {
  return LEGAL_LOCALES.map((locale) => {
    const active = legalHasText(doc, locale);
    const current = locale === shown;
    let href: string | null = null;
    if (active && !current) {
      if (locale === "pl") href = legalHref(slug, visitor !== "pl");
      else if (locale === visitor) href = legalHref(slug);
    }
    return { locale, active, current, href };
  });
}
