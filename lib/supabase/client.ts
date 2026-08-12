"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_COOKIE_OPTIONS } from "./config";

/** Browser client. It rewrites the auth cookie from JavaScript on every token
 *  refresh, so it must use the SAME attributes as the server — otherwise a
 *  refresh downgrades the cookie to non-Secure and WebKit starts expiring it
 *  after a day, which is what broke installed PWAs. */
export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
  });
}
