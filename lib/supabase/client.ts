"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_COOKIE_OPTIONS, PERSIST_COOKIE } from "./config";

/**
 * Browser client. It rewrites the auth cookie from JavaScript on every token
 * refresh, so it must use the SAME attributes as the server — otherwise a
 * refresh downgrades the cookie to non-Secure and WebKit starts expiring it
 * after a day, which is what broke installed PWAs.
 *
 * It must ALSO honor the login-time "remember me" choice. @supabase/ssr
 * force-reapplies its default maxAge over cookieOptions, so session-only
 * cookies can only be produced by owning the write ourselves: this setAll
 * serializes the cookie directly and simply omits Max-Age when the
 * `ecs_persist=0` marker says this is a browser-session login. Values are
 * written verbatim — Supabase cookie payloads are base64url, which needs no
 * escaping and round-trips identically through Next's server-side parsing.
 */
function sessionOnly(): boolean {
  return typeof document !== "undefined"
    && document.cookie.split("; ").includes(`${PERSIST_COOKIE}=0`);
}

export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        if (typeof document === "undefined" || !document.cookie) return [];
        return document.cookie.split("; ").map((pair) => {
          const eq = pair.indexOf("=");
          return { name: pair.slice(0, eq), value: pair.slice(eq + 1) };
        });
      },
      setAll(cookiesToSet) {
        if (typeof document === "undefined") return;
        const strip = sessionOnly();
        for (const { name, value, options } of cookiesToSet) {
          const maxAge = options?.maxAge;
          let cookie = `${name}=${value}; Path=${options?.path ?? "/"}; SameSite=${String(options?.sameSite ?? "lax")}`;
          if (options?.secure) cookie += "; Secure";
          // Deletions (maxAge <= 0) always keep their expiry; positive
          // lifetimes are dropped for session-only logins.
          if (typeof maxAge === "number" && (maxAge <= 0 || !strip)) cookie += `; Max-Age=${maxAge}`;
          document.cookie = cookie;
        }
      },
    },
  });
}
