import { NextResponse } from "next/server";
import { createAuthRouteClient } from "@/lib/supabase/auth-route";

export const dynamic = "force-dynamic";

/**
 * Password sign-in as a CLASSIC full-page POST.
 *
 * The login form used to submit through a server-action fetch; installed
 * standalone PWAs (iOS WebKit in particular) proved unreliable at persisting
 * the session cookies written on that fetch response. A native form POST
 * answered with 303 + Set-Cookie is the one flow every WebView on earth
 * handles identically — no JavaScript, no fetch, no client router involved.
 *
 * The session cookies ride the redirect WITH their attributes; see
 * lib/supabase/auth-route.ts for why copying name+value alone was breaking
 * roughly every other login.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const nextRaw = String(form.get("next") ?? "");
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/home";
  const origin = new URL(request.url).origin;

  const redirectTo = (path: string) => {
    const res = NextResponse.redirect(`${origin}${path}`, { status: 303 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  if (!email || !password) return redirectTo("/login?error=invalid");

  const { supabase, applyCookies } = await createAuthRouteClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return redirectTo(`/login?error=invalid${nextRaw ? `&next=${encodeURIComponent(next)}` : ""}`);

  return applyCookies(redirectTo(next));
}
