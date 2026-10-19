import "server-only";
import { createHash } from "crypto";
import { consentParts, consentPlainText, type ConsentKey, type ConsentPart } from "@/lib/launch/fields";

/**
 * A CONSENT IS THE EXACT SENTENCE THAT WAS ON SCREEN.
 *
 * The admin edits the two consent sentences in Strony WWW. Whatever version
 * the visitor ticked is the one recorded — not "consent v1" pointing at a text
 * nobody can reconstruct later. So the version is DERIVED from the words: a
 * short hash of the locale and the rendered sentence. Editing the sentence
 * changes the version on its own; nobody has to remember to bump a constant.
 *
 * The SERVER resolves the sentence from the published page when a form is
 * submitted and compares versions with what the page rendered, so a client
 * can never write a consent text of its own choosing into the record.
 */

export type ResolvedConsent = {
  key: ConsentKey;
  /** The sentence with its link labels in place — what is recorded. */
  text: string;
  /** "terms_privacy@<12 hex>" */
  version: string;
  /** For rendering: plain runs and the two links. */
  parts: ConsentPart[];
};

export function consentVersion(key: ConsentKey, locale: string, text: string): string {
  const digest = createHash("sha256").update(`${locale}\n${text}`).digest("hex").slice(0, 12);
  return `${key}@${digest}`;
}

export function resolveConsent(
  key: ConsentKey, template: string, locale: string, labels: { terms: string; privacy: string },
): ResolvedConsent {
  const text = consentPlainText(template, labels);
  return { key, text, version: consentVersion(key, locale, text), parts: consentParts(template, labels) };
}
