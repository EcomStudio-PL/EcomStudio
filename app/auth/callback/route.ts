import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAuthRouteClient } from "@/lib/supabase/auth-route";
import { PERSIST_COOKIE } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

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
    return NextResponse.redirect(`${origin}/login${failed ? "?error=link" : ""}`);
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
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  // Same warm-up as the password route: spend the clock-skew window here
  // rather than on the first authenticated page. See lib/supabase/skew-retry.ts.
  if (data.user) {
    await supabase.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
  }
  const redirect = NextResponse.redirect(`${origin}${next}`);
  redirect.headers.set("Cache-Control", "no-store");
  return applyCookies(redirect);
}
