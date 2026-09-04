/**
 * WHERE GROVBASE LIVES — the single source of the app's own origin.
 *
 * Everything that has to name the site from the outside (auth e-mail links,
 * canonical tags, OpenGraph, sitemap, links inside outgoing mail) reads this.
 * One place means one host to change, and it means production can never be
 * described by whatever hostname a request happened to arrive on.
 *
 * The order below is deliberate:
 *
 *   preview   → the deployment's own URL. Nothing else knows it, and a
 *               preview that called itself grovbase.com would send its
 *               testers to production.
 *   anywhere  → NEXT_PUBLIC_SITE_URL when set. This is the canonical
 *     else      production origin and the value an operator controls.
 *   production→ the brand's domain, so a missing variable degrades to the
 *               right answer instead of to a Vercel hostname.
 *   dev       → localhost, untouched.
 *
 * VERCEL_URL is a per-deployment hostname; it is a preview fallback here and
 * never the canonical production origin.
 */

const CANONICAL = "https://grovbase.com";
const DEVELOPMENT = "http://localhost:3000";

/** Trim a trailing slash so callers can always write `${SITE_URL}/path`. */
function normalize(url: string): string {
  const trimmed = url.trim();
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

function resolve(): string {
  // NEXT_PUBLIC_* are inlined at build time, so this works on the client too.
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV;
  const vercelHost = process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL;

  if (vercelEnv === "preview" && vercelHost) return normalize(vercelHost);
  if (configured) return normalize(configured);
  if (vercelEnv === "production" || process.env.NODE_ENV === "production") return CANONICAL;
  return DEVELOPMENT;
}

export const SITE_URL = resolve();

/** The canonical origin as a URL object — what Next's `metadataBase` wants. */
export const SITE_ORIGIN = new URL(SITE_URL);

/** An absolute URL for a root-relative path: absoluteUrl("/login"). */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
