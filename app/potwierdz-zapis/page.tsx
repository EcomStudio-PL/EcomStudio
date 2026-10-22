import type { Metadata, Viewport } from "next";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { MinimalHeader, MinimalFooter } from "@/components/cms/site-shell";
import { getPublishedPage } from "@/lib/server/public-site";
import { launchDefaultsFrom, launchFieldsFromBlocks, resolveLaunchContent } from "@/lib/server/launch-page";
import { launchPageSlug } from "@/lib/server/prelaunch/public";
import { launchOptionsFromBlocks, safeLaunchCopy } from "@/lib/server/prelaunch/landing";
import { ConfirmSignup, type ConfirmShareCopy } from "./confirm";

export const dynamic = "force-dynamic";

/**
 * POTWIERDŹ ZAPIS — where the double opt-in link from the e-mail lands.
 *
 * THE TOKEN NEVER REACHES THE SERVER BY URL. The mail links to
 * `/potwierdz-zapis#t=<token>`: a fragment is not sent with the request, so it
 * is in no access log, no Vercel request log and no GA page_location (the
 * sanitiser drops fragments). The island below reads it once, wipes it from
 * the address bar, and sends it in a POST body only when the person presses
 * the button.
 *
 * AN EXPLICIT PRESS, NEVER ON ARRIVAL. Corporate link scanners open every URL
 * in an incoming mail, and the modern ones run JavaScript. A page that
 * confirmed on load would let a scanner give marketing consent on the
 * recipient's behalf (review S10). So arriving shows a button, and only a
 * real click posts the token. This is the opposite of /wypisz-sie, which acts
 * on arrival on purpose: leaving must be one click, joining must be a person.
 *
 * Same chrome as /wypisz-sie: MinimalHeader / MinimalFooter, no sign-in entry,
 * nothing that asks for anything else. Never indexed, never in the sitemap,
 * disallowed in robots.txt.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const description = t("prelaunchUi.confirm.metaDescription");
  return {
    title: t("prelaunchUi.confirm.title"),
    description,
    openGraph: { description },
    robots: { index: false, follow: false },
  };
}

/** Zoom allowed here, as on the launch page it belongs to (WCAG 1.4.4): the
 *  app's global pinch lock is for the tool screens, not a one-button page. */
export const viewport: Viewport = { maximumScale: 5, userScalable: true };

/**
 * The launch page's own referral wording, so the share card here says what
 * the landing page's says (and the owner edits it in one place). The legacy
 * app_settings layer holds none of these keys, so only the CMS block and the
 * shipped copy are read.
 */
async function shareCopy(locale: string, dict: Record<string, unknown>): Promise<ConfirmShareCopy | null> {
  try {
    const supabase = await createClient();
    const page = await getPublishedPage(supabase, await launchPageSlug());
    if (!launchOptionsFromBlocks(page?.blocks).shown.referral) return null;
    const defaults = launchDefaultsFrom(dict);
    const c = safeLaunchCopy(resolveLaunchContent(
      { published: {}, draft: {} }, locale, defaults, "published",
      launchFieldsFromBlocks(page?.blocks, locale),
    ), defaults);
    // ref.body keeps its {referral}: the island fills it from the confirm
    // answer and drops to bodyNone when there is no approved value.
    return {
      title: c["ref.title"], body: c["ref.body"], bodyNone: c["ref.bodyNone"],
      copy: c["ref.copy"], rewardNote: c["reward.note"],
    };
  } catch {
    return null;
  }
}

export default async function ConfirmSignupPage() {
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const share = await shareCopy(locale, dict);

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <MinimalHeader />
      <main className="flex-1">
        {/* 320px-safe: the site's own page inset, no fixed widths. */}
        <div className="mx-auto w-full max-w-[34rem] px-[var(--page-x,1rem)] py-12 sm:py-20">
          <ConfirmSignup share={share} />
        </div>
      </main>
      <MinimalFooter t={t} />
    </div>
  );
}
