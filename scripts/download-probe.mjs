/**
 * "POBIERZ" — the runtime behaviour, in a real browser.
 *
 * The static test pins the shape; this one runs the helper. It simulates an
 * iPhone, an iPad, an Android and a desktop by overriding the two things the
 * helper reads (`navigator.maxTouchPoints` and `navigator.share`), then asserts
 * what actually happened: a share sheet with a real File, or an anchor download
 * — and in NO case a navigation to the storage host.
 *
 *   node scripts/download-probe.mjs --harness
 *   npm run build && npx next start -p 3100 &
 *   node scripts/download-probe.mjs http://127.0.0.1:3100
 *   node scripts/download-probe.mjs --clean
 */
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/download";
const PAGE_SRC = `import { DownloadProbe } from "@/app/probe-tmp/download/client";
export const dynamic = "force-static";
export default function Page() { return <DownloadProbe />; }
`;
const CLIENT_SRC = `"use client";
import { useEffect } from "react";
import { saveBlob, saveImageFrom, fileNameFor, extOf } from "@/lib/save-image";

/** The helper, reachable from the probe. Nothing else on the page. */
export function DownloadProbe() {
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__save = { saveBlob, saveImageFrom, fileNameFor, extOf };
  }, []);
  return <div data-probe="download-root">ready</div>;
}
`;

if (process.argv.includes("--clean")) {
  fs.rmSync("app/probe-tmp", { recursive: true, force: true });
  console.log("removed app/probe-tmp");
  process.exit(0);
}
if (process.argv.includes("--harness")) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${DIR}/page.tsx`, PAGE_SRC);
  fs.writeFileSync(`${DIR}/client.tsx`, CLIENT_SRC);
  console.log(`wrote ${DIR}/{page,client}.tsx — build, start, then probe`);
  process.exit(0);
}

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const URL_ = `${BASE}/probe-tmp/download`;

let pass = 0, fail = 0;
const failures = [];
const ok = (c, label) => { if (c) pass++; else { fail++; failures.push(label); } };

/**
 * Install a fake device before the page's own scripts run.
 *  - `touch`  : how many touch points the device claims
 *  - `share`  : "ok" | "abort" | "notallowed" | null (no Web Share at all)
 */
function deviceScript(touch, share) {
  return `
    Object.defineProperty(navigator, "maxTouchPoints", { value: ${touch}, configurable: true });
    window.__calls = { share: [], anchors: [], navigations: [] };
    ${share === null ? `
      delete navigator.share; delete navigator.canShare;
    ` : `
      navigator.canShare = (d) => !!d && Array.isArray(d.files) && d.files.length > 0;
      navigator.share = async (data) => {
        window.__calls.share.push({
          files: (data.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
          title: data.title ?? null,
        });
        ${share === "abort" ? `const e = new Error("x"); e.name = "AbortError"; throw e;` : ""}
        ${share === "notallowed" ? `const e = new Error("x"); e.name = "NotAllowedError"; throw e;` : ""}
      };
    `}
    // Record every programmatic anchor click instead of letting it download.
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      window.__calls.anchors.push({ href: this.href, download: this.getAttribute("download") });
      // Deliberately NOT calling through: a real click would start a download
      // the headless browser cannot complete, and the assertion is about what
      // the anchor SAYS, not about the file landing on disk.
    };
    addEventListener("beforeunload", () => window.__calls.navigations.push(location.href));
  `;
}

async function scenario(browser, label, { touch, share, expect }) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(deviceScript(touch, share));
  const page = await ctx.newPage();
  const navigated = [];
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigated.push(f.url()); });

  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__save);

  // A blob the app already holds — the "Pobierz" path after a conversion.
  const result = await page.evaluate(async () => {
    const api = window.__save;
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" });
    const outcome = await api.saveBlob(blob, api.fileNameFor("Sofa Skandynawska", "image/jpeg"));
    return { outcome, calls: window.__calls };
  });

  ok(result.outcome === expect, `${label}: outcome ${result.outcome}, expected ${expect}`);

  if (expect === "shared") {
    ok(result.calls.share.length === 1, `${label}: share called ${result.calls.share.length}×`);
    const f = result.calls.share[0]?.files?.[0];
    ok(!!f, `${label}: no File handed to the share sheet`);
    if (f) {
      ok(/^grovbase-sofa-skandynawska-\d{4}-\d{2}-\d{2}-\d{4}\.jpg$/.test(f.name),
        `${label}: filename "${f.name}" is not a readable grovbase name`);
      ok(f.type === "image/jpeg", `${label}: File type ${f.type}`);
      ok(f.size === 4, `${label}: File size ${f.size}`);
    }
    ok(result.calls.anchors.length === 0, `${label}: it also built a download anchor`);
  }

  if (expect === "saved") {
    ok(result.calls.anchors.length === 1, `${label}: ${result.calls.anchors.length} anchor clicks`);
    const a = result.calls.anchors[0];
    if (a) {
      ok(a.href.startsWith("blob:"), `${label}: anchor href is ${a.href.slice(0, 40)}, expected a blob: URL`);
      ok(/\.jpg$/.test(a.download ?? ""), `${label}: anchor download="${a.download}"`);
    }
  }

  if (expect === "cancelled") {
    ok(result.calls.anchors.length === 0,
      `${label}: a cancelled share still downloaded (${result.calls.anchors.length} anchor)`);
  }

  // THE POINT OF THE WHOLE EXERCISE: nobody is sent to the storage host.
  const left = navigated.filter((u) => !u.includes("/probe-tmp/download"));
  ok(left.length === 0, `${label}: navigated away to ${left.join(", ")}`);
  ok(!navigated.some((u) => /supabase/i.test(u)), `${label}: navigated to a storage URL`);

  await ctx.close();
  return result;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  });

  const rows = [];
  rows.push(["iPhone Safari (share ok)", await scenario(browser, "iphone",
    { touch: 5, share: "ok", expect: "shared" })]);
  rows.push(["iPad (desktop UA, touch)", await scenario(browser, "ipad",
    { touch: 5, share: "ok", expect: "shared" })]);
  rows.push(["Android Chrome (gesture lapsed)", await scenario(browser, "android-notallowed",
    { touch: 5, share: "notallowed", expect: "saved" })]);
  rows.push(["Mobile, sheet dismissed", await scenario(browser, "abort",
    { touch: 5, share: "abort", expect: "cancelled" })]);
  rows.push(["Mobile without Web Share", await scenario(browser, "noshare",
    { touch: 5, share: null, expect: "saved" })]);
  rows.push(["Desktop (no touch, share exists)", await scenario(browser, "desktop",
    { touch: 0, share: "ok", expect: "saved" })]);
  rows.push(["Desktop without Web Share", await scenario(browser, "desktop-noshare",
    { touch: 0, share: null, expect: "saved" })]);

  // Naming and extensions, straight from the helper.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__save);
  const names = await page.evaluate(() => {
    const a = window.__save;
    return {
      jpg: a.extOf("image/jpeg"), png: a.extOf("image/png"), webp: a.extOf("image/webp"),
      unknown: a.extOf("application/octet-stream"),
      noSeed: a.fileNameFor(null, "image/png"),
      accents: a.fileNameFor("Żółta Sukienka", "image/webp"),
    };
  });
  ok(names.jpg === "jpg" && names.png === "png" && names.webp === "webp",
    `extensions: ${JSON.stringify(names)}`);
  ok(names.unknown === "img", `unknown MIME → ${names.unknown}`);
  ok(/^grovbase-\d{4}-\d{2}-\d{2}-\d{4}\.png$/.test(names.noSeed), `no-seed name ${names.noSeed}`);
  ok(/^grovbase-zolta-sukienka-/.test(names.accents), `accents not folded: ${names.accents}`);
  await ctx.close();
  await browser.close();

  console.log("\nBEHAVIOUR BY DEVICE");
  for (const [label, r] of rows) console.log(`  ${label.padEnd(34)} → ${r.outcome}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFAILURES");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
})();
