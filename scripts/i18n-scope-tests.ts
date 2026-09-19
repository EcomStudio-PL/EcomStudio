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
 * fails if the committed manifest is not EXACTLY what the code needs. Add a
 * `t("newsletter.x")` to a customer page and this goes red with the fix in the
 * message, instead of shipping a broken label.
 *
 *   npm run test:i18n:scopes           check
 *   npm run test:i18n:scopes -- --write regenerate lib/i18n/scopes.ts
 *
 * Server components are NOT the risk here — they render with the full
 * dictionary and never serialise it — so the analysis is deliberately a
 * superset of what the client strictly needs. Over-including costs bytes;
 * under-including costs correctness.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { gzipSync } from "zlib";
import { join, dirname, resolve, relative } from "path";

const ROOT = process.cwd();
const WRITE = process.argv.includes("--write");

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); }
}

/* ── the import graph ──────────────────────────────────────────────────── */

const IMPORT = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
/** `t("ns.key")`, in any quote style. The namespace is the first segment. */
const T_CALL = /\bt\(\s*["'`]([A-Za-z0-9_]+)\./g;
/** The server-side pair that reads the same dictionary shape. */
const T_DIRECT = /\b(?:resolveKey|lookup)\(\s*\w+\s*,\s*["'`]([A-Za-z0-9_]+)\./g;
/** `t(`${prefix}.${o}`)` — a key whose NAMESPACE is not visible to this scan. */
const T_INTERPOLATED = /\bt\(\s*`\$\{/;

/** Files whose namespace cannot be read statically, and why that is safe.
 *  A new entry here is a decision, not a formality: it means this script can no
 *  longer see what that file needs. */
const INTERPOLATED_ALLOWED = new Map([
  // Every `prefix` passed to its <Choice> is a literal "cms.*" (lines 37-138),
  // and `cms` is in the root scope because the public page renderer needs it,
  // so the admin surface has it whatever this script can see.
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
  const src = readFileSync(file, "utf8");
  const namespaces = new Set<string>();
  for (const re of [T_CALL, T_DIRECT]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) namespaces.add(m[1]!);
  }
  const deps: string[] = [];
  IMPORT.lastIndex = 0;
  let m: RegExpExecArray | null;
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

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      // API handlers and server actions render no UI and never see the
      // provider; they translate with the full server-side dictionary.
      if (entry !== "api" && entry !== "actions") routeFiles(p, out);
    } else if (ROUTE_FILE.test(entry)) out.push(p);
  }
  return out;
}

const all = routeFiles(join(ROOT, "app"));
const isAdmin = (f: string) => relative(ROOT, f).startsWith("app/admin");
const isApp = (f: string) => relative(ROOT, f).startsWith("app/(app)");

/** The root layout wraps everything, so its own namespaces belong to the root
 *  scope no matter which surface is rendering. */
const rootEntries = all.filter((f) => !isAdmin(f) && !isApp(f));
const appEntries = all.filter(isApp);
const adminEntries = all.filter(isAdmin);

const dict = JSON.parse(readFileSync(join(ROOT, "lib/i18n/dictionaries/pl.json"), "utf8")) as Record<string, unknown>;
const known = (n: string) => Object.hasOwn(dict, n);
const bytes = (names: Iterable<string>) =>
  [...names].reduce((s, n) => s + JSON.stringify(dict[n]).length, 0);
/** What the browser actually pulls down. Measured, not assumed: this
 *  dictionary compresses about 2.9x, not the "roughly a fifth" that gets
 *  quoted for prose. Reporting the decoded figure as "transfer" overstates
 *  the saving by three times. */
const wire = (names: Iterable<string>) =>
  gzipSync(Buffer.from(JSON.stringify(Object.fromEntries([...names].map((n) => [n, dict[n]]))), "utf8"), { level: 9 }).length;

const rootClosure = closure(rootEntries);
const appClosure = closure([...appEntries, join(ROOT, "app/layout.tsx")]);
const adminClosure = closure([...adminEntries, join(ROOT, "app/layout.tsx")]);

const needRoot = [...rootClosure.namespaces].filter(known).sort();
const needApp = [...appClosure.namespaces].filter((n) => known(n) && !needRoot.includes(n)).sort();
const needAdmin = [...adminClosure.namespaces].filter((n) => known(n) && !needRoot.includes(n)).sort();

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

console.log("\nA. THE COMMITTED MANIFEST IS WHAT THE CODE NEEDS");

let SCOPES: { root: string[]; app: string[]; admin: string[] } | null = null;
try {
  const src = readFileSync(join(ROOT, "lib/i18n/scopes.ts"), "utf8");
  const grab = (key: string) => {
    const m = new RegExp(`const ${key} = \\[([^\\]]*)\\]`).exec(src);
    return m ? [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!) : [];
  };
  SCOPES = { root: grab("root"), app: grab("app"), admin: grab("admin") };
} catch { /* reported below */ }

if (WRITE) {
  writeFileSync(join(ROOT, "lib/i18n/scopes.ts"), render(needRoot, needApp, needAdmin));
  console.log("  (rewrote lib/i18n/scopes.ts)");
  SCOPES = { root: needRoot, app: needApp, admin: needAdmin };
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const diff = (want: string[], got: string[]) => {
  const missing = want.filter((n) => !got.includes(n));
  const extra = got.filter((n) => !want.includes(n));
  return [missing.length ? `missing: ${missing.join(", ")}` : "", extra.length ? `unused: ${extra.join(", ")}` : ""]
    .filter(Boolean).join("  |  ") || "order differs";
};

check("lib/i18n/scopes.ts exists", SCOPES !== null, "run: npm run test:i18n:scopes -- --write");
if (SCOPES) {
  check("root scope matches the public surface", same(needRoot, SCOPES.root), diff(needRoot, SCOPES.root));
  check("app scope matches the signed-in surface", same(needApp, SCOPES.app), diff(needApp, SCOPES.app));
  check("admin scope matches the admin surface", same(needAdmin, SCOPES.admin), diff(needAdmin, SCOPES.admin));

  console.log("\nB. NOTHING IS SENT TWICE, AND NOTHING NAMED IS IMAGINARY");
  const dup = [...SCOPES.app, ...SCOPES.admin].filter((n) => SCOPES!.root.includes(n));
  check("no namespace is serialised by two scopes", dup.length === 0, dup.join(", "));
  const ghosts = [...SCOPES.root, ...SCOPES.app, ...SCOPES.admin].filter((n) => !known(n));
  check("every namespace in the manifest exists in the dictionary", ghosts.length === 0, ghosts.join(", "));
}

console.log("\nC. EVERY KEY'S NAMESPACE IS STILL VISIBLE TO THIS ANALYSIS");
const interpolated = [...new Set([...rootClosure.interpolated, ...appClosure.interpolated, ...adminClosure.interpolated])].sort();
const unexpected = interpolated.filter((f) => !INTERPOLATED_ALLOWED.has(f));
check("no new file builds a translation key from an unknown namespace",
  unexpected.length === 0,
  `${unexpected.join(", ")}\n      A key like t(\`\${prefix}.x\`) cannot be traced. Either make the\n      namespace literal, or add the file to INTERPOLATED_ALLOWED with the\n      reason its namespace is covered anyway.`);

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
