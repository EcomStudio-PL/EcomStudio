import "server-only";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * WHO MAY POST TO THE PRE-LAUNCH ENDPOINTS — the browser's own word for it.
 *
 * The routes already refuse anything that is not `application/json`, which a
 * cross-site HTML form cannot send without a CORS preflight that we never
 * answer. The Origin check is the second lock on the same door (S17):
 *
 *   · the canonical origin (lib/site.ts — NOT the request's Host header), and
 *     its www twin, so a visitor who reached the site through www is not
 *     refused if the platform serves it rather than redirecting;
 *   · outside production only: the deployment's own URL, its branch alias and
 *     the origin the request itself arrived on, so a preview or a local
 *     `next start` can be tested end to end;
 *   · `Origin: null` (sandboxed frames, file://, some redirects) is refused;
 *   · NO Origin header at all is accepted only when the browser also says the
 *     request is same-origin — or sends no Fetch Metadata, as a server-side
 *     caller or an old browser does. A browser that announces a cross-site
 *     request and hides its origin is not one we answer.
 *
 * `SITE_ORIGIN` is a URL object; comparing it to a header string never
 * matches, which is exactly the bug S17 found in the first draft — so every
 * comparison here is between `.origin` strings.
 */

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** grovbase.com ↔ www.grovbase.com. Only for a bare two-label host: a
 *  preview's `x-y.vercel.app` has no www twin worth trusting. */
function wwwTwin(origin: string): string | null {
  const url = new URL(origin);
  if (url.hostname.startsWith("www.")) url.hostname = url.hostname.slice(4);
  else if (url.hostname.split(".").length === 2) url.hostname = `www.${url.hostname}`;
  else return null;
  return url.origin;
}

/** process.env, or a test's stand-in. Read at call time, never at import. */
type Env = Record<string, string | undefined>;

export function allowedOrigins(request: Request, env: Env = process.env): Set<string> {
  const allowed = new Set<string>([SITE_ORIGIN.origin]);
  const twin = wwwTwin(SITE_ORIGIN.origin);
  if (twin) allowed.add(twin);
  if (env.VERCEL_ENV !== "production") {
    for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
      const o = host?.trim() ? originOf(`https://${host.trim()}`) : null;
      if (o) allowed.add(o);
    }
    const own = originOf(request.url);
    if (own) allowed.add(own);
  }
  return allowed;
}

export function originAllowed(request: Request, env: Env = process.env): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) {
    const site = request.headers.get("sec-fetch-site");
    return site === null || site === "same-origin";
  }
  if (origin.trim() === "" || origin.trim() === "null") return false;
  const o = originOf(origin.trim());
  return o !== null && allowedOrigins(request, env).has(o);
}
