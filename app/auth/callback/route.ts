import { NextResponse } from "next/server";
import { createAuthRouteClient } from "@/lib/supabase/auth-route";

export const dynamic = "force-dynamic";

/** Email confirmation / password-reset landing. The session cookies written
 *  by exchangeCodeForSession must be copied onto the redirect we return —
 *  a freshly constructed NextResponse does not inherit them — and they must
 *  keep their attributes, or the session lasts only until the tab closes. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.includes("\\")
    ? nextParam
    : "/home";

  if (code) {
    const { supabase, applyCookies } = await createAuthRouteClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Same warm-up as the password route: spend the clock-skew window here
      // rather than on the first authenticated page. See lib/supabase/skew-retry.ts.
      if (data.user) {
        await supabase.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
      }
      const redirect = NextResponse.redirect(`${origin}${next}`);
      redirect.headers.set("Cache-Control", "no-store");
      return applyCookies(redirect);
    }
  }
  return NextResponse.redirect(`${origin}/login`);
}
