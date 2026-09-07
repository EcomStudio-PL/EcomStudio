/**
 * ADMIN INFORMATION ARCHITECTURE — the invariants the Stage 3 rebuild bought.
 *
 * These are cheap, static assertions against the repository itself: the menu
 * config, the route tree and the stylesheet. They exist because every one of
 * them is a bug that has actually happened here — a menu entry pointing at a
 * route that redirects to itself, a "green" badge rendering magenta, an amber
 * that survived a rebrand in one forgotten file, a revalidatePath naming a
 * route that never existed.
 */
import { readFileSync, existsSync } from "node:fs";
import { ADMIN_NAV, ADMIN_BOTTOM } from "@/lib/navigation";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { console.log(`  ok   ${name}`); return; }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

const read = (path: string) => readFileSync(path, "utf8");
const routeFile = (href: string) => {
  const clean = href.split("?")[0];
  return `app${clean}/page.tsx`;
};

console.log("A. every menu entry resolves to a real page");
const allItems = [...ADMIN_NAV.flatMap((g) => g.items), ...ADMIN_BOTTOM];
for (const item of allItems) {
  const file = routeFile(item.href);
  check(`${item.href} exists`, existsSync(file), file);
}

console.log("B. no menu entry points at a redirect stub");
for (const item of allItems) {
  const file = routeFile(item.href);
  if (!existsSync(file)) continue;
  const src = read(file);
  const isStub = /^import \{ redirect \} from "next\/navigation";/m.test(src)
    && /redirect\("/.test(src);
  check(`${item.href} is a real screen`, !isStub, "menu points at a redirect");
}

console.log("C. retired routes still resolve (no admin 404)");
const RETIRED: Record<string, string> = {
  "app/admin/mail/page.tsx": "/admin/communication",
  "app/admin/notifications/page.tsx": "/admin/communication/powiadomienia",
  "app/admin/email/page.tsx": "/admin/communication/kanaly",
  "app/admin/email/templates/page.tsx": "/admin/communication/szablony",
  "app/admin/settings/integrations/page.tsx": "/admin/communication/kanaly",
  "app/admin/workspaces/page.tsx": "/admin/users",
  "app/admin/products/page.tsx": "/admin/generations",
  "app/admin/homepage/page.tsx": "/admin/www",
};
for (const [file, dest] of Object.entries(RETIRED)) {
  check(`${file} redirects`, existsSync(file) && read(file).includes(`redirect("${dest}")`), dest);
}

console.log("D. the six groups, in order");
const GROUPS = ["overview", "clients", "finance", "ai", "marketing", "system"];
check("group keys", JSON.stringify(ADMIN_NAV.map((g) => g.key)) === JSON.stringify(GROUPS),
  ADMIN_NAV.map((g) => g.key).join(","));
check("Workspaces is not in the menu", !allItems.some((i) => i.href === "/admin/workspaces"));
check("Produkty is not in the menu", !allItems.some((i) => i.href === "/admin/products"));
check("Wsparcie sits with the clients", ADMIN_NAV.find((g) => g.key === "clients")!
  .items.some((i) => i.href === "/admin/support"));
check("one communication entry, not five",
  allItems.filter((i) => i.href.startsWith("/admin/communication")).length === 1);
check("Zaawansowane is last under SYSTEM",
  ADMIN_NAV.find((g) => g.key === "system")!.items.at(-1)!.href === "/admin/system");

console.log("E. every menu label is translated in all three languages");
for (const dict of [{ n: "pl", d: pl }, { n: "en", d: en }, { n: "de", d: de }]) {
  const nav = (dict.d as { admin: { nav: Record<string, string>; navGroups: Record<string, string> } }).admin;
  for (const group of ADMIN_NAV) {
    check(`${dict.n}: group ${group.key}`, typeof nav.navGroups[group.key] === "string");
    for (const item of group.items) {
      check(`${dict.n}: item ${item.key}`, typeof nav.nav[item.key] === "string");
    }
  }
}

console.log("F. the design system carries no amber");
const css = read("app/globals.css");
// The two brand values the rebrand specified, light and dark.
check("--accent2 light is #D628CF", /--accent2: 214 40 207;/.test(css));
check("--accent2 dark is #F950E1", /--accent2: 249 80 225;/.test(css));
check("--warning is not yellow", !/--warning: (176 82 8|251 191 36);/.test(css));
const badge = read("components/ui/badge.tsx");
check("badge has no amber tone", !/\bamber:/.test(badge));
check("badge has no colour-named green", !/\bgreen:/.test(badge));
check("badge tones are semantic",
  ["neutral", "success", "accent", "danger", "info"].every((k) => badge.includes(`  ${k}:`)));

console.log("G. no raw amber/yellow class survives anywhere");
const SOURCES = [
  "app/admin", "components/admin", "components/ui", "components/cms",
  "components/layout", "components/tools", "components/editor", "lib",
];
import { readdirSync, statSync } from "node:fs";
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}
const offenders: string[] = [];
for (const dir of SOURCES) {
  for (const file of walk(dir)) {
    for (const [i, line] of read(file).split("\n").entries()) {
      // Prose in a comment explaining why the amber is gone is not an amber.
      const code = line.replace(/^\s*(\*|\/\/|\/\*).*$/, "");
      if (/\b(bg|text|border|ring|from|to|via)-(amber|yellow)-\d/.test(code)) {
        offenders.push(`${file}:${i + 1}`);
      }
    }
  }
}
check("no tailwind amber/yellow utilities", offenders.length === 0, offenders.join(", "));

console.log("H. revalidatePath names routes that exist");
const badPaths: string[] = [];
for (const file of walk("app/actions")) {
  for (const m of read(file).matchAll(/revalidatePath\("(\/admin[^"]*)"\)/g)) {
    const target = m[1].split("?")[0];
    if (!existsSync(`app${target}/page.tsx`)) badPaths.push(`${file}: ${target}`);
  }
  for (const m of read(file).matchAll(/= "(\/admin\/[a-z/-]+)";/g)) {
    if (!existsSync(`app${m[1]}/page.tsx`)) badPaths.push(`${file}: ${m[1]}`);
  }
}
check("no revalidate target is a phantom route", badPaths.length === 0, badPaths.join(", "));

console.log("I. system health refuses to invent a green");
const health = read("lib/services/admin-health.ts");
check("three states, not two", /"ok" \| "fail" \| "unknown"/.test(health));
check("unknown when never tested", /return "unknown"/.test(health));
const systemPage = read("app/admin/system/page.tsx");
check("no hardcoded Vercel green", !/Vercel<\/span>\s*\n?\s*<Badge tone="success"/.test(systemPage));
// The health grid used to sit on the dashboard. It now lives on the System
// screen — moved, not deleted: the diagnostics are still one click away, and
// the dashboard is free to be about the business.
check("system screen shows verified health", systemPage.includes("HealthGrid"));
check("dashboard no longer carries the integration grid",
  !read("app/admin/page.tsx").includes("readSystemHealth"));

console.log("J. analytics asks four questions over one range");
const analytics = read("app/admin/analytics/page.tsx");
check("four tabs", /const TABS = \["business", "usage", "clients", "providers"\]/.test(analytics));
check("six ranges incl. custom", /"24h": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365/.test(analytics)
  && analytics.includes("resolveWindow"));
check("ledger reads are range-scoped", /\.gte\("created_at", w\.from\)/.test(analytics));
check("a truncated window says so", analytics.includes("analytics.capped"));

console.log(failures === 0 ? "\nAll admin IA tests passed." : `\n${failures} admin IA test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
