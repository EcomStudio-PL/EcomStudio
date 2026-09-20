import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { CMS_TAG } from "@/lib/server/public-site";

/**
 * WHICH PAGE ANSWERS "/". ONE FUNCTION, ONE ANSWER.
 *
 * WHAT THIS REPLACED, AND WHY IT HAD TO GO.
 *
 * The front door used to be an enum in app_settings — `homepage.mode` of
 * "full" | "waitlist" — which the route then translated into one of two
 * HARDCODED slugs. "Which page is the homepage" was therefore written down
 * twice: once as a setting an admin could change, and once as the literals
 * 'home' and 'premiera' spread across app/page.tsx, the page list's badge, its
 * public-URL column and the delete guard. Two spellings of one fact.
 *
 * They drifted, and the way they drifted was invisible. On 2026-09-20 the panel
 * showed "Strona premiery" as the active homepage while grovbase.com served the
 * full landing — because the setting was readable by an admin and NOT readable
 * by a visitor (migration 0110 part 1 has the whole trace), and the enum's
 * fallback silently answered "full" for everyone who was not signed in.
 *
 * So the answer now lives on the page itself, as `cms_pages.is_homepage`, with a
 * partial unique index making "exactly one" a property of the database rather
 * than a convention. It is read here through the SAME anonymous client and the
 * SAME cache tag as every other public page read, which is the point: if this
 * function can see the flag, so can a visitor, because it IS a visitor.
 *
 * THE INVARIANT THIS RELIES ON. `cms_set_homepage()` refuses to flag a page that
 * is not live, and a trigger refuses to unpublish, archive or delete the page
 * that is flagged. So a flagged page is always a page a visitor can be served,
 * and the badge in the admin panel cannot mean something the public contradicts.
 *
 * `null` is not an error. It means no CMS page is the homepage, and "/" falls
 * back to the built-in default layout — exactly what it has always done for an
 * unpublished `home`.
 */

export type ActiveHomepage = {
  slug: string;
  /** `launch` renders the pre-launch page; anything else renders as blocks. */
  kind: string;
};

/** The live homepage, as a visitor would resolve it. */
export async function getActiveHomepage(): Promise<ActiveHomepage | null> {
  return readActiveHomepage();
}

const readActiveHomepage = unstable_cache(
  async (): Promise<ActiveHomepage | null> => {
    const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await anon
      .from("cms_pages")
      .select("slug, kind, status, scheduled_at")
      .eq("is_homepage", true)
      .maybeSingle();
    // The read policy already hides a page that is not live from an anonymous
    // reader; this is the second lock on the same door, and the one this file
    // is responsible for.
    if (!data || !isLive(data)) return null;
    return { slug: data.slug, kind: (data.kind as string | null) ?? "standard" };
  },
  ["cms-active-homepage"],
  { revalidate: 300, tags: [CMS_TAG] },
);

function isLive(row: { status: string; scheduled_at: string | null }): boolean {
  if (row.status === "published") return true;
  if (row.status !== "scheduled") return false;
  const at = row.scheduled_at ? Date.parse(row.scheduled_at) : NaN;
  return Number.isFinite(at) && Date.now() >= at;
}
