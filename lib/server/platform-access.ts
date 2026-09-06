import "server-only";
import { cache } from "react";
import type { Client } from "@/lib/services/workspace";
import {
  ACCESS_DEFAULTS, EMPTY_ACCESS_COPY, signupOpen,
  type AccessCopy, type PlatformAccess,
} from "@/lib/platform-access";

/**
 * PLATFORM ACCESS — server side.
 *
 * One read per request (React cache dedupes the layout, the dialog and any
 * auth route sharing a render), and one place that answers "may this happen".
 * Every enforcement point below calls the same two functions, so a door closed
 * in the panel is closed in the UI, in the server action, on the legacy route
 * and in the OAuth callback at once.
 *
 * Fail-safe posture, deliberately asymmetric: if the configuration cannot be
 * read we fall back to OPEN. A settings outage must not lock every customer
 * (and every admin) out of the product — the switches exist to close the door
 * on purpose, never by accident.
 */

export const ACCESS_SETTINGS_KEY = "platform_access";
/** The pre-existing global registration kill switch, kept in step so the
 *  older /admin/system editor and this panel can never contradict each other. */
export const LEGACY_SECURITY_KEY = "security";

type Row = {
  allow_signup?: boolean;
  allow_login?: boolean;
  show_auth_entry?: boolean;
  waitlist_enabled?: boolean;
  signup_opens_at?: string | null;
  copy?: Partial<AccessCopy>;
  mobile_override?: boolean;
  mobile_copy?: Partial<AccessCopy>;
};

function coerceCopy(value: Partial<AccessCopy> | undefined): AccessCopy {
  const v = value ?? {};
  const s = (x: unknown) => (typeof x === "string" ? x.slice(0, 400) : "");
  return {
    loginTitle: s(v.loginTitle), loginBody: s(v.loginBody), loginCta: s(v.loginCta),
    signupTitle: s(v.signupTitle), signupBody: s(v.signupBody), signupCta: s(v.signupCta),
    closedTitle: s(v.closedTitle), closedBody: s(v.closedBody),
  };
}

export const getPlatformAccess = cache(async (supabase: Client): Promise<PlatformAccess> => {
  try {
    const { data, error } = await supabase
      .from("app_settings").select("key, value")
      .in("key", [ACCESS_SETTINGS_KEY, LEGACY_SECURITY_KEY]);
    if (error) return ACCESS_DEFAULTS;
    const rows = new Map((data ?? []).map((r) => [r.key as string, r.value]));
    const row = (rows.get(ACCESS_SETTINGS_KEY) ?? {}) as Row;
    const legacy = (rows.get(LEGACY_SECURITY_KEY) ?? {}) as { registration_enabled?: boolean };

    // The legacy switch still counts: it is a master kill for registration, so
    // turning it off in the old settings screen closes signup here too. The
    // panel writes both, so they only diverge if someone edits the raw row.
    const legacySignupOff = legacy.registration_enabled === false;

    return {
      allowSignup: row.allow_signup !== false && !legacySignupOff,
      allowLogin: row.allow_login !== false,
      showAuthEntry: row.show_auth_entry !== false,
      waitlistEnabled: row.waitlist_enabled === true,
      signupOpensAt: typeof row.signup_opens_at === "string" && row.signup_opens_at !== ""
        ? row.signup_opens_at : null,
      copy: coerceCopy(row.copy),
      mobileOverride: row.mobile_override === true,
      mobileCopy: coerceCopy(row.mobile_copy),
    };
  } catch {
    return ACCESS_DEFAULTS;
  }
});

/**
 * THE ADMIN IS NEVER LOCKED OUT.
 *
 * Closing public login must never make the panel that reopens it unreachable.
 * The check is the real profiles row — the same one the DB trigger guards
 * against self-escalation — read AFTER the caller has proved who they are.
 * There is no query parameter, header or URL secret anywhere in this path.
 */
export async function isAdminAccount(supabase: Client, userId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("profiles").select("role").eq("id", userId).maybeSingle();
    return data?.role === "admin";
  } catch {
    // Unreadable role during a closed-login window would otherwise lock the
    // operator out; the customer path already failed closed above.
    return false;
  }
}

/** May THIS authenticated user hold a session right now? Admins always may. */
export async function loginAllowedFor(
  supabase: Client,
  userId: string,
): Promise<boolean> {
  const access = await getPlatformAccess(supabase);
  if (access.allowLogin) return true;
  return isAdminAccount(supabase, userId);
}

/** May a NEW account be created right now (server clock, schedule included)? */
export async function signupAllowedNow(supabase: Client): Promise<boolean> {
  const access = await getPlatformAccess(supabase);
  return signupOpen(access, new Date());
}

/**
 * An account that was created while registration was closed cannot simply be
 * deleted — that needs a service-role key, which this application deliberately
 * does not carry. So it is neutralised instead: the profile is marked blocked,
 * which the app shell already refuses to render for, and the session is ended.
 * The row exists in auth.users and can do nothing.
 *
 * The write goes through close_out_denied_signup() (migration 0062) rather
 * than a plain update, because profiles_role_guard correctly refuses to let a
 * non-admin change `blocked` — that rule is what stops a blocked account
 * unblocking itself, and it is not being weakened. The function re-checks
 * server-side that registration really is closed and that the caller is not an
 * admin, and it can only ever act on auth.uid(): the caller cannot name a
 * victim. `userId` here is only for the assertion below.
 *
 * Returns whether the account was actually neutralised, so the caller can log
 * a failure instead of assuming success.
 */
export async function neutraliseAccount(supabase: Client, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("close_out_denied_signup");
    if (error || data !== true) {
      console.error("access.neutralise.failed", { userId, code: error?.code });
      return false;
    }
    return true;
  } catch (cause) {
    console.error("access.neutralise.threw", { userId, cause });
    return false;
  }
}
