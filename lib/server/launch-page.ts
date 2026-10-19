import "server-only";
import type { Client } from "@/lib/services/workspace";
import { LAUNCH_V2_TEXT_FIELDS, launchPlainFromContent, type LaunchPlain } from "@/lib/launch/fields";

/**
 * THE LAUNCH PAGE'S CONTENT.
 *
 * Which page "/" opens is NOT decided here: since migration 0110 it is the
 * `is_homepage` flag on the cms_pages row (lib/server/homepage.ts). This file
 * only knows the launch page's words. The legacy `launch_page` settings row
 * is read underneath as a second layer for sites edited before the CMS owned
 * the page.
 *
 * The copy is stored as OVERRIDES ONLY — {published: {pl: {"hero.h1": "…"}},
 * draft: {…}} — because the shipped dictionary already carries a complete,
 * translated page in pl/en/de. An admin who changes one headline stores one
 * field; every other line stays translated, and "clear the field" is a real
 * reset rather than an empty page.
 */

/**
 * The page's vocabulary. The first version was ONE screen and its old
 * `value.*`, `how.*` and `final.*` groups were dropped for that reason; the
 * Landing V2 brief turns it back into a long page, whose new sections have
 * their own, new keys (lib/launch/fields.ts) appended at the end — the old
 * groups stay retired. `cleanOverrides` drops any stored value whose key is
 * not here, so old rows are ignored, not fatal.
 */
export const LAUNCH_FIELDS = [
  // Hero. `h1Accent` is the tail of the headline that carries the gradient —
  // a separate field rather than markup inside h1, so an admin can translate
  // the sentence without having to know where the colour starts.
  "hero.badge", "hero.h1", "hero.h1Accent", "hero.sub",
  "hero.placeholder", "hero.image", "hero.consent",
  // The three compact proof chips under the sub-headline.
  "feature.1t", "feature.1b", "feature.2t", "feature.2b", "feature.3t", "feature.3b",
  // The signup card.
  "form.title", "form.sub", "hero.cta", "form.safety",
  // What you get for signing up — heading plus three two-line cards.
  "perks.heading",
  "benefit.1", "benefit.1sub", "benefit.2", "benefit.2sub", "benefit.3", "benefit.3sub",
  "success.title", "success.body", "success.follow",
  "social.heading",
  "seo.title", "seo.description", "seo.ogTitle", "seo.ogDescription",
  // Landing V2 — offer line, consents, after-submit, galleries, cost strip,
  // creators, final call to action, sticky bar.
  ...LAUNCH_V2_TEXT_FIELDS,
] as const;

export type LaunchField = (typeof LAUNCH_FIELDS)[number];
export type LaunchOverrides = Partial<Record<LaunchField, string>>;
/** One override map per locale, e.g. { pl: {...}, en: {...} }. */
export type LaunchByLocale = Record<string, LaunchOverrides>;
export type LaunchStore = { published: LaunchByLocale; draft: LaunchByLocale };

const FIELD_SET = new Set<string>(LAUNCH_FIELDS);

/** Keep only known fields with sane, trimmed string values. */
export function cleanOverrides(input: unknown): LaunchOverrides {
  const out: LaunchOverrides = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!FIELD_SET.has(k) || typeof v !== "string") continue;
    const value = v.trim().slice(0, 2000);
    if (value) out[k as LaunchField] = value;
  }
  return out;
}

function cleanByLocale(input: unknown): LaunchByLocale {
  const out: LaunchByLocale = {};
  if (!input || typeof input !== "object") return out;
  for (const [locale, map] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[a-z]{2}$/.test(locale)) continue;
    const cleaned = cleanOverrides(map);
    if (Object.keys(cleaned).length > 0) out[locale] = cleaned;
  }
  return out;
}

/*
  `getHomepageMode()` USED TO LIVE HERE, AND IT IS GONE ON PURPOSE.

  It read app_settings.homepage and answered "full" | "waitlist". Two problems,
  one of which took the site down for every logged-out visitor:

  1. It could not read the row at all as an anonymous visitor — an unscoped
     `for all ... using (is_admin())` policy made the SELECT raise rather than
     filter (migration 0110 part 1) — and its "anything unrecognised means the
     full landing" default then silently answered "full" for the whole public.
  2. Even working, it named a MODE and not a PAGE, so the route had to map the
     mode back onto hardcoded slugs. Which page is the homepage was written
     down in two places that could disagree, and did.

  lib/server/homepage.ts::getActiveHomepage() replaces it: one flag, on the row
  itself, read through the anonymous client that a visitor would use.
*/

export async function getLaunchStore(supabase: Client): Promise<LaunchStore> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "launch_page").maybeSingle();
  const v = (data?.value ?? {}) as { published?: unknown; draft?: unknown };
  return { published: cleanByLocale(v.published), draft: cleanByLocale(v.draft) };
}

/**
 * The shipped copy for one locale — the `launch` object of a dictionary.
 * Its keys are flat and contain dots ("hero.h1"), so it is read directly
 * rather than through `makeT`, whose lookup splits keys on the dot.
 */
export type LaunchDefaults = Record<string, unknown>;

export function launchDefault(defaults: LaunchDefaults, field: LaunchField): string {
  // One field has no shipped default on purpose: `hero.image` empty means "no
  // custom visual" and the page falls back to the artwork in /public.
  //
  // `hero.consent` used to be the second one, where empty meant "no consent
  // checkbox". It is not optional any more — the box is always shown and
  // always required — so it ships with a sentence like every other line, and
  // clearing the field in the admin restores that sentence rather than
  // removing the consent.
  if (field === "hero.image") return "";
  const value = defaults[field];
  return typeof value === "string" ? value : "";
}

/**
 * The shipped copy for one locale, V2 keys included: the `launch` namespace
 * first, then `prelaunch` — where the V2 defaults live so they are NOT shipped
 * to every public page's client dictionary (the root client scope carries the
 * whole `launch` namespace; see lib/i18n/scopes.ts).
 */
export function launchDefaultsFrom(dict: Record<string, unknown>): LaunchDefaults {
  const launch = (dict.launch ?? {}) as Record<string, unknown>;
  const v2 = (dict.prelaunch ?? {}) as Record<string, unknown>;
  return { ...v2, ...launch };
}

/** The launch block's non-localized values: section switches and two pictures. */
export function launchPlainFromBlocks(
  blocks: { type: string; content?: unknown }[] | null | undefined,
): LaunchPlain {
  const block = (blocks ?? []).find((b) => b.type === "launch");
  return launchPlainFromContent(block?.content);
}

/**
 * The launch page's section as stored in the CMS: one `launch` block whose
 * `content.fields` holds the same field keys, localized.
 *
 * The page now lives in cms_pages like every other public page, so it gets the
 * draft → preview → publish model for free. The old app_settings.launch_page
 * rows are still read underneath as a second layer of overrides, so a site
 * that was edited before this change keeps its copy without a data migration.
 */
export function launchFieldsFromBlocks(
  blocks: { type: string; content?: unknown }[] | null | undefined,
  locale: string,
): { fields: Partial<Record<LaunchField, string>>; managed: boolean } {
  const block = (blocks ?? []).find((b) => b.type === "launch");
  const bag = ((block?.content ?? {}) as { fields?: Record<string, Record<string, string>> }).fields ?? {};
  const out: Partial<Record<LaunchField, string>> = {};
  for (const field of LAUNCH_FIELDS) {
    const text = bag[field];
    const value = text?.[locale] ?? text?.pl ?? text?.en ?? "";
    if (typeof value === "string" && value.trim()) out[field] = value.trim();
  }
  // `managed` says the CMS owns this page now. Once it does, the legacy
  // app_settings overrides must stop applying — otherwise clearing a field in
  // the editor would resurrect the old value with no UI left to remove it.
  return { fields: out, managed: Boolean(block) };
}

/**
 * The copy for one render: shipped defaults, with the admin's overrides on
 * top. `draft` is what the admin preview asks for; the live page always reads
 * what was published.
 */
export function resolveLaunchContent(
  store: LaunchStore,
  locale: string,
  defaults: LaunchDefaults,
  which: "published" | "draft" = "published",
  /** What the CMS page holds — the highest-priority layer. */
  fromCms: { fields: Partial<Record<LaunchField, string>>; managed: boolean } = { fields: {}, managed: false },
): Record<LaunchField, string> {
  // A CMS-managed page ignores the legacy store entirely: two override layers
  // would mean an admin could not clear a field back to the shipped default.
  const overrides = fromCms.managed ? {} : (store[which][locale] ?? store[which].pl ?? {});
  const out = {} as Record<LaunchField, string>;
  for (const field of LAUNCH_FIELDS) {
    out[field] = fromCms.fields[field] ?? overrides[field] ?? launchDefault(defaults, field);
  }
  return out;
}
