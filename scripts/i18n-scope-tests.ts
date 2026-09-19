/**
 * WHICH TRANSLATIONS EACH SURFACE ACTUALLY NEEDS — computed, then enforced.
 *
 * THE PROBLEM. `app/layout.tsx` handed the ENTIRE dictionary to a client
 * component, so every document GrovBase serves — the landing page included —
 * carried all 87 namespaces inlined in its HTML. A visitor reading the terms of
 * service downloaded the newsletter campaign builder's labels, the CRM's, the
 * AI cost table's. Not as a cached file that a second page could reuse: inline,
 * in the RSC payload, again on every navigation that re-renders the root.
 *
 * THE FIX (lib/i18n/scopes.ts) splits that payload three ways — what the public
 * pages need, what the signed-in app adds, what /admin adds — and each layout
 * serialises only its own share.
 *
 * WHY THIS FILE EXISTS. Sending less is only safe if "less" is still
 * everything that surface renders. A namespace left out does not throw: `t()`
 * falls back to humanizeKey and a Polish label quietly turns into an English
 * word. That is a visible regression that no type check can catch and that
 * nobody notices until a customer does.
 *
 * So the split is not hand-maintained. This script re-derives it from the
 * import graph — every route file, everything it imports, transitively — and
 * fails if the committed manifest is not EXACTLY what the code needs.
 *
 *   npm run test:i18n:scopes            check
 *   npm run test:i18n:scopes -- --write regenerate lib/i18n/scopes.ts
 *
 * IT LOOKS FOR KEYS, NOT FOR `t(` CALLS, AND THAT DISTINCTION IS THE WHOLE
 * POINT. The first version of this script matched `t("ns.key")` and nothing
 * else. This codebase passes translation keys around as values constantly —
 * `lib/features.ts` stores `nameKey: "topnav.home"` in a registry,
 * `lib/tool-search.ts` builds `` `toolsearch.${f.key}.desc` `` into an object,
 * `lib/relative-time.ts` returns `"time.minutes"`, `lib/roles.ts` maps roles to
 * `"roles.admin"` — and the component at the other end just calls `t(entry.x)`.
 * There are well over a hundred such sites. Matching call syntax found none of
 * them and produced a manifest that was green while four surfaces rendered
 * humanised English. So the scan now takes EVERY string or template literal in
 * the file whose first dotted segment names a real namespace.
 *
 * That over-includes: a notification type like "credits.purchased" is not a
 * translation key but looks exactly like one. Over-including costs bytes.
 * Under-including costs correctness. The trade is deliberate and one-way.
 *
 * Server components are also not the risk here — they render with the full
 * dictionary and never serialise it — so the analysis is a superset twice over.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { gzipSync } from "zlib";
import { join, dirname, resolve, relative } from "path";
import { SCOPES as COMMITTED } from "../lib/i18n/scopes";

const ROOT = process.cwd();
const WRITE = process.argv.includes("--write");

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); }
}

/* ── reading a source file the way JavaScript reads it ─────────────────────
 * Comments are not code. `lib/i18n/t.ts` explains itself with an example key
 * from the admin panel; taking that prose literally put 19 KB of admin
 * translations onto the landing page. So the scan walks the file tracking
 * string, template and comment state instead of running a regex over the raw
 * text. `//` and `/*` outside a string are always comments in valid
 * JavaScript, which is what makes this tractable — the only thing that could
 * fool it is a regex literal containing one, and there is none in this tree
 * (the fixtures below pin the behaviour either way). */
function stripComments(src: string): string {
  let out = "";
  // Template literals nest: `a ${cond ? "x" : `y`} b`. A stack, not a flag.
  const stack: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    const next = src[i + 1];
    const top = stack[stack.length - 1];

    if (top === "//") {
      if (c === "\n") { stack.pop(); out += c; }
      continue;
    }
    if (top === "/*") {
      if (c === "*" && next === "/") { stack.pop(); i++; }
      else if (c === "\n") out += c; // keep line numbers honest
      continue;
    }
    if (top === "'" || top === '"' || top === "`") {
      out += c;
      if (c === "\\") { out += src[i + 1] ?? ""; i++; continue; }
      if (c === top) stack.pop();
      else if (top === "`" && c === "$" && next === "{") { out += next; i++; stack.push("${"); }
      continue;
    }
    // Ordinary code, or inside a template's ${ … } hole.
    if (c === "/" && next === "/") { stack.push("//"); i++; continue; }
    if (c === "/" && next === "*") { stack.push("/*"); i++; continue; }
    out += c;
    if (c === "'" || c === '"' || c === "`") stack.push(c);
    else if (c === "}" && top === "${") stack.pop();
    else if (c === "{" && top === "${") stack.push("{");
    else if (c === "}" && top === "{") stack.pop();
  }
  return out;
}

/* ── the import graph ──────────────────────────────────────────────────── */

const IMPORT = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
/** Any string or template whose first dotted segment could be a namespace.
 *  `${` is allowed after the dot so `` `toolsearch.${key}.desc` `` counts. */
const KEY_LIKE = /["'`]([A-Za-z0-9_]+)\.[A-Za-z0-9_${]/g;
/** `t(`${prefix}.${o}`)` — the namespace itself is a variable, so NOTHING can
 *  see it statically. Rare, and each one has to be justified by hand. */
const T_INTERPOLATED = /\bt\(\s*`\$\{/;

/** Files that build a key from a namespace this script cannot read, and why
 *  that is safe anyway. A new entry here is a decision, not a formality. */
const INTERPOLATED_ALLOWED = new Map([
  // Every `prefix` passed to its <Choice> is a literal "cms.*" string prop
  // (lines 37-138), so the scan above sees `cms` regardless, and `cms` is in
  // the root scope because the public page renderer needs it.
  ["components/admin/cms/style-panel.tsx", "all prefixes are literal cms.* props"],
]);

function resolveImport(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // a package, not ours
  for (const c of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    try { if (statSync(c).isFile()) return c; } catch { /* next candidate */ }
  }
  return null;
}

type Scanned = { namespaces: Set<string>; deps: string[]; interpolated: boolean };
const scanned = new Map<string, Scanned>();
function scan(file: string): Scanned {
  const hit = scanned.get(file);
  if (hit) return hit;
  const src = stripComments(readFileSync(file, "utf8"));
  const namespaces = new Set<string>();
  KEY_LIKE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KEY_LIKE.exec(src)) !== null) {
    // Back up one character: a match consumes the delimiter of the NEXT
    // literal in `"a.b" + "c.d"`, which would skip every other key.
    KEY_LIKE.lastIndex -= 1;
    if (known(m[1]!)) namespaces.add(m[1]!);
  }
  const deps: string[] = [];
  IMPORT.lastIndex = 0;
  while ((m = IMPORT.exec(src)) !== null) {
    const r = resolveImport(m[1]!, file);
    if (r) deps.push(r);
  }
  const out = { namespaces, deps, interpolated: T_INTERPOLATED.test(src) };
  scanned.set(file, out);
  return out;
}

function closure(entries: string[]): { namespaces: Set<string>; files: Set<string>; interpolated: string[] } {
  const files = new Set<string>();
  const namespaces = new Set<string>();
  const interpolated: string[] = [];
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    const s = scan(f);
    for (const n of s.namespaces) namespaces.add(n);
    if (s.interpolated) interpolated.push(relative(ROOT, f));
    stack.push(...s.deps);
  }
  return { namespaces, files, interpolated };
}

/* ── the three surfaces ────────────────────────────────────────────────── */

const ROUTE_FILE = /^(page|layout|template|error|global-error|loading|not-found|default)\.tsx$/;
/** Route handlers and server actions render no UI and never see the provider;
 *  they translate with the full server-side dictionary. Anchored to the two
 *  top-level directories on purpose — a future app/admin/actions/page.tsx is a
 *  screen, not a server-action folder, and must not be skipped. */
const NOT_A_ROUTE = new Set(["app/api", "app/actions"]);

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (!NOT_A_ROUTE.has(relative(ROOT, p))) routeFiles(p, out);
    } else if (ROUTE_FILE.test(entry)) out.push(p);
  }
  return out;
}

const dict = JSON.parse(readFileSync(join(ROOT, "lib/i18n/dictionaries/pl.json"), "utf8")) as Record<string, unknown>;
function known(n: string) { return Object.hasOwn(dict, n); }
const bytes = (names: Iterable<string>) =>
  [...names].reduce((s, n) => s + JSON.stringify(dict[n]).length, 0);
/** What the browser actually pulls down. Measured, not assumed: this
 *  dictionary compresses about 2.9x, not the "roughly a fifth" that gets
 *  quoted for prose. Reporting the decoded figure as "transfer" overstates
 *  the saving by three times. */
const wire = (names: Iterable<string>) =>
  gzipSync(Buffer.from(JSON.stringify(Object.fromEntries([...names].map((n) => [n, dict[n]]))), "utf8"), { level: 9 }).length;

const all = routeFiles(join(ROOT, "app"));
const isAdmin = (f: string) => relative(ROOT, f).startsWith("app/admin");
const isApp = (f: string) => relative(ROOT, f).startsWith("app/(app)");

/** The root layout wraps everything, so its own namespaces belong to the root
 *  scope no matter which surface is rendering. */
const rootEntries = all.filter((f) => !isAdmin(f) && !isApp(f));
const appEntries = all.filter(isApp);
const adminEntries = all.filter(isAdmin);

const rootClosure = closure(rootEntries);
const appClosure = closure([...appEntries, join(ROOT, "app/layout.tsx")]);
const adminClosure = closure([...adminEntries, join(ROOT, "app/layout.tsx")]);

const needRoot = [...rootClosure.namespaces].sort();
const needApp = [...appClosure.namespaces].filter((n) => !needRoot.includes(n)).sort();
const needAdmin = [...adminClosure.namespaces].filter((n) => !needRoot.includes(n)).sort();

/* ── report, then enforce ──────────────────────────────────────────────── */

const total = bytes(Object.keys(dict));
console.log("MEASURED DICTIONARY PAYLOAD (pl). Three different numbers, kept apart");
console.log("on purpose: WIRE is what is transferred, DECODED is what the browser");
console.log("holds and what React must parse. Neither is the other.\n");
console.log(`  ${"".padEnd(34)} ${"decoded".padStart(8)} ${"gzip".padStart(7)}   share`);
const row = (label: string, names: string[]) =>
  console.log(`  ${label.padEnd(34)} ${String(bytes(names)).padStart(8)} ${String(wire(names)).padStart(7)}` +
    `   ${((100 * bytes(names)) / total).toFixed(0).padStart(3)}%  (${String(names.length).padStart(2)} namespaces)`);
row("whole dictionary (before)", Object.keys(dict));
row("public pages carry", needRoot);
row("+ signed-in app adds", needApp);
row("+ /admin adds", needAdmin);
row("app surface total", [...needRoot, ...needApp]);
row("admin surface total", [...needRoot, ...needAdmin]);

console.log("\nA. THE SCANNER READS THE FILE THE WAY JAVASCRIPT DOES");
/** Fixtures, because everything below depends on this one function and a
 *  tokenizer that quietly ate code would make every check a lie. */
const FIXTURES: Array<[string, string, string]> = [
  ["a line comment is not code", `// see "nav.home"\nconst a = "cms.x";`, "cms"],
  ["a block comment is not code", `/* t("admin.y") */ const a = "cms.x";`, "cms"],
  ["a comment marker inside a string is not a comment", `const u = "https://x"; const a = "cms.x";`, "cms"],
  ["a template hole does not end the file", "const a = `tpl.${x}`; const b = \"cms.x\";", "tpl,cms"],
  ["a nested template is tracked", "const a = `${cond ? `nav.a` : \"cms.b\"}`;", "nav,cms"],
  ["adjacent literals are both seen", `const a = "nav.a" + "cms.b";`, "nav,cms"],
];
for (const [label, src, expected] of FIXTURES) {
  const found: string[] = [];
  const clean = stripComments(src);
  KEY_LIKE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KEY_LIKE.exec(clean)) !== null) { KEY_LIKE.lastIndex -= 1; if (known(m[1]!)) found.push(m[1]!); }
  check(label, found.join(",") === expected, `expected ${expected}, found ${found.join(",") || "nothing"}`);
}

console.log("\nB. THE COMMITTED MANIFEST IS WHAT THE CODE NEEDS");

if (WRITE) {
  writeFileSync(join(ROOT, "lib/i18n/scopes.ts"), render(needRoot, needApp, needAdmin));
  console.log("  (rewrote lib/i18n/scopes.ts — re-run without --write to verify)");
}

// The EXPORTED value, not the file's text. A manifest that reads correctly but
// exports `{ root, app: root, admin }` would pass any regex over the source
// while the app surface silently lost 40 namespaces.
const exported = {
  root: [...COMMITTED.root] as string[],
  app: [...COMMITTED.app] as string[],
  admin: [...COMMITTED.admin] as string[],
};
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const diff = (want: string[], got: string[]) => {
  const missing = want.filter((n) => !got.includes(n));
  const extra = got.filter((n) => !want.includes(n));
  return [missing.length ? `MISSING (these render as humanised English): ${missing.join(", ")}` : "",
    extra.length ? `unused: ${extra.join(", ")}` : ""]
    .filter(Boolean).join("  |  ") || "order differs";
};

check("root scope matches the public surface", same(needRoot, exported.root), diff(needRoot, exported.root));
check("app scope matches the signed-in surface", same(needApp, exported.app), diff(needApp, exported.app));
check("admin scope matches the admin surface", same(needAdmin, exported.admin), diff(needAdmin, exported.admin));

const coverage = (surface: string, need: string[], scope: string[]) => {
  const uncovered = need.filter((n) => !exported.root.includes(n) && !scope.includes(n));
  check(`every namespace the ${surface} renders reaches it`, uncovered.length === 0, uncovered.join(", "));
};
coverage("public surface", [...rootClosure.namespaces], []);
coverage("signed-in app", [...appClosure.namespaces], exported.app);
coverage("/admin", [...adminClosure.namespaces], exported.admin);

console.log("\nC. NOTHING IS SENT TWICE, AND NOTHING NAMED IS IMAGINARY");
const dup = [...exported.app, ...exported.admin].filter((n) => exported.root.includes(n));
check("no namespace is serialised by two scopes", dup.length === 0, dup.join(", "));
const ghosts = [...exported.root, ...exported.app, ...exported.admin].filter((n) => !known(n));
check("every namespace in the manifest exists in the dictionary", ghosts.length === 0, ghosts.join(", "));

console.log("\nD. EACH LAYOUT ASKS FOR ITS OWN SCOPE AND WRAPS ITS OWN SUBTREE");
/** None of this is type-checked: swapping two scope names, or deleting a
 *  wrapper, compiles cleanly and silently drops a surface to the root scope. */
const WIRING: Array<[string, string, string]> = [
  ["app/layout.tsx", "root", "I18nProvider"],
  ["app/(app)/layout.tsx", "app", "I18nScope"],
  ["app/admin/layout.tsx", "admin", "I18nScope"],
];
for (const [file, scope, component] of WIRING) {
  let src = "";
  try { src = readFileSync(join(ROOT, file), "utf8"); } catch { /* reported */ }
  check(`${file} requests the "${scope}" scope`,
    new RegExp(`getScopedDictionary\\(\\s*["']${scope}["']`).test(src),
    "the scope name is a plain string — nothing else would catch a swap");
  check(`${file} wraps its subtree in <${component}>`,
    new RegExp(`<${component}[\\s>]`).test(src) && new RegExp(`</${component}>`).test(src),
    "without the wrapper this surface silently falls back to the root scope");
}

console.log("\nE. EVERY KEY'S NAMESPACE IS STILL VISIBLE TO THIS ANALYSIS");
const interpolated = [...new Set([...rootClosure.interpolated, ...appClosure.interpolated, ...adminClosure.interpolated])].sort();
const unexpected = interpolated.filter((f) => !INTERPOLATED_ALLOWED.has(f));
check("no new file builds a key from a namespace held in a variable",
  unexpected.length === 0,
  `${unexpected.join(", ")}\n      A key like t(\`\${prefix}.x\`) cannot be traced. Either make the\n      namespace literal, or add the file to INTERPOLATED_ALLOWED with the\n      reason its namespace is covered anyway.`);

console.log("\nF. THE KEYS THAT ARE PASSED AROUND AS VALUES STILL RESOLVE");
/** Every one of these reached its component as a variable, so the first
 *  version of this script could not see any of them and shipped a manifest
 *  that rendered them as English. They are pinned here by hand, against the
 *  dictionary each surface actually receives, so the claim is about the
 *  product and not about the analysis that produced the manifest. */
const VALUE_KEYS: Array<[string, "root" | "app" | "admin", string, string]> = [
  ["toolsearch.image_moda.desc", "app", "lib/tool-search.ts -> command-palette", "the search modal's subtitles"],
  ["toolsearch.image_moda.words", "app", "lib/tool-search.ts -> command-palette", "what the search matches Polish queries against"],
  ["models.badge.recommended", "app", "lib/model-badge.ts -> model-select", "the badge on an AI model chip"],
  ["cats.moda", "app", "lib/features.ts -> feature gates", "category names"],
  ["topnav.home", "admin", "lib/features.ts -> feature-availability-panel", "tile names in Ustawienia → Funkcje"],
  ["mega.engine", "admin", "lib/features.ts -> tool-registry", "tool names in Admin → AI"],
  ["video.title", "admin", "lib/features.ts -> tool-registry", "the Wideo row"],
  ["time.minutes", "admin", "lib/relative-time.ts -> RelativeTime", "every relative timestamp in /admin"],
  ["roles.admin", "admin", "lib/roles.ts -> admin-sidebar", "the role badge"],
  ["tpl.credits", "admin", "lib/server/message-templates.ts", "message template labels"],
];
/** The same walk lib/i18n/t.ts does, over the same merged dictionary the
 *  surface's providers produce. */
const lookup = (d: Record<string, unknown>, key: string): string | undefined => {
  const parts = key.split(".");
  let node: unknown = d;
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== "object") return undefined;
    const obj = node as Record<string, unknown>;
    const rest = parts.slice(i).join(".");
    if (typeof obj[rest] === "string") return obj[rest] as string;
    node = obj[parts[i]!];
  }
  return typeof node === "string" ? node : undefined;
};
const scopedDict = (scope: "root" | "app" | "admin") => {
  const names = scope === "root" ? exported.root : [...exported.root, ...exported[scope]];
  return Object.fromEntries(names.map((n) => [n, dict[n]]));
};
for (const [key, scope, where, what] of VALUE_KEYS) {
  const full = lookup(dict as Record<string, unknown>, key);
  const scoped = lookup(scopedDict(scope), key);
  check(`${key} resolves on the ${scope} surface — ${what}`,
    scoped !== undefined && scoped === full,
    `${where}: the full dictionary says ${JSON.stringify(full)}, this surface gets ` +
    `${scoped === undefined ? "nothing (t() would humanise the key)" : JSON.stringify(scoped)}`);
}

function render(rootNs: string[], appNs: string[], adminNs: string[]): string {
  const list = (ns: string[]) => ns.map((n) => `  "${n}",`).join("\n");
  return `// GENERATED — npm run test:i18n:scopes -- --write
//
// WHICH TRANSLATIONS EACH SURFACE SERIALISES INTO ITS HTML.
//
// The root layout used to hand every client page the whole dictionary: 87
// namespaces, inline, on every document including the landing page. These three
// lists are the same dictionary split by who actually renders it, derived from
// the import graph rather than by hand — scripts/i18n-scope-tests.ts re-derives
// them on every run and fails if this file has drifted from the code.
//
// DO NOT EDIT BY HAND, and in particular do not trim a namespace that looks
// unused. The lists are deliberately a superset: this codebase passes
// translation keys around as values (lib/features.ts, lib/tool-search.ts,
// lib/relative-time.ts, lib/roles.ts), so "no t(\\"ns.\\" in this file" means
// nothing. A namespace removed here does not raise — it renders an English
// word where Polish should be.
//
// Server components are unaffected: getDictionary() still returns everything,
// because a server render never ships the dictionary anywhere.
//
// \`app\` and \`admin\` are DELTAS on top of \`root\`. The root layout wraps both
// surfaces, so anything listed there is already on the page; repeating it would
// serialise it twice.

/** Public pages — landing, legal, CMS pages, unsubscribe, the auth dialog. */
const root = [
${list(rootNs)}
] as const;

/** Added by app/(app)/layout.tsx for a signed-in customer. */
const app = [
${list(appNs)}
] as const;

/** Added by app/admin/layout.tsx. */
const admin = [
${list(adminNs)}
] as const;

export const SCOPES = { root, app, admin };
export type Scope = keyof typeof SCOPES;
`;
}

console.log(failures === 0 ? "\nAll i18n scope tests passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
