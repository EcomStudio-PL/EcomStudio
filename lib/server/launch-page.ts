import "server-only";
import type { Client } from "@/lib/services/workspace";

/**
 * THE LAUNCH PAGE'S CONTENT AND THE SWITCH THAT SHOWS IT.
 *
 * Two settings rows drive everything: `homepage.mode` decides which front
 * door "/" opens, and `launch_page` holds the admin's copy.
 *
 * The copy is stored as OVERRIDES ONLY — {published: {pl: {"hero.h1": "…"}},
 * draft: {…}} — because the shipped dictionary already carries a complete,
 * translated page in pl/en/de. An admin who changes one headline stores one
 * field; every other line stays translated, and "clear the field" is a real
 * reset rather than an empty page.
 */

export const LAUNCH_FIELDS = [
  "hero.badge", "hero.h1", "hero.sub", "hero.placeholder", "hero.cta", "hero.note",
  "hero.trust", "hero.image", "hero.consent",
  "value.heading", "value.t1", "value.b1", "value.t2", "value.b2", "value.t3", "value.b3",
  "how.heading", "how.s1", "how.s2", "how.s3",
  "final.heading", "final.body", "final.cta",
  "seo.title", "seo.description", "seo.ogTitle", "seo.ogDescription",
] as const;

export type LaunchField = (typeof LAUNCH_FIELDS)[number];
export type LaunchOverrides = Partial<Record<LaunchField, string>>;
/** One override map per locale, e.g. { pl: {...}, en: {...} }. */
export type LaunchByLocale = Record<string, LaunchOverrides>;
export type LaunchStore = { published: LaunchByLocale; draft: LaunchByLocale };
export type HomepageMode = "full" | "waitlist";

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

/** Which homepage is live. Anything unrecognised means the full landing —
 *  a broken setting must never hide the product behind a signup form. */
export async function getHomepageMode(supabase: Client): Promise<HomepageMode> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "homepage").maybeSingle();
  const mode = (data?.value as { mode?: unknown } | null)?.mode;
  return mode === "waitlist" ? "waitlist" : "full";
}

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
  // Two fields have no shipped default on purpose. `hero.image` empty means
  // "no custom visual" and the page draws its own composition; `hero.consent`
  // empty means the consent checkbox is off — an admin turns it on by writing
  // the sentence people would be agreeing to.
  if (field === "hero.image" || field === "hero.consent") return "";
  const value = defaults[field];
  return typeof value === "string" ? value : "";
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
): Record<LaunchField, string> {
  const overrides = store[which][locale] ?? store[which].pl ?? {};
  const out = {} as Record<LaunchField, string>;
  for (const field of LAUNCH_FIELDS) {
    out[field] = overrides[field] ?? launchDefault(defaults, field);
  }
  return out;
}
