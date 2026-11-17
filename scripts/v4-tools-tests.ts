/**
 * „UPDATE NARZĘDZI V4” (17.11.2026) — the five changes, held.
 *
 *   npm run test:v4tools
 *
 *   1  „Generator GrovShot” is the generator's visible name (PL/EN/DE); its
 *      technical ids (tool keys, operations, modes) are unchanged.
 *   2  Miniaturka has no „← E-commerce” (no link, no separator); every other
 *      tool keeps its way back.
 *   3  Stwórz zdjęcie: „Inspiracja (opcjonalnie)” behind
 *      app_settings("generation").customInspirationEnabled, OFF by default —
 *      no section, no library, no drop target, no draft inspiration restored,
 *      no slot reserved, nothing sent (and /api/generate drops it); ON = as
 *      before.
 *   4  Miniaturka · Packshot AI: „Zdjęcia po Packshot AI” in the preview
 *      (only a Miniaturka's own passes), „Użyj w kolejnej generacji” APPENDS
 *      (dedupe by the Retusz job, limit 10, partial add, messages), switches
 *      Packshot AI off, keeps everything else; cost = what is sent.
 *   5  The header's balance / „Doładuj” goes to /plan.
 *
 * The screens are the REAL components bundled with esbuild and mounted in
 * Chromium (scripts/stubs/v4-harness.tsx, scripts/stubs/preview-sources-
 * harness.tsx); every /api answer is the page's own router. No network, no
 * database, no model call, no credit moved.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import { CUSTOM_INSPIRATION_DEFAULT, customInspirationEnabled, customPhotoBudget } from "@/lib/generator/studio";
import { readCustomInspirationEnabled } from "@/lib/server/custom-inspiration";
import { mergeRetouched, retouchedRef, type FormPhoto, type RetouchedPhoto } from "@/lib/thumbnail/reuse";
import { THUMBNAIL_PATH, quoteTotal } from "@/lib/thumbnail/config";
import { makeT } from "@/lib/i18n/t";
import type { GalleryItem } from "@/components/genv3/types";
import type { Client } from "@/lib/services/workspace";

let passed = 0;
let failed = 0;
let skipped = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 700)}`}`); }
}
function skip(name: string, why: string) { skipped++; console.log(`  – ${name} (skipped: ${why})`); }
const section = (s: string) => console.log(`\n${s}`);
const src = (p: string) => readFileSync(p, "utf8");
type Dict = Record<string, unknown>;
const at = (d: Dict, key: string): unknown => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Dict)[k] : undefined), d);
const ADMIN_NAMESPACES = ["gss", "gsp", "aicc", "admin"];
function customerStrings(d: Dict): [string, string][] {
  const out: [string, string][] = [];
  const walk = (o: unknown, path: string) => {
    if (typeof o === "string") out.push([path, o]);
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
  };
  for (const [k, v] of Object.entries(d)) if (!ADMIN_NAMESPACES.includes(k)) walk(v, k);
  return out;
}
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/* ── 1 · the name ──────────────────────────────────────────────────────── */
function sectionName() {
  section("1 · „Generator GrovShot” — the visible name");
  const keys = ["genv3.modeManaged", "genv3.managedTitle", "mega.engine", "nav.prompts", "sellerHome.tool.grovshot.name"];
  for (const [loc, d] of [["pl", pl], ["en", en], ["de", de]] as const) {
    for (const k of keys) check(`${loc}: ${k} = „Generator GrovShot”`, at(d as Dict, k) === "Generator GrovShot", at(d as Dict, k));
    // Admin-only panels (gss.* GrovShot quality/KB/tests, gsp.* process
    // view, aicc.* AI control centre) are not what a customer sees.
    const old = customerStrings(d as Dict).filter(([, v]) => /GrovBase Shot|Grovbase Shot|Shot 1\.0/.test(v));
    check(`${loc}: no customer-facing text says „GrovBase Shot” / „Shot 1.0”`, old.length === 0, old.slice(0, 3));
    check(`${loc}: „Stwórz zdjęcie” tab keeps its own name`, typeof at(d as Dict, "genv3.modeCustom") === "string" && at(d as Dict, "genv3.modeCustom") !== "Generator GrovShot", at(d as Dict, "genv3.modeCustom"));
    check(`${loc}: an engine error names the new generator`, String(at(d as Dict, "studio.err.scenario_unavailable")).includes("Generator GrovShot"), at(d as Dict, "studio.err.scenario_unavailable"));
  }
  check("search finds it by the new name and by „grovshot”", /generator grovshot/.test(String(at(pl as Dict, "toolsearch.prompts.words"))) && /grovshot/.test(String(at(pl as Dict, "toolsearch.prompts.words"))));
  // The technical identity did not move: tool keys, operations, modes, the address.
  const ws = src("components/genv3/workspace.tsx");
  check("GrovShot V2 still submits tool „prompts”, operation „grovshot_v2”", ws.includes(`tool: "prompts", operation: "grovshot_v2"`));
  check("Stwórz zdjęcie still submits tool „generator”, operation null", ws.includes(`tool: "generator", operation: null`));
  check("the GrovShot / Stwórz zdjęcie switch keeps its two modes", /\["grovshot", "stworz"\]|"grovshot" \| "stworz"/.test(ws + src("lib/generator/studio.ts")));
  const gt = src("lib/gallery-tools.ts");
  check("gallery tool modes unchanged (prompts / generator)", gt.includes("prompts") && gt.includes("generator"));
}

/* ── 2 · Miniaturka without „← E-commerce” (source) ───────────────────── */
function sectionBackSource() {
  section("2 · Miniaturka — no „← E-commerce” (wiring)");
  const rt = src("components/category/workflow-runtime.tsx");
  const thumbLine = rt.split("\n").find((l) => l.includes("<ThumbnailWorkspace")) ?? "";
  check("workflow runtime hands Miniaturka no `back`", thumbLine !== "" && !thumbLine.includes("back="), thumbLine.trim());
  check("the other tools there keep `back={back}`", (rt.match(/back=\{back\}/g) ?? []).length >= 2);
  const tw = src("components/thumbnail/workspace.tsx");
  const frameLine = tw.split("\n").find((l) => l.includes("<ToolFrame")) ?? "";
  check("Miniaturka's ToolFrame has no `back`", frameLine !== "" && !frameLine.includes("back="), frameLine.trim());
  check("Miniaturka keeps its name (title) in the header", frameLine.includes("title={"));
}

/* ── 3 · the inspiration flag (unit + server) ─────────────────────────── */
async function sectionFlagUnit() {
  section("3 · Stwórz zdjęcie — customInspirationEnabled (settings, server)");
  check("default is OFF", CUSTOM_INSPIRATION_DEFAULT === false && customInspirationEnabled(null) === false && customInspirationEnabled({}) === false);
  check("only a literal true turns it on", customInspirationEnabled({ customInspirationEnabled: true }) === true
    && customInspirationEnabled({ customInspirationEnabled: "true" }) === false && customInspirationEnabled({ customInspirationEnabled: 1 }) === false);
  check("explicit false stays off", customInspirationEnabled({ customInspirationEnabled: false }) === false);
  const client = (answer: () => Promise<{ data: unknown; error: unknown }>) => {
    const seen: string[] = [];
    const q = {
      select: (c: string) => { seen.push(`select:${c}`); return q; },
      eq: (k: string, v: string) => { seen.push(`eq:${k}=${v}`); return q; },
      maybeSingle: answer,
    };
    return { c: { from: (t: string) => { seen.push(`from:${t}`); return q; } } as unknown as Client, seen };
  };
  const on = client(async () => ({ data: { value: { customInspirationEnabled: true, maxAttempts: 2 } }, error: null }));
  check("reads app_settings(„generation”) → true", await readCustomInspirationEnabled(on.c) === true, on.seen);
  check("…from the existing settings row", on.seen.join(",") === "from:app_settings,select:value,eq:key=generation", on.seen);
  check("row without the key → OFF", await readCustomInspirationEnabled(client(async () => ({ data: { value: { maxAttempts: 2 } }, error: null })).c) === false);
  check("no row → OFF", await readCustomInspirationEnabled(client(async () => ({ data: null, error: null })).c) === false);
  check("read error → OFF", await readCustomInspirationEnabled(client(async () => ({ data: null, error: { message: "x" } })).c) === false);
  check("thrown read → OFF", await readCustomInspirationEnabled(client(async () => { throw new Error("down"); }).c) === false);
  const model = { supportsRefs: true, maxRefs: 6 };
  check("a hidden (zero) inspiration reserves no product slot", customPhotoBudget(model, 0) === 6 && customPhotoBudget(model, 1) === 5);
  const ws = src("components/genv3/workspace.tsx");
  check("the panel's budget counts only ACTIVE inspirations", ws.includes("customPhotoBudget(model, activeInsp.length)") && !ws.includes("customPhotoBudget(model, insp.length)"));
  check("the request carries only active inspirations", ws.includes("inspirationPaths: activeInsp.map("));
  const route = src("app/api/generate/route.ts");
  check("/api/generate reads the flag itself", route.includes("readCustomInspirationEnabled(supabase)"));
  check("/api/generate drops inspirationPaths when it is off", /inspirationPaths: inspirationEnabled\s*\?/.test(route) && /:\s*\[\],/.test(route.slice(route.indexOf("inspirationPaths: inspirationEnabled"), route.indexOf("inspirationPaths: inspirationEnabled") + 260)));
  const page = src("components/genv3/studio-page.tsx");
  check("the studio page hands the flag to the panel (member and guest)", (page.match(/inspirationEnabled/g) ?? []).length >= 2 && (page.match(/readCustomInspirationEnabled\(/g) ?? []).length >= 2);
}

/* ── 4 · Packshot AI reuse (pure) ──────────────────────────────────────── */
function sectionMergeUnit() {
  section("4 · Packshot AI — „Użyj w kolejnej generacji” (merge rule, cost)");
  const ph = (k: string): FormPhoto => ({ key: k, path: k, url: `blob:${k}` });
  const rp = (n: number, url = `https://signed/${n}`): RetouchedPhoto => ({ ref: retouchedRef(uuid(n)), original: `ws/p/${n}.png`, url });
  const A = ph("ws/a.png"), B = ph("ws/b.png"), C = ph("ws/c.png");
  let m = mergeRetouched([A, B, C], [rp(1), rp(2)], 10);
  check("appended at the END, nothing replaced or moved", m.photos.map((p) => p.key).join(",") === ["ws/a.png", "ws/b.png", "ws/c.png", retouchedRef(uuid(1)), retouchedRef(uuid(2))].join(","), m.photos.map((p) => p.key));
  check("counts: 2 added, 0 skipped, 0 duplicates", m.added === 2 && m.skipped === 0 && m.duplicates === 0);
  m = mergeRetouched([], [rp(1), rp(2)], 10);
  check("empty form → the two in their order", m.photos.map((p) => p.key).join(",") === [retouchedRef(uuid(1)), retouchedRef(uuid(2))].join(","));
  m = mergeRetouched([A, ph(retouchedRef(uuid(1)))], [rp(1, "https://signed/OTHER"), rp(2)], 10);
  check("already there (same Retusz job, another signed URL) → not twice", m.added === 1 && m.duplicates === 1 && m.photos.length === 3);
  m = mergeRetouched(Array.from({ length: 9 }, (_, i) => ph(`ws/${i}.png`)), [rp(1), rp(2), rp(3)], 10);
  check("limit 10: 9 + 3 → 1 added, 2 skipped", m.added === 1 && m.skipped === 2 && m.photos.length === 10);
  check("…the customer's photos all stay", m.photos.slice(0, 9).every((p, i) => p.key === `ws/${i}.png`));
  m = mergeRetouched(Array.from({ length: 10 }, (_, i) => ph(`ws/${i}.png`)), [rp(1), rp(2)], 10);
  check("full form → nothing added, nothing removed", m.added === 0 && m.skipped === 2 && m.photos.length === 10);
  m = mergeRetouched([A], [{ ref: "https://evil/x.png", original: null, url: "x" }, { ref: "retouched:not-a-uuid", original: null, url: "x" }], 10);
  check("a forged reference is never taken", m.added === 0 && m.photos.length === 1);
  const first = mergeRetouched([A], [rp(1)], 10);
  const second = mergeRetouched(first.photos, [rp(1)], 10);
  check("two quick clicks → once (the second is a duplicate)", first.added === 1 && second.added === 0 && second.duplicates === 1 && second.photos.length === 2);
  // Cost: OFF = the thumbnail; ON = thumbnail + one pass per photo, carried or not.
  const off = quoteTotal({ photos: 4, retouch: false, retouchUnit: 7, thumbnailCredits: 20 });
  const on = quoteTotal({ photos: 4, retouch: true, retouchUnit: 7, thumbnailCredits: 20 });
  check("OFF: thumbnail only (20)", off.total === 20, off);
  check("ON: thumbnail + 4 passes (20 + 28 = 48)", on.total === 48 && on.retouchCount === 4, on);
  const tw = src("components/thumbnail/workspace.tsx");
  check("the form quotes WITHOUT a „reused” discount (re-processing is paid)", !/reused:/.test(tw));
  check("Packshot AI goes OFF only when something was added", /if \(merged\.added > 0\) \{[^}]*setRetouch\(false\)/.test(tw));
  const sr = src("app/api/generations/sources/route.ts");
  check("preview lists only this Miniaturka's OWN passes", sr.includes("fromRun.includes(f.jobId)"));
}

/* ── 5 · „Doładuj” → /plan ─────────────────────────────────────────────── */
function sectionTopUp() {
  section("5 · Header balance / „Doładuj” → /plan");
  const cc = src("components/layout/credits-control.tsx");
  const hrefs = [...cc.matchAll(/href=["{]([^"}]+)["}]/g)].map((x) => x[1]);
  check("credits control links to /plan", hrefs.length > 0 && hrefs.every((h) => h === "/plan" || h === `"/plan"`), hrefs);
  check("…and nowhere to /credits", !cc.includes(`"/credits"`));
  check("the control is the header's (mega-topbar)", src("components/layout/mega-topbar.tsx").includes("<CreditsControl"));
  check("/credits page itself is unchanged in place", existsSync("app/(app)/credits/page.tsx"));
}

/* ── the browser ──────────────────────────────────────────────────────── */
function findChromium(): string | null {
  const base = "/opt/pw-browsers";
  if (!existsSync(base)) return null;
  const shells = readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const d of shells) for (const sub of ["chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
    if (existsSync(`${base}/${d}/${sub}`)) return `${base}/${d}/${sub}`;
  }
  return existsSync(`${base}/chromium`) ? `${base}/chromium` : null;
}

const WS = "11111111-1111-4111-8111-111111111111";
const svg = (label: string, hue: number) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="hsl(${hue} 60% 55%)"/><text x="20" y="160" font-size="40" fill="white" font-family="sans-serif">${label}</text></svg>`)}`;

async function browserSections() {
  const esbuild = await import("esbuild");
  type PW = typeof import("playwright");
  const mod = (process.env.PLAYWRIGHT_MODULE ? await import(process.env.PLAYWRIGHT_MODULE) : await import("playwright")) as PW & { default?: PW };
  const pw = (mod.chromium ? mod : mod.default ?? mod) as PW;
  const bundle = async (entry: string) => (await esbuild.build({
    entryPoints: [entry], bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false, logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    banner: { js: `var process = { env: { NODE_ENV: "production" } };` },
    alias: {
      "next/link": "./scripts/stubs/next-link.tsx",
      "next/navigation": "./scripts/stubs/v4-stubs.ts",
      "@/lib/supabase/client": "./scripts/stubs/v4-stubs.ts",
      "@/lib/notify": "./scripts/stubs/v4-stubs.ts",
      "@/app/actions/auth": "./scripts/stubs/v4-stubs.ts",
      "@/app/actions/public-tools": "./scripts/stubs/v4-stubs.ts",
      "@/app/actions/tool-guide-seen": "./scripts/stubs/v4-stubs.ts",
      "@/app/actions/trial-watermark": "./scripts/stubs/v4-stubs.ts",
      "@/app/actions/plan-change": "./scripts/stubs/v4-stubs.ts",
      "@/app/actions/feedback": "./scripts/stubs/preview-sources-stubs.ts",
      "@": ".",
    },
  })).outputFiles[0].text;
  let js: { v4: string; preview: string };
  try {
    js = { v4: await bundle("scripts/stubs/v4-harness.tsx"), preview: await bundle("scripts/stubs/preview-sources-harness.tsx") };
  } catch (e) {
    check("harness bundles", false, String(e).slice(0, 1500));
    return;
  }
  const css = existsSync(".next/static/css") ? readdirSync(".next/static/css").filter((f) => f.endsWith(".css")) : [];
  let browser: Awaited<ReturnType<PW["chromium"]["launch"]>>;
  try { browser = await pw.chromium.launch(); }
  catch (e) {
    const exe = findChromium();
    if (!exe) { skip("browser flows", `no Chromium (${String(e).split("\n")[0].slice(0, 120)})`); return; }
    browser = await pw.chromium.launch({ executablePath: exe });
  }

  // A secure origin: the panels use crypto.randomUUID (as on grovbase.com).
  const ORIGIN = "https://v4.test";
  type Captured = { path: string; body: Record<string, unknown> };
  async function open(app: "v4" | "preview", fx: Record<string, unknown>, o: { width?: number } = {}) {
    const context = await browser.newContext({ viewport: { width: o.width ?? 1280, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    const posts: Captured[] = [];
    const gets: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const sources = (fx.sources ?? {}) as Record<string, unknown>;
    await page.route(`${ORIGIN}/**`, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.pathname === "/") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html lang="pl"><head><meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          ${css.map((f) => `<link rel="stylesheet" href="/css/${f}">`).join("")}</head>
          <body class="bg-canvas text-ink"><div id="root"></div>
          <script>window.__boot = Math.random(); window.__fx = ${JSON.stringify({ dict: pl, ws: WS, ...fx })};</script><script src="/app.js"></script></body></html>` });
      }
      if (url.pathname === "/app.js") return route.fulfill({ contentType: "text/javascript; charset=utf-8", body: js[app] });
      if (url.pathname.startsWith("/css/")) return route.fulfill({ path: `.next/static/css/${url.pathname.slice(5)}`, contentType: "text/css" });
      if (req.method() === "POST") {
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>; } catch { /* not JSON */ }
        posts.push({ path: url.pathname, body });
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false, error: "test_capture" }) });
      }
      gets.push(url.pathname + url.search);
      if (url.pathname === "/api/generations/sources") {
        const s = sources[url.searchParams.get("generationId") ?? ""];
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(s ?? { ok: true, known: true, references: [], inspirations: [], marked: null, retouched: [] }) });
      }
      if (url.pathname === "/api/generations") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, items: [], nextCursor: null }) });
      if (url.pathname === "/api/preview/actions") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ enabled: false }) });
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });
    await page.goto(`${ORIGIN}/`);
    return { page, context, errors, posts, gets };
  }
  const toasts = (page: import("playwright").Page) => page.evaluate(() => (window as unknown as { __toasts?: { kind: string; text: string }[] }).__toasts ?? []);
  const clearToasts = (page: import("playwright").Page) => page.evaluate(() => { (window as unknown as { __toasts?: unknown[] }).__toasts = []; });

  /* ── 2 · ToolFrame, rendered ─────────────────────────────────────── */
  section("2 · Miniaturka — no „← E-commerce” (rendered header)");
  for (const width of [1440, 390]) {
    const { page, context, errors } = await open("v4", { mode: "frame", path: THUMBNAIL_PATH }, { width });
    await page.waitForSelector("[data-frame=with] h1", { timeout: 15_000 });
    const r = await page.evaluate(() => {
      const without = document.querySelector("[data-frame=without]")!;
      const withBack = document.querySelector("[data-frame=with]")!;
      const head = without.querySelector("h1")!.parentElement!;
      return {
        noLink: without.querySelectorAll("[data-tool-back]").length,
        noText: /E-commerce/.test(without.textContent ?? ""),
        firstIsTitle: head.firstElementChild?.tagName === "H1" || head.firstElementChild?.contains(without.querySelector("h1")),
        slashes: [...without.querySelectorAll("span[aria-hidden]")].filter((s) => s.textContent === "/").length,
        withLink: withBack.querySelectorAll("[data-tool-back]").length,
        withHref: withBack.querySelector("[data-tool-back]")?.getAttribute("href") ?? null,
        titleLeft: Math.round(without.querySelector("h1")!.getBoundingClientRect().left),
        rowLeft: Math.round(head.getBoundingClientRect().left + parseFloat(getComputedStyle(head).paddingLeft || "0")),
      };
    });
    check(`${width}px: Miniaturka header has no way back`, r.noLink === 0 && !r.noText, r);
    check(`${width}px: no leftover separator`, r.slashes === 0, r);
    check(`${width}px: the name opens the row (no gap where the link stood)`, r.firstIsTitle === true && r.titleLeft === r.rowLeft, r);
    check(`${width}px: another tool keeps „← E-commerce”`, r.withLink === 1 && r.withHref === "/k/ecommerce", r);
    check(`${width}px: no page error`, errors.length === 0, errors);
    await context.close();
  }

  /* ── 3 · Stwórz zdjęcie, rendered ────────────────────────────────── */
  section("3 · Stwórz zdjęcie — inspiration section with the flag OFF / ON (real panel)");
  for (const flag of [false, true]) {
    const label = flag ? "ON" : "OFF";
    const { page, context, errors, posts } = await open("v4", { mode: "studio", path: "/generator", flag, draft: true });
    const cta = page.locator("[data-generate-cta]");
    let ready = true;
    try { await page.waitForFunction(() => !(document.querySelector("[data-generate-cta]") as HTMLButtonElement | null)?.disabled, null, { timeout: 15_000 }); }
    catch { ready = false; }
    check(`${label}: the restored draft makes the form ready`, ready, await page.evaluate(() => document.body.innerText.slice(0, 400)));
    const ui = await page.evaluate(() => ({
      section: document.querySelectorAll("[data-drop-target=insp]").length,
      label: /Inspiracja/.test((document.querySelector("[data-tool-columns], main, #root") as HTMLElement | null)?.innerText ?? ""),
      dialogs: document.querySelectorAll("[role=dialog]").length,
    }));
    if (!flag) {
      check("OFF: no „Inspiracja (opcjonalnie)” section", ui.section === 0 && !ui.label, ui);
      check("OFF: no library dialog", ui.dialogs === 0, ui);
    } else {
      check("ON: the section is there, as before", ui.section === 1 && ui.label, ui);
      const lib = page.locator("[data-drop-target=insp] button", { hasText: String(at(pl as Dict, "genv3.inspPick")) });
      check("ON: „pick from the library” is offered", await lib.count() === 1);
    }
    if (ready) {
      await cta.click();
      await page.waitForTimeout(400);
      const sent = posts.find((p) => p.path === "/api/generate")?.body;
      check(`${label}: one /api/generate request`, posts.filter((p) => p.path === "/api/generate").length === 1, posts.map((p) => p.path));
      const insp = (sent?.inspirationPaths ?? null) as string[] | null;
      const refs = (sent?.referencePaths ?? []) as string[];
      if (!flag) {
        check("OFF: inspirationPaths is empty (the draft's inspiration is not sent)", Array.isArray(insp) && insp.length === 0, sent);
        check("OFF: the hidden inspiration takes no product slot (6 of 6 sent)", refs.length === 6, refs);
      } else {
        check("ON: the draft's inspiration is sent", Array.isArray(insp) && insp.length === 1 && insp[0] === `${WS}/insp-x/i1.png`, sent);
        check("ON: one slot goes to it, as before (5 product photos)", refs.length === 5, refs);
      }
      check(`${label}: the prompt travels verbatim`, sent?.prompt === "Produkt na drewnianym stole w kuchni", sent?.prompt);
    }
    // A drop: OFF → product photos, even over a forged inspiration target.
    await page.evaluate(() => { (window as unknown as { __uploads: string[] }).__uploads = []; });
    if (!flag) {
      await page.evaluate(() => {
        const fake = document.createElement("div");
        fake.setAttribute("data-drop-target", "insp");
        fake.id = "forged";
        document.body.appendChild(fake);
      });
    }
    await page.evaluate((sel) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "d.png", { type: "image/png" }));
      const target = document.querySelector(sel) ?? document.body;
      target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, flag ? "[data-drop-target=insp]" : "#forged");
    await page.waitForTimeout(400);
    const uploads = await page.evaluate(() => (window as unknown as { __uploads: string[] }).__uploads);
    if (!flag) check("OFF: a drop (even over a forged target) goes to product photos", uploads.length <= 1 && uploads.every((u) => /\/adhoc-/.test(u)), uploads);
    else check("ON: a drop on the section is an inspiration, as before", uploads.length === 1 && /\/insp-/.test(uploads[0]!), uploads);
    check(`${label}: no page error`, errors.length === 0, errors);
    await context.close();
  }

  /* ── 4 · Miniaturka form, rendered ───────────────────────────────── */
  section("4 · Miniaturka — photos after Packshot AI in the form (real form)");
  const R = (n: number) => ({ ref: retouchedRef(uuid(n)), original: `${WS}/p/${n}.png`, url: svg(`P${n}`, n * 40) });
  {
    const { page, context, errors, posts } = await open("v4", { mode: "thumb", path: THUMBNAIL_PATH, offerBeforeMount: [R(1), R(2)] });
    await page.waitForSelector("[data-thumbnail-summary]", { timeout: 15_000 });
    await page.waitForTimeout(200);
    const state = () => page.evaluate(() => {
      const sw = document.querySelector("[data-thumbnail-retouch] [role=switch]");
      const vals = [...document.querySelectorAll("[data-thumbnail-summary] dd")].map((d) => d.textContent ?? "");
      return { on: sw?.getAttribute("aria-checked") === "true", photos: Number(vals[0]), total: vals[vals.length - 1] ?? "", hint: !!document.querySelector("[data-thumbnail-reuse-hint]"), hintText: document.querySelector("[data-thumbnail-reuse-hint]")?.textContent ?? "" };
    });
    let s = await state();
    check("from the Library (offer before the form mounts): both photos taken", s.photos === 2, s);
    check("Packshot AI OFF after the hand-over", s.on === false, s);
    check("the hint is shown", s.hint && s.hintText === at(pl as Dict, "thumb.reuse.hint"), s);
    check("message „Dodano 2 zdjęcia.”", (await toasts(page)).some((x) => x.text === "Dodano 2 zdjęcia."), await toasts(page));
    check("OFF: total = the thumbnail only (20)", /^20\b/.test(s.total), s);
    await page.click("[data-thumbnail-cta]");
    await page.waitForTimeout(300);
    let body = posts.filter((p) => p.path === "/api/thumbnail").at(-1)?.body;
    check("OFF: request = these photos, retouch false, quotedTotal 20", JSON.stringify(body?.photos) === JSON.stringify([R(1).ref, R(2).ref]) && body?.retouch === false && body?.quotedTotal === 20, body);
    // A conscious re-processing: ON, priced per photo, sent as such.
    await page.click("[data-thumbnail-retouch] [role=switch]");
    s = await state();
    check("ON: total = 20 + 2 × 7 = 34 (summary)", s.on && /^34\b/.test(s.total), s);
    const aria = await page.locator("[data-thumbnail-cta]").getAttribute("aria-label");
    check("ON: the button says the same price", (aria ?? "").includes("34"), aria);
    await page.click("[data-thumbnail-cta]");
    await page.waitForTimeout(300);
    body = posts.filter((p) => p.path === "/api/thumbnail").at(-1)?.body;
    check("ON: request carries retouch true and quotedTotal 34", body?.retouch === true && body?.quotedTotal === 34, body);
    check("no request went anywhere but /api/thumbnail", posts.every((p) => p.path === "/api/thumbnail"), posts.map((p) => p.path));
    // Same photos again while ON: „already”, nothing changes (switch stays ON).
    await clearToasts(page);
    await page.evaluate((r) => (window as unknown as { __offer: (x: unknown) => void }).__offer(r), [R(1), R(2)]);
    await page.waitForTimeout(150);
    s = await state();
    check("again → „już w formularzu”, form untouched (2 photos, still ON)", s.photos === 2 && s.on === true
      && (await toasts(page)).some((x) => x.text === at(pl as Dict, "thumb.reuse.already")), { s, t: await toasts(page) });
    // Two quick clicks of a new one: added once.
    await clearToasts(page);
    await page.evaluate((r) => { const o = (window as unknown as { __offer: (x: unknown) => void }).__offer; o(r); o(r); }, [R(3)]);
    await page.waitForTimeout(150);
    s = await state();
    const tq = await toasts(page);
    check("two quick clicks → one photo added, then „already”", s.photos === 3 && tq.filter((x) => x.text === "Dodano 1 zdjęcie.").length === 1 && tq.some((x) => x.text === at(pl as Dict, "thumb.reuse.already")), { s, tq });
    check("…and Packshot AI went OFF with it", s.on === false, s);
    check("no page error", errors.length === 0, errors);
    await context.close();
  }
  {
    // Originals first, then the hand-over: appended at the end, nothing replaced.
    const { page, context, errors, posts } = await open("v4", { mode: "thumb", path: THUMBNAIL_PATH });
    await page.waitForSelector("[data-thumbnail-summary]", { timeout: 15_000 });
    const files = (k: number, from = 0) => Array.from({ length: k }, (_, i) => ({ name: `o${from + i + 1}.png`, mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, from + i]) }));
    await page.locator("[data-thumbnail-tool] input[type=file]").first().setInputFiles(files(3));
    await page.waitForFunction(() => Number([...document.querySelectorAll("[data-thumbnail-summary] dd")][0]?.textContent) === 3, null, { timeout: 10_000 });
    await page.click("[data-thumbnail-retouch] [role=switch]");
    await clearToasts(page);
    await page.evaluate((r) => (window as unknown as { __offer: (x: unknown) => void }).__offer(r), [R(1), R(2)]);
    await page.waitForTimeout(150);
    await page.click("[data-thumbnail-cta]");
    await page.waitForTimeout(300);
    const body = posts.filter((p) => p.path === "/api/thumbnail").at(-1)?.body;
    const sent = (body?.photos ?? []) as string[];
    check("3 originals + 2 after Packshot → 5, appended at the END", sent.length === 5 && sent.slice(0, 3).every((p) => p.startsWith(`${WS}/`)) && sent[3] === R(1).ref && sent[4] === R(2).ref, sent);
    check("…Packshot AI turned OFF, priced 20", body?.retouch === false && body?.quotedTotal === 20, body);
    // Up to the limit: 5 + 4 originals = 9, then three → 1 added, 2 not.
    await page.locator("[data-thumbnail-tool] input[type=file]").first().setInputFiles(files(4, 3));
    await page.waitForFunction(() => Number([...document.querySelectorAll("[data-thumbnail-summary] dd")][0]?.textContent) === 9, null, { timeout: 10_000 });
    await clearToasts(page);
    await page.evaluate((r) => (window as unknown as { __offer: (x: unknown) => void }).__offer(r), [R(3), R(4), R(5)]);
    await page.waitForTimeout(150);
    const count = () => page.evaluate(() => Number([...document.querySelectorAll("[data-thumbnail-summary] dd")][0]?.textContent));
    check("limit: 9 + 3 → 10", await count() === 10);
    check("message „Dodano 1 zdjęcie. Nie dodano 2 zdjęć, ponieważ limit wynosi 10.”", (await toasts(page)).some((x) => x.text === "Dodano 1 zdjęcie. Nie dodano 2 zdjęć, ponieważ limit wynosi 10."), await toasts(page));
    await clearToasts(page);
    await page.evaluate((r) => (window as unknown as { __offer: (x: unknown) => void }).__offer(r), [R(6)]);
    await page.waitForTimeout(150);
    check("full form: „Nie dodano 1 zdjęcia, ponieważ limit wynosi 10.”, still 10", await count() === 10
      && (await toasts(page)).some((x) => x.text === "Nie dodano 1 zdjęcia, ponieważ limit wynosi 10."), await toasts(page));
    check("no page error", errors.length === 0, errors);
    await context.close();
  }

  /* ── 4 · the preview section, rendered ───────────────────────────── */
  section("4 · Preview — „Zdjęcia po Packshot AI” (real details view)");
  const base = (n: number, over: Partial<GalleryItem>): GalleryItem => ({
    generationId: uuid(100 + n), assetId: uuid(200 + n), path: `ws/x${n}.png`, url: svg(`I${n}`, n * 60), thumbUrl: svg(`I${n}`, n * 60),
    width: 1024, height: 1024, ratio: "1:1", resolution: "2K", quality: null, quantity: 1, credits: 1, latencyMs: 1000,
    referenceCount: 2, inspirationCount: 0, operation: null, model: "GPT Image", modelId: "m", product: "Kubek",
    sessionType: null, origin: "engine", prompt: null, favorite: false, note: null,
    createdAt: new Date(Date.UTC(2026, 10, 17, 10, n)).toISOString(), grovshot: null, ...over,
  });
  const items = [
    base(1, { operation: "ecommerce_thumbnail" }),          // a Miniaturka with two passes
    base(2, { operation: "ecommerce_thumbnail" }),          // a Miniaturka without Packshot
    base(3, { operation: null }),                           // any other image
  ];
  const ret = (n: number) => ({ ref: retouchedRef(uuid(n)), original: `${WS}/p/${n}.png`, url: svg(`full ${n}`, n * 30), thumbUrl: svg(`P${n}`, n * 30) });
  const srcs = {
    [items[0]!.generationId]: { ok: true, known: true, references: [svg("ref A", 10), svg("ref B", 20)], inspirations: [], marked: null, retouched: [ret(1), ret(2)] },
    [items[1]!.generationId]: { ok: true, known: true, references: [svg("ref C", 30)], inspirations: [], marked: null, retouched: [] },
    [items[2]!.generationId]: { ok: true, known: true, references: [svg("ref D", 40)], inspirations: [], marked: null, retouched: [ret(9)] },
  };
  for (const width of [1280, 390]) {
    const { page, context, errors, posts } = await open("preview", { items, path: "/library", sources: srcs }, { width });
    await page.waitForSelector("[data-retouched]", { timeout: 15_000 });
    const r = await page.evaluate(() => {
      const sec = document.querySelectorAll("[data-retouched]");
      const s = sec[0]!;
      const srcSec = document.querySelector("[data-sources]");
      return {
        count: sec.length,
        title: s.querySelector("p")?.textContent ?? "",
        thumbs: [...s.querySelectorAll("[data-retouched-thumb]")].map((b) => b.getAttribute("aria-label")),
        afterInputs: !!srcSec && !!(srcSec.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING),
        use: s.querySelector("[data-retouched-use]")?.textContent ?? "",
      };
    });
    check(`${width}px: one section „Zdjęcia po Packshot AI”`, r.count === 1 && r.title === "Zdjęcia po Packshot AI", r);
    check(`${width}px: under „Zdjęcia wejściowe”`, r.afterInputs, r);
    check(`${width}px: thumbnails in order`, JSON.stringify(r.thumbs) === JSON.stringify(["Zdjęcie po Packshot AI 1", "Zdjęcie po Packshot AI 2"]), r);
    check(`${width}px: button „Użyj w kolejnej generacji”`, r.use === "Użyj w kolejnej generacji", r);
    await page.click("[data-retouched-thumb] >> nth=1");
    const big = await page.evaluate(() => (document.querySelector("[role=dialog][data-no-pull] img") as HTMLImageElement | null)?.src ?? null);
    check(`${width}px: a click enlarges THAT photo`, !!big && decodeURIComponent(big).includes("full 2"), big?.slice(0, 80));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    check(`${width}px: Esc closes the enlargement, the preview stays`, await page.locator("[role=dialog][data-no-pull]").count() === 0 && await page.locator("[data-retouched]").count() === 1);
    // Other images: no section; back again: still one.
    await page.evaluate(() => (window as unknown as { __h: { setIndex: (i: number) => void } }).__h.setIndex(1));
    await page.waitForTimeout(250);
    check(`${width}px: a Miniaturka without Packshot → no section`, await page.locator("[data-retouched]").count() === 0);
    await page.evaluate(() => (window as unknown as { __h: { setIndex: (i: number) => void } }).__h.setIndex(2));
    await page.waitForTimeout(250);
    check(`${width}px: another tool's image → no section (even if the server listed some)`, await page.locator("[data-retouched]").count() === 0);
    await page.evaluate(() => (window as unknown as { __h: { setIndex: (i: number) => void } }).__h.setIndex(0));
    await page.waitForSelector("[data-retouched]");
    check(`${width}px: back on it → exactly one section, no duplicates`, await page.locator("[data-retouched]").count() === 1);
    check(`${width}px: looking is free (no POST)`, posts.length === 0, posts.map((p) => p.path));
    const boot = await page.evaluate(() => (window as unknown as { __boot: number }).__boot);
    await page.click("[data-retouched-use]");
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      open: (window as unknown as { __h: { open: boolean } }).__h.open,
      pushes: (window as unknown as { __pushes?: string[] }).__pushes ?? [],
      offer: sessionStorage.getItem("gb.thumb.retouched.v1"),
      boot: (window as unknown as { __boot: number }).__boot,
    }));
    const offered = after.offer ? (JSON.parse(after.offer) as { photos: { ref: string }[] }).photos.map((p) => p.ref) : [];
    check(`${width}px: „Użyj…” closes the preview`, after.open === false, after);
    check(`${width}px: …goes to Miniaturka client-side (no reload)`, JSON.stringify(after.pushes) === JSON.stringify([THUMBNAIL_PATH]) && after.boot === boot, after);
    check(`${width}px: …offers this Miniaturka's two passes, in order, by their Retusz job`, JSON.stringify(offered) === JSON.stringify([ret(1).ref, ret(2).ref]), offered);
    check(`${width}px: no page error`, errors.length === 0, errors);
    await context.close();
  }

  await browser.close();
}

/* ── i18n: the new messages read right in every language ──────────────── */
function sectionMessages() {
  section("4 · messages (PL plural forms, EN, DE)");
  const tpl = makeT(pl as Dict);
  check("PL partial message exactly as specified",
    tpl("thumb.reuse.partial", { added: "1 zdjęcie", skipped: "2 zdjęć", max: 10 }) === "Dodano 1 zdjęcie. Nie dodano 2 zdjęć, ponieważ limit wynosi 10.");
  for (const [loc, d] of [["pl", pl], ["en", en], ["de", de]] as const) {
    for (const k of ["added", "partial", "full", "already", "hint"]) check(`${loc}: thumb.reuse.${k}`, typeof at(d as Dict, `thumb.reuse.${k}`) === "string" && String(at(d as Dict, `thumb.reuse.${k}`)).length > 5);
    check(`${loc}: genv3.retouched.use`, typeof at(d as Dict, "genv3.retouched.use") === "string");
    check(`${loc}: thumb.err.retouch_original_missing`, typeof at(d as Dict, "thumb.err.retouch_original_missing") === "string");
  }
}

async function main() {
  sectionName();
  sectionBackSource();
  await sectionFlagUnit();
  sectionMergeUnit();
  sectionMessages();
  sectionTopUp();
  if (process.env.V4_NO_BROWSER) skip("browser flows", "V4_NO_BROWSER");
  else await browserSections();
  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
  process.exit(failed === 0 ? 0 : 1);
}
void main().catch((e) => { console.error(e); process.exit(1); });
