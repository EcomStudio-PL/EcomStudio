import { NextResponse } from "next/server";
import { createAuthRouteClient } from "@/lib/supabase/auth-route";
import { PERSIST_COOKIE } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/** Sign-out as a native form POST — same standalone-PWA reasoning as
 *  /auth/sign-in. The cookie REMOVALS must ride the 303 with their options
 *  intact: a deletion copied as name+value only is not a deletion at all,
 *  it is an empty cookie that outlives the session it was meant to end. */
export async function POST(request: Request) {
  const { supabase, applyCookies } = await createAuthRouteClient();
  await supabase.auth.signOut();
  const origin = new URL(request.url).origin;
  const res = NextResponse.redirect(`${origin}/login`, { status: 303 });
  res.headers.set("Cache-Control", "no-store");
  const out = applyCookies(res);
  // The remember-me marker belongs to the session that just ended.
  out.cookies.set({ name: PERSIST_COOKIE, value: "", path: "/", maxAge: 0 });
  return out;
}
