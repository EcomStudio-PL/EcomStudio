import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { matchRedirect } from "@/lib/server/redirects";

/**
 * FIRST-TOUCH ATTRIBUTION.
 *
 * Where a customer came from is decided by the visit that FIRST brought them
 * here, not by the one that happened to end in a signup — by then the ad click
 * is three sessions in the past and the referrer says "grovbase.com". So the
 * campaign of the first page view is stored once and never rewritten; the
 * absence of the cookie is the only thing that authorises a write.
 *
 * It is httpOnly because nothing in the browser needs to read it, and because a
 * value the page can write is a value a bot can forge into our own reporting.
 * The name and the encoding (a url-encoded query string) are shared with
 * lib/server/event-context.ts, which reads it back; they cannot share a
 * constant, because this file runs in the edge runtime and must not drag
 * `next/headers` in with it.
 */
const FIRST_TOUCH_COOKIE = "ecs_first_touch";
/** Long enough to cover a lead that thinks about it for a season. */
const FIRST_TOUCH_MAX_AGE = 60 * 60 * 24 * 90;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
/** Per-value cap: this cookie rides on every subsequent request, so a padded
 *  URL must not be able to inflate it. */
const VALUE_MAX = 120;

function firstTouchValue(request: NextRequest): string {
  const params = new URLSearchParams();
  for (const key of UTM_KEYS) {
    const value = request.nextUrl.searchParams.get(key)?.trim();
    if (value) params.set(key, value.slice(0, VALUE_MAX));
  }
  const referer = request.headers.get("referer") ?? "";
  if (referer) {
    try {
      // The HOST only. A referring URL can carry the visitor's search terms or
      // a session token in its query string, and attribution needs neither.
      const { host } = new URL(referer);
      if (host && host !== request.nextUrl.host) params.set("ref", host.slice(0, VALUE_MAX));
    } catch {
      // A malformed Referer is simply no referrer.
    }
  }
  params.set("path", request.nextUrl.pathname.slice(0, VALUE_MAX));
  return params.toString();
}

function rememberFirstTouch(request: NextRequest, response: NextResponse): void {
  // The existing cookie IS the first touch. Never overwrite it.
  if (request.cookies.has(FIRST_TOUCH_COOKIE)) return;
  // Only a page a person actually landed on. The matcher already keeps static
  // assets out, but API calls, RSC navigations and link prefetches all reach
  // here, and stamping any of those would record a URL nobody ever saw.
  if (request.method !== "GET") return;
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api") || pathname.startsWith("/_next")) return;
  if (request.headers.get("rsc") === "1") return;
  if (!(request.headers.get("accept") ?? "").includes("text/html")) return;
  response.cookies.set(FIRST_TOUCH_COOKIE, firstTouchValue(request), {
    httpOnly: true,
    sameSite: "lax",
    // Dev runs on http://localhost, where not every browser stores a Secure
    // cookie; production is always https. Same rule as the auth cookies.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FIRST_TOUCH_MAX_AGE,
  });
}

export async function middleware(request: NextRequest) {
  /**
   * ADMIN-MANAGED REDIRECTS COME FIRST, before the session is even touched.
   *
   * `/promocja` has to be able to point at whichever campaign is current, and
   * an ad that has been running for a week must not stop working because the
   * landing behind it was replaced. So the mapping is data the panel owns,
   * read here from an instance-level cache — a map lookup, not a query.
   *
   * Only ordinary page loads are redirected: an API call or an RSC navigation
   * payload that gets a 30x back is a broken response, not a moved page.
   *
   * THE ACCEPT HEADER IS NOT PART OF THE TEST, and requiring `text/html` here
   * was a bug: a campaign link is pasted into a messenger long before anybody
   * clicks it, and the crawler that fetches it to build the preview card sends
   * a wildcard Accept. So do curl, link checkers and uptime monitors. Each of them
   * would have been told the campaign address does not exist while a browser
   * was redirected correctly — the worst shape of failure, because the people
   * running the campaign would never see it. `rsc` and the prefetch header are
   * what actually distinguish a navigation payload from a page load.
   */
  if (request.method === "GET"
    && !request.nextUrl.pathname.startsWith("/api")
    && !request.nextUrl.pathname.startsWith("/_next")
    && request.headers.get("rsc") !== "1"
    && request.headers.get("next-router-prefetch") !== "1") {
    const hit = await matchRedirect(request.nextUrl.pathname);
    if (hit) {
      const destination = /^https:\/\//i.test(hit.target)
        ? new URL(hit.target)
        : new URL(hit.target, request.nextUrl.origin);
      // THE QUERY STRING TRAVELS. A campaign link is `/promocja?utm_source=ig`
      // and the utm tags are the entire point of the click.
      if (!destination.search) destination.search = request.nextUrl.search;
      return NextResponse.redirect(destination, hit.status);
    }
  }

  // updateSession owns the response: it may have written refreshed auth cookies
  // onto it, or replaced it with a redirect that carries them. The first-touch
  // cookie has to go onto THAT object — a fresh NextResponse here would throw
  // the refreshed session away.
  const response = await updateSession(request);
  rememberFirstTouch(request, response);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
