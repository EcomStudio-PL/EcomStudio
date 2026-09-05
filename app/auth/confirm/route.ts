import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createAuthRouteClient } from "@/lib/supabase/auth-route";
import { PERSIST_COOKIE } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/** The token types GoTrue actually emails. Anything else in the query string
 *  is noise (or probing) and lands on the friendly invalid screen. */
const OTP_TYPES = ["signup", "invite", "magiclink", "recovery", "email_change", "email"] as const;

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (OTP_TYPES as readonly string[]).includes(value);
}

/**
 * Landing for BRANDED confirmation emails: the template links here with
 * `?token_hash=…&type=…`, we verify the hash server-side and hand the visitor
 * a GrovBase page — never a Supabase-hosted redirect and never a raw error.
 *
 * The cookie discipline mirrors /auth/callback exactly: verifyOtp writes a
 * session, a freshly constructed NextResponse does not inherit it, so the
 * cookies are replayed onto the redirect WITH their attributes — otherwise
 * the session dies with the tab. See lib/supabase/auth-route.ts.
 *
 * Failure paths (expired, already used, malformed) all land on
 * /auth/verified?state=invalid, which offers a resend. The token never
 * appears in a redirect or a log line.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (!tokenHash || !isOtpType(type)) {
    return NextResponse.redirect(`${origin}/auth/verified?state=invalid`);
  }

  // A session-only user clicking an emailed link must stay session-only:
  // the verification rewrites every auth cookie, so it has to respect the
  // marker. A fresh visitor (no marker) gets the persistent default.
  const persist = (await cookies()).get(PERSIST_COOKIE)?.value !== "0";
  const { supabase, applyCookies } = await createAuthRouteClient(persist);
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    // One safe line — the class of failure, never the token or provider text.
    console.warn(`[auth/confirm] verifyOtp failed (type=${type}, status=${error.status ?? "?"})`);
    return NextResponse.redirect(`${origin}/auth/verified?state=invalid`);
  }

  // Same warm-up as the callback route: spend the clock-skew window here
  // rather than on the first authenticated page. See lib/supabase/skew-retry.ts.
  if (data.user) {
    await supabase.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
  }

  // Recovery tokens exist to change a password: the session just written is
  // what lets updatePassword succeed on /reset-password.
  const next = type === "recovery" ? "/reset-password" : "/auth/verified";
  const redirect = NextResponse.redirect(`${origin}${next}`);
  redirect.headers.set("Cache-Control", "no-store");
  return applyCookies(redirect);
}
