import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY, authCookieOptions, PERSIST_COOKIE, stripPersistence } from "./config";

const PROTECTED_PREFIXES = ["/home","/dashboard","/products","/generator","/library","/prompts","/history","/credits","/plan","/settings","/admin","/tools","/inspirations","/support","/k","/retusz","/wideo"];
const AUTH_PAGES = ["/login", "/register", "/forgot-password"];

/** The dialog's own address. Kept as literals rather than imported from
 *  lib/auth-routes: this module runs in the edge runtime, where every import
 *  is bundled, and the two values are asserted equal by the test suite. */
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
  if (!user && PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = AUTH_HOST;
    url.search = "";
    url.searchParams.set(AUTH_PARAM, "login");
    url.searchParams.set("next", pathname);
    return redirectWithCookies(url);
  }
  // Already signed in? Neither the old auth routes nor the dialog have
  // anything to offer — go where they were headed, or home.
  const dialogOpen = pathname === AUTH_HOST && request.nextUrl.searchParams.has(AUTH_PARAM);
  if (user && (dialogOpen || AUTH_PAGES.some((p) => pathname.startsWith(p)))) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    url.pathname = next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/home";
    url.search = "";
    return redirectWithCookies(url);
  }

  // Authenticated HTML and the login page must never be served from a cache.
  // A backgrounded PWA that resumes from a cached shell would otherwise show
  // a signed-out page (or someone else's) until the next hard reload.
  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) || AUTH_PAGES.some((p) => pathname.startsWith(p))) {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
  }
  return response;
}
