/**
 * WHAT THE LEGAL PDF CAN DRAW — character by character.
 *
 * The PDF (lib/server/legal/pdf.ts) sets every character in the embedded
 * Inter TTFs. A character neither has a glyph for comes out as the font's
 * .notdef: an empty box, in the middle of a legal sentence. Text exported
 * from Word brings a few of those along, and they fall into two groups:
 *
 *   • characters with a meaning the PDF can keep without a glyph — handled
 *     where the text is drawn, the stored text untouched (legalPdfCharRole):
 *       tab, line tabulation (VT), form feed  → a breakable space (a tab a
 *                                                wider one)
 *       U+2028, U+2029 (line/paragraph sep.)  → a line break in the paragraph
 *       soft hyphen U+00AD, zero-width U+200B,
 *       U+200C, U+200D, U+2060, U+FEFF        → not drawn (lines break only
 *                                                at spaces, so a soft hyphen
 *                                                is never visible anyway)
 *
 *   • everything else the fonts lack (☐ ☑ ✔, Word's Symbol bullet U+F0B7,
 *     emoji…) — no substitute glyph is invented for them; the PDF draws the
 *     box, and legalPdfUncovered() names them so the admin panel can say so
 *     before anybody downloads the file.
 *
 * WHICH CODE POINTS THE FONTS COVER is the table below: every code point for
 * which BOTH Inter-Regular.ttf and Inter-SemiBold.ttf have a glyph (fontkit's
 * hasGlyphForCodePoint — the two files cover exactly the same 2 849). It is a
 * table rather than a font read because the admin overview (/admin/www) runs
 * where the TTFs are not deployed (next.config.mjs traces them into the four
 * PDF routes only), and because this module stays pure. npm run
 * test:legal:pdf checks it against both fonts for all 1 114 112 code points
 * and prints the replacement table if a font file ever changes.
 */

/** [first, last] inclusive, ascending — the code points both Inter TTFs have a glyph for. */
const COVERED: readonly number[] = [
  0x0000, 0x0000, 0x0020, 0x007e, 0x00a0, 0x00ac, 0x00ae, 0x0148, 0x014a, 0x01c3, 0x01c5, 0x0254,
  0x0256, 0x027b, 0x027e, 0x0284, 0x0286, 0x0290, 0x0292, 0x02a4, 0x02a6, 0x0304, 0x0306, 0x030a,
  0x030c, 0x030c, 0x030f, 0x030f, 0x0313, 0x0313, 0x0315, 0x0315, 0x031b, 0x031b, 0x0323, 0x0323,
  0x0326, 0x0328, 0x032c, 0x032c, 0x0337, 0x0338, 0x0342, 0x0343, 0x0346, 0x036f, 0x0374, 0x0376,
  0x037a, 0x037f, 0x0384, 0x038a, 0x038c, 0x038c, 0x038e, 0x03a1, 0x03a3, 0x03d7, 0x03dc, 0x03dd,
  0x03f0, 0x03f6, 0x03f9, 0x03fa, 0x03fc, 0x0479, 0x0480, 0x049d, 0x04a0, 0x04ff, 0x052f, 0x052f,
  0x0e3f, 0x0e3f, 0x1d00, 0x1d00, 0x1d0d, 0x1d0d, 0x1d1b, 0x1d1b, 0x1d43, 0x1d43, 0x1d47, 0x1d49,
  0x1d4d, 0x1d4d, 0x1d4f, 0x1d50, 0x1d52, 0x1d52, 0x1d56, 0x1d58, 0x1d5b, 0x1d5b, 0x1d62, 0x1d65,
  0x1d9c, 0x1d9c, 0x1da0, 0x1da0, 0x1dbb, 0x1dbb, 0x1dbf, 0x1df5, 0x1dfc, 0x1e9b, 0x1e9d, 0x1f15,
  0x1f18, 0x1f1d, 0x1f20, 0x1f45, 0x1f48, 0x1f4d, 0x1f50, 0x1f57, 0x1f59, 0x1f59, 0x1f5b, 0x1f5b,
  0x1f5d, 0x1f5d, 0x1f5f, 0x1f7d, 0x1f80, 0x1fb4, 0x1fb6, 0x1fc4, 0x1fc6, 0x1fd3, 0x1fd6, 0x1fdb,
  0x1fdd, 0x1fef, 0x1ff2, 0x1ff4, 0x1ff6, 0x1ffe, 0x2000, 0x200b, 0x2010, 0x2027, 0x202f, 0x2055,
  0x2057, 0x2057, 0x205f, 0x205f, 0x2070, 0x2071, 0x2074, 0x208e, 0x2090, 0x209c, 0x20a0, 0x20af,
  0x20b1, 0x20b5, 0x20b8, 0x20ba, 0x20bc, 0x20bf, 0x20db, 0x20de, 0x20e8, 0x20e8, 0x20f0, 0x20f0,
  0x2100, 0x2101, 0x2103, 0x2103, 0x2105, 0x2106, 0x2109, 0x2109, 0x2113, 0x2113, 0x2116, 0x2117,
  0x211e, 0x2122, 0x2126, 0x2126, 0x212a, 0x212b, 0x212e, 0x212e, 0x2132, 0x2132, 0x213b, 0x213b,
  0x214d, 0x214d, 0x2150, 0x217f, 0x2183, 0x2186, 0x2189, 0x2189, 0x2190, 0x2199, 0x21a9, 0x21aa,
  0x21b0, 0x21b1, 0x21b3, 0x21b5, 0x21ba, 0x21bb, 0x21d0, 0x21d0, 0x21d2, 0x21d2, 0x21d4, 0x21d4,
  0x21de, 0x21df, 0x21e4, 0x21e5, 0x21e7, 0x21e7, 0x21ea, 0x21ea, 0x2202, 0x2202, 0x2205, 0x2206,
  0x220f, 0x220f, 0x2211, 0x2212, 0x221a, 0x221a, 0x221e, 0x221e, 0x222b, 0x222b, 0x2236, 0x2236,
  0x2248, 0x2248, 0x2260, 0x2260, 0x2264, 0x2265, 0x2295, 0x2298, 0x2303, 0x2305, 0x2318, 0x2318,
  0x2325, 0x2327, 0x232b, 0x232b, 0x2380, 0x2380, 0x2387, 0x2387, 0x238b, 0x238b, 0x23ce, 0x23cf,
  0x2423, 0x2423, 0x2460, 0x2468, 0x24b6, 0x24cf, 0x24ea, 0x24ea, 0x25a0, 0x25a2, 0x25aa, 0x25aa,
  0x25b2, 0x25b3, 0x25b6, 0x25b7, 0x25ba, 0x25bd, 0x25c0, 0x25c1, 0x25c4, 0x25c7, 0x25ca, 0x25cb,
  0x25cf, 0x25cf, 0x25e6, 0x25e6, 0x25ef, 0x25ef, 0x2600, 0x2600, 0x2605, 0x2606, 0x263c, 0x263c,
  0x2661, 0x2661, 0x2665, 0x2665, 0x26a0, 0x26a0, 0x2713, 0x2713, 0x2717, 0x2717, 0x2756, 0x2756,
  0x2764, 0x2764, 0x2780, 0x2788, 0x27ef, 0x27ef, 0x27f5, 0x27fa, 0x2913, 0x2913, 0x2a38, 0x2a38,
  0x2b06, 0x2b06, 0x2b12, 0x2b13, 0x2b1c, 0x2b1c, 0x2b24, 0x2b24, 0x2c7c, 0x2c7c, 0x2c7f, 0x2c7f,
  0x2dff, 0x2dff, 0x2e18, 0x2e18, 0xa69f, 0xa69f, 0xa7ff, 0xa7ff, 0xa92e, 0xa92e, 0xe000, 0xe000,
  0xe002, 0xe05e, 0xe06a, 0xe0bd, 0xe0c8, 0xe0cc, 0xe0dc, 0xe0e6, 0xe0f3, 0xe0f5, 0xe106, 0xe106,
  0xe109, 0xe10a, 0xe10c, 0xe10f, 0xe111, 0xe113, 0xe117, 0xe118, 0xe121, 0xe122, 0xe124, 0xe124,
  0xe12a, 0xe15e, 0xe163, 0xe163, 0xe1c3, 0xe1c3, 0xe1d2, 0xe1df, 0xe1e1, 0xe2dc, 0xee01, 0xee07,
  0xee09, 0xee0a, 0xee0c, 0xee12, 0xee14, 0xee14, 0xee17, 0xee17, 0xee1d, 0xee45, 0xee47, 0xee84,
  0xee87, 0xeed6, 0xeed8, 0xeee1, 0xf6c3, 0xf6c3, 0xfeff, 0xfeff, 0x1f12f, 0x1f149, 0x1f16a, 0x1f16b,
  0x1f850, 0x1f850, 0x1f852, 0x1f852,
];

/** Whether both embedded Inter fonts have a glyph for `cp`. */
export function legalPdfHasGlyph(cp: number): boolean {
  // Binary search over the ranges: the last range starting at or before cp.
  let lo = 0;
  let hi = COVERED.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (COVERED[mid * 2] > cp) hi = mid - 1;
    else if (COVERED[mid * 2 + 1] < cp) lo = mid + 1;
    else return true;
  }
  return false;
}

/** The ranges themselves, for the test that compares them with the fonts. */
export function legalPdfGlyphRanges(): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < COVERED.length; i += 2) out.push([COVERED[i], COVERED[i + 1]]);
  return out;
}

/**
 * What the PDF does with a character that is not drawn as its own glyph:
 *   "space"  — a breakable space (VT, FF)
 *   "tab"    — a breakable space, drawn wider
 *   "break"  — a line break inside the paragraph (U+2028, U+2029)
 *   "hidden" — nothing at all (soft hyphen, zero-width characters)
 * null for every other character: it is drawn as itself.
 */
export type LegalPdfCharRole = "space" | "tab" | "break" | "hidden";

// Code points, not characters: an invisible character typed into a source
// file is one nobody can see in a review.
const ROLES: ReadonlyMap<number, LegalPdfCharRole> = new Map<number, LegalPdfCharRole>([
  [0x0009, "tab"],
  [0x000b, "space"],
  [0x000c, "space"],
  [0x2028, "break"],
  [0x2029, "break"],
  [0x00ad, "hidden"],
  [0x200b, "hidden"],
  [0x200c, "hidden"],
  [0x200d, "hidden"],
  [0x2060, "hidden"],
  [0xfeff, "hidden"],
]);

/** The role of one character (a one-code-point string), or null. */
export function legalPdfCharRole(ch: string): LegalPdfCharRole | null {
  return ROLES.get(ch.codePointAt(0) ?? -1) ?? null;
}

/** The body of a RegExp character class matching the characters with one of
 *  `roles` (use it with the "u" flag). */
export function legalPdfRoleClass(roles: readonly LegalPdfCharRole[]): string {
  return [...ROLES].filter(([, role]) => roles.includes(role)).map(([cp]) => `\\u{${cp.toString(16)}}`).join("");
}

/** Whether a string holds any character with a role — the drawing's fast
 *  path skips the per-character work when it does not. */
export const LEGAL_PDF_ROLE_CHARS = new RegExp(`[${legalPdfRoleClass(["space", "tab", "break", "hidden"])}]`, "u");

export type LegalPdfUncoveredChar = {
  /** The character itself. */
  char: string;
  codePoint: number;
  /** How many times the text holds it. */
  count: number;
};

/**
 * The characters of `text` the PDF can only draw as an empty box: neither a
 * glyph in both embedded fonts nor one of the roles above, line ends (the
 * text's own "\n", and "\r") aside. In order of first appearance.
 */
export function legalPdfUncovered(text: string): LegalPdfUncoveredChar[] {
  const found = new Map<string, LegalPdfUncoveredChar>();
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    // Printable ASCII is the bulk of any document and always covered.
    if (cp >= 0x20 && cp <= 0x7e) continue;
    if (ch === "\n" || ch === "\r" || ROLES.has(cp) || legalPdfHasGlyph(cp)) continue;
    // A variation selector ("™️", "❤️" pasted from the web) is folded into the
    // glyph before it by the font layout and never drawn on its own; an
    // uncovered base character ("✔️") is reported through that character.
    if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) continue;
    const seen = found.get(ch);
    if (seen) seen.count += 1;
    else found.set(ch, { char: ch, codePoint: cp, count: 1 });
  }
  return [...found.values()];
}

/** "U+F0B7", "U+1F600" — how the admin panel names a code point. */
export function legalCodePointLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}
