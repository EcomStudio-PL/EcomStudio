import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { lookup } from "@/lib/i18n/t";
import { ICE_TEXT_KEYS, isDeniedKey, textSpec } from "@/lib/ice/registry";
import { textProblem } from "@/lib/ice/validate";
import type { IceLocale } from "@/lib/ice/types";

/**
 * THE PUBLISHED TEXT OVERRIDES — what admins changed in the visual editor.
 *
 * One small read for the whole site (key, locale, text), cached for every
 * visitor and invalidated by the tag on each save. Read through the definer
 * function with an anonymous client: nothing user-scoped may live in a shared
 * cache entry, and the table itself is admin-only.
 *
 * A FAILED READ IS THROWN, NEVER CACHED. Returning {} from inside the cache
 * would store "no overrides" for every visitor until the entry expired — every
 * edited text visibly reverting for five minutes after one hiccup. Thrown, the
 * cache keeps serving the last good bag (or, cold, this one request renders
 * the shipped copy).
 */

export const CONTENT_TAG = "content-overrides";

export type OverrideBag = Record<IceLocale, Record<string, string>>;

const EMPTY: OverrideBag = { pl: {}, en: {}, de: {} };

const readBag = unstable_cache(
  async (): Promise<OverrideBag> => {
    const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await anon.rpc("content_overrides_published");
    if (error) {
      // The function not existing yet (code deployed before 0141) is a real,
      // stable "nothing to apply" — the only error worth caching.
      if (error.code === "PGRST202" || error.code === "42883") return { pl: {}, en: {}, de: {} };
      throw new Error(`content_overrides_published: ${error.code ?? ""} ${error.message}`);
    }
    if (!Array.isArray(data)) throw new Error("content_overrides_published: not a list");
    const bag: OverrideBag = { pl: {}, en: {}, de: {} };
    for (const row of data as { key?: unknown; locale?: unknown; value?: unknown }[]) {
      if (typeof row.key !== "string" || typeof row.value !== "string") continue;
      if (row.locale === "pl" || row.locale === "en" || row.locale === "de") bag[row.locale][row.key] = row.value;
    }
    return bag;
  },
  ["content-overrides"],
  { revalidate: 300, tags: [CONTENT_TAG] },
);

/** The bag for this request; on a failed read, the shipped copy for this one
 *  request only. */
export const overrideBag = cache(async (): Promise<OverrideBag> => {
  try {
    return await readBag();
  } catch (e) {
    console.warn("content-overrides: read failed, rendering the shipped copy", e instanceof Error ? e.message : e);
    return EMPTY;
  }
});

/**
 * The overrides of one locale that may be applied over `dict`: registered,
 * not denied, and passing every rule a save would have enforced — whoever
 * wrote the row.
 */
export function applicableOverrides(entries: Record<string, string> | undefined, dict: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!entries) return out;
  for (const [key, value] of Object.entries(entries)) {
    if (!ICE_TEXT_KEYS.has(key)) continue;
    const fallback = lookup(dict, key);
    if (typeof fallback !== "string" || isDeniedKey(key, fallback)) continue;
    const spec = textSpec(key)?.text;
    if (!spec || textProblem(key, value, fallback, spec.maxLength) !== null) continue;
    out[key] = value;
  }
  return out;
}
