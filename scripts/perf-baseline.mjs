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

const ROUTES = ["/", "/regulamin"];
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const browser = await chromium.launch(launchOptions());

try {
  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();

      /** url -> { count, type, bytes } */
      const requests = new Map();
      page.on("response", async (res) => {
        const url = res.url();
        const type = res.request().resourceType();
        let bytes = 0;
        try {
          const len = res.headers()["content-length"];
          bytes = len ? Number(len) : (await res.body().catch(() => Buffer.alloc(0))).length;
        } catch {
          bytes = 0;
        }
        const prev = requests.get(url);
        if (prev) {
          prev.count += 1;
        } else {
          requests.set(url, { count: 1, type, bytes });
        }
      });

      // Install the observers BEFORE navigation, or the entries that matter
      // (LCP fires early) are already gone by the time we look.
      await page.addInitScript(() => {
        window.__lcp = 0;
        window.__cls = 0;
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
          html: document.documentElement.outerHTML.length,
        };
      });

      const all = [...requests.entries()];
      const byType = {};
      let total = 0;
      for (const [, r] of all) {
        byType[r.type] = (byType[r.type] || 0) + r.bytes;
        total += r.bytes;
      }
      const scripts = all
        .filter(([, r]) => r.type === "script")
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .slice(0, 6);
      const dupes = all.filter(([, r]) => r.count > 1);

      console.log(`\n${"=".repeat(64)}`);
      console.log(`${vp.name.toUpperCase()} ${vp.width}x${vp.height}   ${route}`);
      console.log("=".repeat(64));
      console.log(
        `  TTFB ${metrics.ttfb} ms | DCL ${metrics.dcl} ms | load ${metrics.load} ms` +
          ` | LCP ${metrics.lcp} ms | CLS ${metrics.cls}`,
      );
      console.log(`  HTML document: ${kb(metrics.html)}`);
      console.log(`  requests: ${all.length}   transfer: ${kb(total)}`);
      console.log(
        `  by type: ${Object.entries(byType)
          .sort((a, b) => b[1] - a[1])
          .map(([t, b]) => `${t} ${kb(b)}`)
          .join(", ")}`,
      );
      if (scripts.length) {
        console.log(`  largest scripts:`);
        for (const [url, r] of scripts) {
          console.log(`    ${kb(r.bytes).padStart(10)}  ${url.replace(BASE, "")}`);
        }
      }
      console.log(`  duplicate requests: ${dupes.length}`);
      for (const [url, r] of dupes.slice(0, 8)) {
        console.log(`    x${r.count}  ${r.type.padEnd(8)} ${url.replace(BASE, "")}`);
      }

      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

console.log(
  `\nRecorded, not asserted. Thresholds live in Lighthouse CI; this file exists\n` +
    `so an optimisation in Prompt #2 can be proved rather than claimed.`,
);
