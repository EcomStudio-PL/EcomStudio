import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Email confirmation / password-reset landing. The session cookies written
 *  by exchangeCodeForSession must be copied onto the redirect we return —
 *  a freshly constructed NextResponse does not inherit them, and losing them
 *  here means the user lands on /dashboard signed out. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
    ? nextParam
    : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const redirect = NextResponse.redirect(`${origin}${next}`);
      (await cookies()).getAll().forEach((c) => redirect.cookies.set(c.name, c.value));
      redirect.headers.set("Cache-Control", "no-store");
      return redirect;
    }
  }
  return NextResponse.redirect(`${origin}/login`);
}
