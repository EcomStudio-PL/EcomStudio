import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import type { GuideContent, GuideToolKey } from "@/lib/tool-guides";

/**
 * THE GUIDES ADMINS SAVED — kept apart from lib/server/tool-guides.ts on
 * purpose: the customer's "seen" action needs only a guide's version, and
 * importing the shipped copy from here would put every tool's default
 * tutorial text into the dictionary every signed-in page sends.
 */

export const TOOL_GUIDES_TAG = "tool-guides";

/* ── WHAT ADMINS PUBLISHED ─────────────────────────────────────────────── */

export type PublishedGuide = {
  tutorialEnabled: boolean;
  starterEnabled: boolean;
  version: number;
  /** The admin's copy for the parts that are on; null = the shipped default. */
  tutorial: GuideContent["tutorial"] | null;
  starter: GuideContent["starter"] | null;
};

/**
 * Every saved guide, one small read for the whole site, cached for every
 * visitor and invalidated by the admin's save (TOOL_GUIDES_TAG). Read through
 * the definer function with an anonymous client: nothing user-scoped may live
 * in a shared cache entry, and the table itself is admin-only.
 *
 * A FAILED READ IS THROWN, NEVER CACHED (the content-overrides rule): the
 * caller then serves the shipped guides for that one request. The function
 * not existing yet (code before 0142) is the one stable answer worth caching.
 */
const readPublished = unstable_cache(
  async (): Promise<Record<string, PublishedGuide>> => {
    const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await anon.rpc("tool_guides_published");
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") return {};
      throw new Error(`tool_guides_published: ${error.code ?? ""} ${error.message}`);
    }
    const out: Record<string, PublishedGuide> = {};
    for (const row of data ?? []) {
      out[row.tool_key] = {
        tutorialEnabled: row.tutorial_enabled,
        starterEnabled: row.starter_enabled,
        version: row.tutorial_version,
        tutorial: (row.tutorial as GuideContent["tutorial"] | null) ?? null,
        starter: (row.starter as GuideContent["starter"] | null) ?? null,
      };
    }
    return out;
  },
  ["tool-guides"],
  { revalidate: 300, tags: [TOOL_GUIDES_TAG] },
);

export async function publishedGuide(tool: GuideToolKey): Promise<PublishedGuide | null> {
  try {
    return (await readPublished())[tool] ?? null;
  } catch (e) {
    console.warn("tool-guides: read failed, using the shipped guide", e instanceof Error ? e.message : e);
    return null;
  }
}
