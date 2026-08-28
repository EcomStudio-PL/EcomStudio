import { NextResponse } from "next/server";
import { createAuthRouteClient } from "@/lib/supabase/auth-route";
import { authCookieOptions, PERSIST_COOKIE } from "@/lib/supabase/config";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";

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
 * "Pozostań zalogowany" is real, not cosmetic: unchecked, every auth cookie
 * (and the marker that tells later refreshes to keep doing this) is written
 * WITHOUT maxAge — a browser-session login that ends when the browser does.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const remember = form.get("remember") != null;
  const nextRaw = String(form.get("next") ?? "");
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") && !nextRaw.includes("\\") ? nextRaw : "/home";
  const origin = new URL(request.url).origin;

  const redirectTo = (path: string) => {
    const res = NextResponse.redirect(`${origin}${path}`, { status: 303 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  if (!email || !password) return redirectTo("/login?error=invalid");

  // Brute-force brake: 10 attempts per minute per address. A limited caller
  // sees the ordinary invalid-credentials screen — nothing to enumerate.
  if (!rateLimit(`signin:${clientIp(request)}`, 10, 60_000)) {
    return redirectTo("/login?error=invalid");
  }

  const { supabase, applyCookies } = await createAuthRouteClient(remember);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // An unconfirmed address gets its own message (with a resend action);
    // everything else collapses to one non-enumerating "invalid" screen.
    const code = /confirm/i.test(error.message) ? "unconfirmed" : "invalid";
    const keep = nextRaw ? `&next=${encodeURIComponent(next)}` : "";
    const mail = code === "unconfirmed" ? `&email=${encodeURIComponent(email)}` : "";
    return redirectTo(`/login?error=${code}${mail}${keep}`);
  }

  // WARM-UP READ. The token was minted a millisecond ago, and until the
  // database node's clock catches up with the auth server's, PostgREST
  // rejects it as "issued at future" (PGRST303) — so the first page after
  // login would render as an account with no records. The client retries
  // that code, so doing one throwaway authenticated read HERE spends the
  // skew window inside the redirect, where nobody sees it, instead of on
  // the dashboard. Failure is not fatal: the app retries its own reads.
  if (data.user) {
    await supabase.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
  }

  const res = applyCookies(redirectTo(next));
  // Record the persistence choice for every later cookie writer (middleware
  // refresh, browser-client refresh). The "0" marker is itself a session
  // cookie, so a closed browser resets cleanly to the default.
  res.cookies.set({ name: PERSIST_COOKIE, value: remember ? "1" : "0", ...authCookieOptions(remember) });
  return res;
}
