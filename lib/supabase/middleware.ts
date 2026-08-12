import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_COOKIE_OPTIONS } from "./config";

const PROTECTED_PREFIXES = ["/dashboard","/products","/generator","/library","/prompts","/history","/credits","/plan","/settings","/admin"];
const AUTH_PAGES = ["/login", "/register", "/forgot-password"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
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

  if (!user && PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return redirectWithCookies(url);
  }
  if (user && AUTH_PAGES.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    url.pathname = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
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
