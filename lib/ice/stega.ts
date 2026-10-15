/**
 * INVISIBLE ELEMENT MARKERS for the inline editor's edit mode.
 *
 * In edit mode — an admin's own render of the one page being edited, never a
 * customer's — each editable string carries, after its last visible
 * character, which element it is: a short ASCII payload written in two
 * zero-width characters (U+200C = 0, U+200D = 1, seven bits a character)
 * between word-joiner frames. That lets the editor find "the text that came
 * from this key" without a single new attribute or wrapper in the page's
 * markup: what a customer receives is what was there before.
 *
 * Why these characters: they are default-ignorable and zero-advance even
 * under `letter-spacing` (Unicode TAG characters are not — Blink gives the
 * cluster one letter-spacing unit), they add no line-break opportunity (no
 * U+200B), and they survive React escaping, `text-transform` and hydration.
 *
 * The payload starts with the edit session's nonce, which is never stored
 * anywhere a page's copy comes from — so text from any other source cannot
 * pose as an element. Values are stripped of markers before one is appended,
 * and every write path refuses these characters (`hasInvisible`).
 */

const ZERO = "‌";
const ONE = "‍";
const WJ = "⁠";
export const MARK_START = `${WJ}${ONE}${WJ}`;
export const MARK_END = `${WJ}${ZERO}${WJ}`;
const PAYLOAD = /^[\x20-\x7e]{1,64}$/;

/** The marker for one element: invisible, appended to its visible text. */
export function stegaMark(payload: string): string {
  if (!PAYLOAD.test(payload)) return "";
  let bits = "";
  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(i);
    for (let b = 6; b >= 0; b--) bits += (code >> b) & 1 ? ONE : ZERO;
  }
  return MARK_START + bits + MARK_END;
}

export type StegaHit = { payload: string; at: number; end: number };

/** Every well-formed marker in a string, with where it sits (`at` = first
 *  character of the marker, `end` = one past its last). */
export function stegaLocate(text: string): StegaHit[] {
  const found: StegaHit[] = [];
  let i = text.indexOf(MARK_START);
  while (i !== -1) {
    const from = i + MARK_START.length;
    const end = text.indexOf(MARK_END, from);
    if (end === -1) break;
    const bits = text.slice(from, end);
    if (bits.length > 0 && bits.length % 7 === 0 && /^[‌‍]+$/.test(bits)) {
      let payload = "";
      for (let c = 0; c < bits.length; c += 7) {
        let code = 0;
        for (let b = 0; b < 7; b++) code = (code << 1) | (bits[c + b] === ONE ? 1 : 0);
        payload += String.fromCharCode(code);
      }
      if (PAYLOAD.test(payload)) {
        found.push({ payload, at: i, end: end + MARK_END.length });
        i = text.indexOf(MARK_START, end + MARK_END.length);
        continue;
      }
    }
    // Not a marker (a stray start, or a broken one): look again from the
    // next character, so a real marker after it is still found.
    i = text.indexOf(MARK_START, i + 1);
  }
  return found;
}

/** Every well-formed marker in a string, in order of appearance. */
export function stegaRead(text: string): string[] {
  return stegaLocate(text).map((h) => h.payload);
}

/** The text without any complete marker. */
export function stegaStrip(text: string): string {
  return text.replace(/⁠‍⁠[‌‍]*⁠‌⁠/g, "");
}

/**
 * Invisible and direction-changing characters that no edited text may carry:
 * zero-width and joiner characters (U+200B–U+200F), bidi embeddings and
 * isolates and the Arabic letter mark (U+202A–U+202E, U+2066–U+2069,
 * U+061C), line and paragraph separators (U+2028, U+2029), the soft hyphen
 * (U+00AD), word joiner and invisible
 * operators (U+2060–U+2064), the BOM, Unicode TAG characters, and C0/C1
 * controls other than a newline. Refused on every save, and dropped again
 * when an override is applied, whoever wrote it.
 */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/u;

export function hasInvisible(text: string): boolean {
  return INVISIBLE.test(text);
}
