import "server-only";
import { createHash, randomBytes } from "crypto";

/**
 * THE SECRETS A PRE-LAUNCH SUBMISSION HANDS OUT — and the shapes they are
 * checked against before anything reaches the database.
 *
 * Two random values are minted per submission, and only their SHA-256 is ever
 * stored (prelaunch_optin_tokens.token_hash, prelaunch_signups.answer_hash):
 *
 *   · the double opt-in token — 32 bytes, base64url (43 characters). It travels
 *     in the mail as a URL FRAGMENT (`#t=…`), so it is never in a request line,
 *     a server log or a GA page_location;
 *   · the answer handle — 16 bytes (22 characters), returned to the page that
 *     submitted so it can answer "Gdzie sprzedajesz?" for THAT submission only.
 *
 * A malformed value is refused on its shape here, which keeps a bot's junk out
 * of the database round trip and keeps every message the route sends short.
 */

export const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

/** 32 random bytes in base64url. */
export const DOI_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** 16 random bytes in base64url. */
export const ANSWER_HANDLE_RE = /^[A-Za-z0-9_-]{22}$/;

export function newDoiToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256Hex(raw) };
}

export function newAnswerHandle(): { raw: string; hash: string } {
  const raw = randomBytes(16).toString("base64url");
  return { raw, hash: sha256Hex(raw) };
}

/**
 * DECOYS — what the signup answers when the submission did not CREATE a
 * signup (an address that is already on the list, confirmed, throttled or
 * suppressed). Random, never stored, and shaped exactly like the real thing:
 * an 8-character code from the same alphabet (REFERRAL_CODE_RE) and a 22-
 * character handle. A response that differed in shape would tell anyone who
 * types a stranger's address whether that stranger is on the list (S7).
 *
 * 32 symbols divide 256, so `byte % 32` is uniform — no rejection loop.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function decoyReferralCode(): string {
  return Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function decoyAnswerHandle(): string {
  return randomBytes(16).toString("base64url");
}

/** The address rule every public form here uses, mirrored by the SQL. */
export const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

/** Trimmed, lower-cased, ≤ 254 and shaped like an address — or null. */
export function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

/**
 * A FIRST NAME IS A NAME, NOT A SENTENCE (S9).
 *
 * The field is optional and goes nowhere near the double opt-in mail; it is
 * shown only after the address has been proven (the confirmation page, the
 * welcome mail). Still, whatever is typed here is attacker-controlled until
 * then, so it is held to letters (any script, Polish and German diacritics
 * included), spaces, apostrophes and hyphens, at most 40 characters, starting
 * with a letter. Anything else — a URL, an "@", digits, markup — is simply no
 * name. The database applies the same rule; this copy keeps a refused value
 * out of the request and out of the admin notification.
 */
const FIRST_NAME_RE = /^\p{L}[\p{L} '’-]{0,39}$/u;

export function cleanFirstName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").replace(/\s+/g, " ").trim();
  return name.length > 0 && FIRST_NAME_RE.test(name) ? name : null;
}

/** The three locales the copy, the mails and the database know. */
export const PRELAUNCH_LOCALES = ["pl", "en", "de"] as const;
export type PrelaunchLocale = (typeof PRELAUNCH_LOCALES)[number];
export const cleanLocale = (value: unknown): PrelaunchLocale =>
  value === "en" || value === "de" ? value : "pl";
