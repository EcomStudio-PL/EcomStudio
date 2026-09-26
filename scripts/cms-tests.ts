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
 *
 * Run: npm run test:cms
 */
import { readFileSync, readdirSync } from "fs";
import { scopeCss, styleSafe } from "../lib/cms-css";
import { sanitizeHtml, sanitizeRichText } from "../lib/cms-sanitize";
import { resolveHandler, FORM_HANDLERS, isContactTopic } from "../lib/cms-forms";
import { slugProblem, slugify, RESERVED, isBlockType } from "../lib/services/cms";
import { resolveStyle, DEVICE_PRESETS } from "../lib/cms-style";
import { pageMetadata, RESERVED_SLUGS } from "../lib/server/cms-page";
import { SECTION_GROUPS, BLOCK_TYPES } from "../lib/cms";
import { SEED_PAGES } from "../lib/cms-seed";

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

for (const slug of ["admin", "api", "auth", "dashboard", "login", "register", "settings", "k", "blog"]) {
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
const dbSlugs = [...dbList.matchAll(/'([^']+)'/g)].map((m) => m[1]);
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

const rendered = [...renderer.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]);
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

console.log(failures === 0 ? "\nAll CMS tests passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
