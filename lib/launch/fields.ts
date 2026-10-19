/**
 * THE LONG PRE-LAUNCH PAGE'S VOCABULARY (Landing V2).
 *
 * The first launch page was deliberately ONE screen, and its field list said
 * so. The V2 brief replaces that with a long conversion page: galleries, a
 * cost strip, a "who is behind it" tile, a final call to action and a sticky
 * mobile bar. These are the keys the new sections read — localized text in the
 * launch block's `content.fields`, exactly like the hero's — so every word is
 * editable in Strony WWW and, where policy allows, inline in "Edytuj stronę".
 *
 * Shared (no server imports): the server resolver, the CMS schema and the
 * visual editor's registry all derive their lists from here.
 */

/** Localized text keys added by V2 (stored in content.fields[key][locale]). */
export const LAUNCH_V2_TEXT_FIELDS = [
  // Hero offer line — variants, the first one whose tokens all resolve wins.
  "hero.offer", "hero.offerDate", "hero.offerCredits", "hero.offerNone",
  "countdown.label",
  // The signup card.
  "form.firstName", "hero.consentMarketing", "consent.termsLabel", "consent.privacyLabel",
  // After submitting.
  "success.resend", "success.resendHint",
  "channel.q", "channel.allegro", "channel.amazon", "channel.own", "channel.multi", "channel.thanks",
  "ref.title", "ref.body", "ref.bodyNone", "ref.copy",
  // Galleries — their words live here so the inline editor can edit them.
  "gallery.thumbs.eyebrow", "gallery.thumbs.title",
  "gallery.retouch.eyebrow", "gallery.retouch.title",
  "gallery.fashion.eyebrow", "gallery.fashion.title",
  "gallery.cta", "gallery.before", "gallery.after",
  // Cost strip.
  "cost.left", "cost.leftValue", "cost.right", "cost.rightValue",
  // Who is behind it.
  "creators.eyebrow", "creators.title", "creators.body", "creators.signature",
  // Final call to action and the sticky phone bar.
  "final.title", "final.sub",
  "sticky.cta",
] as const;

export type LaunchV2TextField = (typeof LAUNCH_V2_TEXT_FIELDS)[number];

/**
 * Keys whose copy is a legal statement or may carry a token-driven promise:
 * never editable inline (the builder is where they are reviewed), matching
 * the existing policy for `hero.consent`, `form.safety`, `hero.placeholder`
 * and `seo.*` (scripts/ice-tests.ts A14).
 */
export const LAUNCH_V2_BUILDER_ONLY = ["hero.consentMarketing", "consent.termsLabel", "consent.privacyLabel"] as const;

/**
 * Non-localized values stored directly on the launch block's content (NOT in
 * `fields`): two pictures and the per-section visibility switches. A switch
 * is stored as "1" when the section is HIDDEN and is absent when it shows, so
 * a page published before V2 shows every section by default.
 */
export const LAUNCH_HIDE_KEYS = [
  "hideCountdown", "hideBenefits", "hideCost", "hideCreators",
  "hideFinal", "hideSticky", "hideChannel", "hideReferral",
] as const;
export type LaunchHideKey = (typeof LAUNCH_HIDE_KEYS)[number];
export const LAUNCH_MEDIA_KEYS = ["creatorsImage", "ogImage"] as const;
export type LaunchMediaKey = (typeof LAUNCH_MEDIA_KEYS)[number];

export type LaunchPlain = Partial<Record<LaunchHideKey | LaunchMediaKey, string>>;

/** Read the plain values off a launch block's content (lenient). */
export function launchPlainFromContent(content: unknown): LaunchPlain {
  const out: LaunchPlain = {};
  if (!content || typeof content !== "object") return out;
  const c = content as Record<string, unknown>;
  for (const key of [...LAUNCH_HIDE_KEYS, ...LAUNCH_MEDIA_KEYS]) {
    const v = c[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, 1024);
  }
  return out;
}

export const isHidden = (plain: LaunchPlain, key: LaunchHideKey): boolean => plain[key] === "1";

/**
 * A consent sentence as the visitor sees it and as it is RECORDED.
 *
 * The admin writes "Akceptuję {terms} i {privacy}."; the page renders the two
 * tokens as links, and the consent record stores the sentence with the link
 * labels in place ("Akceptuję Regulamin i Politykę prywatności.") — the exact
 * words that were on screen, which is what a consent audit needs.
 */
export type ConsentPart = { kind: "text"; text: string } | { kind: "link"; link: "terms" | "privacy"; text: string };

export function consentParts(template: string, labels: { terms: string; privacy: string }): ConsentPart[] {
  const out: ConsentPart[] = [];
  const re = /\{(terms|privacy)\}/g;
  let last = 0;
  for (const m of template.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: template.slice(last, at) });
    const link = m[1] as "terms" | "privacy";
    out.push({ kind: "link", link, text: link === "terms" ? labels.terms : labels.privacy });
    last = at + m[0].length;
  }
  if (last < template.length) out.push({ kind: "text", text: template.slice(last) });
  return out;
}

export function consentPlainText(template: string, labels: { terms: string; privacy: string }): string {
  return consentParts(template, labels).map((p) => p.text).join("").replace(/\s+/g, " ").trim();
}

export const CONSENT_KEYS = ["terms_privacy", "marketing_email"] as const;
export type ConsentKey = (typeof CONSENT_KEYS)[number];

/** Referral codes: 8 characters from an alphabet without I, O, 0 and 1. */
export const REFERRAL_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
/** The landing parameter. Its name contains "code", so the GA sanitiser
 *  (lib/analytics/ga.ts SENSITIVE_PARAM_PARTS) never sends it to Google. */
export const REFERRAL_PARAM = "ref_code";

/** "Gdzie sprzedajesz?" — the same four values as profiles.seller_channel (0135). */
export const SELLER_CHANNELS = ["allegro", "amazon", "own_store", "multi"] as const;
export type SellerChannel = (typeof SELLER_CHANNELS)[number];
