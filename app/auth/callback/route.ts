import { after } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAuthRouteClient } from "@/lib/supabase/auth-route";
import { PERSIST_COOKIE } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { buildDedupeKey, notify } from "@/lib/server/notify";
import { collectEventContext, contextRows, eventDataFrom, formatWarsaw } from "@/lib/server/event-context";
import { loginAllowedFor, neutraliseAccount, signupAllowedNow } from "@/lib/server/platform-access";

export const dynamic = "force-dynamic";

/**
 * A genuinely NEW social sign-in is worth the same admin ping a password
 * signup gets — but a returning Google/Apple login and a password RESET (which
 * also lands here) must stay silent. So: only when the account was created in
 * this exchange (its creation and this first sign-in are seconds apart) and the
 * link is not the recovery flow. Email confirmations no longer pass through
 * here — they use /auth/confirm with a token_hash — so this cannot double-fire
 * for an address the signup action already announced.
 */
const NEW_USER_WINDOW_MS = 60_000;
function isFreshSignup(user: { created_at?: string; last_sign_in_at?: string | null }): boolean {
  if (!user.created_at) return false;
  const created = new Date(user.created_at).getTime();
  const signedIn = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : created;
  return Number.isFinite(created) && Math.abs(signedIn - created) <= NEW_USER_WINDOW_MS;
}

/**
 * Landing for every emailed auth link (signup confirmation, password reset)
 * and for OAuth PKCE returns. The session cookies written by
 * exchangeCodeForSession must be copied onto the redirect we return —
 * a freshly constructed NextResponse does not inherit them — and they must
 * keep their attributes, or the session lasts only until the tab closes.
 *
 * Failure paths land on /login with a FRIENDLY code, never a blank page or
 * a raw Supabase error: `link` = expired/invalid/used link, and Supabase's
 * own error redirects (?error=…&error_code=…) are folded into the same
 * message. An already-verified user clicking an old link simply ends up
 * authenticated (or on /login), which is the correct outcome.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.includes("\\")
    ? nextParam
    : "/home";

  // Supabase-signalled failures (expired OTP, cancelled OAuth consent…)
  // arrive without a code but with error params.
  if (!code) {
    const failed = searchParams.get("error") || searchParams.get("error_code");
    return NextResponse.redirect(`${origin}/?auth=login${failed ? "&error=link" : ""}`);
  }

  // A session-only user clicking an emailed link must stay session-only:
  // the exchange rewrites every auth cookie, so it has to respect the
  // marker. A fresh visitor (no marker) gets the persistent default.
  const persist = (await cookies()).get(PERSIST_COOKIE)?.value !== "0";
  const { supabase, applyCookies } = await createAuthRouteClient(persist);
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Invalid / expired / already-used code — one honest message, no raw
    // provider text, nothing to enumerate.
    return NextResponse.redirect(`${origin}/?auth=login&error=link`);
  }

  // Same warm-up as the password route: spend the clock-skew window here
  // rather than on the first authenticated page. See lib/supabase/skew-retry.ts.
  if (data.user) {
    await supabase.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
  }

  /**
   * THE DOOR, for the social path.
   *
   * Two different refusals, and they are not the same refusal:
   *
   *  - A BRAND-NEW social account arriving while registration is closed.
   *    Supabase has already created the auth user by the time we get here —
   *    the provider round trip is what creates it — and deleting it would
   *    need a service-role key this application deliberately does not carry.
   *    So the account is neutralised instead: the profile is marked blocked,
   *    which every protected surface already refuses, and the session ends.
   *    Nothing usable is left behind.
   *
   *  - An EXISTING customer signing in while public login is closed. Their
   *    account is untouched; only the session ends. Admins pass, because the
   *    panel that reopens the door must stay reachable.
   *
   * A password-reset return (next=/reset-password) is neither: it is an
   * existing customer proving they own the address, so it is left alone.
   */
  if (data.user && !next.startsWith("/reset-password")) {
    // The EXCHANGED client, not a fresh cookie-reading one: the response
    // cookies have not been written yet, so a new server client here would be
    // anonymous — it could not read the caller's role (locking an admin out of
    // the social path) and could not write the profile below.
    const fresh = isFreshSignup(data.user);
    if (fresh && !(await signupAllowedNow(supabase))) {
      await neutraliseAccount(supabase, data.user.id);
      await supabase.auth.signOut();
      const denied = new URL("/", origin);
      denied.searchParams.set("auth", "register");
      denied.searchParams.set("blocked", "signup");
      return applyCookies(NextResponse.redirect(denied));
    }
    if (!fresh && !(await loginAllowedFor(supabase, data.user.id))) {
      await supabase.auth.signOut();
      const denied = new URL("/", origin);
      denied.searchParams.set("auth", "login");
      denied.searchParams.set("blocked", "login");
      return applyCookies(NextResponse.redirect(denied));
    }
  }

  // Announce a brand-new social signup, once, off the hot path. Recovery links
  // (next=/reset-password) and returning logins are skipped. notify() swallows
  // its own failures, and the dedupe key keeps a double-submit to one ping.
  if (data.user?.email && !next.startsWith("/reset-password") && isFreshSignup(data.user)) {
    const email = data.user.email;
    const provider = data.user.app_metadata?.provider ?? "oauth";
    const fullName = (data.user.user_metadata?.full_name as string | undefined)?.trim() ?? "";
    const context = await collectEventContext();
    const rows = ([
      ["👤 Użytkownik", fullName],
      ["📧 E-mail", email],
      ["🔓 Metoda", provider],
      ["🕒 Data", formatWarsaw(new Date())],
      ...contextRows(context),
    ] as [string, string][]).filter(([, v]) => v !== "");
    const tplData = eventDataFrom(context, {
      name: fullName, email, source: provider,
      // Drives the card's "Otwórz klienta" button; never rendered as a row.
      user_id: data.user.id,
    });
    after(async () => {
      const client = await createClient();
      await notify(client, {
        type: "user.registered",
        title: "NOWA REJESTRACJA",
        icon: "🎉",
        rows,
        data: tplData,
        footer: "GrovBase Admin",
        dedupeKey: buildDedupeKey("user.registered", email.toLowerCase()),
      });
    });
  }

  const redirect = NextResponse.redirect(`${origin}${next}`);
  redirect.headers.set("Cache-Control", "no-store");
  return applyCookies(redirect);
}
