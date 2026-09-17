import { createClient as createAnonClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";

/**
 * REDIRECTS, READ WITHOUT A QUERY PER REQUEST.
 *
 * `grovbase.com/promocja` has to point at whichever campaign is current, and
 * that has to be changeable from the admin panel without a deploy — which
 * means the mapping is data. The catch is where it is applied: middleware,
 * before routing, on every request that is not a static file.
 *
 * SO IT IS CACHED IN THE INSTANCE. A module-level copy with a short life,
 * refreshed at most once a minute per running instance. A campaign
 * re-pointed in the panel is live within that minute everywhere, and a
 * request costs nothing but a map lookup. `unstable_cache` is not available
 * here — middleware is not a server component — and a Supabase round trip in
 * front of every page load would be the wrong trade by a wide margin.
 *
 * A FAILED READ IS NOT A FAILED REQUEST. If the table cannot be read the
 * previous copy is kept and, failing that, the answer is "no redirects":
 * the visitor gets the page they asked for. A routing table that is briefly
 * stale is a small problem; a site that 500s because a redirect list did not
 * load is a large one.
 */

export type Redirect = { source: string; target: string; status: number };

/** How long an instance may serve its copy before refreshing. */
const TTL_MS = 60_000;

let cache: { at: number; rows: Map<string, Redirect> } | null = null;
let inflight: Promise<Map<string, Redirect>> | null = null;

/**
 * The shape a source is stored and looked up in: leading slash, no trailing
 * slash, no query, no fragment, lower case. `/Promocja/` and `/promocja?x=1`
 * both have to find the row somebody typed as `promocja`.
 */
export function normalizePath(input: string): string {
  const raw = (input ?? "").trim().split("#")[0].split("?")[0].toLowerCase();
  if (!raw) return "";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const trimmed = withSlash.replace(/\/+$/, "");
  return trimmed || "/";
}

/** A destination is either somewhere in this app or an https address. */
export function normalizeTarget(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (/^https:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw.replace(/\/{2,}/g, "/");
  return null;
}

async function load(): Promise<Map<string, Redirect>> {
  const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await anon.rpc("cms_redirects_active");
  if (error || !data) throw new Error("redirects_unavailable");
  const map = new Map<string, Redirect>();
  for (const row of data as { source: string; target: string; status_code: number }[]) {
    const source = normalizePath(row.source);
    const target = normalizeTarget(row.target);
    if (!source || !target) continue;
    map.set(source, { source, target, status: row.status_code });
  }
  return map;
}

export async function getRedirects(): Promise<Map<string, Redirect>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  // One refresh at a time per instance: a cold start under load must not
  // turn into twenty identical queries.
  if (!inflight) {
    inflight = load()
      .then((rows) => {
        cache = { at: Date.now(), rows };
        // A refresh happens at most once a minute per instance, and it is the
        // only evidence that the routing table is being read at all — without
        // it, "the redirect did not fire" and "the table never loaded" look
        // identical from the outside.
        console.info(`[redirects] loaded ${rows.size}`);
        return rows;
      })
      .catch((error) => {
        // SILENCE WAS THE BUG. A redirect table that cannot be read makes every
        // campaign address 404 while everything else keeps working, so it has
        // to say so somewhere.
        console.warn("[redirects] load failed:", error instanceof Error ? error.message : error);
        // Keep whatever we had; an empty map only on the very first failure.
        if (cache) { cache = { at: Date.now(), rows: cache.rows }; return cache.rows; }
        cache = { at: Date.now(), rows: new Map() };
        return cache.rows;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** The redirect for this path, if there is one. */
export async function matchRedirect(pathname: string): Promise<Redirect | null> {
  const path = normalizePath(pathname);
  if (!path || path === "/") return null;
  const rows = await getRedirects();
  return rows.get(path) ?? null;
}

/** Used by the tests and by the admin form: the panel's own routes and the
 *  app's own pages are not somewhere you may redirect FROM. */
export const PROTECTED_SOURCES = [
  "/", "/api", "/admin", "/home", "/login", "/register", "/logout",
  "/dashboard", "/settings", "/generator", "/library", "/prompts", "/history",
  "/credits", "/plan", "/tools", "/inspirations", "/support", "/retusz",
  "/wideo", "/k", "/podglad", "/_next", "/favicon.ico", "/sitemap.xml",
  "/robots.txt", "/manifest.webmanifest",
];

export function sourceIsProtected(source: string): boolean {
  const path = normalizePath(source);
  return PROTECTED_SOURCES.some((p) => path === p || path.startsWith(`${p}/`));
}
