/**
 * "Czy chodziło o gmail.com?"
 *
 * A real registration on production went to `vislipoland@gmail.con`. Every
 * system behaved perfectly: the address is validly formed, the server accepted
 * it, the hook rendered the mail and SMTP took it. The message then went
 * nowhere at all, because `gmail.con` is not a place — and the customer was
 * left waiting for a confirmation that could never arrive, with nothing on
 * screen suggesting why.
 *
 * No amount of backend correctness catches that. One line under the field
 * does. This is a SUGGESTION and never a rule: the address is not rejected,
 * the form is not blocked, and a genuine `.co` or a real domain nobody has
 * heard of still goes through untouched. It only offers the correction when a
 * mistyped domain is one small slip away from a very common one.
 */

/** The domains a Polish e-commerce seller actually uses. */
const KNOWN = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "protonmail.ch",
  "wp.pl", "o2.pl", "onet.pl", "onet.eu", "interia.pl", "interia.eu",
  "op.pl", "poczta.onet.pl", "gazeta.pl", "vp.pl", "tlen.pl",
];

/**
 * Edit distance, capped, counting a SWAP OF TWO NEIGHBOURS AS ONE EDIT
 * (Damerau–Levenshtein).
 *
 * That distinction is the whole difference between catching "gmial.com" and
 * not: plain Levenshtein scores it 2, the same as two unrelated mistakes,
 * because it has to spend one substitution on each letter. A human typed one
 * thing — two fingers landing out of order — and the metric should agree with
 * the hand, not with the alphabet.
 */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  // Three rows, because a transposition looks two rows back.
  let twoBack: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return false; // no cell in this row can still win
    twoBack = prev;
    prev = row;
  }
  return prev[b.length] <= max;
}

/**
 * The corrected address, or null when there is nothing worth saying.
 *
 * Returns null for an address that is already right — a domain we know is
 * never "corrected" to another one.
 */
export function suggestEmail(raw: string): string | null {
  const email = raw.trim();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (KNOWN.includes(domain)) return null;

  // One slip on a short domain, two on a long one: "gmail.con" and
  // "gmial.com" both qualify, "firma.pl" is left alone.
  for (const known of KNOWN) {
    const budget = known.length > 9 ? 2 : 1;
    if (within(domain, known, budget)) return `${local}@${known}`;
  }
  return null;
}
