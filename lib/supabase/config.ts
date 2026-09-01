/**
 * Supabase connection config.
 * Env vars take precedence (set them in Vercel per environment: development / preview / production).
 * The fallback below is the DEV project's PUBLIC anon key — safe to ship to browsers by design
 * (all access is enforced by Row Level Security). Never put a service-role key here.
 */
const ENV_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ENV_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Whether the connection details came from the environment rather than the
 * DEV fallback below. Server code uses this to refuse to serve a production
 * request that would otherwise reach the wrong database.
 */
export const SUPABASE_CONFIG_FROM_ENV = Boolean(ENV_URL && ENV_ANON_KEY);

/**
 * A PRODUCTION deployment must bring its own connection details.
 *
 * This is not hypothetical: a deployment once shipped without its env file,
 * the fallback below quietly took over, and the live site authenticated
 * against the DEV project. Every real customer was told their correct
 * password was wrong, because their account does not exist there — and
 * nothing in the build or the logs said so. Silently serving the wrong
 * database is worse than not building at all, so it is a BUILD FAILURE now.
 *
 * Only a real production deployment is guarded. A local `next build` and
 * preview deployments keep the fallback, which is the whole point of having
 * one — a fresh checkout runs with no setup.
 */
if (process.env.VERCEL_ENV === "production" && !SUPABASE_CONFIG_FROM_ENV) {
  throw new Error(
    "Supabase is not configured for production. NEXT_PUBLIC_SUPABASE_URL and " +
    "NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set for a production deployment; " +
    "refusing to fall back to the development project.",
  );
}

export const SUPABASE_URL = ENV_URL ?? "https://ezyhwkcrrysanbcbkzsq.supabase.co";

export const SUPABASE_ANON_KEY =
  ENV_ANON_KEY ?? "sb_publishable_eXRZtrYfvb4nICOx-jE-TA_mJH3xz21";

/**
 * Auth cookie attributes, shared by the server, browser and middleware
 * clients so a session written by one is honoured by the others.
 *
 * `secure` is the important one: WebKit caps the lifetime of non-Secure
 * cookies (24h when written from JavaScript, 7 days otherwise), which
 * silently evicted the session of installed PWAs — the app relaunches, the
 * cookie is gone and the user is bounced back to /login even though they
 * "just logged in". Marking the cookie Secure removes that cap.
 *
 * maxAge must outlive the Supabase refresh token, otherwise the cookie
 * disappears while the session behind it is still perfectly valid.
 */
export const AUTH_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  // Dev runs on http://localhost, where Secure cookies are not stored by
  // every browser; production is always https.
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365,
} as const;

/**
 * "Pozostań zalogowany". The choice must reach EVERY writer of the auth
 * cookies — the sign-in route, the middleware refresh, and the browser
 * client's own token refresh — or the first rewrite would silently convert
 * a session login into a year-long one. The choice itself travels as a tiny
 * marker cookie (nothing sensitive: a single "0"/"1"); when the marker is
 * absent we default to persistent, which is exactly how every existing
 * account behaved before the checkbox existed.
 */
export const PERSIST_COOKIE = "ecs_persist";

export function authCookieOptions(persist: boolean) {
  if (persist) return AUTH_COOKIE_OPTIONS;
  // No maxAge → a browser-session cookie: gone when the browser closes.
  const { maxAge: _drop, ...session } = AUTH_COOKIE_OPTIONS;
  return session;
}

/**
 * @supabase/ssr force-reapplies its default maxAge AFTER merging the
 * caller's cookieOptions ({ ...defaults, ...cookieOptions, maxAge:
 * defaults.maxAge }), so a session-only login can NOT be expressed through
 * cookieOptions at all — it has to be enforced at the WRITE POINT, on the
 * options the library hands to setAll. This helper strips the lifetime
 * attributes there when the login is session-only. Deletions (maxAge <= 0)
 * pass through untouched: a stripped deletion would stop deleting.
 */
export function stripPersistence<T extends { maxAge?: number; expires?: unknown } | undefined>(
  options: T, persist: boolean,
): T | Omit<NonNullable<T>, "maxAge" | "expires"> {
  if (persist || !options) return options;
  // Only a positive lifetime is a persistence grant; deletions (maxAge 0 /
  // past expires) must pass through untouched or they stop deleting.
  if ((options.maxAge ?? 0) <= 0) return options;
  const { maxAge: _m, expires: _e, ...rest } = options;
  return rest;
}
