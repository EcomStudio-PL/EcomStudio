import type { CmsBlockContent, LocaleText } from "./cms";

/**
 * WHAT EACH SECTION IS MADE OF.
 *
 * One table, read by the admin editor to decide which inputs to draw and by
 * nothing else. Before this existed every section type got the same twenty
 * generic inputs — badge, subtitle, CTA2, alignment — whether or not it
 * rendered them, and the launch page got its own separate editor.
 *
 * Every label is an i18n key with NO dots inside its last segment, so a label
 * can never come out looking like a key even if a translation is missing.
 */

export type FieldKind =
  | "text"      // one localized line
  | "textarea"  // localized paragraph
  | "url"       // a plain link, not localized
  | "media"     // an image/video URL, offered with the media picker
  | "align"     // left / right
  | "items";    // the repeatable list (cards, steps, questions…)

export type FieldDef = {
  /** A key of CmsBlockContent, or — for `launch` — a key inside content.fields. */
  key: string;
  kind: FieldKind;
  /** i18n key under `cms.label.`, e.g. "heroBadge" → cms.label.heroBadge */
  label: string;
  /** Shown under the input when the field needs explaining. */
  hint?: string;
};

const f = (key: string, kind: FieldKind, label: string, hint?: string): FieldDef =>
  ({ key, kind, label, ...(hint ? { hint } : {}) });

const HEADING = f("title", "text", "heading");
const BODY = f("description", "textarea", "body");
const CTA = [f("ctaLabel", "text", "ctaLabel"), f("ctaUrl", "url", "ctaUrl")];
// No separate `alt` entry: the media picker already asks for it next to the
// image it describes, and two inputs for one value is how they drift apart.
const IMAGE = [f("mediaUrl", "media", "image")];

/** Section type → the fields it actually renders. */
export const SECTION_FIELDS: Record<string, FieldDef[]> = {
  hero: [
    f("badge", "text", "badge"),
    HEADING,
    f("subtitle", "textarea", "subheading"),
    ...CTA,
    f("cta2Label", "text", "cta2Label"),
    f("cta2Url", "url", "cta2Url"),
    ...IMAGE,
  ],
  text: [HEADING, BODY],
  media: [...IMAGE, HEADING, BODY],
  video: [
    HEADING,
    f("subtitle", "text", "subheading"),
    f("mediaUrl", "media", "video", "videoHint"),
    f("posterUrl", "media", "poster"),
    f("items", "items", "moreVideos"),
  ],
  benefits: [HEADING, BODY, f("items", "items", "benefitItems")],
  workflow: [HEADING, f("items", "items", "steps")],
  features: [HEADING, f("items", "items", "featureItems")],
  showcase: [HEADING, BODY, f("items", "items", "galleryItems")],
  before_after: [
    HEADING, BODY,
    f("mediaUrl", "media", "imageBefore"),
    f("media2Url", "media", "imageAfter"),
  ],
  product_lock: [f("badge", "text", "badge"), HEADING, BODY, f("items", "items", "bullets")],
  use_cases: [HEADING, f("items", "items", "useCaseItems")],
  stats: [f("items", "items", "statItems")],
  text_image: [HEADING, BODY, ...CTA, ...IMAGE, f("alignment", "align", "imageSide")],
  cta: [HEADING, ...CTA],
  faq: [HEADING, f("items", "items", "questions")],
  legal: [HEADING, f("description", "textarea", "legalBody")],
  contact: [HEADING, BODY, f("items", "items", "contactItems")],
  logo_cloud: [f("items", "items", "logos")],
};

/**
 * The launch page's own vocabulary. These land in `content.fields`, keyed the
 * same way the public component reads them, so what the admin types is what
 * the page shows — no translation table in between.
 */
export const LAUNCH_SECTION_FIELDS: FieldDef[] = [
  f("hero.badge", "text", "launchBadge"),
  f("hero.h1", "text", "launchHeadline"),
  f("hero.h1Accent", "text", "launchHeadlineAccent", "launchHeadlineAccentHint"),
  f("hero.sub", "textarea", "launchSub"),
  f("feature.1t", "text", "launchFeature1T"),
  f("feature.1b", "text", "launchFeature1B"),
  f("feature.2t", "text", "launchFeature2T"),
  f("feature.2b", "text", "launchFeature2B"),
  f("feature.3t", "text", "launchFeature3T"),
  f("feature.3b", "text", "launchFeature3B"),
  f("form.title", "text", "launchFormTitle"),
  f("form.sub", "text", "launchFormSub"),
  f("hero.placeholder", "text", "launchPlaceholder"),
  f("hero.cta", "text", "launchCta"),
  f("form.safety", "text", "launchFormSafety"),
  f("hero.consent", "textarea", "launchConsent", "launchConsentHint"),
  f("hero.image", "media", "launchImage", "launchImageHint"),
  f("perks.heading", "text", "launchPerksHeading"),
  f("benefit.1", "text", "launchBenefit1"),
  f("benefit.1sub", "text", "launchBenefit1Sub"),
  f("benefit.2", "text", "launchBenefit2"),
  f("benefit.2sub", "text", "launchBenefit2Sub"),
  f("benefit.3", "text", "launchBenefit3"),
  f("benefit.3sub", "text", "launchBenefit3Sub"),
  f("success.title", "text", "launchSuccessTitle"),
  f("success.body", "text", "launchSuccessBody"),
  f("success.follow", "text", "launchSuccessFollow"),
  f("social.heading", "text", "launchSocialHeading"),
  f("seo.title", "text", "seoTitle"),
  f("seo.description", "textarea", "seoDescription"),
  f("seo.ogTitle", "text", "seoOgTitle"),
  f("seo.ogDescription", "textarea", "seoOgDescription"),
];

export function fieldsFor(type: string): FieldDef[] {
  if (type === "launch") return LAUNCH_SECTION_FIELDS;
  return SECTION_FIELDS[type] ?? [HEADING, BODY];
}

/** Whether a section type stores its values in the `fields` bag. */
export const usesFieldBag = (type: string) => type === "launch";

/** Read one localized value out of a block, whichever storage it uses.
 *  A dotted field key is the marker for the `fields` bag — the launch page's
 *  vocabulary — and matches how writeField stores it. */
export function readField(content: CmsBlockContent, def: FieldDef, locale: string): string {
  if (def.key.includes(".")) {
    const bag = content.fields ?? {};
    const text = bag[def.key] as Record<string, string | undefined> | undefined;
    // Same fallback the public renderer uses, so the editor shows what the
    // page will actually display rather than an empty box.
    return text?.[locale] ?? text?.pl ?? "";
  }
  const value = (content as Record<string, unknown>)[def.key];
  if (def.kind === "url" || def.kind === "media" || def.kind === "align") {
    return typeof value === "string" ? value : "";
  }
  return ((value ?? {}) as Record<string, string | undefined>)[locale] ?? "";
}

/** Write one value back, preserving the other locales. */
export function writeField(
  content: CmsBlockContent, def: FieldDef, locale: string, value: string,
): CmsBlockContent {
  if (def.key.includes(".")) {
    const bag = { ...(content.fields ?? {}) };
    const prev = (bag[def.key] ?? {}) as LocaleText;
    bag[def.key] = { ...prev, [locale]: value };
    return { ...content, fields: bag };
  }
  if (def.kind === "url" || def.kind === "media" || def.kind === "align") {
    return { ...content, [def.key]: value || undefined };
  }
  const prev = ((content as Record<string, unknown>)[def.key] ?? {}) as LocaleText;
  return { ...content, [def.key]: { ...prev, [locale]: value } };
}
