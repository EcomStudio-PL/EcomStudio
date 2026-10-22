"use server";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { getPlatformAccess } from "@/lib/server/platform-access";
import { getPublishedPage } from "@/lib/server/public-site";
import {
  getLaunchStore, launchDefaultsFrom, launchFieldsFromBlocks, resolveLaunchContent,
} from "@/lib/server/launch-page";
import { getPrelaunchPublicConfig, launchPageSlug } from "@/lib/server/prelaunch/public";
import { launchCampaign, launchOptionsFromBlocks, launchPerks, safeLaunchCopy } from "@/lib/server/prelaunch/landing";
import { accessCopyFor, blockedReasonFor, type AccessCopy, type BlockedReason } from "@/lib/platform-access";

/**
 * What the auth dialog needs to know before it draws a form: is the door open,
 * and if not, what should it say. Fetched ONCE when the dialog first opens —
 * not per button, per §32 — and the answer is advisory only. Every actual
 * attempt is re-checked on the server, so a stale "open" here buys nothing.
 */
/** One line of "what signing up gets you", as the launch page words it. */
export type AccessPerk = { t: string; b: string };

export type AccessView = {
  loginBlocked: BlockedReason | null;
  signupBlocked: BlockedReason | null;
  waitlistEnabled: boolean;
  showAuthEntry: boolean;
  copy: AccessCopy;
  /** The pre-launch perks, READ FROM THE LAUNCH PAGE'S OWN CONTENT — the CMS
   *  block, then the legacy overrides, then the shipped translation. The
   *  dialog is a second place these promises appear, not a second place they
   *  are written: an admin who edits the bonuses in /admin/www edits both. */
  perks: AccessPerk[];
};

/**
 * The bonus lines exactly as the launch page resolves them — through the SAME
 * function (`launchPerks`, lib/server/prelaunch/landing.ts), against the same
 * approved campaign values. The copy carries tokens now ("{credits} kredytów
 * na start"), so reading the raw fields would print "{credits}" here, and a
 * card the page hides (an unapproved number, a price lock the checkout does
 * not offer, early access with no mechanism) would still be promised in the
 * dialog. Empty when nothing is approved, or when the owner switched the
 * benefits section off — a dialog that invents a benefit is a dialog making a
 * promise nobody agreed to.
 *
 * The page is the homepage's launch page when it is one (launchPageSlug), not
 * a second spelling of its slug.
 */
async function waitlistPerks(supabase: Awaited<ReturnType<typeof createClient>>): Promise<AccessPerk[]> {
  try {
    const { dict, locale } = await getDictionary();
    const slug = await launchPageSlug();
    const [store, page, config] = await Promise.all([
      getLaunchStore(supabase),
      getPublishedPage(supabase, slug),
      getPrelaunchPublicConfig(),
    ]);
    if (!launchOptionsFromBlocks(page?.blocks).shown.benefits) return [];
    const defaults = launchDefaultsFrom(dict);
    const c = safeLaunchCopy(resolveLaunchContent(
      store, locale, defaults, "published",
      launchFieldsFromBlocks(page?.blocks, locale),
    ), defaults);
    const now = Date.now();
    // Credits arrive with an ACCOUNT on the same address — said with the
    // number, here as on the page (D6).
    const note = launchCampaign(c, config, locale, now).rewardNote;
    return launchPerks(c, config, locale, now).map(({ key, t, b }) => ({
      t, b: key === "credits" && note ? [b, note].filter(Boolean).join(" ") : b,
    }));
  } catch {
    return [];
  }
}

export async function accessViewAction(mobile: boolean): Promise<AccessView> {
  try {
    const supabase = await createClient();
    const access = await getPlatformAccess(supabase);
    const now = new Date();
    const loginBlocked = blockedReasonFor(access, "login", now);
    const signupBlocked = blockedReasonFor(access, "register", now);
    // Only paid for when a shut door is actually going to offer the list.
    const perks = access.waitlistEnabled && (loginBlocked || signupBlocked)
      ? await waitlistPerks(supabase)
      : [];
    return {
      loginBlocked,
      signupBlocked,
      waitlistEnabled: access.waitlistEnabled,
      showAuthEntry: access.showAuthEntry,
      copy: accessCopyFor(access, mobile),
      perks,
    };
  } catch {
    // A settings outage must not close the product. The server still enforces
    // the real answer on every attempt.
    return {
      loginBlocked: null, signupBlocked: null, waitlistEnabled: false,
      showAuthEntry: true,
      copy: {
        loginTitle: "", loginBody: "", loginCta: "",
        signupTitle: "", signupBody: "", signupCta: "",
        closedTitle: "", closedBody: "",
      },
      perks: [],
    };
  }
}
