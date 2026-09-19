/**
 * THE SMOKE TEST: does GrovBase still come up, for a stranger, in both themes?
 *
 * This is the harness the remediation work (Prompt #2) runs against. It is
 * deliberately narrow, because the value of a smoke test is that a failure
 * MEANS something — a suite that goes red for environmental reasons teaches
 * everyone to ignore it.
 *
 * WHAT IT COVERS, AND WHY ONLY THIS
 * Every check below is reachable by an anonymous visitor. Nothing here logs
 * in, submits a form, uploads a file, spends a credit or calls an AI provider.
 * That is not timidity: the authenticated flows need a dedicated test account
 * with throwaway data, and no such account exists yet. Faking one against real
 * production data would be worse than not testing. See the SKIPPED section at
 * the end — it names exactly what is missing and what would unlock it.
 *
 * WHAT A FAILURE MEANS
 * - a non-200 on a public route: the page a stranger lands on is broken
 * - a console error: something threw in the browser, in front of a customer
 * - horizontal scroll: the mobile layout is broken at that width
 * - a theme that does not apply: the dark/light contract is broken
 *
 * NOT A PERFORMANCE TEST. Page weight is recorded, not asserted — the numbers
 * are context for the audit's P0-03 (the 238 KB i18n dictionary serialised
 * into every page), and turning them into thresholds here would duplicate
 * Lighthouse CI badly.
 *
 * Run:  npm run test:smoke -- <base-url>
 * e.g.  npm run test:smoke -- http://127.0.0.1:3000
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = (process.argv[2] || process.env.SMOKE_BASE_URL || "").replace(/\/$/, "");
if (!BASE) {
  console.error("usage: npm run test:smoke -- <base-url>");
  process.exit(2);
}

/**
 * Find a browser without hardcoding this container's layout.
 *
 * The existing probes point `executablePath` straight at
 * /opt/pw-browsers/chromium_headless_shell-1194/..., which is correct here and
 * wrong anywhere else — a GitHub runner installs browsers somewhere else
 * entirely. So: use an explicit override if given, use the known container path
 * if it happens to exist, otherwise let Playwright resolve its own download.
 */
function launchOptions() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (explicit) return { executablePath: explicit };
  const containerShell = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
  if (existsSync(containerShell)) return { executablePath: containerShell };
  return {};
}

let failures = 0;
let checks = 0;

function check(label, ok, detail = "") {
  checks += 1;
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

/** Routes an anonymous visitor can reach. Confirmed against
 *  lib/supabase/middleware.ts PROTECTED_PREFIXES on 2026-09-19. */
const PUBLIC_PAGES = ["/", "/regulamin", "/polityka-prywatnosci"];

/** Widths that have to be free of horizontal scroll. The narrow end is a
 *  small iPhone; 430 is a Pro Max; 768 is the tablet breakpoint. */
const WIDTHS = [320, 375, 430, 768];

const browser = await chromium.launch(launchOptions());

try {
  // ---------------------------------------------------------------- pages
  console.log(`\nPUBLIC PAGES  (${BASE})`);
  const weights = [];

  for (const path of PUBLIC_PAGES) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const consoleErrors = [];
    const failedRequests = [];

    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("requestfailed", (r) => {
      // A cancelled navigation is not a broken resource.
      const err = r.failure()?.errorText || "";
      if (!/ERR_ABORTED/.test(err)) failedRequests.push(`${r.url()} ${err}`);
    });

    const res = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 45_000 });
    check(`${path} responds 200`, res?.status() === 200, `got ${res?.status()}`);

    // Console errors must be collected AFTER hydration, not at `load`.
    // React hydration mismatches — the most common console-error class in a
    // Next app — are thrown by client code that has not run yet at `load`.
    // Asserting there is the same mistake that made the auth-dialog check
    // report "no password field" on a page that has one.
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const html = await page.content();
    weights.push([path, html.length]);

    check(`${path} has no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
    check(`${path} has no failed requests`, failedRequests.length === 0, failedRequests.slice(0, 2).join(" | "));

    // Something app-shaped rendered. A byte-length floor would also be
    // cleared by a Next error page, so assert on a landmark the real shell
    // has and an error page does not.
    const landmarks = await page.locator("header, main, footer, [role=main]").count();
    check(`${path} renders real page structure`, landmarks > 0, `found ${landmarks} landmark elements`);

    await ctx.close();
  }

  // ------------------------------------------------------------ crawlables
  console.log(`\nCRAWLABLES`);
  for (const path of ["/robots.txt", "/sitemap.xml"]) {
    const r = await fetch(`${BASE}${path}`);
    const body = await r.text();
    check(`${path} responds 200`, r.status === 200, `got ${r.status}`);
    check(`${path} is not empty`, body.trim().length > 0);
  }
  const robots = await fetch(`${BASE}/robots.txt`).then((r) => r.text());
  check("robots.txt points at a sitemap", /sitemap/i.test(robots), robots.slice(0, 80));
  check(
    "robots.txt does not Disallow the whole site",
    !/^\s*Disallow:\s*\/\s*$/im.test(robots),
    "a bare 'Disallow: /' would delist every public page",
  );

  // -------------------------------------------------------------- viewport
  // HORIZONTAL OVERFLOW — and why the obvious check is worthless here.
  //
  // The obvious test is `documentElement.scrollWidth <= clientWidth`. In THIS
  // repo that assertion can never fail: app/globals.css sets
  // `overflow-x: clip` on both html and body (the "RESPONSIVE FLOOR"
  // backstop), and `clip` removes the scrolling box entirely, so scrollWidth
  // is clamped to clientWidth no matter how far content overruns.
  //
  // Verified empirically with this repo's own Chromium: a 3000px-wide child in
  // a 320px viewport reports scrollWidth 3008 without the rule and 320 with
  // it. The first version of this check shipped with that hole and reported
  // four passes that could not fail.
  //
  // So the backstop is neutralised for the duration of the measurement. That
  // asks the question worth asking — does the layout actually FIT, or is it
  // merely being clipped? — because clipped overflow is still broken: the
  // content is cut off, it is just cut off silently.
  console.log(`\nNO HORIZONTAL OVERFLOW (CSS clip backstop neutralised)`);
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 45_000 });

    const overflow = await page.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;
      const saved = [
        [html, html.style.cssText],
        [body, body.style.cssText],
      ];
      // !important, because the repo's rule is itself specific.
      for (const el of [html, body]) {
        el.style.setProperty("overflow-x", "visible", "important");
        el.style.setProperty("max-width", "none", "important");
      }
      // Force layout before reading.
      void html.offsetWidth;
      const result = { scroll: html.scrollWidth, client: html.clientWidth, widest: null };

      if (result.scroll > result.client + 1) {
        // Name the culprit — "something overflows" is not actionable.
        let worst = null;
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (getComputedStyle(el).visibility === "hidden") continue;
          if (!worst || r.right > worst.right) {
            worst = { right: r.right, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60) };
          }
        }
        result.widest = worst;
      }

      for (const [el, css] of saved) el.style.cssText = css;
      return result;
    });

    check(
      `${width}px wide: layout fits without the clip backstop`,
      overflow.scroll <= overflow.client + 1,
      overflow.widest
        ? `scrollWidth ${overflow.scroll} > ${overflow.client}; widest right edge ${Math.round(
            overflow.widest.right,
          )}px on <${overflow.widest.tag} class="${overflow.widest.cls}">`
        : `scrollWidth ${overflow.scroll} > clientWidth ${overflow.client}`,
    );
    await ctx.close();
  }

  // ----------------------------------------------------------------- theme
  // THEME — and a correction worth writing down.
  //
  // The obvious assertion here is "light and dark must resolve to different
  // backgrounds, or the toggle is decorative". That assertion is WRONG for
  // these routes, and it failed when first written.
  //
  // Measured 2026-09-19: on `/` and `/regulamin`, documentElement.className is
  // "dark" under BOTH prefers-color-scheme values, and the body background is
  // rgb(13, 8, 19) in both. The public marketing surface is deliberately
  // dark-only. That is approved, frozen behaviour — not a bug, and not
  // something this harness should pressure anyone into "fixing".
  //
  // The real light/dark contract belongs to the authenticated app shell, which
  // needs a test account. It is listed in the SKIPPED block below.
  //
  // So what is asserted is what is actually true and still worth protecting:
  // a theme class is resolved, and the body has a real (non-transparent)
  // background in both cases.
  console.log(`\nTHEME (public surface is intentionally dark-only)`);
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 45_000 });
    const info = await page.evaluate(() => ({
      htmlClass: document.documentElement.className,
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    check(
      `prefers-color-scheme:${scheme} — a theme class is applied`,
      /\b(dark|light)\b/.test(info.htmlClass),
      `html class="${info.htmlClass}"`,
    );
    check(
      `prefers-color-scheme:${scheme} — body background is not transparent`,
      !!info.bg && info.bg !== "rgba(0, 0, 0, 0)",
      info.bg,
    );
    await ctx.close();
  }

  // ------------------------------------------------------------ auth entry
  // Opening the dialog is public; submitting it is not, so we stop at "does
  // the entry point appear". No credentials are typed anywhere in this file.
  console.log(`\nAUTH ENTRY POINT (dialog only — no credentials)`);
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/?auth=login`, { waitUntil: "load", timeout: 45_000 });
    check("/?auth=login responds 200", res?.status() === 200, `got ${res?.status()}`);

    // The dialog is mounted by auth-dialog-context on the client, so it does
    // not exist at `load`. Waiting for the field is the point of the check —
    // asserting immediately after load reports "no password field" on a page
    // that has one, which is how this check first failed.
    let appeared = true;
    try {
      await page.waitForSelector('input[type="password"]', { state: "attached", timeout: 15_000 });
    } catch {
      appeared = false;
    }
    check("a password field appears once the dialog hydrates", appeared);
    check("the dialog is exposed with role=dialog", (await page.locator('[role="dialog"]').count()) > 0);
    await ctx.close();
  }

  // ------------------------------------------------------------- page weight
  console.log(`\nDOM SIZE — DECODED, NOT WIRE BYTES (recorded, not asserted)`);
  for (const [path, len] of weights) {
    console.log(`  ${String(Math.round(len / 1024)).padStart(5)} KB  ${path}`);
  }
  console.log(
    `  These are serialised-DOM lengths after decompression, NOT transfer size.\n` +
      `  The responses are gzipped: / measures ~288 KB decoded but ~90 KB on the\n` +
      `  wire. Do not quote these as "bytes shipped" — an earlier version of the\n` +
      `  docs did, and overstated the network cost by roughly 3.3x.\n` +
      `  Context: lib/i18n/dictionaries/pl.json is 237,997 bytes, which is most\n` +
      `  of that decoded figure — the shape the audit's P0-03 describes.\n` +
      `  For real transfer sizes use: npm run perf:baseline -- <base-url>`,
  );

  console.log(`\nSKIPPED — REQUIRED MANUAL STEP`);
  console.log(
    [
      "  The authenticated half of the smoke matrix is NOT implemented, because",
      "  it needs a dedicated test account and this project has none.",
      "",
      "  Blocked on a test account with throwaway data:",
      "    - login of an existing user, logout, re-login",
      "    - client dashboard",
      "    - library listing + history",
      "    - a tool page",
      "    - credits/plan read",
      "    - admin smoke (needs a SEPARATE non-personal admin account)",
      "",
      "  Do not unblock this by using a personal or operator account: browser",
      "  automation can read whatever that session can read. Do not point it at",
      "  production data. Create a test account, then extend this file.",
    ].join("\n"),
  );
} finally {
  await browser.close();
}

console.log(`\nsmoke: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`smoke: ${failures} check(s) failed`);
  process.exit(1);
}
