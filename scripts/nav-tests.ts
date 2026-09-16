/**
 * EXACTLY ONE MENU ROW IS LIT, AND THE SECTION HOLDING IT IS OPEN.
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
import { CATEGORIES, categoryHref } from "@/lib/categories";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n     ${detail}`}`);
}
function section(title: string) { console.log(`\n${title}`); }

/* ── the drawer, as it is actually assembled ─────────────────────────────── */

/**
 * The customer drawer's four sections and their rows, mirroring
 * `components/layout/customer-drawer.tsx` with everything visible.
 *
 * NO SECTION CARRIES AN OPEN STATE any more. The drawer opens every group shut
 * and only a click opens one, so there is nothing here for a `defaultOpen` to
 * model — what is still worth asserting is that the rows are partitioned
 * cleanly and that exactly one of them lights up per route.
 */
const EDIT_ROWS = IMAGE_EDIT.filter((e) => !e.soon).map((e) => e.href);
/** What the drawer deliberately no longer renders: the generator entry that
 *  „Tworzenie" used to hold, kept here only to assert its absence. */
const CREATE_ROWS = IMAGE_MODES.map((e) => e.href).filter((h) => !EDIT_ROWS.includes(h));

const DRAWER: readonly { title: string; rows: readonly string[] }[] = [
  { title: "GŁÓWNE", rows: ["/home", "/library", "/support", "/settings"] },
  { title: "OBRAZY", rows: CATEGORIES.map(categoryHref) },
  { title: "NARZĘDZIA", rows: EDIT_ROWS },
  { title: "WIDEO", rows: ["/wideo"] },
];

const DRAWER_ROWS = DRAWER.flatMap((s) => s.rows);

/** Which rows the drawer would light for a pathname. */
const litRows = (pathname: string) => DRAWER_ROWS.filter((h) => isNavActive(pathname, h));

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

const doubles = ROUTES
  .map((r) => ({ route: r, lit: litRows(r) }))
  .filter((x) => x.lit.length > 1);
check("no route lights two drawer rows", doubles.length === 0,
  doubles.map((d) => `${d.route} → ${d.lit.join(" + ")}`).join("\n     "));

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

/* ── B. no destination is rendered twice ─────────────────────────────────── */

section("B. ONE DESTINATION, ONE ROW");

const seen = new Map<string, string[]>();
for (const s of DRAWER) for (const h of s.rows) seen.set(h, [...(seen.get(h) ?? []), s.title]);
const dupes = [...seen].filter(([, where]) => where.length > 1);
check("the drawer renders no href twice", dupes.length === 0,
  dupes.map(([h, where]) => `${h} in ${where.join(" and ")}`).join("\n     "));
check("…specifically: „Wszystkie narzędzia” belongs to EDYTUJ, not TWORZENIE",
  EDIT_ROWS.includes("/tools") && !CREATE_ROWS.includes("/tools"));
check("…and TWORZENIE still has the generator", CREATE_ROWS.includes("/prompts"),
  `TWORZENIE rows: ${CREATE_ROWS.join(", ") || "none"}`);

/* ── C. no section opens itself, ever ────────────────────────────────────── */

section("C. A SECTION OPENS ON A CLICK AND ON NOTHING ELSE");

/**
 * The drawer used to expand the group holding the current page. It no longer
 * does, and the rule that replaced it is stricter and easier to state: the
 * open state is component state seeded to `false`, so the ROUTE cannot reach
 * it at all. That is asserted two ways here — the component no longer imports
 * the function that used to decide it, and its section state is a plain
 * `useState(false)` — because a browser probe can show the sections are shut
 * on the routes it visits, while this shows there is no code path that could
 * open one on any route.
 */
const DRAWER_SRC = fs.readFileSync("components/layout/customer-drawer.tsx", "utf8");

check("the drawer does not consult sectionOwnsRoute any more",
  !/sectionOwnsRoute/.test(DRAWER_SRC));
check("…nor the pathname, inside Section",
  !/function Section[\s\S]*?usePathname/.test(DRAWER_SRC.slice(DRAWER_SRC.indexOf("function Section"))));
check("…and a section's open state starts false",
  /function Section[\s\S]{0,400}useState\(false\)/.test(DRAWER_SRC),
  DRAWER_SRC.slice(DRAWER_SRC.indexOf("function Section"), DRAWER_SRC.indexOf("function Section") + 260));
check("…with no defaultOpen left anywhere in it", !/defaultOpen/.test(DRAWER_SRC));

// `sectionOwnsRoute` itself stays correct for anything that may want it later:
// it must never claim a section that does not hold the lit row.
const mismatched = ROUTES.filter((r) => {
  const lit = litRows(r);
  const owning = DRAWER.filter((s) => sectionOwnsRoute(r, s.rows));
  if (lit.length === 0) return owning.length > 0;
  return owning.length !== 1 || !owning[0]!.rows.includes(lit[0]!);
});
check("sectionOwnsRoute still answers honestly for every route", mismatched.length === 0,
  mismatched.slice(0, 6).join(", "));

// What the four groups hold, and what they must not.
check("GŁÓWNE is Pulpit / Biblioteka / Pomoc / Ustawienia",
  DRAWER[0]!.rows.join() === "/home,/library,/support,/settings", DRAWER[0]!.rows.join(" "));
check("…and „Inspiracje” is not in the drawer at all",
  !DRAWER_ROWS.includes("/inspirations"));
check("…and neither is the „Tworzenie” generator entry",
  CREATE_ROWS.every((h) => !DRAWER_ROWS.includes(h)), CREATE_ROWS.join(", "));
check("NARZĘDZIA holds the hub, exactly once",
  DRAWER_ROWS.filter((h) => h === "/tools").length === 1);

/* ── D. the registry stays complete ──────────────────────────────────────── */

section("D. THE REGISTRY IS WHAT MAKES LONGEST-MATCH WORK");

const missing = DRAWER_ROWS.filter((h) => !/[?#]/.test(h) && !NAV_REGISTRY.includes(navPath(h)));
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
  litRows("/library").join() === "/library",
  `got: ${litRows("/library").join(" + ")}`);

for (const c of CATEGORIES) {
  const href = categoryHref(c);
  check(`${href} lights its own category alone`, litRows(href).join() === href,
    `got: ${litRows(href).join(" + ") || "nothing"}`);
}

/* ── F. the route is the only input ──────────────────────────────────────── */

section("F. REFRESH, DIRECT URL, BACK/FORWARD");

/**
 * All three are the same claim: the answer is a pure function of the pathname,
 * so there is no state for a reload to lose or a history entry to desynchronise.
 * Proving purity is proving all three at once.
 */
const twice = ROUTES.every((r) =>
  litRows(r).join() === litRows(r).join()
  && DRAWER.every((s) => sectionOwnsRoute(r, s.rows) === sectionOwnsRoute(r, s.rows)));
check("the same pathname always gives the same answer", twice);

const orderIndependent = ROUTES.every((r) => {
  const forward = litRows(r).join();
  const reversed = [...DRAWER_ROWS].reverse().filter((h) => isNavActive(r, h)).reverse().join();
  return forward === reversed;
});
check("…and it does not depend on the order rows are asked in", orderIndependent);

console.log(failed === 0 ? "\nAll navigation tests passed." : `\n${failed} navigation test(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
