"use server";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { getPlatformAccess } from "@/lib/server/platform-access";
import { getPublishedPage } from "@/lib/server/public-site";
import {
  getLaunchStore, launchFieldsFromBlocks, resolveLaunchContent,
} from "@/lib/server/launch-page";
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
 * The three bonus lines exactly as the launch page resolves them. Empty when
 * nothing is configured — a dialog that invents a benefit is a dialog making
 * a promise nobody agreed to.
 */
async function waitlistPerks(supabase: Awaited<ReturnType<typeof createClient>>): Promise<AccessPerk[]> {
  try {
    const { dict, locale } = await getDictionary();
    const [store, page] = await Promise.all([
      getLaunchStore(supabase),
      getPublishedPage(supabase, "premiera"),
    ]);
    const c = resolveLaunchContent(
      store, locale, dict.launch as Record<string, unknown>, "published",
      launchFieldsFromBlocks(page?.blocks, locale),
    );
    return [
      { t: c["benefit.1"], b: c["benefit.1sub"] },
      { t: c["benefit.2"], b: c["benefit.2sub"] },
      { t: c["benefit.3"], b: c["benefit.3sub"] },
    ].filter((p) => p.t.trim() !== "");
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
