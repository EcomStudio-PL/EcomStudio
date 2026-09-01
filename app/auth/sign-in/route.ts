import { NextResponse } from "next/server";
import type { AuthError } from "@supabase/supabase-js";
import { createAuthRouteClient } from "@/lib/supabase/auth-route";
import { authCookieOptions, PERSIST_COOKIE, SUPABASE_CONFIG_FROM_ENV } from "@/lib/supabase/config";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Sign-in outcomes the LOGIN SCREEN can talk about. Deliberately coarse: the
 * user gets a category, never a backend detail, and "invalid" stays the
 * catch-all so nothing here can be used to work out whether an address has
 * an account.
 *
 * The categories exist because one message for everything is actively
 * misleading — an outage, a rate limit and a typo are different problems
 * with different next steps, and telling someone their password is wrong
 * when the database is unreachable sends them off resetting a password that
 * was never the issue.
 */
type SignInFailure = "invalid" | "unconfirmed" | "ratelimit" | "unavailable" | "config";

/**
 * Supabase reports failures through `code` (stable), `status` (HTTP) and
 * `message` (human, translated, liable to change) — so match in that order
 * and only fall back to the message.
 */
function classify(error: AuthError): SignInFailure {
  const code = error.code ?? "";
  if (code === "email_not_confirmed" || /confirm/i.test(error.message)) return "unconfirmed";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || error.status === 429) {
    return "ratelimit";
  }
  if (code === "invalid_credentials" || error.status === 400) return "invalid";
  // No status at all means the request never got an answer; 5xx means the
  // auth service answered badly. Neither is the customer's password.
  if (!error.status || error.status >= 500) return "unavailable";
  return "invalid";
}

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

  const keep = nextRaw ? `&next=${encodeURIComponent(next)}` : "";
  const fail = (code: SignInFailure, mail?: string) => redirectTo(
    `/login?error=${code}${mail ? `&email=${encodeURIComponent(mail)}` : ""}${keep}`,
  );

  if (!email || !password) return fail("invalid");

  /**
   * Never sign in against the DEV project from a production deployment: the
   * account would not exist there and the customer would be told their
   * password is wrong. `config.ts` already fails a production BUILD without
   * env vars; this is the runtime half, so a misconfiguration announces
   * itself instead of masquerading as a bad password.
   */
  if (process.env.VERCEL_ENV === "production" && !SUPABASE_CONFIG_FROM_ENV) {
    console.error("auth.sign-in.misconfigured: production deployment is missing NEXT_PUBLIC_SUPABASE_* env vars");
    return fail("config");
  }

  // Brute-force brake: 10 attempts per minute per address. Saying so is safe
  // — the limit is per IP and reveals nothing about whether an account exists.
  if (!rateLimit(`signin:${clientIp(request)}`, 10, 60_000)) {
    return fail("ratelimit");
  }

  const { supabase, applyCookies } = await createAuthRouteClient(remember);

  // A transport failure THROWS rather than returning an error, and an
  // unhandled throw here is a 500 on the login form — which reads to the
  // user as "the site is broken" with no way forward.
  let result;
  try {
    result = await supabase.auth.signInWithPassword({ email, password });
  } catch (cause) {
    console.error("auth.sign-in.transport", cause);
    return fail("unavailable");
  }
  const { data, error } = result;
  if (error) {
    const code = classify(error);
    // The technical detail stays HERE, in the server log. The redirect below
    // carries a category and nothing else.
    console.error("auth.sign-in.failed", {
      code, supabaseCode: error.code, status: error.status, message: error.message,
    });
    return fail(code, code === "unconfirmed" ? email : undefined);
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
