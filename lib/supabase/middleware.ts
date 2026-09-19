import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY, authCookieOptions, PERSIST_COOKIE, stripPersistence } from "./config";
import { safeReturnTo } from "@/lib/auth-routes";
import { cachedPass, rememberPass, sha256Hex, stepUpAppliesTo } from "@/lib/server/step-up-edge";

// `/podglad` is the CMS draft preview: an unpublished page rendered as a
// visitor would see it. It is not under /admin because it must carry NO admin
// chrome — the builder loads it in an iframe to judge a real layout — so it
// needs its own entry here, and the route checks the admin role itself.
const PROTECTED_PREFIXES = ["/home","/dashboard","/generator","/library","/prompts","/history","/credits","/plan","/settings","/admin","/podglad","/tools","/inspirations","/support","/k","/retusz","/wideo"];
const AUTH_PAGES = ["/login", "/register", "/forgot-password"];

/**
 * SEGMENT-WISE, NOT CHARACTER-WISE.
 *
 * `startsWith` on a one-letter prefix makes `/k` own every public slug that
 * merely begins with a k — /kontakt, /kariera, /klauzula-rodo — and `/p` would
 * own /plany. Those are CMS pages an admin publishes: treating them as
 * protected hides them from logged-out visitors and from crawlers, which for a
 * pricing or contact page is the whole point of the page.
 *
 * `/k` owns `/k` and `/k/<category>`. It does not own `/kontakt`.
 */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => isUnder(pathname, p));
}
function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.some((p) => isUnder(pathname, p));
}

/**
 * THE OPERATOR'S OWN DOOR.
 *
 * `/admin` is a protected prefix, so an unauthenticated visit to anything
 * under it is bounced to the dialog — which is right for every admin screen
 * and wrong for the one that exists to SIGN IN to them. Without this exemption
 * /admin/login redirects to itself forever.
 *
 * Exempting the path is not a hole. It renders a sign-in form and nothing
 * else; the credentials still go to /auth/sign-in, which still checks the
 * password and the platform door, and /admin/layout.tsx still refuses to
 * render for an account whose profiles row is not an admin. Knowing the
 * address buys a stranger a login form, which is what "/" already offers.
 */
export const ADMIN_LOGIN_PATH = "/admin/login";

/** The dialog's own address. Kept as literals rather than imported from
 *  lib/auth-routes: this module runs in the edge runtime, where every import
 *  is bundled, and the two values are asserted equal by the test suite. */
/** Same value as DEVICE_COOKIE in lib/server/login-security.ts, repeated for
 *  the same reason AUTH_HOST is: that module is `server-only`. The test suite
 *  asserts the two are equal. */
const DEVICE_COOKIE = "grovbase_device";

const AUTH_HOST = "/";
const AUTH_PARAM = "auth";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Honor the login-time "remember me" choice on every token refresh: a
  // session login must keep producing session cookies here, or the first
  // middleware refresh would quietly upgrade it to a persistent one.
  const persist = request.cookies.get(PERSIST_COOKIE)?.value !== "0";
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: authCookieOptions(persist),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          // The library force-restores its default maxAge; session-only
          // logins are enforced on the final write. See stripPersistence.
          response.cookies.set(name, value, stripPersistence(options, persist))
        );
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  // Any redirect must carry the cookies getUser() may have just set while
  // refreshing the session — otherwise the refreshed token is lost and the
  // user is bounced to /login despite having a valid session. Installed
  // PWAs always enter through a protected path, so they hit this on every
  // launch; dropping the cookies here is what broke standalone login.
  const redirectWithCookies = (url: URL) => {
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  // Signing in is a DIALOG now, so an unauthenticated visit to a protected
  // page opens it over the landing page instead of navigating to a screen of
  // its own — carrying the path as the returnTo, which /auth/sign-in and the
  // OAuth callback both validate before honouring.
  const adminLogin = pathname === ADMIN_LOGIN_PATH;

  if (!user && !adminLogin && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = AUTH_HOST;
    url.search = "";
    url.searchParams.set(AUTH_PARAM, "login");
    url.searchParams.set("next", pathname);
    return redirectWithCookies(url);
  }
  // Signed in and standing on the operator's sign-in page: there is nothing
  // to sign into. Straight to the panel, which does its own role check and
  // sends a non-admin to the dashboard.
  if (user && adminLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return redirectWithCookies(url);
  }
  // Already signed in? Neither the old auth routes nor the dialog have
  // anything to offer — go where they were headed, or home.
  const dialogOpen = pathname === AUTH_HOST && request.nextUrl.searchParams.has(AUTH_PARAM);
  if (user && (dialogOpen || isAuthPage(pathname))) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    url.pathname = safeReturnTo(next) || "/home";
    url.search = "";
    return redirectWithCookies(url);
  }

  // ── THE SECOND FACTOR, AT THE REQUEST LAYER ───────────────────────────────
  //
  // The emailed-code gate lives in the two protected LAYOUTS, and a layout
  // only runs when a page renders. /auth/sign-in writes full session cookies
  // the moment the password is right, so an attacker holding nothing but a
  // stolen password has a valid session before any layout has had a say — and
  // every API route is reachable in that state, including the ones that spend
  // the customer's credits and the ones that hand back their work.
  //
  // Asked here, the question covers the request instead of the render.
  if (user && stepUpAppliesTo(pathname)) {
    const raw = request.cookies.get(DEVICE_COOKIE)?.value?.trim() ?? "";
    const deviceHash = raw ? await sha256Hex(raw) : "";
    const key = `${user.id}:${deviceHash}`;
    if (!cachedPass(key)) {
      // The policy arguments are inert after migration 0104 — the function
      // reads verify_new_device / verify_new_ip / reverify_days from
      // app_settings itself, because taking them from the caller was how the
      // second factor could be waved away. They are still passed so the call
      // matches the deployed signature.
      const { data, error } = await supabase.rpc("login_security_check", {
        p_device_hash: deviceHash,
        p_ip_hash: "",
        p_verify_device: true,
        p_verify_ip: true,
        p_reverify_days: 0,
      });
      const verdict = (data as { trusted?: boolean } | null)?.trusted;
      if (verdict === true) {
        rememberPass(key);
      } else if (error || verdict === undefined) {
        // COULD NOT DECIDE — not the same as "not trusted". Refusing every
        // API call because one database read hiccuped would turn a blip into
        // an outage, and the layout gate behind this still applies. The
        // attacker cannot reach this branch: it needs the database to fail,
        // not a password to be stolen.
        console.warn("stepUp.undecided", error?.code ?? "no_verdict", pathname);
      } else {
        return NextResponse.json({ ok: false, error: "step_up_required" }, { status: 403 });
      }
    }
  }

  // Authenticated HTML and the login page must never be served from a cache.
  // A backgrounded PWA that resumes from a cached shell would otherwise show
  // a signed-out page (or someone else's) until the next hard reload.
  if (isProtectedPath(pathname) || isAuthPage(pathname)) {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  }
  return response;
}
