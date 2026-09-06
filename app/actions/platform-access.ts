"use server";
import { createClient } from "@/lib/supabase/server";
import { getPlatformAccess } from "@/lib/server/platform-access";
import { accessCopyFor, blockedReasonFor, type AccessCopy, type BlockedReason } from "@/lib/platform-access";

/**
 * What the auth dialog needs to know before it draws a form: is the door open,
 * and if not, what should it say. Fetched ONCE when the dialog first opens —
 * not per button, per §32 — and the answer is advisory only. Every actual
 * attempt is re-checked on the server, so a stale "open" here buys nothing.
 */
export type AccessView = {
  loginBlocked: BlockedReason | null;
  signupBlocked: BlockedReason | null;
  waitlistEnabled: boolean;
  showAuthEntry: boolean;
  copy: AccessCopy;
};

export async function accessViewAction(mobile: boolean): Promise<AccessView> {
  try {
    const supabase = await createClient();
    const access = await getPlatformAccess(supabase);
    const now = new Date();
    return {
      loginBlocked: blockedReasonFor(access, "login", now),
      signupBlocked: blockedReasonFor(access, "register", now),
      waitlistEnabled: access.waitlistEnabled,
      showAuthEntry: access.showAuthEntry,
      copy: accessCopyFor(access, mobile),
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
    };
  }
}
