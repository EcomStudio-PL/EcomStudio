import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL, SUPABASE_ANON_KEY, authCookieOptions, stripPersistence } from "./config";
import { fetchWithSkewRetry } from "./skew-retry";

type WrittenCookie = { name: string; value: string; options?: Record<string, unknown> };

/**
 * Supabase client for the auth ROUTE HANDLERS (sign-in, sign-out, callback).
 *
 * These handlers answer with a brand-new `NextResponse.redirect(...)`, which
 * does not inherit anything Supabase wrote into the request-scoped cookie
 * store — so the cookies have to be copied across by hand.
 *
 * They used to be copied with `cookies().getAll()`, and that is what broke
 * logins. `getAll()` yields `{ name, value }` and NOTHING else, so every
 * attribute was silently discarded on the one response that establishes the
 * session:
 *
 *   - `maxAge` vanished, making the session cookie a BROWSER-SESSION cookie
 *     that dies when the tab or the installed PWA closes;
 *   - `secure` vanished, and WebKit then caps a non-Secure cookie's lifetime
 *     to a day — the exact eviction AUTH_COOKIE_OPTIONS exists to prevent;
 *   - a chunk DELETION (`set(name, "", { maxAge: 0 })`, which Supabase emits
 *     whenever the token grows past one cookie or shrinks back) came through
 *     as `{ name, value: "" }` and was rewritten as a PERSISTENT EMPTY
 *     cookie. The next request then carried `sb-…-auth-token=""` beside the
 *     real `sb-…-auth-token.0`/`.1`, the session failed to parse, and the
 *     user landed on a signed-out page seconds after a successful login —
 *     fixed only by signing out (which clears the wreckage) and back in.
 *
 * This client records what Supabase writes WITH its options, so the redirect
 * can carry the real thing.
 */
export async function createAuthRouteClient(persist = true) {
  const cookieStore = await cookies();
  const written: WrittenCookie[] = [];

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: authCookieOptions(persist),
    global: { fetch: fetchWithSkewRetry() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          // @supabase/ssr force-reapplies its default maxAge over our
          // cookieOptions, so session-only logins are enforced HERE, on the
          // final options, not via configuration. See stripPersistence.
          const opts = stripPersistence(options as { maxAge?: number } | undefined, persist);
          written.push({ name, value, options: opts as Record<string, unknown> | undefined });
          try {
            cookieStore.set(name, value, options);
          } catch {
            // Route handlers can always set cookies; this guard only matters
            // if the helper is ever reused from a Server Component.
          }
        }
      },
    },
  });

  /**
   * Replay exactly the cookies Supabase wrote — names, values AND options —
   * onto the response the handler returns. Only auth cookies are touched:
   * re-emitting the whole jar would strip the attributes off unrelated
   * cookies (theme, locale) for no reason.
   */
  const applyCookies = (response: NextResponse) => {
    for (const { name, value, options } of written) {
      response.cookies.set({ name, value, ...(options ?? {}) });
    }
    return response;
  };

  return { supabase, applyCookies };
}
