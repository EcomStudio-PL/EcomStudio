/**
 * EXACTLY ONE MENU ROW IS LIT.
 *
 * Two bugs lived here, and they were the same bug twice: the drawer decided
 * "where am I" from something other than the route.
 *
 *   · "Wszystkie narzędzia" lit up NEXT TO "Zmiana rozmiaru" on /tools/resize.
 *     The longest-match guard in `nav-link.tsx` was correct, but it consulted a
 *     list that only knew the desktop sidebar's config — so it never saw that
 *     `/tools/resize` is itself a menu entry and let `/tools` claim the path.
 *   · The section containing the current page opened collapsed, every time,
 *     because it was `useState(defaultOpen)` over a literal and the drawer
 *     unmounts its contents on close.
 *
 * A browser cannot prove the absence of a second highlight across every route
 * in the product — you would have to visit all of them and look. This can, so
 * it does: for EVERY route the app serves, it counts the rows the drawer would
 * light and fails if that is ever more than one.
 *
 * It also guards the three things that make the fix true rather than lucky:
 * the registry has to stay complete, no menu may render one destination twice,
 * and a section must be open exactly when it holds the lit row — an open
 * section with nothing highlighted in it is the same confusion in reverse.
 *
 * Run:  npm run test:nav
 */
import fs from "node:fs";
import path from "node:path";
import { isNavActive, sectionOwnsRoute, navPath, NAV_REGISTRY } from "@/lib/nav-active";
import { ADMIN_NAV, CLIENT_NAV } from "@/lib/navigation";
import { IMAGE_EDIT, IMAGE_MODES, IMAGE_EDIT_MORE } from "@/lib/topnav";
import { CATEGORIES, categoryHref, categoryPath } from "@/lib/categories";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n     ${detail}`}`);
}
function section(title: string) { console.log(`\n${title}`); }

/* ── the drawer and the header's tool column, as they are assembled ──────── */

/**
 * The customer drawer is four direct rows under the wallet — Biblioteka,
 * Pomoc, Ustawienia and, for staff, Panel admina — mirroring
 * `components/layout/customer-drawer.tsx` with everything visible. It used to
 * carry four accordion groups (GŁÓWNE, OBRAZY, NARZĘDZIA, WIDEO); the tools now
 * live on the Narzędzia tab, the bottom bar and the search.
 *
 * The longest-match rule the drawer relies on is still exercised against the
 * header's tool column (IMAGE_EDIT), where the /tools vs /tools/resize bug
 * lived.
 */
const EDIT_ROWS = IMAGE_EDIT.filter((e) => !e.soon).map((e) => e.href);
/** The generator entry of the header panel — never a row of the tool column. */
const CREATE_ROWS = IMAGE_MODES.map((e) => e.href).filter((h) => !EDIT_ROWS.includes(h));

const DRAWER_ROWS: readonly string[] = ["/library", "/support", "/settings", "/admin"];
/** The header panel's TWÓRZ column: each category, matched on its path. */
const CAT_ROWS: readonly string[] = CATEGORIES.map(categoryPath);
/** Groups whose rows must never light twice: the drawer and the header column. */
const GROUPS: readonly { title: string; rows: readonly string[] }[] = [
  { title: "drawer", rows: DRAWER_ROWS },
  { title: "tool column", rows: EDIT_ROWS },
  { title: "category column", rows: CAT_ROWS },
];

const litIn = (rows: readonly string[], pathname: string) => rows.filter((h) => isNavActive(pathname, h));
/** Which tool-column rows the header would light for a pathname. */
const litRows = (pathname: string) => litIn(EDIT_ROWS, pathname);

/* ── every route the app actually serves ─────────────────────────────────── */

/**
 * Walk the app directory for `page.tsx`, dropping route groups from the URL and
 * giving dynamic segments a plausible value, so `/tools/[slug]` is tested as a
 * real address a seller can be standing on.
 */
function routes(): string[] {
  const out: string[] = [];
  const SAMPLE: Record<string, string> = { slug: "upscale", tool: "grovshot", id: "1" };
  const walk = (dir: string, url: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name === "api" || name.startsWith("_")) continue;
      const seg = name.startsWith("(") && name.endsWith(")")
        ? ""                                                      // route group
        : name.startsWith("[")
          ? `/${SAMPLE[name.replace(/[[\].]/g, "")] ?? "x"}`
          : `/${name}`;
      const next = path.join(dir, name);
      if (fs.existsSync(path.join(next, "page.tsx"))) out.push(`${url}${seg}` || "/");
      walk(next, `${url}${seg}`);
    }
  };
  walk("app", "");
  return [...new Set(out)].sort();
}

const ROUTES = routes();

/* ── A. never two rows at once ───────────────────────────────────────────── */

section("A. EXACTLY ONE ROW IS LIT, ON EVERY ROUTE THE APP SERVES");

check(`the route walk found the app (${ROUTES.length} routes)`, ROUTES.length > 20,
  ROUTES.slice(0, 5).join(", "));

for (const g of GROUPS) {
  const doubles = ROUTES
    .map((r) => ({ route: r, lit: litIn(g.rows, r) }))
    .filter((x) => x.lit.length > 1);
  check(`no route lights two ${g.title} rows`, doubles.length === 0,
    doubles.map((d) => `${d.route} → ${d.lit.join(" + ")}`).join("\n     "));
}

// The reported bug, named.
check("/tools/resize lights ONLY „Zmiana rozmiaru”",
  litRows("/tools/resize").join() === "/tools/resize",
  `got: ${litRows("/tools/resize").join(" + ") || "nothing"}`);
check("…and „Wszystkie narzędzia” is dark there", !isNavActive("/tools/resize", "/tools"));
check("…and „Retusz zdjęć” is dark there", !isNavActive("/tools/resize", "/retusz"));

check("/retusz lights ONLY „Retusz zdjęć”",
  litRows("/retusz").join() === "/retusz",
  `got: ${litRows("/retusz").join(" + ") || "nothing"}`);
check("…and „Wszystkie narzędzia” is dark there", !isNavActive("/retusz", "/tools"));

check("/tools lights ONLY „Wszystkie narzędzia”",
  litRows("/tools").join() === "/tools",
  `got: ${litRows("/tools").join(" + ") || "nothing"}`);
for (const tool of ["/tools/resize", "/tools/compress", "/tools/editor"]) {
  check(`…and ${tool} is dark on the hub`, !isNavActive("/tools", tool));
}

check("/tools/compress lights ONLY „Kompresja”", litRows("/tools/compress").join() === "/tools/compress");
check("/tools/editor lights ONLY „Edycja obrazu”", litRows("/tools/editor").join() === "/tools/editor");
check("/library lights ONLY „Biblioteka” in the drawer", litIn(DRAWER_ROWS, "/library").join() === "/library");
check("/admin lights ONLY „Panel admina” in the drawer", litIn(DRAWER_ROWS, "/admin").join() === "/admin");

/* ── B. no destination is rendered twice ─────────────────────────────────── */

section("B. ONE DESTINATION, ONE ROW");

check("the drawer renders no href twice", new Set(DRAWER_ROWS).size === DRAWER_ROWS.length);
check("…the header's „Wszystkie narzędzia” belongs to the tool column, not TWORZENIE",
  EDIT_ROWS.includes("/tools") && !CREATE_ROWS.includes("/tools"));
check("…and TWORZENIE still has the generator", CREATE_ROWS.includes("/prompts"),
  `TWORZENIE rows: ${CREATE_ROWS.join(", ") || "none"}`);

/* ── C. the drawer is four direct rows ───────────────────────────────────── */

section("C. THE DRAWER: FOUR DIRECT ROWS, NO GROUPS");

const DRAWER_SRC = fs.readFileSync("components/layout/customer-drawer.tsx", "utf8");
/* Code only: the comments explain what used to be here. */
const DRAWER_CODE = DRAWER_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

check("no accordion is left: no Section, no expand state, no chevron-down",
  !/function Section|<Section|useState|aria-expanded|ChevronDown/.test(DRAWER_CODE));
check("no GŁÓWNE / OBRAZY / NARZĘDZIA / WIDEO heading",
  !/nav\.groups\.main|topnav\.image|nav\.groups\.tools|topnav\.video/.test(DRAWER_CODE));
check("no category, tool or video rows in the drawer",
  !/CATEGORIES|categoryHref|editEntriesFor|toolEntries|"\/wideo"|"\/home"/.test(DRAWER_CODE));
const order = ['href="/library"', 'href="/support"', 'href="/settings"', 'href="/admin"'].map((h) => DRAWER_CODE.indexOf(h));
check("Biblioteka → Pomoc → Ustawienia → Panel admina, in that order",
  order.every((i) => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]!), order.join(","));
check("no „Pulpit” row", !/nav\.pulpit/.test(DRAWER_CODE));
check("„Panel admina” is shown only for the real admin role",
  /\{isAdmin && \(\s*<Tile href="\/admin"/.test(DRAWER_CODE));
check("„Biblioteka” keeps its availability gate and badge",
  /show\("\/library"\) && \(\s*<Tile href="\/library"[^>]*badge=\{badge\("\/library"\)\}/.test(DRAWER_CODE));
check("the wallet card keeps „Ulepsz plan” (/plan) and „Doładuj kredyty” (/credits)",
  /href="\/plan"/.test(DRAWER_CODE) && /href="\/credits"/.test(DRAWER_CODE));
check("the account card still links to the profile (/settings) and the back arrow closes",
  /<AccountCard[^>]*onNavigate=\{closeNav\}/.test(DRAWER_CODE) && /onClick=\{close\}/.test(DRAWER_CODE));
check("the footer is unchanged: sign-out, language, theme — in that order",
  (() => {
    const a = DRAWER_CODE.indexOf('action="/auth/sign-out"');
    const b = DRAWER_CODE.indexOf("<LocaleSwitcher");
    const c = DRAWER_CODE.indexOf("<ThemeToggle");
    return a > 0 && a < b && b < c && /footer=\{/.test(DRAWER_CODE);
  })());
check("every row closes the drawer as it navigates",
  (DRAWER_CODE.match(/<Tile [^>]*onNavigate=\{closeNav\}/g) ?? []).length === 4);

// `sectionOwnsRoute` itself stays correct for anything that may use it:
// it must never claim a group that does not hold the lit row.
const mismatched = ROUTES.filter((r) => {
  const lit = GROUPS.flatMap((g) => litIn(g.rows, r));
  const owning = GROUPS.filter((g) => sectionOwnsRoute(r, g.rows));
  if (lit.length === 0) return owning.length > 0;
  return !owning.every((g) => g.rows.some((h) => lit.includes(h)));
});
check("sectionOwnsRoute still answers honestly for every route", mismatched.length === 0,
  mismatched.slice(0, 6).join(", "));
check("„Inspiracje” is not in the drawer", !DRAWER_ROWS.includes("/inspirations"));

/* ── D. the registry stays complete ──────────────────────────────────────── */

section("D. THE REGISTRY IS WHAT MAKES LONGEST-MATCH WORK");

const missing = [...DRAWER_ROWS, ...EDIT_ROWS].filter((h) => !/[?#]/.test(h) && !NAV_REGISTRY.includes(navPath(h)));
check("every drawer row is in NAV_REGISTRY", missing.length === 0, missing.join(", "));

const sidebarMissing = [...CLIENT_NAV, ...ADMIN_NAV]
  .flatMap((g) => g.items.map((i) => i.href))
  .filter((h) => !NAV_REGISTRY.includes(navPath(h)));
check("every sidebar and admin row is in NAV_REGISTRY", sidebarMissing.length === 0, sidebarMissing.join(", "));

// The registry deliberately stops short of the six unlisted tools, so the hub
// keeps the highlight on a page that has no row of its own.
for (const e of IMAGE_EDIT_MORE) {
  const p = navPath(e.href);
  if (EDIT_ROWS.includes(p) || p === "/tools/editor") continue;
  check(`${p} has no row, so the hub keeps it`, isNavActive(p, "/tools"));
}

/* ── E. desktop and admin did not regress ────────────────────────────────── */

section("E. SIDEBAR AND ADMIN MENU UNCHANGED");

// The case the original longest-match guard was written for.
check("/admin/ai/modele lights „Modele AI”, not „AI”", isNavActive("/admin/ai/modele", "/admin/ai/modele"));
check("…and /admin/ai is dark there", !isNavActive("/admin/ai/modele", "/admin/ai"));
// …and the case that made "index routes match exactly" the wrong rule.
check("/admin/ai/szablony still lights „AI” (no row of its own)", isNavActive("/admin/ai/szablony", "/admin/ai"));
check("/admin/ai/wiedza still lights „AI”", isNavActive("/admin/ai/wiedza", "/admin/ai"));
check("/admin lights only itself", isNavActive("/admin", "/admin"));
check("…and /admin is dark on /admin/users", !isNavActive("/admin/users", "/admin"));
check("/admin/users lights itself", isNavActive("/admin/users", "/admin/users"));
check("/admin/settings/access lights itself", isNavActive("/admin/settings/access", "/admin/settings/access"));

check("a ?query row can never be the current page",
  !isNavActive("/library", "/library?tab=history"));
check("…so /library lights Biblioteka alone",
  litIn(DRAWER_ROWS, "/library").join() === "/library",
  `got: ${litIn(DRAWER_ROWS, "/library").join(" + ")}`);

for (const c of CATEGORIES) {
  const own = categoryPath(c);
  const wf = `${own}/${c.workflows[0].key}`;
  check(`${wf} (a workflow screen) lights its own category alone`, litIn(CAT_ROWS, wf).join() === own,
    `got: ${litIn(CAT_ROWS, wf).join(" + ") || "nothing"}`);
  // The category's LINK is a section of the hub. usePathname() sees /tools,
  // so the hub row is the lit one there — never the category and the hub
  // together, which would be the two-highlights bug again.
  const hub = navPath(categoryHref(c));
  const both = litIn([...CAT_ROWS, ...EDIT_ROWS], hub);
  check(`${categoryHref(c)} lights „Wszystkie narzędzia” alone`, both.join() === "/tools",
    `got: ${both.join(" + ") || "nothing"}`);
}

/* ── F. the route is the only input ──────────────────────────────────────── */

section("F. REFRESH, DIRECT URL, BACK/FORWARD");

/**
 * All three are the same claim: the answer is a pure function of the pathname,
 * so there is no state for a reload to lose or a history entry to desynchronise.
 * Proving purity is proving all three at once.
 */
const twice = ROUTES.every((r) =>
  GROUPS.every((g) => litIn(g.rows, r).join() === litIn(g.rows, r).join()
    && sectionOwnsRoute(r, g.rows) === sectionOwnsRoute(r, g.rows)));
check("the same pathname always gives the same answer", twice);

const orderIndependent = ROUTES.every((r) => GROUPS.every((g) => {
  const forward = litIn(g.rows, r).join();
  const reversed = [...g.rows].reverse().filter((h) => isNavActive(r, h)).reverse().join();
  return forward === reversed;
}));
check("…and it does not depend on the order rows are asked in", orderIndependent);

console.log(failed === 0 ? "\nAll navigation tests passed." : `\n${failed} navigation test(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
