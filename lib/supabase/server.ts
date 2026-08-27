import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_COOKIE_OPTIONS } from "./config";
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
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
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
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — middleware refreshes sessions.
        }
      },
    },
  });
});
