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
