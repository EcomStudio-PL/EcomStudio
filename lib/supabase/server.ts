import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL, SUPABASE_ANON_KEY, authCookieOptions, PERSIST_COOKIE, stripPersistence } from "./config";
import { fetchWithSkewRetry } from "./skew-retry";

/**
 * One Supabase client per request. The layout and the page it renders both
 * call this during the same request; `cache` memoizes the instance so they
 * share it (and the per-request getters built on top of it can dedupe their
 * reads by argument identity). This is a per-request memo only — nothing is
 * shared between users or across requests.
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();
  // A token auto-refresh inside a server action / route handler rewrites the
  // auth cookies; it must respect the login-time remember-me choice.
  const persist = cookieStore.get(PERSIST_COOKIE)?.value !== "0";
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: authCookieOptions(persist),
    // A token minted seconds ago is briefly "from the future" for the
    // database node; without this every read right after sign-in fails.
    global: { fetch: fetchWithSkewRetry() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, stripPersistence(options, persist))
          );
        } catch {
          // Called from a Server Component — middleware refreshes sessions.
        }
      },
    },
  });
});

/**
 * The signed-in user, fetched ONCE per request.
 *
 * `supabase.auth.getUser()` is not a token decode — auth-js issues a real
 * GET /auth/v1/user to GoTrue every single time it is called, and it does no
 * caching of its own. On the navigation path that was being paid three times
 * over for the same person: the shell layout asks, the feature gate asks again
 * inside isAdminUser, and the page asks a third time. Against a database on
 * another continent those were three serial ocean crossings to answer a
 * question whose answer could not have changed between them.
 *
 * React's `cache` is per-request and per-render, so this dedupes within one
 * navigation and shares nothing between users or across requests — the same
 * guarantee `createClient` above already relies on. A server action that wants
 * a deliberately fresh check can still call `auth.getUser()` directly; this is
 * an opt-in for read paths, not a replacement.
 */
export const getRequestUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
