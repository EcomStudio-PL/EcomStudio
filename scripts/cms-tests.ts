/**
 * THE CMS, TESTED WHERE IT CAN ACTUALLY GO WRONG.
 *
 * Three things in this feature are security boundaries and one is a promise
 * the brief makes in its first paragraph. Those are what is tested here:
 *
 *   A. CSS SCOPING — a custom block must not be able to restyle the header,
 *      the footer, the admin panel or another section.
 *   B. HTML SANITISATION — nothing typed into a content field may execute.
 *   C. FORM HANDLERS — a form may only post to an approved endpoint.
 *   D. SLUGS — a page may never claim a route the application owns, and the
 *      list the app checks must match the list the database enforces.
 *   E. STYLE AND RESPONSIVE — presets become variables, never raw CSS.
 *   F. SEO — the page's own metadata, its fallbacks, and noindex.
 *   G. THE PUBLIC BUNDLE — the builder is admin-only and stays that way.
 *   H. THE WAITING-LIST PAGE — untouched, still the front door.
 *   I. THE PICKER AND THE SEED AGREE WITH THE RENDERER.
 *   J. THE LAUNCH PAGE IN THE BUILDER (Landing V2) — every field, the section
 *      switches, the token rule, the "every field exists" invariant, and the
 *      galleries the builder may switch but never write — the pure rules and
 *      the real actions over a fake Supabase (scripts/stubs/ice-*.ts).
 *
 * Run: npm run test:cms — built with the ice stubs for the actions:
 *   esbuild scripts/cms-tests.ts --bundle --platform=node --format=esm \
 *     --alias:@/lib/supabase/server=./scripts/stubs/ice-supabase-server.ts \
 *     --alias:@/lib/services/audit=./scripts/stubs/ice-audit.ts \
 *     --alias:next/headers=./scripts/stubs/ice-next-headers.ts \
 *     --alias:next/cache=./scripts/stubs/ice-next-cache.ts \
 *     --alias:@=. --alias:server-only=./scripts/server-only-stub.js --external:sharp \
 *     --outfile=.next/cms-tests.mjs --log-level=error && node .next/cms-tests.mjs
 * Optional: I18N_FRAGMENT=<path to an i18n-*.json fragment> checks the labels
 * against the dictionaries with that fragment merged in (before it lands).
 */
import { readFileSync, readdirSync } from "fs";
import { scopeCss, styleSafe } from "../lib/cms-css";
import { sanitizeHtml, sanitizeRichText } from "../lib/cms-sanitize";
import { resolveHandler, FORM_HANDLERS, isContactTopic } from "../lib/cms-forms";
import {
  slugProblem, slugify, RESERVED, isBlockType, NOT_COPYABLE_TYPES, ensureLaunchFieldObjects, launchTokenProblem,
  versionBlockRows,
} from "../lib/services/cms";
import { resolveStyle, DEVICE_PRESETS } from "../lib/cms-style";
import { pageMetadata, RESERVED_SLUGS } from "../lib/server/cms-page";
import { SECTION_GROUPS, BLOCK_TYPES, canonicalJson, type CmsBlockContent } from "../lib/cms";
import { SEED_PAGES } from "../lib/cms-seed";
import {
  LAUNCH_GALLERY_FIELDS, LAUNCH_SECTION_FIELDS, fieldsFor, readField, toggleOn, writeField, type FieldDef,
} from "../lib/cms-schema";
import { LAUNCH_FIELDS } from "../lib/server/launch-page";
import { LAUNCH_MEDIA_KEYS, LAUNCH_SECTIONS, LAUNCH_SHOW_KEYS, SECTION_DEFAULT_SHOWN, sectionKey } from "../lib/launch/fields";
import { lookup } from "../lib/i18n/t";
import {
  applySectionTemplateAction, duplicateBlockAction, publishPageAction, rollbackPageAction, saveBlockAction,
  saveSectionTemplateAction,
} from "../app/actions/cms";
import { ensureLaunchSectionAction } from "../app/actions/public-pages";
import { FakeDb, type Row } from "./stubs/ice-fake-db";
import { iceState, resetIceState } from "./stubs/ice-state";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const SECTION = "8f3e1c20-0000-4000-8000-000000000001";
const SCOPE = `[data-cms-section="${SECTION}"]`;

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("A. CUSTOM CSS CANNOT ESCAPE ITS SECTION");

check("a plain selector is prefixed",
  scopeCss(".hero-title { color: red }", SECTION) === `${SCOPE} .hero-title { color: red }`,
  scopeCss(".hero-title { color: red }", SECTION));

check("every selector in a list is prefixed",
  scopeCss("h1, h2 { margin: 0 }", SECTION) === `${SCOPE} h1, ${SCOPE} h2 { margin: 0 }`,
  scopeCss("h1, h2 { margin: 0 }", SECTION));

// The four ways to say "the whole document". Each must collapse to the section.
for (const root of ["body", "html", ":root", "*"]) {
  const out = scopeCss(`${root} { display: none }`, SECTION);
  check(`\`${root}\` can only mean this section`, out === `${SCOPE} { display: none }`, out);
}

check("a @media block is descended into, not dropped",
  scopeCss("@media (max-width: 600px) { .a { color: red } }", SECTION)
    === `@media (max-width: 600px) { ${SCOPE} .a { color: red } }`,
  scopeCss("@media (max-width: 600px) { .a { color: red } }", SECTION));

check("@keyframes keeps its own private selectors",
  scopeCss("@keyframes spin { from { opacity: 0 } to { opacity: 1 } }", SECTION)
    .startsWith("@keyframes spin {"),
  scopeCss("@keyframes spin { from { opacity: 0 } }", SECTION));

check("a selector already scoped by hand is not doubled",
  scopeCss(`${SCOPE} .x { color: red }`, SECTION) === `${SCOPE} .x { color: red }`);

check("& is treated as the scope",
  scopeCss("&.wide { width: 100% }", SECTION) === `${SCOPE}.wide { width: 100% }`,
  scopeCss("&.wide { width: 100% }", SECTION));

// The refusals. Each of these is a way of fetching or executing through CSS.
for (const attack of [
  '@import url("https://evil.test/x.css"); .a { color: red }',
  ".a { width: expression(alert(1)) }",
  ".a { background: url(javascript:alert(1)) }",
  ".a { behavior: url(x.htc) }",
  ".a { color: red } </style><script>alert(1)</script>",
]) {
  check(`refused outright: ${attack.slice(0, 34)}…`, scopeCss(attack, SECTION) === "");
}

check("a brace inside a string does not end the block",
  scopeCss(`.a { content: "}" ; color: red }`, SECTION).includes("color: red"),
  scopeCss(`.a { content: "}" ; color: red }`, SECTION));

check("a comment cannot smuggle a selector out",
  !scopeCss("/* } body { display:none } /* */ .a { color: red }", SECTION)
    .includes("body {"),
  scopeCss("/* } body { display:none } /* */ .a { color: red }", SECTION));

check("styleSafe neutralises a closing style tag",
  !styleSafe("a{} </style>").includes("</style>"));

check("empty input is empty output", scopeCss("", SECTION) === "" && scopeCss(undefined, SECTION) === "");

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nB. AUTHORED HTML CANNOT EXECUTE");

const XSS: [string, (out: string) => boolean][] = [
  ["<script>alert(1)</script>", (o) => !o.includes("alert")],
  ["<p onclick=\"alert(1)\">x</p>", (o) => !o.includes("onclick")],
  ["<p onmouseover=alert(1)>x</p>", (o) => !o.includes("onmouseover")],
  ["<a href=\"javascript:alert(1)\">x</a>", (o) => !o.includes("javascript")],
  ["<a href=\"java\tscript:alert(1)\">x</a>", (o) => !/javascript/i.test(o.replace(/\s/g, ""))],
  ["<img src=x onerror=alert(1)>", (o) => !o.includes("onerror")],
  ["<iframe src=\"https://evil.test\"></iframe>", (o) => !o.includes("iframe")],
  ["<style>body{display:none}</style>", (o) => !o.includes("display")],
  ["<div style=\"position:fixed;inset:0\">x</div>", (o) => !o.includes("position")],
  ["<object data=\"x.swf\"></object>", (o) => !o.includes("object")],
  ["<form action=\"https://evil.test\"><input name=p></form>", (o) => !o.includes("form")],
  ["<svg onload=alert(1)></svg>", (o) => !o.includes("onload")],
  ["<link rel=stylesheet href=\"https://evil.test/x.css\">", (o) => !o.includes("stylesheet")],
  ["<base href=\"https://evil.test/\">", (o) => !o.includes("base")],
  ["<a href=\"data:text/html,<script>alert(1)</script>\">x</a>", (o) => !o.includes("data:text/html")],
];
for (const [input, ok] of XSS) {
  const out = sanitizeHtml(input);
  check(`neutralised: ${input.slice(0, 40)}`, ok(out), out);
}

check("ordinary formatting survives",
  sanitizeHtml("<h2>Tytuł</h2><p>Treść <strong>ważna</strong></p>")
    === "<h2>Tytuł</h2><p>Treść <strong>ważna</strong></p>",
  sanitizeHtml("<h2>Tytuł</h2><p>Treść <strong>ważna</strong></p>"));

check("a table survives, because a legal document needs one",
  sanitizeHtml("<table><tr><th scope=\"col\">A</th><td colspan=\"2\">B</td></tr></table>")
    .includes("<th scope=\"col\">"),
  sanitizeHtml("<table><tr><th scope=\"col\">A</th><td colspan=\"2\">B</td></tr></table>"));

check("an https link survives and a new tab gets noopener",
  sanitizeHtml('<a href="https://grovbase.com" target="_blank">x</a>')
    === '<a href="https://grovbase.com" target="_blank" rel="noopener noreferrer">x</a>',
  sanitizeHtml('<a href="https://grovbase.com" target="_blank">x</a>'));

check("a relative link survives",
  sanitizeHtml('<a href="/cennik">x</a>') === '<a href="/cennik">x</a>');

check("plain http is dropped rather than mixed into an https page",
  !sanitizeHtml('<a href="http://example.test">x</a>').includes("href"));

check("an unbalanced tag cannot swallow the page",
  sanitizeHtml("<div><p>x") === "<div><p>x</p></div>",
  sanitizeHtml("<div><p>x"));

check("a stray closing tag is ignored",
  sanitizeHtml("</div><p>x</p>") === "<p>x</p>", sanitizeHtml("</div><p>x</p>"));

check("text is escaped, not interpreted",
  sanitizeHtml("5 < 6 & 7 > 4") === "5 &lt; 6 &amp; 7 &gt; 4", sanitizeHtml("5 < 6 & 7 > 4"));

check("rich text refuses layout tags",
  !sanitizeRichText("<section><p>x</p></section>").includes("section"),
  sanitizeRichText("<section><p>x</p></section>"));

check("rich text keeps document tags",
  sanitizeRichText("<h2>A</h2><ul><li>b</li></ul>") === "<h2>A</h2><ul><li>b</li></ul>");

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nC. FORMS POST ONLY WHERE THEY ARE ALLOWED TO");

check("the contact handler resolves", resolveHandler("contact", "contact")?.endpoint === "/api/public/contact");
check("an empty handler falls back to the section's own kind",
  resolveHandler(undefined, "newsletter")?.key === "newsletter");
check("an unknown handler is refused", resolveHandler("evil", "contact") === null);
check("a URL is not a handler", resolveHandler("https://evil.test/collect", "contact") === null);
check("a contact section cannot become a newsletter signup",
  resolveHandler("newsletter", "contact") === null);
check("every handler points at our own origin",
  FORM_HANDLERS.every((h) => h.endpoint.startsWith("/api/")));
check("topics are a closed list",
  isContactTopic("sales") && !isContactTopic("<script>"));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nD. A PAGE CANNOT CLAIM A ROUTE THE APP OWNS");

for (const slug of ["admin", "api", "auth", "dashboard", "login", "register", "settings", "profile", "k", "blog"]) {
  check(`refused: /${slug}`, slugProblem(slug) === "reserved");
}
check("an empty slug is refused", slugProblem("") === "empty");
check("uppercase and spaces are refused", slugProblem("Moja Strona") === "shape");
check("a path separator is refused", slugProblem("a/b") === "shape");
check("a leading dash is refused", slugProblem("-x") === "shape");
check("an ordinary slug passes", slugProblem("polityka-prywatnosci") === null);

// The app's list and the database's list have to agree, or one of them is
// enforcing a rule the other does not. The database's list is the one in the
// LATEST migration that (re)defines the function (0085, then 0125 added
// "blog") — the one the database actually runs.
const RESERVED_DEF = /create or replace function public\.cms_slug_is_reserved[\s\S]*?array\[([\s\S]*?)\]/;
const definingMigration = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()
  .filter((f) => RESERVED_DEF.test(readFileSync(`supabase/migrations/${f}`, "utf8"))).pop() ?? "";
const migration = definingMigration ? readFileSync(`supabase/migrations/${definingMigration}`, "utf8") : "";
check("the reserved-slug function is read from the latest migration that defines it",
  definingMigration >= "0125", definingMigration);
const dbList = RESERVED_DEF.exec(migration)?.[1] ?? "";
// A later migration may extend the list WITHOUT restating it: 0127 rebuilds
// the live function from pg_get_functiondef and splices one slug in after
// 'settings' ("execute replace(v_def, '''settings''', '''settings'', ''profile''')").
// Those additions are part of what the database runs, so they count too.
const SPLICE = /execute replace\(v_def, '''([^']+)''', '''\1'', ''([^']+)'''\)/g;
const spliced = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql") && f > definingMigration).sort()
  .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
  .filter((sql) => /cms_slug_is_reserved\(text\)/.test(sql))
  .flatMap((sql) => [...sql.matchAll(SPLICE)].map((m) => m[2]));
const dbSlugs = [...[...dbList.matchAll(/'([^']+)'/g)].map((m) => m[1]), ...spliced];
check("the /profile slug reserved by 0127 is read from its splice", spliced.includes("profile"), `${spliced}`);
const missingInApp = dbSlugs.filter((s) => !RESERVED.includes(s));
const missingInDb = RESERVED.filter((s) => !dbSlugs.includes(s));
check("the app's reserved list matches the database's",
  missingInApp.length === 0 && missingInDb.length === 0,
  `app is missing [${missingInApp}], db is missing [${missingInDb}]`);

// And the renderer's own guard has to match too, or a slug the database
// allows could still 404 at the route.
const missingInRoute = RESERVED.filter((s) => !RESERVED_SLUGS.has(s));
check("the public route refuses the same slugs", missingInRoute.length === 0, `${missingInRoute}`);

check("slugify folds Polish letters rather than dropping them",
  slugify("Polityka prywatności") === "polityka-prywatnosci", slugify("Polityka prywatności"));
check("slugify handles ł, which has no Unicode decomposition",
  slugify("Żółta Sukienka") === "zolta-sukienka", slugify("Żółta Sukienka"));

check("only known section types may be saved",
  isBlockType("hero") && isBlockType("custom_code") && !isBlockType("evil_type"));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nE. STYLE PRESETS BECOME VARIABLES, NEVER RAW CSS");

const styled = resolveStyle({
  base: { paddingTop: "xl", width: "wide", columns: 4, align: "center", background: "gradient" },
  tablet: { columns: 2 },
  mobile: { paddingTop: "sm", columns: 1 },
  hide: { mobile: true },
});
check("base values land on unsuffixed variables",
  styled.style["--cms-pt"]?.includes("clamp") === true && styled.style["--cms-cols"] === "4",
  JSON.stringify(styled.style));
check("a tablet override lands on -t", styled.style["--cms-cols-t"] === "2");
check("a mobile override lands on -m", styled.style["--cms-cols-m"] === "1");
check("an untouched breakpoint emits nothing, so it inherits",
  styled.style["--cms-w-t"] === undefined && styled.style["--cms-align-m"] === undefined);
check("hiding on mobile is a class, not a variable",
  styled.className.includes("cms-hide-m") && !styled.className.includes("cms-hide-d"));
check("every section gets the shared frame class", styled.className.startsWith("cms-sec"));

// The whole point of an enum: a value from the database cannot become CSS.
const forged = resolveStyle({
  base: {
    paddingTop: "1px; background: url(https://evil.test)" as never,
    width: "100vw" as never,
    align: "center; position: fixed" as never,
    columns: 999,
  },
});
check("a forged spacing value is dropped", forged.style["--cms-pt"] === undefined,
  forged.style["--cms-pt"]);
check("a forged width is dropped", forged.style["--cms-w"] === undefined);
check("a forged alignment is dropped", forged.style["--cms-align"] === undefined);
check("an out-of-range column count is dropped", forged.style["--cms-cols"] === undefined);

check("the device presets cover the widths the brief names",
  [1920, 1440, 1366].every((w) => (DEVICE_PRESETS.desktop as readonly number[]).includes(w))
  && [1024, 768].every((w) => (DEVICE_PRESETS.tablet as readonly number[]).includes(w))
  && [430, 390, 375, 360, 320].every((w) => (DEVICE_PRESETS.mobile as readonly number[]).includes(w)));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nF. SEO");

const page = {
  slug: "cennik", title: "Cennik", kind: "standard", blocks: [],
  publishedAt: null, updatedAt: null,
  seo: {
    pl: { title: "Cennik GrovBase", description: "Plany i kredyty." },
    en: { title: "GrovBase pricing" },
    ogImage: "https://grovbase.com/og.png",
  },
};
const pl = pageMetadata(page as never, "pl", "/cennik");
check("the locale's own title wins", pl.title === "Cennik GrovBase");
check("a canonical is emitted", pl.alternates?.canonical === "/cennik");
check("the share card falls back to the search title", pl.openGraph?.title === "Cennik GrovBase");
check("an og image makes it a large card",
  (pl.twitter as { card?: string } | undefined)?.card === "summary_large_image");

const en = pageMetadata(page as never, "en", "/cennik");
check("a locale with no description inherits the Polish one",
  en.title === "GrovBase pricing" && en.description === "Plany i kredyty.");

const de = pageMetadata(page as never, "de", "/cennik");
check("a locale with nothing of its own falls back to Polish", de.title === "Cennik GrovBase");

const bare = pageMetadata({ ...page, seo: {} } as never, "pl", "/x");
check("a page with no SEO still names itself", bare.title === "Cennik");
check("indexing is on by default", (bare.robots as { index?: boolean }).index === true);

const hidden = pageMetadata({ ...page, seo: { noindex: true } } as never, "pl", "/x");
check("noindex is honoured", (hidden.robots as { index?: boolean }).index === false);

const sitemap = readFileSync("app/sitemap.ts", "utf8");
check("the sitemap reads the same noindex flag", /isNoindex\(p\.seo\)/.test(sitemap));
check("the sitemap lists published pages only", /\.eq\("status", "published"\)/.test(sitemap));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nG. THE BUILDER NEVER REACHES A PUBLIC PAGE");

const publicFiles = [
  "components/cms/blocks.tsx",
  "components/cms/site-shell.tsx",
  "components/cms/custom-block.tsx",
  "components/cms/cms-image.tsx",
  "components/cms/cms-form.tsx",
  "app/[slug]/page.tsx",
];
for (const file of publicFiles) {
  const src = readFileSync(file, "utf8");
  check(`${file.replace("components/cms/", "")} imports nothing from the builder`,
    !/@\/components\/admin\//.test(src) && !/@\/app\/actions\/cms/.test(src));
}

const renderer = readFileSync("components/cms/blocks.tsx", "utf8");
check("the renderer prints markup only through the sanitiser",
  (renderer.match(/dangerouslySetInnerHTML/g) ?? []).length === 1
  && /anchorHeadings\(html\)/.test(renderer));
check("a section that throws does not take the page with it",
  /try \{[\s\S]*renderBlock[\s\S]*\} catch/.test(renderer));
check("a broken section is hidden in production and shown to an admin",
  /if \(!ctx\.admin\) return null;/.test(renderer));

/** These files EXPLAIN why they do not call eval; the explanation must not
 *  itself trip the check that verifies it. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\*.*$/gm, "");

const custom = readFileSync("components/cms/custom-block.tsx", "utf8");
check("custom JS is off unless asked for",
  /code\?\.jsEnabled && js/.test(custom));
check("custom JS runs in a frame with no same-origin access",
  /allow-same-origin is absent ON PURPOSE/.test(readFileSync("components/cms/sandbox-frame.tsx", "utf8")));
const sandbox = readFileSync("components/cms/sandbox-frame.tsx", "utf8");
check("the sandbox attribute genuinely omits allow-same-origin",
  /sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/.test(sandbox));
check("the frame only listens to its own window",
  /event\.source !== ref\.current\.contentWindow/.test(sandbox));
check("nothing in the CMS calls eval",
  [custom, sandbox, renderer].every((src) => !/\beval\s*\(|new Function\s*\(/.test(stripComments(src))));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nG2. THE PUBLIC RENDERER READS ONLY WHAT A VISITOR MAY READ");

const mediaLib = readFileSync("lib/server/cms-media.ts", "utf8");
check("image metadata comes from the bounded lookup, not the catalogue",
  /rpc\("cms_media_meta"/.test(mediaLib) && !/from\("media_assets"\)/.test(mediaLib));
check("the lookup is capped, so it can never become a scan",
  /MAX_LOOKUP/.test(mediaLib) && /slice\(0, MAX_LOOKUP\)/.test(mediaLib));
check("a failed lookup degrades to an unoptimised image, not an error",
  /if \(error \|\| !data\) return EMPTY;/.test(mediaLib));

const m88 = readFileSync("supabase/migrations/0088_cms_media_meta_for_visitors.sql", "utf8");
check("the lookup function is definer and granted to anon",
  /security definer/.test(m88) && /grant execute on function public\.cms_media_meta/.test(m88));
check("the grant is preceded by an explicit revoke from public",
  /revoke all on function public\.cms_media_meta\(text\[\]\) from public, anon, authenticated;/.test(m88));
check("the lookup takes paths and cannot be asked to list",
  /m\.storage_path = any \(p_paths\)/.test(m88) && !/limit \d+\s*;/.test(m88));

const m89 = readFileSync("supabase/migrations/0089_media_catalogue_is_not_public.sql", "utf8");
check("the world-readable media policy is dropped",
  /drop policy if exists "media_read" on public\.media_assets;/.test(m89));
check("media policies are scoped to authenticated, never the public role",
  (m89.match(/create policy[\s\S]*?to authenticated/g) ?? []).length === 2
  && !/create policy[^;]*to public/.test(m89));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nH. THE WAITING-LIST PAGE IS UNTOUCHED");

const root = readFileSync("app/page.tsx", "utf8");
/*
  THIS ASSERTION USED TO READ `if (mode === "waitlist")`.

  It was pinning the IMPLEMENTATION of the homepage switch, not the property
  that matters — and the implementation was the defect: "which page is the
  homepage" lived in an app_settings enum that no anonymous visitor could read,
  so "/" served the ordinary landing while the panel said otherwise. Migration
  0110 moved the answer onto the page row.

  What section H is actually for is that the LAUNCH PAGE still has a route to
  "/" of its own and still renders through its own component. That is what is
  checked now; scripts/homepage-tests.ts holds the single-source-of-truth
  property, and scripts/homepage-sql-tests.sh holds the policy half.
*/
check("the launch page still has its own branch at \"/\"",
  /kind === "launch"/.test(root) && /getActiveHomepage/.test(root));
check("the launch page is still rendered by its own component",
  /<LaunchPage/.test(root) && /resolveLaunchContent\(/.test(root));
check("the waiting-list branch still reads the registration config",
  /getRegistrationConfig\(supabase\)/.test(root));
check("the waiting-list form is not imported by the CMS renderer",
  !/waitlist-form/.test(renderer));

const launch = readFileSync("components/launch/launch-page.tsx", "utf8");
check("the launch page does not render CMS sections",
  !/BlockRenderer/.test(launch) && !/cms-sec/.test(launch));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nI. THE PICKER AND THE SEED AGREE WITH THE RENDERER");

const offered = SECTION_GROUPS.flatMap((g) => g.types);
const unknown = offered.filter((t) => !(BLOCK_TYPES as readonly string[]).includes(t));
check("every section the picker offers is a known type", unknown.length === 0, `${unknown}`);

// The O nas sections are rendered in their own file (blocks.tsx hands every
// about_* block to renderAboutBlock).
const aboutRenderer = readFileSync("components/cms/about-sections.tsx", "utf8");
const rendered = [...`${renderer}\n${aboutRenderer}`.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]);
check("blocks.tsx hands every about_* block to the about renderer",
  /if \(isAboutType\(block\.type\)\) return renderAboutBlock\(block, ctx, first\);/.test(renderer));
const unrenderable = offered.filter((t) => !rendered.includes(t));
check("every section the picker offers has a renderer", unrenderable.length === 0, `${unrenderable}`);

const dict = JSON.parse(readFileSync("lib/i18n/dictionaries/pl.json", "utf8")) as
  { cms: Record<string, unknown> };
const nested = (dict.cms.sectionType ?? {}) as Record<string, string>;
const unnamed = offered.filter((t) => !nested[t] && !dict.cms[`sectionType.${t}`]);
check("every section the picker offers has a name", unnamed.length === 0, `${unnamed}`);

const seedSlugs = SEED_PAGES.map((p) => p.slug);
check("the seed covers the seven pages the brief asks for",
  ["home", "narzedzia", "cennik", "o-nas", "kontakt", "regulamin", "polityka-prywatnosci"]
    .every((s) => seedSlugs.includes(s)), `${seedSlugs}`);
const seedTypes = SEED_PAGES.flatMap((p) => p.sections.map((s) => s.type));
check("every seeded section is a type the renderer knows",
  seedTypes.every((t) => rendered.includes(t)),
  `${seedTypes.filter((t) => !rendered.includes(t))}`);
check("nothing in the seed invents legal wording",
  SEED_PAGES.filter((p) => p.slug === "regulamin" || p.slug === "polityka-prywatnosci")
    .every((p) => JSON.stringify(p.sections).includes("przygotowaniu")));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nJ. THE LAUNCH PAGE IN THE BUILDER (Landing V2)");

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const isObj = (v: unknown) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const LAUNCH_KEYS = LAUNCH_FIELDS as readonly string[];

// H, strengthened: the launch page draws its own sections — the galleries
// included — and still never the generic CMS renderer.
check("the launch page reads the gallery blocks itself, never through BlockRenderer",
  !/BlockRenderer/.test(launch) && !/cms-sec/.test(launch));

{
  const rows = LAUNCH_SECTION_FIELDS.filter((f) => f.kind !== "heading");
  const keys = rows.map((f) => f.key);
  const notOnce = LAUNCH_KEYS.filter((k) => keys.filter((x) => x === k).length !== 1);
  check(`every field the page reads (${LAUNCH_KEYS.length} LAUNCH_FIELDS) is in the builder form exactly once`,
    notOnce.length === 0, notOnce.join(", "));
  const extra = keys.filter((k) => !LAUNCH_KEYS.includes(k));
  check("…and the only other rows are the 8 section switches and the 2 pictures stored next to `fields`",
    same([...extra].sort(), [...LAUNCH_SHOW_KEYS, ...LAUNCH_MEDIA_KEYS].sort()), extra.join(", "));
  const toggles = rows.filter((f) => f.kind === "toggle");
  check("each switch is a toggle on its section's `showX` key, defaulting to that section's own default",
    toggles.length === LAUNCH_SECTIONS.length
    && LAUNCH_SECTIONS.every((s) => toggles.some((f) => f.key === sectionKey(s) && f.defaultOn === SECTION_DEFAULT_SHOWN[s])));
  check("…so the cost strip and the creators tile start OFF (no unapproved prices, no invented people)",
    toggles.find((f) => f.key === "showCost")?.defaultOn === false && toggles.find((f) => f.key === "showCreators")?.defaultOn === false);
  check("the two pictures (creatorsImage, ogImage) are media fields",
    LAUNCH_MEDIA_KEYS.every((k) => rows.find((f) => f.key === k)?.kind === "media"));
  check("no key twice (headings included), and every label / hint is an i18n key without a dot",
    new Set(LAUNCH_SECTION_FIELDS.map((f) => f.key)).size === LAUNCH_SECTION_FIELDS.length
    && LAUNCH_SECTION_FIELDS.every((f) => !f.label.includes(".") && !(f.hint ?? "").includes(".")));
  check("the form opens with a group heading, and the galleries' texts have their own group",
    LAUNCH_SECTION_FIELDS[0].kind === "heading" && LAUNCH_SECTION_FIELDS.some((f) => f.kind === "heading" && f.label === "launchGroupGalleries"));

  const showCost = rows.find((f) => f.key === "showCost") as FieldDef;
  const showFinal = rows.find((f) => f.key === "showFinal") as FieldDef;
  const c0: CmsBlockContent = { fields: { "hero.h1": { pl: "X" } } };
  check("an untouched switch reads as its default", !toggleOn(c0, showCost) && toggleOn(c0, showFinal));
  const on = writeField(c0, showCost, "de", "1") as Record<string, unknown>;
  const off = writeField(on as CmsBlockContent, showCost, "pl", "0") as Record<string, unknown>;
  check("a switch is stored at the content root as \"1\" / \"0\" — never per language, never inside `fields`",
    on.showCost === "1" && !("showCost" in ((on.fields ?? {}) as object)) && toggleOn(on as CmsBlockContent, showCost)
    && off.showCost === "0" && !toggleOn(off as CmsBlockContent, showCost) && readField(off as CmsBlockContent, showCost, "en") === "0");
  const heading = LAUNCH_SECTION_FIELDS.find((f) => f.kind === "heading") as FieldDef;
  const summary = LAUNCH_GALLERY_FIELDS[0];
  const galleryContent = { gallery: "thumbs", items: [{ id: "aaaaaaaa-0000-4000-8000-0000000000aa", before: null, after: null }] } as unknown as CmsBlockContent;
  check("a heading and a gallery summary store nothing: writeField returns the same object, readField reads \"\"",
    writeField(c0, heading, "pl", "x") === c0 && writeField(galleryContent, summary, "pl", "x") === galleryContent
    && readField(galleryContent, summary, "pl") === "" && readField(c0, heading, "pl") === "");
  check("fieldsFor('launch_gallery') is that one read-only summary",
    fieldsFor("launch_gallery") === LAUNCH_GALLERY_FIELDS && LAUNCH_GALLERY_FIELDS.length === 1 && summary.kind === "gallery");
}

{
  // Every label the builder draws for the launch page and its galleries, in
  // all three languages — a raw `cms.label.…` on screen is a visible bug.
  type Dict = Record<string, unknown>;
  const loadDict = (l: string) => JSON.parse(readFileSync(`lib/i18n/dictionaries/${l}.json`, "utf8")) as Dict;
  const DICTS: Record<string, Dict> = { pl: loadDict("pl"), en: loadDict("en"), de: loadDict("de") };
  const fragmentPath = process.env.I18N_FRAGMENT;
  const merge = (into: Dict, from: Dict) => {
    for (const [k, v] of Object.entries(from)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (!into[k] || typeof into[k] !== "object") into[k] = {};
        merge(into[k] as Dict, v as Dict);
      } else into[k] = v;
    }
  };
  if (fragmentPath) {
    const fragment = JSON.parse(readFileSync(fragmentPath, "utf8")) as Record<string, Dict>;
    for (const l of ["pl", "en", "de"]) merge(DICTS[l], fragment[l] ?? {});
  }
  const labelKeys = [...LAUNCH_SECTION_FIELDS, ...LAUNCH_GALLERY_FIELDS]
    .flatMap((f) => [f.label, f.hint]).filter((k): k is string => Boolean(k)).map((k) => `cms.label.${k}`);
  const summaryKeys = ["Thumbs", "Retouch", "Fashion", "Pairs", "Complete", "Incomplete", "State", "Shown", "Hidden", "NoComplete", "Edit", "Count"]
    .map((s) => `cms.label.launchGallery${s}`);
  const otherKeys = ["cms.sectionType.launch", "cms.sectionType.launch_gallery", "cms.err.text_token", "cms.err.galleryManaged", "cms.err.notCopyable"];
  const all = [...new Set([...labelKeys, ...summaryKeys, ...otherKeys])];
  const missing = ["pl", "en", "de"].flatMap((l) => all.filter((k) => {
    const v = lookup(DICTS[l], k);
    return typeof v !== "string" || !v.trim();
  }).map((k) => `${l}:${k}`));
  check(`every builder label / hint of the launch page and its galleries exists in pl, en and de (${all.length} keys${fragmentPath ? ", fragment merged" : ""})`,
    missing.length === 0, `${missing.length} missing: ${missing.slice(0, 8).join(", ")}`);
}

{
  const raw = { fields: { "hero.h1": { pl: "H" }, "hero.badge": "nie obiekt" }, showCost: "1" } as unknown as CmsBlockContent;
  const fixed = ensureLaunchFieldObjects(raw, LAUNCH_KEYS);
  check("the invariant: every launch field becomes an object; written values kept; a non-object replaced by {}; root keys kept",
    LAUNCH_KEYS.every((k) => isObj(fixed.fields?.[k])) && same(fixed.fields?.["hero.h1"], { pl: "H" })
    && same(fixed.fields?.["hero.badge"], {}) && (fixed as Record<string, unknown>).showCost === "1");
  check("…idempotent, and it never mutates its input",
    same(ensureLaunchFieldObjects(fixed, LAUNCH_KEYS), fixed) && (raw.fields as Record<string, unknown>)["hero.badge"] === "nie obiekt");
  const tok = (fields: Record<string, Record<string, string>>) => launchTokenProblem({ fields });
  check("the token rule refuses '{premiera}' and a value token in the headline, names the field and the language",
    same(tok({ "hero.h1": { pl: "Start {premiera}" } }), { key: "hero.h1", locale: "pl", tokens: ["premiera"] })
    && tok({ "hero.h1": { en: "{credits} now" } })?.tokens[0] === "credits");
  check("…and allows each line its own tokens: hero.offer {date}{credits}, ref.body {referral}, hero.consent {terms}{privacy}",
    tok({ "hero.offer": { pl: "Startujemy {date} – {credits} kredytów" }, "ref.body": { de: "+{referral}" },
      "hero.consent": { pl: "Akceptuję {terms} i {privacy}." }, "hero.h1": { pl: "Bez znaczników" } }) === null);
  check("…a typo such as '{credit}' is refused even where {credits} is allowed",
    tok({ "hero.offer": { pl: "{credit} kredytów" } })?.tokens[0] === "credit");

  const ITEM = { id: "aaaaaaaa-0000-4000-8000-0000000000a1", before: { url: "u1" }, after: { url: "u2" } };
  const snap = [
    { id: "x1", type: "launch", sort_order: 0, visible: true, content: { fields: { "hero.h1": { pl: "H" } } } },
    { id: "x2", type: "launch_gallery", sort_order: 10, visible: false, content: { gallery: "thumbs", items: [ITEM] } },
    { id: "x3", type: "evil_type", sort_order: 20, visible: true, content: {} },
  ];
  const rows = versionBlockRows(snap, "page", "admin", LAUNCH_KEYS);
  const gal = rows.find((r) => r.type === "launch_gallery");
  check("rollback rows keep a launch_gallery: the same content, the same switch, the same place",
    Boolean(gal) && same(gal?.content, snap[1].content) && gal?.visible === false && gal?.sort_order === 10);
  check("…drop an unknown type, and bring the launch block up to the invariant",
    !rows.some((r) => r.type === "evil_type")
    && LAUNCH_KEYS.every((k) => isObj((rows.find((r) => r.type === "launch")?.content as unknown as CmsBlockContent).fields?.[k])));
  check("the never-copied types are exactly launch and launch_gallery", same([...NOT_COPYABLE_TYPES].sort(), ["launch", "launch_gallery"]));
}

/* ── the actions themselves, over a fake Supabase ─────────────────────── */
{
  const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
  const PAGE = "bbbbbbbb-0000-4000-8000-000000000001";
  const B_LAUNCH = "cccccccc-0000-4000-8000-000000000001";
  const B_GAL = "cccccccc-0000-4000-8000-000000000002";
  const B_HERO = "cccccccc-0000-4000-8000-000000000003";
  const T0 = "2026-10-01T10:00:00.000Z";
  const ITEM = { id: "aaaaaaaa-0000-4000-8000-0000000000a1", before: { url: "u1" }, after: { url: "u2" } };
  const launchContent = () => ({ fields: { "hero.h1": { pl: "Stary" } } });

  const fresh = () => {
    resetIceState();
    const d = new FakeDb();
    d.user = { id: ADMIN };
    d.tables.profiles = [{ id: ADMIN, role: "admin" }];
    d.tables.cms_pages = [{
      id: PAGE, slug: "premiera", kind: "launch", status: "published", is_homepage: true, seo: {}, published_at: T0,
      published_snapshot: [{ id: B_LAUNCH, type: "launch", sort_order: 0, visible: true, content: launchContent() }],
    }];
    d.tables.cms_blocks = [
      { id: B_LAUNCH, page_id: PAGE, type: "launch", sort_order: 0, visible: true, content: launchContent(), style: {}, code: {}, updated_at: T0 },
      { id: B_GAL, page_id: PAGE, type: "launch_gallery", sort_order: 10, visible: true, content: { gallery: "thumbs", items: [ITEM] }, style: {}, code: {}, updated_at: T0 },
      { id: B_HERO, page_id: PAGE, type: "hero", sort_order: 20, visible: true, content: {}, style: {}, code: {}, updated_at: T0 },
    ];
    d.tables.cms_page_versions = [];
    d.tables.cms_templates = [];
    iceState.client = d.client();
    return d;
  };
  const block = (d: FakeDb, id: string) => (d.tables.cms_blocks ?? []).find((r) => r.id === id) as Row | undefined;
  const wrote = (d: FakeDb, table: string, op?: string) =>
    d.calls.filter((c) => c.kind === "from" && c.table === table && c.op !== "select" && (!op || c.op === op)).length;

  {
    const d = fresh();
    const r = await saveBlockAction({
      id: B_GAL, pageId: PAGE, type: "launch_gallery", content: { gallery: "thumbs", items: [] } as unknown as CmsBlockContent,
      style: { base: { paddingTop: "xl" } }, visible: false, anchor: "galeria",
    });
    const g = block(d, B_GAL);
    check("saveBlockAction on a stored gallery writes its switch and NOTHING else (stale builder content is ignored)",
      r.ok && g?.visible === false && same(g?.content, { gallery: "thumbs", items: [ITEM] }) && same(g?.style, {}) && g?.anchor === undefined,
      JSON.stringify({ r, g }));
  }
  {
    const d = fresh();
    const r = await saveBlockAction({ pageId: PAGE, type: "launch_gallery", content: { gallery: "retouch", items: [] } as unknown as CmsBlockContent, visible: true });
    check("…refuses to CREATE a gallery (only the inline editor does) — galleryManaged, no insert",
      !r.ok && r.error === "galleryManaged" && wrote(d, "cms_blocks", "insert") === 0);
    const r2 = await saveBlockAction({ id: B_HERO, pageId: PAGE, type: "launch_gallery", content: {}, visible: true });
    check("…and to turn another block into one", !r2.ok && r2.error === "galleryManaged" && block(d, B_HERO)?.type === "hero");
  }
  {
    const d = fresh();
    const r = await saveBlockAction({ id: B_LAUNCH, pageId: PAGE, type: "launch", content: { fields: { "hero.h1": { pl: "Start {premiera}" } } }, visible: true });
    check("a launch save with a token the line does not allow → text_token, naming the line; nothing written",
      !r.ok && r.error === "text_token" && /hero\.h1 \(pl\): \{premiera\}/.test(r.ok ? "" : r.detail ?? "")
      && same(block(d, B_LAUNCH)?.content, launchContent()) && wrote(d, "cms_blocks") === 0, JSON.stringify(r));
  }
  {
    const d = fresh();
    const r = await saveBlockAction({ id: B_LAUNCH, pageId: PAGE, type: "launch", content: { fields: { "hero.h1": { pl: "Nowy" } } }, visible: true });
    const stored = block(d, B_LAUNCH)?.content as CmsBlockContent | undefined;
    check("a launch save is normalised: every field stored as an object, the edit kept",
      r.ok && LAUNCH_KEYS.every((k) => isObj(stored?.fields?.[k])) && stored?.fields?.["hero.h1"]?.pl === "Nowy");
  }
  {
    const d = fresh();
    d.tables.cms_templates = [{ id: "dddddddd-0000-4000-8000-000000000001", kind: "section", payload: [{ type: "launch_gallery", content: { gallery: "thumbs", items: [] } }] }];
    const results = await Promise.all([
      duplicateBlockAction(B_LAUNCH), duplicateBlockAction(B_GAL),
      saveSectionTemplateAction({ name: "x", blockId: B_GAL }), saveSectionTemplateAction({ name: "x", blockId: B_LAUNCH }),
      applySectionTemplateAction({ pageId: PAGE, templateId: "dddddddd-0000-4000-8000-000000000001" }),
    ]);
    check("Duplicate, 'Zapisz jako szablon' and 'Moje sekcje' refuse the launch block and the galleries → notCopyable, nothing inserted",
      results.every((x) => !x.ok && x.error === "notCopyable") && wrote(d, "cms_blocks", "insert") === 0 && wrote(d, "cms_templates", "insert") === 0,
      JSON.stringify(results));
    // The fake client has no `.gt()`, which the duplicate's re-numbering uses,
    // so a real duplicate cannot complete here; what matters is that an
    // ordinary section is not refused by the new rule.
    const other = await duplicateBlockAction(B_HERO);
    check("…while any other section is not refused by that rule", other.ok || other.error !== "notCopyable", JSON.stringify(other));
  }
  {
    const d = fresh();
    const ITEM2 = { id: "aaaaaaaa-0000-4000-8000-0000000000a2", before: { url: "u3" }, after: null };
    const galleryV1 = { gallery: "thumbs", items: [ITEM, ITEM2] };
    d.tables.cms_page_versions = [{
      id: "eeeeeeee-0000-4000-8000-000000000001", page_id: PAGE, version: 1, seo: {},
      snapshot: [
        { id: "old-launch", type: "launch", sort_order: 0, visible: true, content: launchContent() },
        { id: "old-gallery", type: "launch_gallery", sort_order: 10, visible: false, content: galleryV1 },
      ],
    }];
    const r = await rollbackPageAction(PAGE, "eeeeeeee-0000-4000-8000-000000000001");
    const back = (d.tables.cms_blocks ?? []).filter((b) => b.type === "launch_gallery");
    check("Historia → Przywróć keeps the gallery: re-created with identical content and switch",
      r.ok && back.length === 1 && same(back[0].content, galleryV1) && back[0].visible === false, JSON.stringify(back));
  }
  {
    const d = fresh();
    const r = await publishPageAction(PAGE);
    const page = d.tables.cms_pages[0];
    const snap = page.published_snapshot as Row[];
    const order = d.calls.flatMap((c, i) => (c.kind === "from" && c.op !== "select" && (c.table === "cms_page_versions" || c.table === "cms_pages") ? [`${c.table}:${i}`] : []));
    check("publishPageAction (now through the shared publishPage) publishes every block, the galleries included",
      r.ok && snap.length === 3 && snap.some((b) => b.id === B_GAL && b.type === "launch_gallery") && page.status === "published");
    check("…the version is written FIRST, then the page; one audit row; the public cache cleared",
      order.length === 2 && order[0].startsWith("cms_page_versions") && order[1].startsWith("cms_pages")
      && iceState.audits.length === 1 && iceState.audits[0].action === "cms.published" && iceState.revalidated.includes("tag:cms-pages"),
      JSON.stringify({ order, audits: iceState.audits.map((a) => a.action), rev: iceState.revalidated }));
  }
  {
    const d = fresh();
    d.tables.cms_blocks = d.tables.cms_blocks.filter((b) => b.type !== "launch");
    const r = await ensureLaunchSectionAction(PAGE);
    const created = (d.tables.cms_blocks ?? []).find((b) => b.type === "launch");
    check("ensureLaunchSectionAction on a page without its section creates one with EVERY field present (at least {})",
      r.ok && Boolean(created) && LAUNCH_KEYS.every((k) => isObj((created?.content as CmsBlockContent | undefined)?.fields?.[k])));
    check("…and never creates a gallery", (d.tables.cms_blocks ?? []).filter((b) => b.type === "launch_gallery").length === 1);
  }
  {
    const d = fresh();
    const r = await ensureLaunchSectionAction(PAGE);
    const draft = block(d, B_LAUNCH)?.content as CmsBlockContent;
    const live = (d.tables.cms_pages[0].published_snapshot as Row[])[0].content as CmsBlockContent;
    check("an existing section missing fields: draft AND published copy normalised the same way when they were equal (the inline editor is not locked out)",
      r.ok && LAUNCH_KEYS.every((k) => isObj(draft.fields?.[k])) && same(draft, live) && d.tables.cms_pages[0].published_at === T0
      && draft.fields?.["hero.h1"]?.pl === "Stary");
  }
  {
    const d = fresh();
    const other = { fields: { "hero.h1": { pl: "Inny" } } };
    (d.tables.cms_pages[0].published_snapshot as Row[])[0].content = other;
    const r = await ensureLaunchSectionAction(PAGE);
    check("…when the draft already differs from what is published, only the draft is normalised",
      r.ok && LAUNCH_KEYS.every((k) => isObj((block(d, B_LAUNCH)?.content as CmsBlockContent).fields?.[k]))
      && same((d.tables.cms_pages[0].published_snapshot as Row[])[0].content, other));
  }
  {
    const d = fresh();
    const full = ensureLaunchFieldObjects(launchContent(), LAUNCH_KEYS);
    (block(d, B_LAUNCH) as Row).content = full;
    (d.tables.cms_pages[0].published_snapshot as Row[])[0].content = full;
    const r = await ensureLaunchSectionAction(PAGE);
    check("…and a section that already holds every field is not written at all",
      r.ok && wrote(d, "cms_blocks") === 0 && wrote(d, "cms_pages") === 0);
  }
}

console.log(failures === 0 ? "\nAll CMS tests passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
