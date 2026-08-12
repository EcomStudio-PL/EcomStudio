/**
 * Supabase connection config.
 * Env vars take precedence (set them in Vercel per environment: development / preview / production).
 * The fallback below is the DEV project's PUBLIC anon key — safe to ship to browsers by design
 * (all access is enforced by Row Level Security). Never put a service-role key here.
 */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ezyhwkcrrysanbcbkzsq.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_eXRZtrYfvb4nICOx-jE-TA_mJH3xz21";

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
