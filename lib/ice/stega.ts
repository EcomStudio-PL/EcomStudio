/**
 * INVISIBLE ELEMENT MARKERS for the inline editor's edit mode.
 *
 * In edit mode — an admin's own render, never a customer's — each editable
 * string carries, after its last visible character, which element it is:
 * `TAG_START`, the ASCII payload (`t:<i18n key>`, `c:<block>:<path>`, …) as
 * Unicode TAG characters, and `TAG_END`. Tag characters (U+E0000–U+E007F) are
 * default-ignorable: zero width, no glyph, no line-break opportunity, and they
 * survive React escaping, `text-transform` and hydration unchanged. That lets
 * the editor find "the text node that came from this key" without a single
 * new attribute or wrapper in the page's markup — the markup a customer gets
 * is the markup that was there before.
 *
 * The editor reads them and nothing else may: every value an operator saves
 * is checked for tag characters on the server (`hasTagChars`), so a saved
 * string can never carry a marker of its own.
 */

const BASE = 0xe0000;
export const TAG_START = String.fromCodePoint(0xe0001);
export const TAG_END = String.fromCodePoint(0xe007f);
const PRINTABLE = /^[\x20-\x7e]+$/;

/** The marker for one element: invisible, appended to its visible text. */
export function stegaMark(payload: string): string {
  if (!PRINTABLE.test(payload)) return "";
  let out = TAG_START;
  for (const ch of payload) out += String.fromCodePoint(BASE + ch.charCodeAt(0));
  return out + TAG_END;
}

/** Every marker in a string, in order of appearance. */
export function stegaRead(text: string): string[] {
  const found: string[] = [];
  let i = text.indexOf(TAG_START);
  while (i !== -1) {
    const end = text.indexOf(TAG_END, i + TAG_START.length);
    if (end === -1) break;
    let payload = "";
    for (const ch of text.slice(i + TAG_START.length, end)) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp < BASE + 0x20 || cp > BASE + 0x7e) { payload = ""; break; }
      payload += String.fromCharCode(cp - BASE);
    }
    if (payload) found.push(payload);
    i = text.indexOf(TAG_START, end + TAG_END.length);
  }
  return found;
}

/** The visible text without any marker. */
export function stegaStrip(text: string): string {
  return text.replace(/[\u{E0000}-\u{E007F}]/gu, "");
}

/** Whether a string holds any tag character at all (refused on save). */
export function hasTagChars(text: string): boolean {
  return /[\u{E0000}-\u{E007F}]/u.test(text);
}
