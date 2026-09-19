/**
 * THE BEFORE-PICTURE.
 *
 * Purely diagnostic: it measures and prints, and changes nothing. Its job is
 * to give the remediation work (Prompt #2) a number to beat, so that "this is
 * faster now" is a measurement rather than an impression.
 *
 * WHAT IT RECORDS, PER ROUTE AND PER VIEWPORT
 *   - TTFB, DOMContentLoaded, load
 *   - LCP (PerformanceObserver, largest-contentful-paint)
 *   - CLS (layout-shift entries, excluding user-initiated ones)
 *   - HTML document bytes
 *   - every request, grouped by type, with transfer sizes
 *   - the JS chunks, largest first
 *   - DUPLICATE requests — the same URL fetched more than once in one load
 *
 * WHY DUPLICATES GET THEIR OWN SECTION
 * A duplicate request is the cheapest real finding a trace produces: it is
 * unambiguous, it has no upside, and fixing one never changes what the user
 * sees. The audit already flagged two shapes of it server-side (P1-34, and the
 * double getUser() in P1-28); this catches the browser-side equivalent.
 *
 * NOT A GATE. Nothing here asserts or exits non-zero on a slow number. Turning
 * these into thresholds is Lighthouse CI's job, and doing it in two places
 * means two places to argue with.
 *
 * Run:  npm run perf:baseline -- <base-url>
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = (process.argv[2] || process.env.PERF_BASE_URL || "").replace(/\/$/, "");
if (!BASE) {
  console.error("usage: npm run perf:baseline -- <base-url>");
  process.exit(2);
}

function launchOptions() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (explicit) return { executablePath: explicit };
  const containerShell = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
  if (existsSync(containerShell)) return { executablePath: containerShell };
  return {};
}

/*
  THE ROUTES STAGE 3 IS MEASURED ON.

  Every one of these is reachable by an ANONYMOUS visitor, which is what makes
  the numbers reproducible and safe to record. `/home` is in the list on
  purpose even though an anonymous request is redirected away from it: what is
  being measured there is the cost of the redirect itself, and it is labelled
  as such rather than passed off as the dashboard.

  THE AUTHENTICATED SURFACE IS DELIBERATELY NOT BROWSED HERE. It needs a real
  session, this project has no test account (docs/tooling/playwright.md), and
  pointing a browser at a real one would put a customer's data into an
  artifact. Its payload is measured instead from the build's own First Load JS
  per route, which is a real number, needs no session, and is comparable
  before and after. Reported separately, and the limit is stated rather than
  papered over.
*/
const ROUTES = (process.env.PERF_ROUTES || "/,/regulamin,/polityka-prywatnosci,/login,/home")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
];

/** Machine-readable output, so BEFORE vs AFTER is a computed delta rather
 *  than two walls of text someone compares by eye. */
const JSON_OUT = process.env.PERF_JSON || "";
const collected = [];

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const browser = await chromium.launch(launchOptions());

try {
  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();

      /**
       * url -> { count, type, wire, decoded }
       *
       * TWO DIFFERENT NUMBERS, AND THE DIFFERENCE IS ~3x.
       *   wire    = bytes actually sent, AFTER gzip/brotli (request.sizes()
       *             responseBodySize + responseHeadersSize). This is what the
       *             user's connection pays for.
       *   decoded = bytes after decompression. This is what the parser and
       *             memory pay for.
       * An earlier version of this script read `res.body().length` — which is
       * DECODED — and printed it under the heading "Transfer". That overstated
       * the wire cost of this app by roughly 3.3x. Both are reported now, and
       * each is labelled for what it is.
       */
      const requests = new Map();
      /** Total request COUNT including repeats, as opposed to unique URLs. */
      let requestCount = 0;

      page.on("response", async (res) => {
        const url = res.url();
        const type = res.request().resourceType();
        requestCount += 1;

        let wire = 0;
        let decoded = 0;
        try {
          const sizes = await res.request().sizes();
          wire = (sizes.responseBodySize || 0) + (sizes.responseHeadersSize || 0);
        } catch {
          wire = 0;
        }
        try {
          decoded = (await res.body().catch(() => Buffer.alloc(0))).length;
        } catch {
          decoded = 0;
        }

        const prev = requests.get(url);
        if (prev) {
          // A repeat costs real bytes again — count them, or a newly
          // introduced duplicate fetch would add 0 KB to the totals and the
          // script would miss exactly the regression it exists to catch.
          prev.count += 1;
          prev.wire += wire;
          prev.decoded += decoded;
        } else {
          requests.set(url, { count: 1, type, wire, decoded });
        }
      });

      // Install the observers BEFORE navigation, or the entries that matter
      // (LCP fires early) are already gone by the time we look.
      await page.addInitScript(() => {
        window.__lcp = 0;
        window.__cls = 0;
        // TBT PROXY. Real INP needs interaction and real TBT needs a
        // Lighthouse trace; the total time spent in long tasks past the 50 ms
        // each one is allowed is the closest honest stand-in a plain page load
        // can give, and it moves for the same reasons TBT does.
        window.__blocking = 0;
        window.__longtasks = 0;
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              window.__longtasks += 1;
              window.__blocking += Math.max(0, e.duration - 50);
            }
          }).observe({ type: "longtask", buffered: true });
        } catch {
          /* longtask unsupported in this browser build */
        }
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) window.__lcp = Math.max(window.__lcp, e.startTime);
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              // hadRecentInput === true means the user caused it; not a defect.
              if (!e.hadRecentInput) window.__cls += e.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch {
          /* observer unsupported — the numbers below will read 0 */
        }
      });

      await page.goto(`${BASE}${route}`, { waitUntil: "load", timeout: 60_000 });
      // Give late-arriving LCP candidates and shifts a moment to land.
      await page.waitForTimeout(2500);

      const metrics = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] || {};
        return {
          ttfb: Math.round(nav.responseStart || 0),
          dcl: Math.round(nav.domContentLoadedEventEnd || 0),
          load: Math.round(nav.loadEventEnd || 0),
          lcp: Math.round(window.__lcp || 0),
          cls: Number((window.__cls || 0).toFixed(4)),
          blocking: Math.round(window.__blocking || 0),
          longtasks: window.__longtasks || 0,
          html: document.documentElement.outerHTML.length,
        };
      });

      const all = [...requests.entries()];
      const byType = {};
      let totalWire = 0;
      let totalDecoded = 0;
      for (const [, r] of all) {
        byType[r.type] = byType[r.type] || { wire: 0, decoded: 0 };
        byType[r.type].wire += r.wire;
        byType[r.type].decoded += r.decoded;
        totalWire += r.wire;
        totalDecoded += r.decoded;
      }
      const scripts = all
        .filter(([, r]) => r.type === "script")
        .sort((a, b) => b[1].wire - a[1].wire)
        .slice(0, 6);
      const dupes = all.filter(([, r]) => r.count > 1);

      console.log(`\n${"=".repeat(64)}`);
      console.log(`${vp.name.toUpperCase()} ${vp.width}x${vp.height}   ${route}`);
      console.log("=".repeat(64));
      console.log(
        `  TTFB ${metrics.ttfb} ms | DCL ${metrics.dcl} ms | load ${metrics.load} ms` +
          ` | LCP ${metrics.lcp} ms | CLS ${metrics.cls}` +
          ` | blocking ${metrics.blocking} ms over ${metrics.longtasks} long task(s)`,
      );
      console.log(`  HTML document (decoded, in-memory): ${kb(metrics.html)}`);
      console.log(
        `  requests: ${requestCount} (${all.length} unique)` +
          `   wire: ${kb(totalWire)}   decoded: ${kb(totalDecoded)}`,
      );
      console.log(
        `  by type (wire): ${Object.entries(byType)
          .sort((a, b) => b[1].wire - a[1].wire)
          .map(([t, b]) => `${t} ${kb(b.wire)}`)
          .join(", ")}`,
      );
      if (scripts.length) {
        console.log(`  largest scripts (wire / decoded):`);
        for (const [url, r] of scripts) {
          console.log(
            `    ${kb(r.wire).padStart(10)} / ${kb(r.decoded).padStart(10)}  ${url.replace(BASE, "")}`,
          );
        }
      }
      console.log(`  duplicate requests: ${dupes.length}`);
      for (const [url, r] of dupes.slice(0, 8)) {
        console.log(`    x${r.count}  ${r.type.padEnd(8)} ${url.replace(BASE, "")}`);
      }

      const jsWire = (byType.script || { wire: 0 }).wire;
      const jsDecoded = (byType.script || { decoded: 0 }).decoded;
      collected.push({
        route,
        viewport: vp.name,
        finalUrl: page.url().replace(BASE, "") || "/",
        redirected: (page.url().replace(BASE, "") || "/") !== route,
        requests: requestCount,
        uniqueRequests: all.length,
        wireBytes: totalWire,
        decodedBytes: totalDecoded,
        jsWireBytes: jsWire,
        jsDecodedBytes: jsDecoded,
        htmlChars: metrics.html,
        ttfbMs: metrics.ttfb,
        loadMs: metrics.load,
        lcpMs: metrics.lcp,
        cls: metrics.cls,
        blockingMs: metrics.blocking,
        longTasks: metrics.longtasks,
        duplicateUrls: dupes.length,
      });

      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

if (JSON_OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), rows: collected }, null, 2));
  console.log(`\nJSON written to ${JSON_OUT} (${collected.length} rows)`);
}

console.log(
  `\nRecorded, not asserted. Thresholds live in Lighthouse CI; this file exists\n` +
    `so an optimisation can be proved rather than claimed.\n` +
    `A route that redirected is marked as such in the JSON — an anonymous hit on\n` +
    `a protected route measures the REDIRECT, never the page behind it.`,
);
