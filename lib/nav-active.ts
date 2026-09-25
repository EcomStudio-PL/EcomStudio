import { ADMIN_NAV, CLIENT_NAV } from "./navigation";
import { IMAGE_EDIT, IMAGE_MODES } from "./topnav";
import { CATEGORIES, categoryPath } from "./categories";

/**
 * WHICH MENU ROW IS "YOU ARE HERE" — one answer, for every menu.
 *
 * This used to live inline in `nav-link.tsx`, and the rule it implemented was
 * already the right one: a prefix match, except that a DEEPER menu entry
 * covering the same path takes the highlight instead. What was wrong was the
 * list it consulted. It knew only `CLIENT_NAV` and `ADMIN_NAV` — the desktop
 * sidebar's config — while the mobile drawer renders most of its rows from
 * `IMAGE_EDIT`, `IMAGE_MODES` and `CATEGORIES`, which were invisible to it.
 *
 * So on `/tools/resize` the rule asked "is there a deeper entry under /tools
 * that covers this path?", found nothing, and lit up "Wszystkie narzędzia" —
 * next to "Zmiana rozmiaru", which was lighting up on its own exact match.
 * Two rows highlighted, and no way to tell which screen you were on.
 *
 * The fix is to complete the registry rather than to special-case `/tools`:
 * every destination any menu can render is declared in `NAV_REGISTRY`, so the
 * longest match wins everywhere, including menus written later.
 *
 * WHY NOT "AN INDEX ROUTE MATCHES EXACTLY". That was the obvious alternative
 * and it breaks the admin menu. `/admin/ai` is an index — `/admin/ai/modele`
 * sits under it — but it also has `/admin/ai/szablony`, `/admin/ai/wiedza`,
 * `/admin/ai/[tool]` and `/admin/ai/sesje/[id]`, none of which are menu
 * entries. Exact-only would leave an operator on three of those screens with
 * NOTHING highlighted. Longest-match gives the honest answer in both places:
 * the specific entry when one exists, the section it belongs to otherwise.
 */

/**
 * Roots that own a whole area but are never where you ARE once you are inside
 * it. Unlike the entries above they have no menu row deep enough to take the
 * highlight off them, so they say so themselves.
 */
const EXACT: ReadonlySet<string> = new Set(["/dashboard", "/admin"]);

/** The path part of an href — `usePathname()` returns nothing else. */
export function navPath(href: string): string {
  return href.split(/[?#]/, 1)[0] ?? "";
}

/** Is `route` at, or underneath, `base`? */
function covers(route: string, base: string): boolean {
  return route === base || route.startsWith(base.endsWith("/") ? base : `${base}/`);
}

/**
 * Every destination a menu can render, as bare paths.
 *
 * `IMAGE_EDIT_MORE` is deliberately NOT here. Those six tools have no menu row
 * of their own — the hub is how you reach them — so letting them suppress the
 * hub would leave `/tools/upscale` with an entirely unlit menu. They are
 * search results, not navigation.
 */
export const NAV_REGISTRY: readonly string[] = Array.from(new Set([
  ...[...CLIENT_NAV, ...ADMIN_NAV].flatMap((g) => g.items.map((i) => i.href)),
  ...IMAGE_EDIT.map((e) => e.href),
  ...IMAGE_MODES.map((e) => e.href),
  // A category's row links to a section of /tools, but it is the current row
  // on the screens of its workflows — so its PATH is what is registered.
  ...CATEGORIES.map((c) => categoryPath(c)),
  "/retusz", "/home", "/library", "/settings", "/support", "/inspirations", "/wideo", "/grovnews",
].map(navPath)));

/**
 * Is the menu row for `href` the one describing the current page?
 *
 * At most one row can say yes for a given pathname, as long as no menu renders
 * the same href twice — `scripts/nav-tests.ts` asserts both halves of that.
 */
export function isNavActive(
  pathname: string,
  href: string,
  registry: readonly string[] = NAV_REGISTRY,
): boolean {
  // An href carrying a query or a fragment addresses a VIEW INSIDE a page,
  // not a page: "/library?tab=history" is a tab of the library. `usePathname()`
  // cannot see either part, so such a row can never prove it is the current
  // one — and matching it on its path alone would light it up beside the plain
  // page it lives on, which is the exact bug this file exists to stop.
  if (/[?#]/.test(href)) return false;

  const route = navPath(pathname);
  if (route === href) return true;
  if (EXACT.has(href)) return false;
  if (!covers(route, href)) return false;

  // A deeper menu entry covering this route owns the highlight instead.
  return !registry.some((other) => other !== href && other.startsWith(`${href}/`) && covers(route, other));
}

/**
 * Does this drawer section contain the row for the current page?
 *
 * The section headings auto-expand on exactly this answer, so a section is
 * open when — and only when — one of its rows is lit. Deriving both from the
 * same function is what stops "the section opened but nothing in it is
 * highlighted", which is a worse state than staying shut.
 */
export function sectionOwnsRoute(
  pathname: string,
  hrefs: readonly string[],
  registry: readonly string[] = NAV_REGISTRY,
): boolean {
  return hrefs.some((href) => isNavActive(pathname, href, registry));
}
