/**
 * Registration validation shared by the client form (instant feedback) and
 * the server action (the authoritative boundary). Plain module — no server
 * or client directive — so both sides import the SAME rules and can never
 * drift apart.
 */

export const ACQUISITION_SOURCES = [
  "facebook", "instagram", "tiktok", "referral", "google", "youtube", "other",
] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

/** Individual password requirements, in display order. */
export const PASSWORD_RULES = [
  { key: "length", test: (pw: string) => pw.length >= 8 },
  { key: "case", test: (pw: string) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
  { key: "digit", test: (pw: string) => /\d/.test(pw) },
] as const;

/** First failing rule key, or null when the password satisfies all rules. */
export function passwordIssue(pw: string): string | null {
  const failed = PASSWORD_RULES.find((r) => !r.test(pw));
  return failed ? `pw_${failed.key}` : null;
}

/** Polish NIP: exactly 10 digits whose weighted checksum (mod 11) equals the
 *  10th digit — length alone accepts typos, the checksum does not. */
export function validNip(raw: string): boolean {
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d{10}$/.test(digits)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const check = sum % 11;
  return check !== 10 && check === Number(digits[9]);
}

/** Countries where tax_id is validated as a Polish NIP. */
export function isPoland(country: string): boolean {
  return /^(pol(ska|and)?|pl)$/i.test(country.trim());
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * ONE NAME FIELD, TWO COLUMNS.
 *
 * Signup asks for "Imię i nazwisko" because two boxes for what everyone
 * types as one string is friction with nothing behind it. The profile still
 * has first_name and last_name (the CRM, the mail templates and the admin
 * list all read them), so the string is split here — in one place, so the
 * client preview and the server action can never disagree.
 *
 * The rule is: the FIRST token is the given name, everything after it is the
 * surname. That keeps "Anna Maria Nowak-Kowalska" and "van der Berg" intact
 * instead of throwing away the parts a naive split(" ")[1] would lose. A
 * single word is a given name with no surname — better than inventing one.
 */
export function splitFullName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

/** Is this usable as a person's name? Deliberately permissive — the point is
 *  to catch an empty box and a single letter, not to police what names look
 *  like in a language we did not think of. */
export function fullNameIssue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "required";
  if (trimmed.replace(/\s/g, "").length < 2) return "name_short";
  return null;
}
