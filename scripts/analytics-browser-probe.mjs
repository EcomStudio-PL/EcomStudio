/**
 * GA4 IN A REAL BROWSER, AGAINST THE REAL PRODUCTION BUILD.
 *
 * scripts/analytics-tests.ts drives the tracker directly; that proves the
 * rules. This proves the WIRING — that the component mounts, that the effect
 * runs, that a client-side navigation reaches it, and that a reload starts
 * over. Those are the parts a unit test cannot see.
 *
 * GOOGLE IS NEVER CONTACTED. googletagmanager.com is unreachable from this
 * container anyway, so the request is intercepted and counted, then fulfilled
 * with an empty body. That is the honest split: `window.dataLayer` is OUR side
 * of the contract and is asserted exactly; draining it is gtag.js's side and is
 * Google's to get right.
 *
 *   npm run build && npx next start -p 3111   (with the ID in the environment)
 *   node scripts/analytics-browser-probe.mjs
 */
import { existsSync } from "fs";
import { chromium } from "playwright";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:3111";
const ID = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID ?? "G-CW61S1HTSF";

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const events = (dl) => dl.filter((e) => e[0] === "event" && e[1] === "page_view");
const configs = (dl) => dl.filter((e) => e[0] === "config");

/** dataLayer holds `arguments` objects once gtag.js has been through it, and
 *  plain arrays before that; both serialise to an array of values. */
const readLayer = (page) => page.evaluate(
  () => (window.dataLayer ?? []).map((e) => Array.from(e)),
);

async function main() {
  /*
     The repo's playwright pins a browser build the sandbox does not carry
     (it has 1194, the package wants 1148). Downloading one is the wrong fix
     here — the installed Chromium is fine for this probe, so it is pointed at
     directly and can be overridden for a machine that resolves its own.
  */
  const executablePath = process.env.PROBE_CHROMIUM
    ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  const browser = await chromium.launch(
    existsSync(executablePath) ? { executablePath } : {},
  );
  const ctx = await browser.newContext();

  let tagRequests = 0;
  const violations = [];
  await ctx.route("https://www.googletagmanager.com/**", async (route) => {
    tagRequests++;
    await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  // Nothing should ever reach the collector here, since the stub never drains
  // the queue — but if it did, it must not carry anything private.
  const collectorUrls = [];
  await ctx.route("https://*.google-analytics.com/**", async (route) => {
    collectorUrls.push(route.request().url());
    await route.fulfill({ status: 204, body: "" });
  });

  const page = await ctx.newPage();
  page.on("console", (m) => {
    const text = m.text();
    if (/Content Security Policy|Refused to/i.test(text)) violations.push(text);
  });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  console.log("A. FIRST LOAD");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  let dl = await readLayer(page);

  check("the tag is requested exactly once", tagRequests === 1, String(tagRequests));
  check("dataLayer exists", Array.isArray(dl) && dl.length > 0, JSON.stringify(dl));
  check("with exactly one config", configs(dl).length === 1, String(configs(dl).length));
  check(`and it names ${ID}`, configs(dl)[0]?.[1] === ID, JSON.stringify(configs(dl)[0]));
  check("with send_page_view disabled",
    configs(dl)[0]?.[2]?.send_page_view === false, JSON.stringify(configs(dl)[0]));
  check("the first load sends exactly ONE page_view", events(dl).length === 1,
    JSON.stringify(events(dl)));
  check("reporting this page", events(dl)[0]?.[2]?.page_location === `${BASE}/`,
    events(dl)[0]?.[2]?.page_location);

  console.log("\nB. A LINK THAT REDIRECTS BACK IS NOT A VISIT");
  /*
    THIS IS THE CHECK THAT FOUND THE BUG, and its first version asserted the
    wrong thing. "Zacznij za darmo" points at /register, which is a server
    redirect() to /?auth=register — the router commits the intermediate route
    without a document load, so the addresses go / → /register → /. The probe
    originally expected /register to be a destination and measured THREE
    page_views for one click; the code was reporting every waypoint.

    What should happen is nothing: the visitor is still on the landing page,
    with a dialog open over it. lib/analytics/ga.ts waits for the address to
    settle, so that is now what happens.
  */
  const redirecting = page.locator('a[href="/register"]').first();
  check("the landing still has the redirecting CTA this checks", await redirecting.count() > 0);
  if (await redirecting.count() > 0) {
    await redirecting.click();
    await page.waitForTimeout(1200);
    dl = await readLayer(page);
    check("no second config — the document never reloaded", configs(dl).length === 1,
      String(configs(dl).length));
    check("opening the dialog over the page adds NO page_view", events(dl).length === 1,
      JSON.stringify(events(dl).map((e) => e[2]?.page_location)));
    check("and the tag was not fetched a second time", tagRequests === 1, String(tagRequests));
  }

  console.log("\nB2. A REAL NAVIGATION IS ONE PAGE_VIEW");
  {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const before = events(await readLayer(page)).length;
    const link = page.locator('a[href="/regulamin"]').first();
    check("the landing links somewhere that really is another page",
      await link.count() > 0);
    if (await link.count() > 0) {
      await link.click();
      await page.waitForURL("**/regulamin", { timeout: 15000 });
      await page.waitForTimeout(800);
      dl = await readLayer(page);
      check("it sends exactly one more page_view", events(dl).length === before + 1,
        JSON.stringify(events(dl).map((e) => e[2]?.page_location)));
      check("for the page it went to",
        events(dl).at(-1)?.[2]?.page_location === `${BASE}/regulamin`,
        events(dl).at(-1)?.[2]?.page_location);
      check("still one config — no document load", configs(dl).length === 1);
    }
  }

  console.log("\nC. A RELOAD IS A NEW DOCUMENT, NOT A DOUBLE");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  dl = await readLayer(page);
  check("the fresh document configures once", configs(dl).length === 1, String(configs(dl).length));
  check("and reports its page once — not twice", events(dl).length === 1,
    JSON.stringify(events(dl).map((e) => e[2]?.page_location)));

  console.log("\nD. NOTHING BROKE AND NOTHING LEAKED");
  check("no CSP violation was reported", violations.length === 0, violations.join(" | "));
  check("no page error (hydration included)", pageErrors.length === 0, pageErrors.join(" | "));
  check("nothing was sent to the collector by our own code",
    collectorUrls.every((u) => !/token|secret|password/i.test(u)),
    collectorUrls.join(" | "));

  // The one address in this app that carries a credential in the fragment.
  console.log("\nE. A CREDENTIAL IN THE URL IS NOT REPORTED");
  await page.goto(`${BASE}/reset-password#access_token=PROBE_SECRET_VALUE`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  dl = await readLayer(page);
  const serialised = JSON.stringify(dl);
  check("the page_view carries no fragment", !serialised.includes("PROBE_SECRET_VALUE"), serialised);
  check("and reports the path alone",
    events(dl)[0]?.[2]?.page_location === `${BASE}/reset-password`,
    events(dl)[0]?.[2]?.page_location);

  await browser.close();
  console.log(failures === 0
    ? "\nAll analytics browser checks passed."
    : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("analytics browser probe crashed:", e); process.exit(1); });
