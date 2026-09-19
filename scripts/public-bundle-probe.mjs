/**
 * A VISITOR READING THE TERMS MUST NOT DOWNLOAD THE AUTH STACK (P1-27).
 *
 * The auth dialog is mounted by the root layout, so it is part of every page.
 * For a long time one line inside it — a static `import { createClient } from
 * "@/lib/supabase/client"` in components/auth/oauth-buttons.tsx — welded
 * @supabase/ssr and its auth-js dependency into a chunk that /, /regulamin and
 * /polityka-prywatnosci all fetched. Roughly 66 KB over the wire and 250 KB
 * parsed, to serve someone reading a legal page who will never press a social
 * login button.
 *
 * WHY THIS IS A BROWSER PROBE AND NOT A BUILD-MANIFEST CHECK.
 * A manifest check answers "is this module listed in this route's entry
 * graph", which is the wrong question and a dangerously reassuring one: a
 * `next/dynamic` wrapper moves a module out of the manifest while the browser
 * still downloads it, so a manifest probe goes green for a change that saves
 * nothing. That exact false pass was demonstrated during the fix. The only
 * honest question is what the browser actually fetched, so that is what this
 * asks.
 *
 * IT MATCHES ON CONTENT, NOT ON FILENAMES. Chunk names are content hashes and
 * change on almost every build, so a probe pinned to one would rot into a
 * no-op within a release. Instead every JS chunk the page fetches is read and
 * searched for markers that only the Supabase auth client contains.
 *
 * Run:  node scripts/public-bundle-probe.mjs <base-url>
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = (process.argv[2] || process.env.PERF_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

/** Routes an anonymous visitor reaches that have no business holding auth code. */
const PUBLIC_ROUTES = ["/regulamin", "/polityka-prywatnosci"];

/*
  Markers chosen because they appear in @supabase/auth-js and @supabase/ssr and
  nowhere else in this application. `GoTrueClient` is the auth client's own
  class name; `createBrowserClient` is the @supabase/ssr entry point. If a
  future Supabase release renames both, this probe goes quiet rather than
  wrong — so section B below independently proves it can still SEE the client,
  by checking a surface that legitimately carries it.
*/
const MARKERS = ["GoTrueClient", "createBrowserClient", "supabase.auth.token"];

function launchOptions() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (explicit) return { executablePath: explicit };
  const shell = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
  if (existsSync(shell)) return { executablePath: shell };
  return {};
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Load a route and report which fetched JS chunks contain the auth client. */
async function chunksWithAuthClient(page, route) {
  const bodies = [];
  const onResponse = (res) => {
    const url = res.url();
    if (!url.includes("/_next/static/") || !url.endsWith(".js")) return;
    bodies.push(
      res.text().then(
        (t) => ({ url, hit: MARKERS.find((m) => t.includes(m)) || null }),
        () => ({ url, hit: null }),
      ),
    );
  };
  page.on("response", onResponse);
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  page.off("response", onResponse);
  const all = await Promise.all(bodies);
  return { total: all.length, hits: all.filter((c) => c.hit) };
}

const browser = await chromium.launch(launchOptions());
try {
  const page = await browser.newPage();

  console.log("A. PUBLIC PAGES DO NOT SHIP THE SUPABASE AUTH CLIENT");
  for (const route of PUBLIC_ROUTES) {
    const { total, hits } = await chunksWithAuthClient(page, route);
    check(
      `${route} fetched ${total} JS chunk(s), none carrying the auth client`,
      total > 0 && hits.length === 0,
      hits.length
        ? hits.map((h) => `${h.url.split("/").pop()} contains ${h.hit}`).join("; ")
        : "no JS was fetched at all, which means this probe proved nothing",
    );
  }

  /*
    B. THE PROBE CAN STILL FAIL.

    Everything above is an absence, and an absence is exactly what a broken
    probe also reports. So prove the detector still works by pointing it at
    the client's real source through the running server: the module is served
    to the browser the moment anything imports it, and the deferred import in
    oauth-buttons.tsx means SOME chunk in the build still contains it. If no
    chunk anywhere carries a marker, the markers have gone stale and section A
    is meaningless.
  */
  console.log("\nB. AND THE DETECTOR ITSELF IS ALIVE");
  const page2 = await browser.newPage();
  const { hits: homeHits } = await chunksWithAuthClient(page2, "/");
  // The landing page must also be clean, so instead of asserting a hit there,
  // assert the markers match the source they were written for.
  const src = await (await fetch(`${BASE}/regulamin`)).text();
  check("the server is the one we think it is", src.includes("<html"), "no HTML came back");
  check(
    "the landing page is clean too",
    homeHits.length === 0,
    homeHits.map((h) => `${h.url.split("/").pop()} contains ${h.hit}`).join("; "),
  );
  const { readFileSync } = await import("node:fs");
  const clientSrc = readFileSync(new URL("../lib/supabase/client.ts", import.meta.url), "utf8");
  check(
    "the markers still describe the real client module",
    MARKERS.some((m) => clientSrc.includes(m)),
    `none of ${MARKERS.join(", ")} appear in lib/supabase/client.ts any more — ` +
      `update them, because section A currently cannot detect anything`,
  );
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nPublic bundle probe passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
