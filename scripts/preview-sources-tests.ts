/**
 * PREVIEW — „ZDJĘCIA WEJŚCIOWE” ACROSS PREV / NEXT, IN A REAL BROWSER.
 *
 *   npm run test:previewsources
 *
 * THE BUG (16.11.2026): in the Library (and every view mounting ImageDetails)
 * each move to another image ADDED a row of „Zdjęcia wejściowe” — the earlier
 * images' references, other products' photos, frozen skeletons — instead of
 * replacing it. Cause: since dfcd622 the SourcesSection is a direct child of
 * the info panel, a sibling of ResultFeedback, and both were keyed by the same
 * generation id. With two siblings on one key React lost track of the old
 * section on every change of generation and never removed it from the DOM.
 * The fix gives each keyed child its own prefix.
 *
 * The REAL component is bundled with esbuild and mounted in Chromium (and
 * WebKit when available) on a synthetic shelf of 34 images from 15
 * generations of 6 products; /api/generations/sources is answered by the
 * page's router with controlled delays, holds and out-of-order answers. No
 * network, no database, no model call. What must hold, at every step:
 *   · exactly ONE [data-sources] in the DOM, and its data-sources-gen is the
 *     generation of the image on screen; one „Zdjęcia wejściowe” label;
 *   · its thumbnails are that generation's own photos — never another's;
 *   · while loading: that one section with skeletons, nothing else;
 *   · a late answer for an image left behind never paints over the current
 *     one (and is cached for when the seller comes back);
 *   · one request per generation over a whole walk (cache + dedupe kept);
 *   · no React "two children with the same key" in a development build.
 *
 * Engines: PREVIEW_ENGINES=chromium,webkit (default chromium). WebKit needs a
 * Playwright whose WebKit build is installed: PLAYWRIGHT_MODULE points at it.
 */
import { existsSync, readdirSync } from "node:fs";
import pl from "@/lib/i18n/dictionaries/pl.json";
import type { GalleryItem } from "@/components/genv3/types";

let passed = 0;
let failed = 0;
let skipped = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 700)}`}`); }
}
function skip(name: string, why: string) { skipped++; console.log(`  – ${name} (skipped: ${why})`); }
const section = (s: string) => console.log(`\n${s}`);

/* ── the shelf ─────────────────────────────────────────────────────────── */

type Gen = { id: string; key: string; product: string; refs: number; insp: number; known: boolean; assets: number; shot?: number; repeat?: boolean };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GENS: Gen[] = [];
const add = (product: string, refs: number, insp: number, assets: number, extra: Partial<Gen> = {}) => {
  const n = GENS.length + 1;
  GENS.push({ id: uuid(n), key: `G${n}`, product, refs, insp, known: true, assets, ...extra });
};
add("Pojemniki", 2, 0, 4);                       // G1  two references, four images of one generation
add("Dziadek do orzechów", 2, 0, 2);             // G2
add("Tefal Ultragliss", 3, 0, 1);                // G3
add("Lampa do roślin", 0, 0, 2);                 // G4  no references (recorded as none)
add("Kettlebell 16 kg", 6, 1, 3);                // G5  seven sources → three tiles + „+4”
add("Worek ogrodowy", 0, 0, 1, { known: false }); // G6  older generation: nothing recorded
for (let s = 1; s <= 6; s++) add("Dziadek do orzechów", 1 + (s % 3), 0, 2, { shot: s }); // G7–G12 GrovShot shots, own refs each
add("Tefal Ultragliss", 5, 0, 3);                // G13
add("Pojemniki", 1, 2, 4);                       // G14
add("Kettlebell 16 kg", 3, 0, 2, { repeat: true }); // G15 the same photo sent twice (fidelity) + one more
const svg = (label: string, hue: number) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${hue} 60% 55%)"/><text x="20" y="160" font-size="44" fill="white" font-family="sans-serif">${label}</text></svg>`)}`;
const ITEMS: GalleryItem[] = GENS.flatMap((g, n) => Array.from({ length: g.assets }, (_, a): GalleryItem => ({
  generationId: g.id, assetId: `${g.id.slice(0, 24)}${String(a + 1).padStart(12, "0")}`, path: `ws/${g.key}-${a}.png`,
  url: svg(`${g.key} · ${a + 1}`, (n * 47) % 360), thumbUrl: svg(g.key, (n * 47) % 360), width: 1024, height: 1024,
  ratio: "1:1", resolution: "2K", quality: null, quantity: g.assets, credits: 1, latencyMs: 30_000,
  referenceCount: g.known ? g.refs : 0, inspirationCount: g.insp, operation: null, model: "Nano Banana Pro", modelId: "m",
  product: g.product, sessionType: "lifestyle", origin: "engine", prompt: null, favorite: false, note: null,
  createdAt: new Date(Date.UTC(2026, 10, 16, 10, n, a)).toISOString(),
  grovshot: g.shot ? { runId: uuid(999), shot: g.shot, price: 1 } : null,
})));
const keyOf = new Map(GENS.map((g) => [g.id, g.key]));
const refUrl = (g: Gen, i: number) => svg(`${g.key} ref ${i + 1}`, 200 + i * 20);
function sourcesOf(g: Gen) {
  const refs = Array.from({ length: g.known ? g.refs : 0 }, (_, i) => refUrl(g, i));
  return {
    ok: true, known: g.known,
    references: g.repeat ? [refs[0], refs[0], ...refs.slice(1)] : refs,
    inspirations: Array.from({ length: g.insp }, (_, i) => svg(`${g.key} insp ${i + 1}`, 30 + i * 20)),
    marked: null, retouched: [],
  };
}
/** What the section must show for a generation (each photo once). */
const expectedThumbs = (g: Gen) => {
  const all = [...new Set([...sourcesOf(g).references, ...sourcesOf(g).inspirations])];
  return all.length > 4 ? all.slice(0, 3) : all;
};

/* ── the browser ───────────────────────────────────────────────────────── */

type Snap = {
  cur: string; count: number; gen: string | null; status: string | null; labels: number; thumbs: string[];
  more: string | null; text: string; tops: number[]; skeletons: number; modals: number;
};
function findChromium(): string | null {
  if (process.env.PREVIEW_CHROMIUM && existsSync(process.env.PREVIEW_CHROMIUM)) return process.env.PREVIEW_CHROMIUM;
  const base = "/opt/pw-browsers";
  if (!existsSync(base)) return null;
  const shells = readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const d of shells) {
    for (const sub of ["chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
      if (existsSync(`${base}/${d}/${sub}`)) return `${base}/${d}/${sub}`;
    }
  }
  return existsSync(`${base}/chromium`) ? `${base}/chromium` : null;
}

async function main() {
  const esbuild = await import("esbuild");
  type PW = typeof import("playwright");
  const mod = (process.env.PLAYWRIGHT_MODULE ? await import(process.env.PLAYWRIGHT_MODULE) : await import("playwright")) as PW & { default?: PW };
  const pw = (mod.chromium ? mod : mod.default ?? mod) as PW;
  const bundle = async (mode: "production" | "development") => (await esbuild.build({
    entryPoints: ["scripts/stubs/preview-sources-harness.tsx"],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false, logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify(mode) },
    banner: { js: `var process = { env: { NODE_ENV: ${JSON.stringify(mode)} } };` },
    alias: {
      "next/link": "./scripts/stubs/next-link.tsx",
      "next/navigation": "./scripts/stubs/preview-sources-stubs.ts",
      "@/lib/supabase/client": "./scripts/stubs/preview-sources-stubs.ts",
      "@/app/actions/feedback": "./scripts/stubs/preview-sources-stubs.ts",
      "@/lib/inflight/store": "./scripts/stubs/preview-sources-stubs.ts",
      "@": ".",
    },
  })).outputFiles[0].text;
  const js = { production: await bundle("production"), development: await bundle("development") };
  const css = existsSync(".next/static/css") ? readdirSync(".next/static/css").filter((f) => f.endsWith(".css")) : [];

  const engines = (process.env.PREVIEW_ENGINES ?? "chromium").split(",").map((s) => s.trim()).filter(Boolean) as ("chromium" | "webkit")[];
  for (const engine of engines) {
    let browser: Awaited<ReturnType<PW["chromium"]["launch"]>>;
    try {
      browser = await pw[engine].launch();
    } catch (e) {
      const exe = engine === "chromium" ? findChromium() : null;
      if (!exe) { skip(`${engine}: every flow`, `no ${engine} build for this Playwright (${String(e).split("\n")[0].slice(0, 120)})`); continue; }
      browser = await pw.chromium.launch({ executablePath: exe });
    }
    await flows(engine, browser);
    await browser.close();
  }

  async function flows(engine: string, browser: Awaited<ReturnType<PW["chromium"]["launch"]>>) {
    const ORIGIN = "http://preview.test";
    let requests: string[] = [];
    let inFlight = 0;
    let delayFor: (key: string) => number = () => 20;
    const holds = new Map<string, Promise<void>>();

    async function open(o: { mode?: "production" | "development"; mobile?: boolean; dark?: boolean } = {}) {
      requests = []; inFlight = 0; delayFor = () => 20; holds.clear();
      const context = await browser.newContext(o.mobile
        ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: engine !== "firefox", hasTouch: true, colorScheme: o.dark ? "dark" : "light" }
        : { viewport: { width: 1280, height: 900 }, colorScheme: o.dark ? "dark" : "light" });
      const page = await context.newPage();
      const errors: string[] = [];
      const keyWarnings: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (/same key|two children with the same key/i.test(m.text())) keyWarnings.push(m.text().slice(0, 200)); });
      await page.route(`${ORIGIN}/**`, async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/") {
          return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html lang="pl"${o.dark ? ' class="dark"' : ""}><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
            ${css.map((f) => `<link rel="stylesheet" href="/css/${f}">`).join("")}</head>
            <body class="bg-canvas text-ink"><div id="root"></div>
            <script>window.__fx = ${JSON.stringify({ items: ITEMS, dict: pl })};</script><script src="/app.js"></script></body></html>` });
        }
        if (url.pathname === "/app.js") return route.fulfill({ contentType: "text/javascript; charset=utf-8", body: js[o.mode ?? "production"] });
        if (url.pathname.startsWith("/css/")) return route.fulfill({ path: `.next/static/css/${url.pathname.slice(5)}`, contentType: "text/css" });
        if (url.pathname === "/api/preview/actions") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ enabled: false }) });
        if (url.pathname === "/api/generations/sources") {
          const g = GENS.find((x) => x.id === url.searchParams.get("generationId"));
          const key = g?.key ?? "?";
          requests.push(key);
          inFlight++;
          try {
            await new Promise((r) => setTimeout(r, delayFor(key)));
            const hold = holds.get(key);
            if (hold) await hold;
            if (!g) return await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false }) });
            return await route.fulfill({ contentType: "application/json", body: JSON.stringify(sourcesOf(g)) });
          } finally { inFlight--; }
        }
        return route.fulfill({ status: 404, body: "" });
      });
      await page.goto(`${ORIGIN}/`);
      await page.waitForSelector("[data-sources]", { timeout: 15_000 });
      const snap = () => page.evaluate(() => {
        const w = window as unknown as { __h: { index: number }; __fx: { items: { generationId: string }[] } };
        const secs = [...document.querySelectorAll("[data-sources]")] as HTMLElement[];
        const s = secs[0];
        return {
          cur: w.__fx.items[w.__h.index].generationId, count: secs.length, gen: s?.getAttribute("data-sources-gen") ?? null,
          status: s?.getAttribute("data-sources-status") ?? null, labels: document.querySelectorAll("[data-sources-label]").length,
          thumbs: secs.flatMap((x) => [...x.querySelectorAll("[data-source-thumb] img")].map((i) => i.getAttribute("src") ?? "")),
          more: s?.querySelector("[data-source-more]")?.textContent ?? null, text: s?.innerText ?? "",
          tops: [...(s?.querySelectorAll("[data-source-thumb], [data-source-more]") ?? [])].map((e) => Math.round(e.getBoundingClientRect().top)),
          skeletons: secs.reduce((n, x) => n + x.querySelectorAll(".skeleton").length, 0),
          modals: document.querySelectorAll("[data-details-modal]").length,
        } as Snap;
      });
      const settle = async () => {
        for (let i = 0; i < 400; i++) {
          if (inFlight === 0) {
            const s = await snap();
            if (s.status !== "loading") return s;
          }
          await page.waitForTimeout(15);
        }
        return snap();
      };
      const index = () => page.evaluate(() => (window as unknown as { __h: { index: number } }).__h.index);
      /** Wait until the view shows image `n` (a state set from outside React renders a tick later). */
      const shown = (n: number) => page.waitForFunction((k) => (window as unknown as { __h: { index: number } }).__h.index === k, n, { timeout: 5_000 });
      /** Jump to the first image of a generation, as the grid would. */
      const goTo = async (key: string) => {
        const i = ITEMS.findIndex((x) => keyOf.get(x.generationId) === key);
        await page.evaluate((k) => (window as unknown as { __h: { setIndex: (i: number) => void } }).__h.setIndex(k), i);
        await shown(i);
      };
      return { context, page, snap, settle, index, shown, goTo, errors, keyWarnings };
    }

    /** The invariant, one image: one section, the image's own generation, its own photos. */
    const exact = (s: Snap) => {
      const g = GENS.find((x) => x.id === s.cur)!;
      const want = expectedThumbs(g);
      return s.count === 1 && s.gen === s.cur && s.labels === 1 && s.status === "ready"
        && s.thumbs.length === want.length && s.thumbs.every((t, i) => t === want[i]);
    };
    const brief = (s: Snap) => ({ cur: keyOf.get(s.cur), count: s.count, gen: s.gen && keyOf.get(s.gen), status: s.status, thumbs: s.thumbs.length, labels: s.labels });

    section(`P. ${engine.toUpperCase()} · DESKTOP`);
    {
      const { context, page, settle, snap, index, shown, goTo, errors } = await open();
      // P1 — a walk through every image, forward, then all the way back.
      const bad: unknown[] = [];
      let steps = 0;
      let s = await settle();
      if (!exact(s)) bad.push(brief(s));
      for (let i = 1; i < ITEMS.length; i++) {
        await page.keyboard.press("ArrowRight");
        await shown(i).catch(() => {});
        s = await settle();
        steps++;
        if (!exact(s) || (await index()) !== i) bad.push({ step: i, ...brief(s) });
      }
      check(`P1 forward through all ${ITEMS.length} images (${steps} moves, ${GENS.length} generations, 6 products): one section, the image's own photos, every time`, bad.length === 0 && steps >= 30, bad.slice(0, 4));
      const back: unknown[] = [];
      for (let i = ITEMS.length - 2; i >= 0; i--) {
        await page.keyboard.press("ArrowLeft");
        await shown(i).catch(() => {});
        s = await settle();
        if (!exact(s) || (await index()) !== i) back.push({ step: i, ...brief(s) });
      }
      check("P2 …and all the way back: the same, A after C shows A's photos again", back.length === 0, back.slice(0, 4));
      const perGen = new Map<string, number>();
      for (const k of requests) perGen.set(k, (perGen.get(k) ?? 0) + 1);
      check("P3 cache and dedupe kept: one request per generation over both walks", [...perGen.values()].every((n) => n === 1) && perGen.size === GENS.length, Object.fromEntries(perGen));

      // P4 — the cases: none recorded as none, unknown, more than four, a repeated photo, GrovShot shots.
      const at = async (key: string) => { await goTo(key); return settle(); };
      const g4 = await at("G4");
      check("P4 a generation without references says so, in the one section", exact(g4) && g4.text.includes("Ta generacja nie używała zdjęć referencyjnych."), brief(g4));
      const g6 = await at("G6");
      check("P5 an older generation with nothing recorded: the „no data” message, nothing guessed", exact(g6) && g6.text.includes("Brak zapisanych danych o zdjęciach referencyjnych"), brief(g6));
      const g5 = await at("G5");
      check("P6 seven sources: one row of three photos + „+4”", exact(g5) && g5.more === "+4" && new Set(g5.tops).size === 1 && g5.tops.length === 4, { ...brief(g5), more: g5.more, tops: g5.tops });
      const g15 = await at("G15");
      check("P7 the same photo sent twice is one tile (no duplicate)", exact(g15) && g15.thumbs.length === 3 && new Set(g15.thumbs).size === 3, brief(g15));
      const shots: unknown[] = [];
      for (let k = 7; k <= 12; k++) {
        const x = await at(`G${k}`);
        const g = GENS[k - 1];
        if (!exact(x) || x.thumbs.length !== g.refs || !x.thumbs.every((t) => t.includes(encodeURIComponent(`${g.key} ref`)))) shots.push(brief(x));
      }
      check("P8 GrovShot: each shot of one product shows ITS references (1–3 each), never the order's whole set", shots.length === 0, shots);

      // P9 — the input-photo lightbox: opens on the photo, Escape closes it and only it.
      await at("G3");
      await page.locator("[data-source-thumb]").nth(1).click();
      const lightboxSrc = await page.locator('[data-sources] [role="dialog"] img').first().getAttribute("src");
      await page.keyboard.press("Escape");
      const after = await snap();
      check("P9 zoom on an input photo shows that photo; Escape closes only the zoom", lightboxSrc === refUrl(GENS[2], 1)
        && (await page.locator('[data-sources] [role="dialog"]').count()) === 0 && after.modals === 1 && exact(after));

      // P10 — close and reopen.
      await page.keyboard.press("Escape");
      const closed = await snap().catch(() => null);
      await page.click("[data-reopen]");
      const reopened = await settle();
      check("P10 close and reopen: still one section, the same image's photos, no new request", closed?.count === 0 && exact(reopened) && requests.filter((k) => k === "G3").length === 1, { closed: closed?.count, reopened: brief(reopened) });
      check("P11 no page error", errors.length === 0, errors);
      await context.close();
    }

    section(`Q. ${engine.toUpperCase()} · SLOW AND OUT OF ORDER`);
    {
      const { context, page, settle, snap, errors } = await open();
      // Q1 — every answer 0–900 ms, arrows faster than the network, both ways.
      let seed = 7;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      delayFor = () => Math.floor(rnd() * 900);
      const bad: unknown[] = [];
      for (let i = 0; i < 70; i++) {
        await page.keyboard.press(rnd() < 0.65 ? "ArrowRight" : "ArrowLeft");
        if (rnd() < 0.5) await page.waitForTimeout(Math.floor(rnd() * 120));
        const s = await snap();
        // Mid-flight: the section may be loading, but it is ONE and it is the current image's.
        if (s.count !== 1 || s.gen !== s.cur || s.labels !== 1) bad.push({ i, ...brief(s) });
        if (s.status === "ready" && !exact(s)) bad.push({ i, painted: brief(s) });
        if (s.status === "loading" && s.thumbs.length > 0) bad.push({ i, loadingWithPhotos: brief(s) });
      }
      const end = await settle();
      check("Q1 70 fast moves both ways, answers 0–900 ms out of order: one section, current generation, at every moment", bad.length === 0 && exact(end), bad.slice(0, 4));

      // Q2 — a held answer for an image already left behind. A fresh page, so
      // nothing is cached yet.
      await context.close();
      const second = await open();
      let release!: () => void;
      holds.set("G13", new Promise<void>((r) => { release = r; }));
      const go2 = second.goTo;
      await go2("G13");
      await second.page.waitForTimeout(80);
      const loading = await second.snap();
      const g13 = GENS[12];
      check("Q2 while an answer is on the way: ONE section, one row of skeletons only, for the image on screen",
        loading.count === 1 && loading.gen === g13.id && loading.status === "loading" && loading.thumbs.length === 0 && loading.skeletons === Math.min(g13.refs, 4), { ...brief(loading), skeletons: loading.skeletons });
      await go2("G14");
      const g14 = await second.settle().catch(() => second.snap());
      release();
      await second.page.waitForTimeout(150);
      const later = await second.snap();
      check("Q3 the late answer for the image left behind never paints over the current one", exact(g14) && exact(later) && later.gen === GENS[13].id, { now: brief(g14), later: brief(later) });
      await go2("G13");
      const back = await second.settle();
      check("Q4 …and it was kept: back on that image, its photos at once, no second request", exact(back) && requests.filter((k) => k === "G13").length === 1, { back: brief(back), requests: requests.filter((k) => k === "G13").length });
      check("Q5 no page error", errors.length === 0 && second.errors.length === 0, [...errors, ...second.errors]);
      await second.context.close();
    }

    section(`M. ${engine.toUpperCase()} · PHONE (390 × 844, touch), LIGHT AND DARK`);
    for (const dark of [false, true]) {
      const { context, page, settle, shown, errors } = await open({ mobile: true, dark });
      const bad: unknown[] = [];
      let s = await settle();
      for (let i = 1; i <= 32; i++) {
        await page.locator('button[aria-label="Następny"]').tap();
        const moved = await shown(i).then(() => true, () => false);
        s = await settle();
        if (!moved || !exact(s)) bad.push({ i, moved, ...brief(s) });
      }
      for (let i = 31; i >= 24; i--) {
        await page.locator('button[aria-label="Poprzedni"]').tap();
        const moved = await shown(i).then(() => true, () => false);
        s = await settle();
        if (!moved || !exact(s)) bad.push({ back: i, moved, ...brief(s) });
      }
      check(`M${dark ? 2 : 1} ${dark ? "dark" : "light"}: 32 taps forward, 8 back — one „Zdjęcia wejściowe” row, the image's own photos`, bad.length === 0, bad.slice(0, 4));
      if (process.env.PREVIEW_SHOTS) await page.screenshot({ path: `${process.env.PREVIEW_SHOTS}/preview-${engine}-${dark ? "dark" : "light"}.png` });
      check(`M${dark ? 4 : 3} ${dark ? "dark" : "light"}: no page error`, errors.length === 0, errors);
      await context.close();
    }

    section(`D. ${engine.toUpperCase()} · DEVELOPMENT BUILD (React's own warnings on)`);
    {
      const { context, page, settle, shown, keyWarnings } = await open({ mode: "development" });
      for (let i = 1; i <= 16; i++) { await page.keyboard.press("ArrowRight"); await shown(i).catch(() => {}); await settle(); }
      check("D1 no „two children with the same key” across 16 moves", keyWarnings.length === 0, keyWarnings.slice(0, 2));
      await context.close();
    }
  }

  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
