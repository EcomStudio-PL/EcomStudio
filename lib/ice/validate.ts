import { samePlaceholders } from "@/lib/i18n/overrides";
import { hasInvisible } from "./stega";

/**
 * THE RULES AN EDITED TEXT MUST PASS — one function, run by the editor while
 * the admin types, by the server action before saving, and again when an
 * override is laid over the dictionary (whoever wrote the row).
 *
 * Plain text only: no markup characters, no invisible or direction-changing
 * characters, no line breaks (these elements render one paragraph), the same
 * `{placeholders}` as the shipped text, a length cap, and — on the pricing
 * page — none of the claims the pricing page is not allowed to make.
 */

export type TextProblem =
  | "empty" | "too_long" | "invisible" | "markup" | "newline" | "placeholders" | "claim";

/** Promises the pricing copy must never make (scripts/plan-page-tests.ts J). */
const PRICING_CLAIMS: readonly RegExp[] = [
  /faktur|VAT|Rechnung|invoice/i,
  /e-mail(em)? potwierdz|confirmation email|Bestätigungs-?E-Mail|potwierdzenie zakupu/i,
  /przelewy|p24/i,
  /panelu płatności|billing portal|Zahlungsportal/i,
];

export function textProblem(key: string, value: string, defaultValue: string, maxLength: number): TextProblem | null {
  if (value.trim().length === 0) return "empty";
  if (value.length > Math.min(maxLength, 2000)) return "too_long";
  if (hasInvisible(value)) return "invisible";
  if (/[<>]/.test(value)) return "markup";
  if (/[\r\n]/.test(value)) return "newline";
  if (!samePlaceholders(defaultValue, value)) return "placeholders";
  if (/^(pricing|packs|plans)\./.test(key) && PRICING_CLAIMS.some((r) => r.test(value))) return "claim";
  return null;
}

/** Above this the panel warns that the layout may not hold the text. */
export function softLimit(defaultValue: string): number {
  return Math.max(24, Math.ceil(defaultValue.length * 1.5));
}

/** Normalise what an admin typed: trim, collapse runs of spaces. */
export function normaliseText(value: string): string {
  return value.replace(/[\t ]+/g, " ").trim();
}

/** Alt text: plain, short, no invisible characters. */
export function altProblem(value: string): TextProblem | null {
  if (value.length > 300) return "too_long";
  if (hasInvisible(value)) return "invisible";
  if (/[<>]/.test(value)) return "markup";
  if (/[\r\n]/.test(value)) return "newline";
  return null;
}
