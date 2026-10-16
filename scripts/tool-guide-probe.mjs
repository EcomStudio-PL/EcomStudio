/**
 * TOOL GUIDES — THE TUTORIAL DIALOG AND THE STARTER GALLERY, DRIVEN IN A REAL
 * BROWSER AGAINST A FAKE NETWORK.
 *
 * The customer side of a tool guide reaches the server three ways, and this
 * probe answers all three itself through Playwright `page.route`:
 *   GET  /api/tool-guides?tool=…   GuideResponse variants built here from the
 *                                  shipped dictionary copy (toolGuideDefaults)
 *                                  with pictures from /public
 *   GET  /api/generations?…        the gallery's refetch / load-more pages:
 *                                  empty, a few items, HTTP 500, delayed
 *   POST <page> + Next-Action      markToolTutorialSeenAction — counted, its
 *                                  body kept, answered 500 (the hook swallows it)
 * Every other /api/* call is answered 404 and any *.supabase.co request from
 * the browser is aborted and listed, so nothing is ever written anywhere.
 *
 * THE HARNESS (written into the CURRENT directory's app/probe-tmp/guide) mounts
 * the REAL components inside a copy of the (app) shell's frame and the real
 * `app` i18n scope (locale = the ecs_locale cookie, theme = next-themes):
 *   /probe-tmp/guide?kind=gallery&op=image_retouch    GenerationGallery (Retusz)
 *   …&op=ecommerce_thumbnail | …&op=fashion_flat_lay  other tool galleries
 *   /probe-tmp/guide?kind=gallery&gt=generator        no operation, `guideTool` prop
 *   /probe-tmp/guide?kind=gallery                     no operation, no tool (no guide)
 *   …&items=3 | …&cursor=c1                           initial items | a page left to load
 *   /probe-tmp/guide?kind=compress | ?kind=resize     the batch workbenches
 *   /probe-tmp/guide?kind=photo&photo=remove_bg       PhotoToolWorkspace
 *   …&available=0                                     the tool cannot run
 *
 * The feature may be uncommitted, so COPY the working tree (no worktree):
 *   SCRATCH=<dir>; mkdir -p $SCRATCH/tgprobe
 *   rsync -a --exclude node_modules --exclude .next --exclude .git <repo>/ $SCRATCH/tgprobe/
 *     (or: tar -C <repo> --exclude=./node_modules --exclude=./.next --exclude=./.git -cf - . | tar -C $SCRATCH/tgprobe -xf -)
 *   ln -s <repo>/node_modules $SCRATCH/tgprobe/node_modules
 *   (cd $SCRATCH/tgprobe && node <repo>/scripts/tool-guide-probe.mjs --harness)
 *   (cd $SCRATCH/tgprobe && npx next dev -p 3321) &        # remember the PID
 *   TG_PROBE_SHOTS=$SCRATCH/shots node <repo>/scripts/tool-guide-probe.mjs http://127.0.0.1:3321
 *   kill <PID>
 *   (cd $SCRATCH/tgprobe && node <repo>/scripts/tool-guide-probe.mjs --clean)
 *
 * Env: TG_PROBE_SHOTS (screenshot dir), TG_PROBE_CHROME (browser binary),
 * TG_PROBE_ONLY (comma list of check groups to run, e.g. "1,2,9,P").
 */
import fs from "node:fs";
import { chromium } from "playwright";
import sharp from "sharp";

const DIR = "app/probe-tmp/guide";

/* ── harness sources (no template literals inside: they live in one) ───── */

const PAGE_SRC = `import { getScopedDictionary } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/provider";
import { Harness } from "./harness";

export const dynamic = "force-dynamic";

/** Tool-guide probe harness (scripts/tool-guide-probe.mjs). Not part of the app. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  // The signed-in app's own share of the dictionary, as app/(app)/layout.tsx adds it.
  const { dict } = await getScopedDictionary("app");
  return (
    <I18nScope dict={dict}>
      <Harness
        kind={q.kind ?? "gallery"}
        op={q.op ?? null}
        guideTool={q.gt ?? null}
        items={Number(q.items ?? "0") || 0}
        cursor={q.cursor ?? null}
        available={q.available !== "0"}
        photo={q.photo ?? "remove_bg"}
      />
    </I18nScope>
  );
}
`;

const HARNESS_SRC = `"use client";
import { useState, type ReactNode } from "react";
import { GenerationGallery } from "@/components/genv3/gallery";
import { CompressWorkbench } from "@/components/tools/compress-workbench";
import { ResizeWorkbench } from "@/components/tools/resize-workbench";
import { PhotoToolWorkspace } from "@/components/tools/photo-tool";
import type { GalleryItem } from "@/components/genv3/types";
import type { GuideToolKey } from "@/lib/tool-guides";
import type { PhotoToolSlug } from "@/lib/images/tools";
import { cn } from "@/lib/utils";

/** Each tool page's own column split (components/retouch/workspace.tsx,
 *  genv3/workspace.tsx, fashion/tool-workspace.tsx). */
const COLS = {
  generator: "lg:grid-cols-[clamp(420px,29vw,470px)_minmax(0,1fr)]",
  fashion: "lg:grid-cols-[clamp(300px,23vw,330px)_minmax(0,1fr)]",
  tool: "lg:grid-cols-[clamp(380px,27vw,430px)_minmax(0,1fr)]",
};

function item(i: number, op: string | null): GalleryItem {
  return {
    generationId: "g-" + i, assetId: "a-" + i, path: "probe/" + i + ".webp",
    url: "/showcase/moda-ghost.webp", thumbUrl: "/showcase/moda-ghost.webp",
    width: 340, height: 425, ratio: "4:5", resolution: null, quality: null,
    quantity: 1, credits: 1, latencyMs: null, referenceCount: 0, inspirationCount: 0,
    operation: op, model: "Probe", modelId: null, product: "Produkt " + i,
    sessionType: null, origin: null, prompt: null, favorite: false, note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The (app) shell's frame: app/(app)/layout.tsx main + the tool page's
 *  workspace ground (app/(app)/retusz/page.tsx). */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell flex min-h-dvh w-full min-w-0 flex-col" data-probe-shell>
      <header className="flex shrink-0 items-center border-b border-line px-4 text-[13px] font-semibold" style={{ height: "var(--header-h)" }}>
        GrovBase · probe
      </header>
      <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pt-4 pb-[var(--page-bottom)] sm:px-6 sm:pt-5 lg:px-8 lg:pb-14 lg:pt-6 xl:px-10">
        <div className="workspace workspace-page gen-shell pt-1">{children}</div>
      </main>
    </div>
  );
}

export function Harness({ kind, op, guideTool, items, cursor, available, photo }: {
  kind: string; op: string | null; guideTool: string | null; items: number;
  cursor: string | null; available: boolean; photo: string;
}) {
  const [fresh, setFresh] = useState<GalleryItem[]>([]);
  const [balance, setBalance] = useState(100);
  const [initial] = useState(() => Array.from({ length: items }, (_, i) => item(i + 1, op)));

  if (kind === "compress") return <Shell><CompressWorkbench available={available} credits={1} reason="ok" balance={100} /></Shell>;
  if (kind === "resize") return <Shell><ResizeWorkbench available={available} credits={1} reason="ok" balance={100} /></Shell>;
  if (kind === "photo") {
    return (
      <Shell>
        <PhotoToolWorkspace tool={photo as PhotoToolSlug} workspaceId="00000000-0000-4000-8000-000000000001"
          available={available} reason={available ? "ok" : "maintenance"} environment="live" credits={1}
          freeWhenTransparent={false} balance={100} presets={[]} initialItems={[]} initialCursor={cursor} />
      </Shell>
    );
  }
  const cols = guideTool === "generator" || guideTool === "prompts" ? COLS.generator
    : op && op.startsWith("fashion_") ? COLS.fashion : COLS.tool;
  return (
    <Shell>
      <div className={cn("gen-shell-body relative grid min-w-0 items-start gap-5 [&>*]:min-w-0 lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0", cols)}>
        <div className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0">
          <div className="panel rounded-2xl p-5" style={{ minHeight: 420 }} data-probe-left>
            <p className="text-[13px] font-semibold">Panel narzędzia (probe)</p>
            <p className="mt-2 text-[12px] text-muted">Ustawienia narzędzia stoją tutaj.</p>
          </div>
        </div>
        <div className="thin-scroll min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4 lg:pr-1" data-probe-right>
          <GenerationGallery initialItems={initial} initialCursor={cursor} freshItems={fresh} onFresh={setFresh}
            pendingCount={0} pendingRatio="1:1" models={[]} balance={balance} onBalance={setBalance}
            onAbsorb={async () => undefined} operation={op ?? undefined}
            guideTool={(guideTool ?? undefined) as GuideToolKey | undefined} />
        </div>
      </div>
    </Shell>
  );
}
`;

if (process.argv.includes("--harness")) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${DIR}/page.tsx`, PAGE_SRC);
  fs.writeFileSync(`${DIR}/harness.tsx`, HARNESS_SRC);
  console.log(`harness written to ${process.cwd()}/${DIR}`);
  process.exit(0);
}
if (process.argv.includes("--clean")) {
  fs.rmSync(DIR, { recursive: true, force: true });
  if (fs.existsSync("app/probe-tmp") && fs.readdirSync("app/probe-tmp").length === 0) fs.rmSync("app/probe-tmp", { recursive: true });
  console.log("harness removed");
  process.exit(0);
}

/* ── setup ─────────────────────────────────────────────────────────────── */

const BASE = (process.argv[2] ?? "http://127.0.0.1:3321").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const SHOTS = process.env.TG_PROBE_SHOTS ?? null;
const CHROME = process.env.TG_PROBE_CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ONLY = process.env.TG_PROBE_ONLY ? new Set(process.env.TG_PROBE_ONLY.split(",").map((s) => s.trim())) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const LOCALES = ["pl", "en", "de"];
const DICT = Object.fromEntries(LOCALES.map((l) => [l,
  JSON.parse(fs.readFileSync(new URL(`../lib/i18n/dictionaries/${l}.json`, import.meta.url), "utf8"))]));
const TG = (l, k) => DICT[l].toolGuide[k];
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));

const VP = {
  390: { name: "390", width: 390, height: 844, touch: true },
  834: { name: "834", width: 834, height: 1112, touch: false },
  1440: { name: "1440", width: 1440, height: 900, touch: false },
};
const WIDTHS = [390, 834, 1440];
const THEMES = ["light", "dark"];

/** lib/tool-guides.ts DEFAULT_STEP_ARTS (the tools this probe mounts). */
const ARTS = {
  generator: ["upload", "inspiration", "prompt", "settings", "result"],
  retouch: ["upload", "settings", "format", "result"],
  ecommerce_thumbnail: ["order", "retouch", "generate", "result"],
  fashion_flat_lay: ["garment", "settings", "result"],
  tool_remove_bg: ["upload", "background", "generate", "compare"],
  resize: ["upload", "resize", "generate", "download"],
  compress: ["upload", "compress", "generate", "download"],
};
const IMG = {
  wide: { url: "/launch/hero-dino.webp", width: 1808, height: 1152, alt: "" },
  tall: { url: "/showcase/moda-ghost.webp", width: 340, height: 425, alt: "" },
  square: { url: "/brand/app-icon.png", width: 1024, height: 1024, alt: "" },
  banner: { url: "/brand/logo-on-light.png", width: 922, height: 200, alt: "" },
};
/** Step pictures: a landscape photo, the drawn art, a portrait photo, a square. */
const STEP_IMAGES = [IMG.wide, null, IMG.tall, IMG.square, null, null];

const LONG_SEED = {
  pl: "Ten krok ma celowo bardzo długi opis, żeby sprawdzić, czy okno samouczka zachowuje tę samą wysokość na każdym kroku i nic nie skacze.",
  en: "This step deliberately carries a very long description, to check that the tutorial window keeps the same height on every single step.",
  de: "Dieser Schritt hat absichtlich eine sehr lange Beschreibung, um zu prüfen, ob das Fenster der Anleitung auf jedem Schritt gleich hoch bleibt.",
};
/** ~400 characters (GUIDE_LIMITS.stepBody), cut at a word. */
function longText(l) {
  let s = "";
  while (s.length < 420) s += (s ? " " : "") + LONG_SEED[l];
  s = s.slice(0, 399);
  return s.slice(0, s.lastIndexOf(" ")) + ".";
}

/** A GuideResponse (+ ok) for `tool` in `locale`, from the shipped default copy. */
function guideFor(tool, locale = "pl", o = {}) {
  const d = DICT[locale].toolGuideDefaults[tool];
  const steps = ARTS[tool].map((art, i) => ({
    title: d.tutorial.steps[`s${i + 1}`].title,
    body: d.tutorial.steps[`s${i + 1}`].body,
    art,
    image: o.noStepImages ? null : STEP_IMAGES[i] ?? null,
  }));
  if (o.longBody) steps[2].body = longText(locale);
  if (o.emptyBody !== undefined) steps[o.emptyBody].body = "";
  return {
    ok: true,
    guide: o.noGuide ? null : {
      tool,
      version: o.version ?? 1,
      tutorial: o.noTutorial ? null : { title: d.tutorial.title, body: d.tutorial.body, steps },
      starter: o.noStarter ? null : {
        title: d.starter.title, body: d.starter.body,
        image: o.starterImage === undefined ? IMG.wide : o.starterImage,
      },
    },
    seen: o.seen ?? 0,
    live: o.live ?? true,
    hasResults: o.hasResults === undefined ? false : o.hasResults,
  };
}

const URLS = {
  retouch: "/probe-tmp/guide?kind=gallery&op=image_retouch",
  thumbnail: "/probe-tmp/guide?kind=gallery&op=ecommerce_thumbnail",
  flatlay: "/probe-tmp/guide?kind=gallery&op=fashion_flat_lay",
  generator: "/probe-tmp/guide?kind=gallery&gt=generator",
  bare: "/probe-tmp/guide?kind=gallery",
  compress: "/probe-tmp/guide?kind=compress",
  resize: "/probe-tmp/guide?kind=resize",
  photo: "/probe-tmp/guide?kind=photo&photo=remove_bg",
};

const DLG = '[data-tool-tutorial] [role="dialog"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 10000, step = 40) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(step);
  }
  return Boolean(await fn());
}

/* ── bookkeeping ───────────────────────────────────────────────────────── */

const GROUPS = [
  ["1", "first visit: auto-open once, one POST, reload seen=1"],
  ["2", "auto-open rules (live / hasResults / seen / version)"],
  ["3", "deferred behind another dialog / the visual editor"],
  ["4", "navigation (counter, progressbar, back/next/start/skip) PL/EN/DE"],
  ["5", "closing: X, Pomiń, Escape (+after illustration click), scrim; no reopen"],
  ["6", "manual reopen: step 1, no POST, focus back to the button"],
  ["7", "focus trap, aria-labelledby/-describedby, body scroll lock"],
  ["8", "dialog height identical on every step"],
  ["9", "layout 390/834/1440 × light/dark × pl/en/de"],
  ["10", "independent state per tool, right tool key per mount"],
  ["11", "starter gallery: content, picture geometry, no controls"],
  ["12", "starter gallery: every case it must stay hidden"],
  ["13", "[data-gallery-toolbar] one row ≤56px with the guide button"],
  ["14", "Compress / Resize workbench"],
  ["15", "starter screenshots light/dark × 3 widths"],
  ["P", "PhotoToolWorkspace (tool_remove_bg)"],
  ["N", "network: nothing written, nothing reaches Supabase from the browser"],
  ["C", "console: no unexpected errors / page errors"],
];
const results = new Map(GROUPS.map(([id]) => [id, { pass: 0, fail: [] }]));
const shots = [];
function check(id, name, cond, detail) {
  const r = results.get(String(id));
  if (cond) { r.pass++; console.log(`  ✓ ${id}. ${name}`); }
  else {
    const d = detail === undefined ? "" : typeof detail === "string" ? detail : JSON.stringify(detail);
    r.fail.push(`${name}${d ? ` — ${d}` : ""}`);
    console.error(`  ✗ ${id}. ${name}${d ? ` — ${d}` : ""}`);
  }
  return Boolean(cond);
}
const info = (id, text) => console.log(`  · ${id}. ${text}`);

/** Every page's network + console record, for groups N and C. */
const allPages = [];
const consoleExpected = [
  // our own mocked answers
  /Failed to load resource: the server responded with a status of (500|404)/,
  /Failed to load resource: net::ERR_FAILED/,
  // dev tooling, and the dev server forwarding its own sandbox-only logs (no
  // Supabase here: the copy overrides and the redirect table cannot load)
  /Download the React DevTools/, /\[Fast Refresh\]/, /\[HMR\]/,
  /content-overrides: read failed/, /\[redirects\] load failed/,
];

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

/** In every page: hide `next dev`'s tools bubble, count tutorial mounts, and
 *  remember (per animation frame) whether the starter or the plain empty
 *  state was EVER painted. */
const INIT = () => {
  window.__tg = { opens: 0, starterAt: null, emptyVisibleAt: null };
  const hide = () => {
    if (document.getElementById("probe-hide-next-dev")) return;
    const st = document.createElement("style");
    st.id = "probe-hide-next-dev";
    st.textContent = "nextjs-portal{display:none!important;pointer-events:none!important}";
    document.documentElement.appendChild(st);
  };
  const arm = () => {
    hide();
    new MutationObserver(hide).observe(document.documentElement, { childList: true });
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && (n.matches("[data-tool-tutorial]") || n.querySelector("[data-tool-tutorial]"))) window.__tg.opens++;
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    const sample = () => {
      const t = performance.now();
      if (window.__tg.starterAt === null && document.querySelector("[data-starter-gallery]")) window.__tg.starterAt = t;
      const e = document.querySelector("[data-gallery-empty]");
      if (window.__tg.emptyVisibleAt === null && e && getComputedStyle(e).visibility !== "hidden") window.__tg.emptyVisibleAt = t;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  };
  if (document.documentElement) arm(); else document.addEventListener("DOMContentLoaded", arm);
};

async function newContext(vp, theme, locale) {
  const ctx = await browser.newContext({
    // bypassCSP: `next dev` evaluates its modules, which the app's CSP
    // (script-src without 'unsafe-eval') forbids — production bundles do not.
    viewport: { width: vp.width, height: vp.height }, colorScheme: theme, bypassCSP: true,
    hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 1,
  });
  await ctx.addCookies([{ name: "ecs_locale", value: locale, url: BASE }]);
  await ctx.addInitScript((th) => { try { localStorage.setItem("theme", th); } catch { /* private mode */ } }, theme);
  await ctx.addInitScript(INIT);
  return ctx;
}

const EMPTY_PAGE = { ok: true, items: [], nextCursor: null };
const genItems = (n, op, from = 100) => Array.from({ length: n }, (_, i) => ({
  generationId: `g-${from + i}`, assetId: `a-${from + i}`, path: `probe/${from + i}.webp`,
  url: "/showcase/grovshot-studio.webp", thumbUrl: "/showcase/grovshot-studio.webp",
  width: 340, height: 425, ratio: "4:5", resolution: null, quality: null, quantity: 1, credits: 1,
  latencyMs: null, referenceCount: 0, inspirationCount: 0, operation: op, model: "Probe", modelId: null,
  product: `Mock ${from + i}`, sessionType: null, origin: null, prompt: null, favorite: false, note: null,
  createdAt: "2026-01-02T00:00:00.000Z",
}));

async function handle(P, route) {
  const req = route.request();
  let u;
  try { u = new URL(req.url()); } catch { return route.fallback(); }
  try {
    if (req.method() === "POST" && req.headers()["next-action"]) {
      P.rec.actions.push({ path: u.pathname + u.search, body: req.postData() ?? "", at: Date.now() });
      return await route.fulfill({ status: 500, contentType: "text/plain", body: "probe: server action not served" });
    }
    if (u.hostname.endsWith("supabase.co") || u.hostname.endsWith("supabase.in")) {
      P.rec.supabase.push(`${req.method()} ${u.hostname}${u.pathname}`);
      return await route.abort();
    }
    if (u.origin !== ORIGIN) { P.rec.external.push(`${req.method()} ${u.href}`); return await route.abort(); }
    if (u.pathname === "/api/tool-guides") {
      P.rec.guideReqs.push(u.searchParams.get("tool"));
      if (P.gate) await P.gate;
      if (P.guideDelay) await sleep(P.guideDelay);
      const body = typeof P.guide === "function" ? P.guide(u.searchParams.get("tool")) : P.guide;
      if (P.guideStatus !== 200 || !body) await route.fulfill({ status: P.guideStatus === 200 ? 500 : P.guideStatus, json: { ok: false, error: "probe" } });
      else await route.fulfill({ status: 200, json: body, headers: { "cache-control": "no-store" } });
      P.rec.guideServed++;
      return;
    }
    if (u.pathname === "/api/generations") {
      P.rec.gen.push(u.search);
      const r = P.gen(u) ?? {};
      if (r.delay) await sleep(r.delay);
      await route.fulfill({ status: r.status ?? 200, json: r.json ?? EMPTY_PAGE });
      P.rec.genServed++;
      return;
    }
    if (u.pathname.startsWith("/api/")) {
      P.rec.api.push(`${req.method()} ${u.pathname}${u.search}`);
      return await route.fulfill({ status: 404, json: { ok: false, error: "probe_not_served" } });
    }
    if (req.method() !== "GET" && req.method() !== "HEAD") P.rec.otherWrites.push(`${req.method()} ${u.pathname}`);
    return await route.fallback();
  } catch { /* page closed while a held answer waited */ }
}

async function openPage(o) {
  const vp = o.vp ?? VP[1440];
  const theme = o.theme ?? "light";
  const locale = o.locale ?? "pl";
  const ownCtx = !o.ctx;
  const ctx = o.ctx ?? await newContext(vp, theme, locale);
  const page = await ctx.newPage();
  const P = {
    ctx, page, vp, theme, locale, ownCtx, label: o.label ?? o.url,
    guide: o.guide, gen: o.gen ?? (() => ({ json: EMPTY_PAGE })), gate: o.gate ?? null,
    guideDelay: o.guideDelay ?? 0, guideStatus: o.guideStatus ?? 200,
    rec: { guideReqs: [], guideServed: 0, gen: [], genServed: 0, actions: [], supabase: [], external: [], api: [], otherWrites: [], console: [], errors: [] },
  };
  allPages.push(P);
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") P.rec.console.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => P.rec.errors.push(String(e?.stack ?? e).slice(0, 400)));
  await page.route("**/*", (route) => handle(P, route));
  if (o.url) await go(P, o.url, o.waitGuide ?? true);
  return P;
}
async function go(P, url, waitGuide = true) {
  await P.page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 180000 });
  if (waitGuide) await guideSettled(P);
  else await P.page.waitForLoadState("load").catch(() => {});
}
/** Every guide request answered (dev StrictMode asks twice) and painted. */
async function guideSettled(P, timeout = 60000) {
  await until(() => P.rec.guideReqs.length > 0, timeout);
  await sleep(250);
  await until(() => P.rec.guideServed >= P.rec.guideReqs.length, timeout);
  await sleep(450);
}
const closeP = (P) => (P.ownCtx ? P.ctx.close() : P.page.close()).catch(() => {});

async function shot(page, name) {
  if (!SHOTS) return;
  const file = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: file }).then(() => shots.push(file)).catch(() => {});
}
async function press(P, locator) {
  if (P.vp.touch) await locator.tap();
  else await locator.click();
}
const dialogCount = (P) => P.page.locator(DLG).count();
async function waitDialog(P, timeout = 6000) {
  try { await P.page.locator(DLG).waitFor({ state: "visible", timeout }); await sleep(500); return true; }
  catch { return false; }
}
async function waitClosed(P, timeout = 2000) {
  return until(async () => (await dialogCount(P)) === 0, timeout);
}
const opens = (P) => P.page.evaluate(() => window.__tg?.opens ?? -1);
const counterText = (P) => P.page.locator("[data-guide-counter]").textContent().then((s) => s?.trim() ?? null).catch(() => null);

/** The dialog's geometry and every clipping question check 9 asks. */
const dialogGeom = (P) => P.page.evaluate(() => {
  const d = document.querySelector('[data-tool-tutorial] [role="dialog"]');
  if (!d) return null;
  const r = d.getBoundingClientRect();
  const scroller = d.querySelector(".thin-scroll");
  const name = (b) => b.hasAttribute("data-guide-next") ? "next:" + b.getAttribute("data-guide-next")
    : ["data-guide-skip", "data-guide-back", "data-guide-close"].find((a) => b.hasAttribute(a)) ?? b.tagName;
  const btns = [...d.querySelectorAll("[data-guide-skip],[data-guide-back],[data-guide-next],[data-guide-close]")].map((b) => {
    const br = b.getBoundingClientRect();
    const at = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
    return {
      k: name(b), text: b.textContent.trim(), vis: getComputedStyle(b).visibility, disabled: b.disabled,
      clipped: b.scrollWidth > b.clientWidth + 1,
      inView: br.left >= -0.5 && br.top >= -0.5 && br.right <= innerWidth + 0.5 && br.bottom <= innerHeight + 0.5,
      inDialog: br.left >= r.left - 0.5 && br.right <= r.right + 0.5 && br.top >= r.top - 0.5 && br.bottom <= r.bottom + 0.5,
      hit: Boolean(at && b.contains(at)),
    };
  });
  const cur = d.querySelector('section[aria-hidden="false"]');
  const texts = [d.querySelector("h2"), d.querySelector("p.overline"), cur?.querySelector("h3"), cur?.querySelector("p"), d.querySelector("[data-guide-counter]")]
    .filter(Boolean).map((e) => {
      const er = e.getBoundingClientRect();
      return { tag: e.tagName, text: e.textContent.trim().slice(0, 36), clipped: e.scrollWidth > e.clientWidth + 1, outside: er.right > r.right + 0.5 || er.left < r.left - 0.5 };
    });
  return {
    rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width },
    vw: innerWidth, vh: innerHeight,
    docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
    dlgOverflowX: d.scrollWidth > d.clientWidth + 1,
    scrollerOverflowX: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : null,
    scrollerScrollsY: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : null,
    scrollerOverflowY: scroller ? getComputedStyle(scroller).overflowY : null,
    btns, texts,
    counter: d.querySelector("[data-guide-counter]")?.textContent.trim() ?? null,
    now: d.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") ?? null,
    max: d.querySelector('[role="progressbar"]')?.getAttribute("aria-valuemax") ?? null,
    curStep: cur?.getAttribute("data-guide-step") ?? null,
  };
});
const dlgHeight = (P) => P.page.evaluate(() => document.querySelector('[data-tool-tutorial] [role="dialog"]')?.getBoundingClientRect().height ?? null);

/** The starter gallery: copy, picture box, painted picture, controls inside. */
const starterGeom = (P) => P.page.evaluate(() => {
  const s = document.querySelector("[data-starter-gallery]");
  if (!s) return null;
  const fig = s.querySelector("figure");
  const box = fig?.firstElementChild;
  const img = box?.querySelector("img") ?? null;
  const br = box?.getBoundingClientRect();
  const interactive = [...s.querySelectorAll("button, a, input, select, textarea, [role=button], [role=link], [tabindex]:not([tabindex='-1']), [contenteditable='true']")]
    .map((e) => e.tagName + (e.getAttribute("role") ? "[" + e.getAttribute("role") + "]" : ""));
  let im = null;
  if (img) {
    const ir = img.getBoundingClientRect();
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const fit = getComputedStyle(img).objectFit;
    const sc = fit === "contain" && nw && nh ? Math.min(ir.width / nw, ir.height / nh) : null;
    im = {
      src: img.getAttribute("src"), complete: img.complete, nw, nh, fit,
      elW: ir.width, elH: ir.height, paintedW: sc ? nw * sc : ir.width, paintedH: sc ? nh * sc : ir.height,
    };
  }
  return {
    badge: s.querySelector("[data-starter-badge]")?.textContent.trim() ?? null,
    title: s.querySelector("h2")?.textContent.trim() ?? null,
    body: s.querySelector("h2 + p")?.textContent.trim() ?? null,
    note: s.querySelector("figcaption")?.textContent.trim() ?? null,
    boxW: br?.width ?? 0, boxH: br?.height ?? 0,
    maxH: Math.min(innerHeight * 0.62, 560), vw: innerWidth,
    svg: Boolean(box?.querySelector("svg")), img: im, interactive,
    docOverflow: document.documentElement.scrollWidth > innerWidth,
    sRight: s.getBoundingClientRect().right,
  };
});
async function starterReady(P) {
  const loc = P.page.locator("[data-starter-gallery]");
  if ((await loc.count()) === 0) return false;
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await P.page.waitForFunction(() => {
    const img = document.querySelector("[data-starter-gallery] figure img");
    return !img || (img.complete && img.naturalWidth > 0);
  }, null, { timeout: 15000 }).catch(() => {});
  await sleep(150);
  return true;
}
const starterCount = (P) => P.page.locator("[data-starter-gallery]").count();
const emptyState = (P) => P.page.evaluate(() => {
  const e = document.querySelector("[data-gallery-empty]");
  return e ? { visible: getComputedStyle(e).visibility !== "hidden", text: e.textContent.trim().slice(0, 80) } : null;
});
const guideBtnCount = (P) => P.page.locator("[data-guide-open]").count();

/** The gallery toolbar's rows, height, and whether any two controls collide. */
const toolbarGeom = (P) => P.page.evaluate(() => {
  const tb = document.querySelector("[data-gallery-toolbar]");
  if (!tb) return null;
  const r = tb.getBoundingClientRect();
  const left = tb.children[0], right = tb.children[1];
  const lr = left.getBoundingClientRect();
  const vis = (el) => {
    const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
    return cs.display !== "none" && cs.visibility !== "hidden" && b.width > 0 && b.height > 0;
  };
  const ctrls = [...tb.querySelectorAll("button, input, select")].filter(vis).map((el) => {
    const b = el.getBoundingClientRect();
    let x1 = b.left, x2 = b.right;
    if (left.contains(el)) { x1 = Math.max(x1, lr.left); x2 = Math.min(x2, lr.right); }
    return {
      n: (el.getAttribute("aria-label") || el.textContent.trim() || el.tagName).slice(0, 26),
      x1, x2, y1: b.top, y2: b.bottom, cy: (b.top + b.bottom) / 2, inLeft: left.contains(el),
    };
  }).filter((c) => c.x2 - c.x1 > 1);
  const overlaps = [];
  for (let i = 0; i < ctrls.length; i++) for (let j = i + 1; j < ctrls.length; j++) {
    const a = ctrls[i], b = ctrls[j];
    const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    if (ox > 1 && oy > 1) overlaps.push(`${a.n} × ${b.n} (${Math.round(ox)}px)`);
  }
  const rows = [];
  for (const c of ctrls) if (!rows.some((y) => Math.abs(y - c.cy) < 6)) rows.push(c.cy);
  const btn = tb.querySelector("[data-guide-open]");
  const bb = btn?.getBoundingClientRect();
  return {
    h: Math.round(r.height * 10) / 10, w: Math.round(r.width), rows: rows.length,
    groupTops: [left, right].map((g) => Math.round(g.getBoundingClientRect().top - r.top)),
    overlaps, outside: ctrls.filter((c) => c.x2 > r.right + 1 || c.x1 < r.left - 1).map((c) => c.n),
    guideFirst: Boolean(left.firstElementChild?.hasAttribute("data-guide-open")),
    guideVisible: Boolean(btn && vis(btn) && bb.left >= lr.left - 1 && bb.right <= lr.right + 1),
    guideClipped: btn ? btn.scrollWidth > btn.clientWidth + 1 : null,
    rightOverflowPx: Math.max(0, Math.round(right.scrollWidth - right.clientWidth)),
    leftScrolls: left.scrollWidth > left.clientWidth + 1,
    docOverflow: document.documentElement.scrollWidth > innerWidth,
  };
});

const run = (id) => !ONLY || ONLY.has(id);
const section = (id) => console.log(`\n── ${id}. ${GROUPS.find((g) => g[0] === id)[1]} ──`);
const pngBuf = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#c86e9a" } }).png().toBuffer();

/* ── warm-up: compile the harness once ─────────────────────────────────── */
{
  console.log(`probe → ${BASE}`);
  const P = await openPage({ url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1 }) });
  const ok = await P.page.locator("[data-gallery-toolbar]").count();
  console.log(`warm-up: toolbar ${ok ? "rendered" : "MISSING"}; guide requests ${JSON.stringify(P.rec.guideReqs)}`);
  for (const u of [URLS.compress, URLS.resize, URLS.photo]) await go(P, u);
  await closeP(P);
}

/* ── 1. first visit ────────────────────────────────────────────────────── */
if (run("1")) {
  section("1");
  for (const w of [1440, 390]) {
    const P = await openPage({ vp: VP[w], url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 0 }) });
    const opened = await waitDialog(P);
    check(1, `[${w}] seen=0, live, hasResults=false, v1 → dialog auto-opens`, opened);
    await sleep(1200);
    check(1, `[${w}] … exactly once (mounts counted: 1)`, (await opens(P)) === 1, { opens: await opens(P) });
    check(1, `[${w}] … exactly ONE server-action POST`, P.rec.actions.length === 1, P.rec.actions.map((a) => a.body));
    check(1, `[${w}] … the POST names the tool ("retouch")`, P.rec.actions[0]?.body.includes('"retouch"'), P.rec.actions[0]?.body);
    info(1, `[${w}] guide GETs on first mount: ${P.rec.guideReqs.length}`);
    check(1, `[${w}] page did not navigate after the 500 answer to the action`, P.page.url() === BASE + URLS.retouch, P.page.url());
    await P.page.keyboard.press("Escape");
    await waitClosed(P);
    await sleep(3000);
    check(1, `[${w}] closed and stayed closed for 3 s`, (await dialogCount(P)) === 0 && (await opens(P)) === 1);
    P.guide = guideFor("retouch", "pl", { seen: 1 });
    const before = P.rec.actions.length;
    await P.page.reload({ waitUntil: "domcontentloaded" });
    await guideSettled(P);
    await sleep(2500);
    check(1, `[${w}] reload with seen=1 → no auto-open`, (await dialogCount(P)) === 0 && (await opens(P)) === 0, { opens: await opens(P) });
    check(1, `[${w}] reload with seen=1 → no POST`, P.rec.actions.length === before, P.rec.actions.length - before);
    check(1, `[${w}] reload with seen=1 → the Samouczek button is there`, (await guideBtnCount(P)) === 1);
    await closeP(P);
  }
}

/* ── 2. auto-open rules ────────────────────────────────────────────────── */
if (run("2")) {
  section("2");
  const cases = [
    { name: "live=false", o: { live: false }, open: false, button: false },
    { name: "hasResults=true, version 1, seen 0", o: { hasResults: true }, open: false, button: true },
    { name: "hasResults=null, version 1, seen 0", o: { hasResults: null }, open: false, button: true },
    { name: "seen 1 ≥ version 1", o: { seen: 1 }, open: false, button: true },
    { name: "seen 3 ≥ version 2 (hasResults=false)", o: { seen: 3, version: 2 }, open: false, button: true },
    { name: "tutorial=null", o: { noTutorial: true }, open: false, button: false },
    { name: "guide=null", o: { noGuide: true }, open: false, button: false },
    { name: "hasResults=true, version 2, seen 1", o: { hasResults: true, version: 2, seen: 1 }, open: true, button: true },
    { name: "hasResults=null, version 2, seen 1", o: { hasResults: null, version: 2, seen: 1 }, open: true, button: true },
  ];
  for (const c of cases) {
    const P = await openPage({ url: URLS.retouch, guide: guideFor("retouch", "pl", c.o) });
    if (c.open) {
      const opened = await waitDialog(P);
      await sleep(800);
      check(2, `${c.name} → auto-opens once`, opened && (await opens(P)) === 1, { opens: await opens(P) });
      check(2, `${c.name} → one POST`, P.rec.actions.length === 1, P.rec.actions.length);
    } else {
      await sleep(2500);
      check(2, `${c.name} → no auto-open`, (await dialogCount(P)) === 0 && (await opens(P)) === 0, { opens: await opens(P) });
      check(2, `${c.name} → no POST`, P.rec.actions.length === 0, P.rec.actions.length);
    }
    check(2, `${c.name} → Samouczek button ${c.button ? "present" : "absent"}`, (await guideBtnCount(P)) === (c.button ? 1 : 0), await guideBtnCount(P));
    await closeP(P);
  }
}

/* ── 3. deferred ───────────────────────────────────────────────────────── */
if (run("3")) {
  section("3");
  const blockers = [
    { name: '[role=dialog][aria-modal=true]', attrs: { role: "dialog", "aria-modal": "true" } },
    { name: "[data-ice-ui]", attrs: { "data-ice-ui": "" } },
  ];
  for (const b of blockers) {
    let release;
    const gate = new Promise((r) => { release = r; });
    const P = await openPage({ url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 0 }), gate, waitGuide: false });
    await until(() => P.rec.guideReqs.length > 0, 60000);
    await P.page.evaluate((attrs) => {
      const el = document.createElement("div");
      el.id = "probe-blocker";
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      el.textContent = "Inny dialog (probe)";
      el.style.cssText = "position:fixed;left:8px;bottom:8px;padding:8px 12px;border-radius:8px;background:#fff;color:#000;z-index:10;font:12px sans-serif";
      document.body.appendChild(el);
    }, b.attrs);
    release();
    await guideSettled(P);
    await sleep(2500);
    check(3, `${b.name} present → tutorial does not open`, (await dialogCount(P)) === 0 && (await opens(P)) === 0, { opens: await opens(P) });
    check(3, `${b.name} present → no POST yet`, P.rec.actions.length === 0, P.rec.actions.length);
    const t0 = Date.now();
    await P.page.evaluate(() => document.getElementById("probe-blocker")?.remove());
    const opened = await until(async () => (await dialogCount(P)) > 0, 4000, 25);
    const ms = Date.now() - t0;
    check(3, `${b.name} removed → tutorial opens within ~2 s`, opened && ms <= 2100, `${opened ? ms + " ms" : "did not open in 4 s"}`);
    await sleep(600);
    check(3, `${b.name} removed → exactly one POST, once`, P.rec.actions.length === 1 && (await opens(P)) === 1, { actions: P.rec.actions.length, opens: await opens(P) });
    await closeP(P);
  }
  // 3c. While the auto-open waits behind a blocker, the customer opens the
  // tutorial by hand and closes it. It must not then pop up again by itself.
  {
    let release;
    const gate = new Promise((r) => { release = r; });
    const P = await openPage({ url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 0 }), gate, waitGuide: false });
    await until(() => P.rec.guideReqs.length > 0, 60000);
    await P.page.evaluate(() => {
      const el = document.createElement("div");
      el.id = "probe-blocker"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
      el.textContent = "Inny dialog (probe)";
      el.style.cssText = "position:fixed;left:8px;bottom:8px;padding:8px 12px;background:#fff;color:#000;z-index:10;font:12px sans-serif";
      document.body.appendChild(el);
    });
    release();
    await guideSettled(P);
    await P.page.locator("[data-guide-open]").click();
    await waitDialog(P);
    await P.page.locator("[data-guide-close]").click();
    await waitClosed(P);
    await P.page.evaluate(() => document.getElementById("probe-blocker")?.remove());
    await sleep(3000);
    const n = await opens(P);
    check(3, "manual open + close while the auto-open was deferred → it does not reopen by itself", (await dialogCount(P)) === 0 && n === 1,
      { opensTotal: n, dialogOpenNow: await dialogCount(P), posts: P.rec.actions.length });
    await closeP(P);
  }
}

/* ── 4. navigation ─────────────────────────────────────────────────────── */
if (run("4")) {
  section("4");
  for (const l of LOCALES) {
    const P = await openPage({ locale: l, url: URLS.retouch, guide: guideFor("retouch", l, { seen: 0 }) });
    await waitDialog(P);
    const c = (n) => fill(TG(l, "counter"), { n, total: 4 });
    let g = await dialogGeom(P);
    const btn = (k) => g.btns.find((b) => b.k === k || b.k.startsWith(k));
    check(4, `[${l}] counter on open = "${c(1)}"`, g.counter === c(1), g.counter);
    check(4, `[${l}] progressbar aria-valuenow 1 / valuemax 4`, g.now === "1" && g.max === "4", { now: g.now, max: g.max });
    check(4, `[${l}] back ("${TG(l, "back")}") disabled on step 1`, btn("data-guide-back").disabled && btn("data-guide-back").text === TG(l, "back"), btn("data-guide-back"));
    check(4, `[${l}] primary = "next" "${TG(l, "next")}"`, btn("next:next")?.text === TG(l, "next"), btn("next:"));
    check(4, `[${l}] skip "${TG(l, "skip")}" visible on step 1`, btn("data-guide-skip").vis === "visible" && btn("data-guide-skip").text === TG(l, "skip"), btn("data-guide-skip"));
    await P.page.locator("[data-guide-next]").click();
    await sleep(350);
    g = await dialogGeom(P);
    check(4, `[${l}] Next → "${c(2)}", aria-valuenow 2, back enabled, step 2 shown`, g.counter === c(2) && g.now === "2" && !btn("data-guide-back").disabled && g.curStep === "2", { counter: g.counter, now: g.now, step: g.curStep });
    await P.page.locator("[data-guide-next]").click();
    await P.page.locator("[data-guide-next]").click();
    await sleep(350);
    g = await dialogGeom(P);
    check(4, `[${l}] last step: "${c(4)}", primary is "start" "${TG(l, "start")}"`, g.counter === c(4) && btn("next:start")?.text === TG(l, "start"), { counter: g.counter, primary: btn("next:") });
    check(4, `[${l}] last step: skip invisible`, btn("data-guide-skip").vis === "hidden", btn("data-guide-skip").vis);
    await P.page.locator("[data-guide-back]").click();
    await sleep(300);
    check(4, `[${l}] Back → "${c(3)}"`, (await counterText(P)) === c(3), await counterText(P));
    if (l === "pl") {
      await P.page.keyboard.press("ArrowRight");
      await sleep(250);
      check(4, "[pl] → key moves forward", (await counterText(P)) === c(4), await counterText(P));
      await P.page.keyboard.press("ArrowLeft");
      await P.page.keyboard.press("ArrowLeft");
      await sleep(250);
      check(4, "[pl] ← key moves back", (await counterText(P)) === c(2), await counterText(P));
      await P.page.keyboard.press("ArrowRight");
      await P.page.keyboard.press("ArrowRight");
      await sleep(250);
    } else {
      await P.page.locator("[data-guide-next]").click();
      await sleep(300);
    }
    await P.page.locator('[data-guide-next="start"]').click();
    check(4, `[${l}] "${TG(l, "start")}" closes the dialog`, await waitClosed(P));
    await closeP(P);
  }
}

/* ── 5. closing ────────────────────────────────────────────────────────── */
if (run("5")) {
  section("5");
  for (const w of [1440, 390]) {
    const P = await openPage({ vp: VP[w], url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 0 }) });
    await waitDialog(P);
    const reopen = async () => {
      const b = P.page.locator("[data-guide-open]");
      await b.scrollIntoViewIfNeeded();
      await press(P, b);
      return waitDialog(P);
    };
    await press(P, P.page.locator("[data-guide-close]"));
    check(5, `[${w}] X closes`, await waitClosed(P));
    await reopen();
    await press(P, P.page.locator("[data-guide-skip]"));
    check(5, `[${w}] Pomiń closes`, await waitClosed(P));
    await reopen();
    await P.page.keyboard.press("Escape");
    check(5, `[${w}] Escape closes`, await waitClosed(P));
    await reopen();
    const pic = await P.page.evaluate(() => {
      const b = document.querySelector('[data-tool-tutorial] section[aria-hidden="false"] > div')?.getBoundingClientRect();
      return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
    });
    if (P.vp.touch) await P.page.touchscreen.tap(pic.x, pic.y); else await P.page.mouse.click(pic.x, pic.y);
    await sleep(150);
    const focusAfterPic = await P.page.evaluate(() => {
      const a = document.activeElement;
      return a === document.body ? "body" : a?.getAttribute("role") === "dialog" ? "dialog" : a?.tagName;
    });
    info(5, `[${w}] focus after a click on the illustration: ${focusAfterPic}`);
    await P.page.keyboard.press("Escape");
    check(5, `[${w}] Escape after a click on the illustration closes`, await waitClosed(P));
    await reopen();
    const scrim = await P.page.evaluate(() => {
      const d = document.querySelector('[data-tool-tutorial] [role="dialog"]').getBoundingClientRect();
      // a point on the scrim: left of a centred card, else above a bottom sheet
      return d.left > 12 ? { x: 6, y: Math.round(innerHeight / 2) } : { x: Math.round(innerWidth / 2), y: Math.max(1, Math.floor(d.top / 2)) };
    });
    const onScrim = await P.page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.classList.contains("scrim")), scrim);
    if (P.vp.touch) await P.page.touchscreen.tap(scrim.x, scrim.y); else await P.page.mouse.click(scrim.x, scrim.y);
    check(5, `[${w}] click on the scrim closes`, onScrim && await waitClosed(P), { point: scrim, onScrim });
    await sleep(3000);
    check(5, `[${w}] nothing reopened by itself in 3 s (1 auto + 4 manual mounts)`, (await dialogCount(P)) === 0 && (await opens(P)) === 5, { opens: await opens(P) });
    check(5, `[${w}] still exactly one POST (manual opens post nothing)`, P.rec.actions.length === 1, P.rec.actions.length);
    await closeP(P);
  }
}

/* ── 6. manual reopen ──────────────────────────────────────────────────── */
if (run("6")) {
  section("6");
  const P = await openPage({ url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1 }) });
  const b = P.page.locator("[data-guide-open]");
  await b.click();
  await waitDialog(P);
  await P.page.locator("[data-guide-next]").click();
  await P.page.locator("[data-guide-next]").click();
  await sleep(300);
  const at3 = await counterText(P);
  await P.page.locator("[data-guide-close]").click();
  await waitClosed(P);
  await b.click();
  await waitDialog(P);
  check(6, "reopen starts at step 1", at3 === "3 z 4" && (await counterText(P)) === "1 z 4", { before: at3, now: await counterText(P) });
  check(6, "manual opens make NO server-action POST", P.rec.actions.length === 0, P.rec.actions.length);
  await P.page.locator("[data-guide-close]").click();
  await waitClosed(P);
  await sleep(100);
  check(6, "after X, focus is back on the Samouczek button", await P.page.evaluate(() => document.activeElement?.hasAttribute("data-guide-open")),
    await P.page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
  await b.click();
  await waitDialog(P);
  await P.page.keyboard.press("Escape");
  await waitClosed(P);
  await sleep(100);
  check(6, "after Escape, focus is back on the Samouczek button", await P.page.evaluate(() => document.activeElement?.hasAttribute("data-guide-open")));
  await closeP(P);
}

/* ── 7. focus, aria, scroll lock ───────────────────────────────────────── */
if (run("7")) {
  section("7");
  {
    const P = await openPage({ url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1 }) });
    const bodyBefore = await P.page.evaluate(() => ({ inline: document.body.style.overflow, computed: getComputedStyle(document.body).overflow }));
    await P.page.locator("[data-guide-open]").click();
    await waitDialog(P);
    check(7, "on open, focus is on the primary button inside the dialog",
      await P.page.evaluate(() => document.activeElement?.hasAttribute("data-guide-next") && Boolean(document.activeElement.closest('[role="dialog"]'))));
    const inside = () => P.page.evaluate(() => Boolean(document.activeElement?.closest("[data-tool-tutorial]")));
    const walk = async (key, n) => {
      const seen = [];
      for (let i = 0; i < n; i++) {
        await P.page.keyboard.press(key);
        seen.push(await P.page.evaluate(() => {
          const a = document.activeElement;
          const k = ["data-guide-close", "data-guide-skip", "data-guide-back", "data-guide-next"].find((x) => a?.hasAttribute(x));
          return (a?.closest("[data-tool-tutorial]") ? "in:" : "OUT:") + (k ?? a?.tagName);
        }));
      }
      return seen;
    };
    let path = await walk("Tab", 7);
    check(7, "Tab ×7 stays inside (step 1)", path.every((s) => s.startsWith("in:")), path);
    path = await walk("Shift+Tab", 7);
    check(7, "Shift+Tab ×7 stays inside (step 1)", path.every((s) => s.startsWith("in:")), path);
    await P.page.locator("[data-guide-next]").focus();
    for (let i = 0; i < 3; i++) await P.page.keyboard.press("ArrowRight");
    await sleep(300);
    path = [...await walk("Tab", 5), ...await walk("Shift+Tab", 5)];
    check(7, "Tab / Shift+Tab stay inside on the last step (skip hidden)", path.every((s) => s.startsWith("in:")), path);
    // After a click on the picture, focus sits on the dialog box itself.
    const pic = await P.page.evaluate(() => {
      const b = document.querySelector('[data-tool-tutorial] section[aria-hidden="false"] > div').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await P.page.mouse.click(pic.x, pic.y);
    path = await walk("Shift+Tab", 2);
    check(7, "after a click on the illustration, Shift+Tab stays inside", path.every((s) => s.startsWith("in:")), path);
    await P.page.mouse.click(pic.x, pic.y);
    path = await walk("Tab", 2);
    check(7, "after a click on the illustration, Tab stays inside", path.every((s) => s.startsWith("in:")), path);
    // aria
    for (let s = 4; s >= 1; s--) {
      const a = await P.page.evaluate(() => {
        const d = document.querySelector('[data-tool-tutorial] [role="dialog"]');
        const lab = document.getElementById(d.getAttribute("aria-labelledby") ?? "");
        const des = document.getElementById(d.getAttribute("aria-describedby") ?? "");
        return { lab: lab?.textContent.trim() ?? null, des: des?.textContent.trim() ?? null, desInCurrent: Boolean(des?.closest('section[aria-hidden="false"]')) };
      });
      check(7, `step ${s}: aria-labelledby and aria-describedby resolve to non-empty text (the current step's)`, Boolean(a.lab) && Boolean(a.des) && a.desInCurrent, a);
      await P.page.keyboard.press("ArrowLeft");
      await sleep(120);
    }
    const bodyOpen = await P.page.evaluate(() => getComputedStyle(document.body).overflow);
    check(7, "body overflow hidden while open", bodyOpen === "hidden", bodyOpen);
    await P.page.keyboard.press("Escape");
    await waitClosed(P);
    const bodyAfter = await P.page.evaluate(() => ({ inline: document.body.style.overflow, computed: getComputedStyle(document.body).overflow }));
    check(7, "body overflow restored after close", bodyAfter.inline === bodyBefore.inline && bodyAfter.computed === bodyBefore.computed, { bodyBefore, bodyAfter });
    await closeP(P);
  }
  {
    // A step without a body: describedby must not dangle.
    const P = await openPage({ url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1, emptyBody: 1 }) });
    await P.page.locator("[data-guide-open]").click();
    await waitDialog(P);
    await P.page.locator("[data-guide-next]").click();
    await sleep(300);
    const a = await P.page.evaluate(() => {
      const d = document.querySelector('[data-tool-tutorial] [role="dialog"]');
      const id = d.getAttribute("aria-describedby");
      return { id, resolves: Boolean(id && document.getElementById(id)) };
    });
    check(7, "step with an empty body: aria-describedby does not point at a missing element", a.resolves || !a.id, a);
    await closeP(P);
  }
  {
    // Real scrolling: 834 is below lg, so the page itself scrolls.
    const P = await openPage({ vp: VP[834], url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 0 }) });
    await waitDialog(P);
    const y0 = await P.page.evaluate(() => scrollY);
    await P.page.mouse.move(10, 20);
    await P.page.mouse.wheel(0, 500);
    await sleep(500);
    const y1 = await P.page.evaluate(() => scrollY);
    await P.page.keyboard.press("Escape");
    await waitClosed(P);
    await P.page.mouse.move(10, 400);
    await P.page.mouse.wheel(0, 500);
    await sleep(500);
    const y2 = await P.page.evaluate(() => scrollY);
    check(7, "[834] wheel over the scrim does not scroll the page while open; does after close", y1 === y0 && y2 > y1, { y0, whileOpen: y1, afterClose: y2 });
    await closeP(P);
  }
}

/* ── 8. height stability (long body) ───────────────────────────────────── */
if (run("8")) {
  section("8");
  for (const w of WIDTHS) {
    const P = await openPage({ vp: VP[w], url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 0, longBody: true }) });
    await waitDialog(P);
    await P.page.waitForFunction(() => [...document.querySelectorAll("[data-tool-tutorial] img")].every((i) => i.complete), null, { timeout: 10000 }).catch(() => {});
    const hs = [];
    for (let s = 1; s <= 4; s++) {
      if (s > 1) { await press(P, P.page.locator("[data-guide-next]")); await sleep(400); }
      hs.push(Math.round((await dlgHeight(P)) * 10) / 10);
    }
    const bodyLen = longText("pl").length;
    check(8, `[${w}] height identical on steps 1–4 (landscape photo / SVG / portrait + ${bodyLen}-char body / square)`, Math.max(...hs) - Math.min(...hs) <= 1, hs);
    info(8, `[${w}] heights ${hs.join(" / ")}`);
    await closeP(P);
  }
}

/* ── 9. layout matrix ──────────────────────────────────────────────────── */
if (run("9")) {
  section("9");
  for (const w of WIDTHS) for (const theme of THEMES) for (const l of LOCALES) {
    const combo = `${w}-${theme}-${l}`;
    const P = await openPage({ vp: VP[w], theme, locale: l, url: URLS.retouch, guide: guideFor("retouch", l, { seen: 0 }) });
    const opened = await waitDialog(P);
    if (!check(9, `[${combo}] dialog opened`, opened)) { await closeP(P); continue; }
    const themeOk = await P.page.evaluate((th) => document.documentElement.classList.contains("dark") === (th === "dark"), theme);
    const hs = [await dlgHeight(P)];
    await press(P, P.page.locator("[data-guide-next]"));
    await sleep(450);
    const g = await dialogGeom(P);
    hs.push(g.rect.height);
    const fails = [];
    if (!themeOk) fails.push("theme not applied");
    if (g.counter !== fill(TG(l, "counter"), { n: 2, total: 4 })) fails.push(`counter "${g.counter}"`);
    if (g.rect.top < -0.5 || g.rect.left < -0.5 || g.rect.right > g.vw + 0.5 || g.rect.bottom > g.vh + 0.5) fails.push(`dialog outside viewport ${JSON.stringify(g.rect)}`);
    if (g.docScrollW > g.vw) fails.push(`page scrollWidth ${g.docScrollW} > ${g.vw}`);
    if (g.dlgOverflowX || g.scrollerOverflowX) fails.push("horizontal overflow inside the dialog");
    for (const b of g.btns.filter((x) => x.vis === "visible")) {
      if (!b.inView || !b.inDialog || !b.hit) fails.push(`button ${b.k} not fully visible/clickable ${JSON.stringify(b)}`);
      if (b.clipped) fails.push(`button ${b.k} text clipped "${b.text}"`);
    }
    for (const t of g.texts) if (t.clipped || t.outside) fails.push(`${t.tag} clipped "${t.text}"`);
    if (g.scrollerScrollsY && g.scrollerOverflowY !== "auto") fails.push("content taller than the sheet but body does not scroll");
    check(9, `[${combo}] inside viewport, no horizontal overflow, footer visible, nothing clipped`, fails.length === 0, fails);
    if (g.scrollerScrollsY) info(9, `[${combo}] step body scrolls inside the dialog (overflow-y ${g.scrollerOverflowY}), dialog ${Math.round(g.rect.height)}px of ${g.vh}`);
    await shot(P.page, `tut-${combo}-step2`);
    for (let s = 3; s <= 4; s++) { await press(P, P.page.locator("[data-guide-next]")); await sleep(400); hs.push(await dlgHeight(P)); }
    check(8, `[${combo}] same height on steps 1–4 (default copy)`, Math.max(...hs) - Math.min(...hs) <= 1, hs.map((h) => Math.round(h * 10) / 10));
    await closeP(P);
  }
}

/* ── 10. independent state, tool key per mount ─────────────────────────── */
if (run("10")) {
  section("10");
  const mounts = [
    ["retouch", URLS.retouch, "retouch"], ["thumbnail", URLS.thumbnail, "ecommerce_thumbnail"],
    ["flat lay", URLS.flatlay, "fashion_flat_lay"], ["generator (guideTool prop)", URLS.generator, "generator"],
    ["compress", URLS.compress, "compress"], ["resize", URLS.resize, "resize"], ["photo tool remove_bg", URLS.photo, "tool_remove_bg"],
  ];
  for (const [name, url, key] of mounts) {
    const P = await openPage({ url, guide: (t) => guideFor(t in ARTS ? t : "retouch", "pl", { seen: 1, hasResults: true }) });
    const keys = [...new Set(P.rec.guideReqs)];
    check(10, `${name} asks for tool=${key} (and only that)`, keys.length === 1 && keys[0] === key, P.rec.guideReqs);
    check(10, `${name} shows its Samouczek button`, (await guideBtnCount(P)) === 1, await guideBtnCount(P));
    await closeP(P);
  }
  {
    const P = await openPage({ url: URLS.bare, guide: guideFor("retouch", "pl"), waitGuide: false });
    await P.page.locator("[data-gallery-toolbar]").waitFor({ timeout: 30000 }).catch(() => {});
    await sleep(3000);
    check(10, "gallery with no operation, no guideTool, at a non-tool route → no guide request, no button",
      P.rec.guideReqs.length === 0 && (await guideBtnCount(P)) === 0, { reqs: P.rec.guideReqs, buttons: await guideBtnCount(P) });
    await closeP(P);
  }
  {
    const ctx = await newContext(VP[1440], "light", "pl");
    const A = await openPage({ ctx, url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 0 }) });
    const B = await openPage({ ctx, url: URLS.thumbnail, guide: guideFor("ecommerce_thumbnail", "pl", { seen: 1 }) });
    await sleep(1500);
    check(10, "tab A (retouch, seen 0) auto-opened; its POST names retouch", (await dialogCount(A)) === 1 && A.rec.actions.length === 1 && A.rec.actions[0].body.includes('"retouch"'), A.rec.actions.map((a) => a.body));
    check(10, "tab B (thumbnail, seen 1) did not open and posted nothing", (await dialogCount(B)) === 0 && B.rec.actions.length === 0, { open: await dialogCount(B), posts: B.rec.actions.length });
    const titleA = await A.page.locator(`${DLG} h2`).textContent();
    check(10, "tab A shows the Retusz tutorial", titleA?.trim() === DICT.pl.toolGuideDefaults.retouch.tutorial.title, titleA);
    B.guide = guideFor("fashion_flat_lay", "pl", { seen: 0 });
    await go(B, URLS.flatlay);
    const openedB = await waitDialog(B);
    check(10, "tab B navigated to flat lay (seen 0) → its own tutorial opens, its POST names fashion_flat_lay",
      openedB && B.rec.actions.length === 1 && B.rec.actions[0].body.includes('"fashion_flat_lay"'), B.rec.actions.map((a) => a.body));
    const titleB = await B.page.locator(`${DLG} h2`).textContent().catch(() => null);
    check(10, "tab B shows the flat-lay tutorial (3 steps)", titleB?.trim() === DICT.pl.toolGuideDefaults.fashion_flat_lay.tutorial.title && (await counterText(B)) === "1 z 3", { titleB, counter: await counterText(B) });
    check(10, "tab A unaffected (still its own dialog, still one POST)", (await dialogCount(A)) === 1 && A.rec.actions.length === 1 && (await counterText(A)) === "1 z 4");
    await ctx.close();
  }
}

/* ── 11 + 15. starter gallery: content, geometry, screenshots ─────────── */
function starterChecks(id, label, s, l, expectImg) {
  const fails = [];
  if (s.badge !== TG(l, "starterBadge")) fails.push(`badge "${s.badge}"`);
  if (s.note !== TG(l, "starterNote")) fails.push(`note "${s.note}"`);
  if (s.interactive.length) fails.push(`controls inside: ${s.interactive.join(",")}`);
  if (s.boxH > s.maxH + 1) fails.push(`picture box ${Math.round(s.boxH)}px > min(62vh,560px)=${Math.round(s.maxH)}`);
  if (s.docOverflow) fails.push("page scrolls sideways");
  if (expectImg) {
    if (!s.img) fails.push("no <img>");
    else {
      const nat = s.img.nw / s.img.nh, painted = s.img.paintedW / s.img.paintedH;
      if (!s.img.complete || !s.img.nw) fails.push("image not loaded");
      if (s.img.fit !== "contain") fails.push(`object-fit ${s.img.fit}`);
      if (Math.abs(painted / nat - 1) > 0.02) fails.push(`painted aspect ${painted.toFixed(3)} vs natural ${nat.toFixed(3)}`);
    }
  } else if (!s.svg || s.img) fails.push(`expected the SVG art, got ${s.img ? "an <img>" : "nothing"}`);
  return check(id, `${label}: badge/note from dictionary, ${expectImg ? "picture contained at its natural aspect" : "SVG art"}, ≤ min(62vh,560px), zero controls`, fails.length === 0, fails);
}
if (run("11") || run("15")) {
  section("11");
  for (const w of WIDTHS) for (const theme of THEMES) {
    const g = guideFor("retouch", "pl", { seen: 1 });
    const P = await openPage({ vp: VP[w], theme, url: URLS.retouch, guide: g });
    const ok = await starterReady(P);
    check(11, `[${w}-${theme}] starter visible (live, starter, hasResults=false, empty list, no filter)`, ok);
    if (ok) {
      const s = await starterGeom(P);
      check(11, `[${w}-${theme}] title/body are the guide's`, s.title === g.guide.starter.title && s.body === g.guide.starter.body, { title: s.title, body: s.body?.slice(0, 40) });
      starterChecks(11, `[${w}-${theme}] landscape 1808×1152`, s, "pl", true);
      const boxAspect = s.boxW / s.boxH;
      info(11, `[${w}-${theme}] picture box ${Math.round(s.boxW)}×${Math.round(s.boxH)} (box aspect ${boxAspect.toFixed(3)} vs 1.569)`);
      check(11, `[${w}-${theme}] [data-gallery-empty] is not rendered alongside`, (await emptyState(P)) === null);
      await shot(P.page, `starter-retouch-${w}-${theme}`);
      check(15, `[${w}-${theme}] starter screenshot`, !SHOTS || fs.existsSync(`${SHOTS}/starter-retouch-${w}-${theme}.png`));
    }
    await closeP(P);
  }
  for (const l of ["en", "de"]) {
    const g = guideFor("retouch", l, { seen: 1 });
    const P = await openPage({ locale: l, url: URLS.retouch, guide: g });
    if (check(11, `[1440-${l}] starter visible`, await starterReady(P))) {
      const s = await starterGeom(P);
      starterChecks(11, `[1440-${l}] badge "${TG(l, "starterBadge")}"`, s, l, true);
    }
    await closeP(P);
  }
  for (const [name, image] of [["portrait 340×425", IMG.tall], ["banner 922×200", IMG.banner], ["square 1024×1024", IMG.square], ["image=null", null]]) {
    for (const w of [1440, 390]) {
      const P = await openPage({ vp: VP[w], url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1, starterImage: image }) });
      if (check(11, `[${w}] ${name}: starter visible`, await starterReady(P))) {
        const s = await starterGeom(P);
        starterChecks(11, `[${w}] ${name}`, s, "pl", Boolean(image));
        if (image) {
          const boxAspect = s.boxW / s.boxH, nat = image.width / image.height;
          info(11, `[${w}] ${name}: box ${Math.round(s.boxW)}×${Math.round(s.boxH)} (aspect ${boxAspect.toFixed(3)}), painted ${Math.round(s.img.paintedW)}×${Math.round(s.img.paintedH)}, max ${Math.round(s.maxH)}`
            + (Math.abs(boxAspect / nat - 1) > 0.02 ? " → the box is letterboxed (height capped, width kept at 100%)" : ""));
        }
        if (w === 1440 && (name.startsWith("portrait") || name === "image=null")) await shot(P.page, `starter-retouch-1440-light-${name.split(" ")[0].replace("=", "-")}`);
      }
      await closeP(P);
    }
  }
}

/* ── 12. starter must stay hidden ──────────────────────────────────────── */
if (run("12")) {
  section("12");
  const g0 = guideFor("retouch", "pl", { seen: 1 });
  {
    // a. the load-more request is still pending (3 s) and then returns items
    const P = await openPage({ url: URLS.retouch + "&cursor=c1", guide: g0, gen: () => ({ delay: 3000, json: { ok: true, items: genItems(3, "image_retouch"), nextCursor: null } }) });
    await until(() => P.rec.gen.length > 0, 10000);
    await sleep(1500);
    const mid = await P.page.evaluate(() => window.__tg.starterAt);
    await until(() => P.rec.genServed > 0, 6000);
    await sleep(600);
    const cards = await P.page.locator("[data-gallery-card]").count();
    check(12, "generations request pending 3 s (then 3 items) → starter never painted, items shown after",
      mid === null && (await P.page.evaluate(() => window.__tg.starterAt)) === null && cards === 3, { starterAtMid: mid, cards, req: P.rec.gen[0] });
    check(12, "the gallery request carries op=image_retouch (mock sanity)", P.rec.gen[0]?.includes("op=image_retouch"), P.rec.gen[0]);
    await closeP(P);
  }
  {
    // a2. pending 3 s then EMPTY: hidden while pending, shown once it answers
    const P = await openPage({ url: URLS.retouch + "&cursor=c1", guide: g0, gen: () => ({ delay: 3000, json: EMPTY_PAGE }) });
    await until(() => P.rec.gen.length > 0, 10000);
    await sleep(1500);
    const mid = await starterCount(P);
    await until(() => P.rec.genServed > 0, 6000);
    await sleep(600);
    check(12, "pending 3 s then an empty page → hidden while pending, visible after (positive control)", mid === 0 && (await starterCount(P)) === 1, { mid, after: await starterCount(P) });
    await closeP(P);
  }
  {
    // a3. the GUIDE answer is pending 3 s: neither empty state may flash
    const P = await openPage({ url: URLS.retouch, guide: g0, guideDelay: 3000, waitGuide: false });
    await until(() => P.rec.guideReqs.length > 0, 60000);
    await sleep(1500);
    const mid = await P.page.evaluate(() => ({ starterAt: window.__tg.starterAt, emptyVisibleAt: window.__tg.emptyVisibleAt, empty: !!document.querySelector("[data-gallery-empty]") }));
    await guideSettled(P);
    const end = await P.page.evaluate(() => ({ starterAt: window.__tg.starterAt, emptyVisibleAt: window.__tg.emptyVisibleAt }));
    check(12, "guide answer pending 3 s → plain empty state held invisible, starter not yet painted",
      mid.starterAt === null && mid.emptyVisibleAt === null && mid.empty, mid);
    check(12, "… then the starter appears and the plain empty state never flashed", end.starterAt !== null && end.emptyVisibleAt === null, end);
    await closeP(P);
  }
  {
    // b. generations HTTP 500 (the page left to load fails)
    const P = await openPage({ url: URLS.retouch + "&cursor=c1", guide: g0, gen: () => ({ status: 500, json: { ok: false, error: "boom" } }) });
    await sleep(3000);
    check(12, "generations HTTP 500 → starter never painted", (await P.page.evaluate(() => window.__tg.starterAt)) === null && (await starterCount(P)) === 0);
    const es = await emptyState(P);
    info(12, `after the 500: plain empty state ${es ? (es.visible ? "visible" : "invisible") : "absent"}; ${P.rec.gen.length} /api/generations requests in ~3 s (load-more retries)`);
    await closeP(P);
  }
  {
    const P = await openPage({ url: URLS.retouch + "&items=3", guide: g0 });
    await sleep(800);
    check(12, "items exist → no starter", (await starterCount(P)) === 0 && (await P.page.locator("[data-gallery-card]").count()) === 3);
    await closeP(P);
  }
  {
    // d. filters driven through the real toolbar controls (empty answers)
    const P = await openPage({ url: URLS.retouch, guide: g0 });
    const fav = P.page.locator(`[data-gallery-toolbar] button[aria-label="${DICT.pl.genv3.filterFav}"]`);
    const search = P.page.locator(`[data-gallery-toolbar] input[aria-label="${DICT.pl.genv3.searchLabel}"]:visible`);
    const settle = async (n) => { await until(() => P.rec.genServed >= n, 5000); await sleep(400); };
    check(12, "precondition: starter visible before any filter", (await starterCount(P)) === 1);
    await fav.click(); await settle(1);
    let es = await emptyState(P);
    check(12, "favourites on, empty answer → no starter; plain 'filtered' empty state shown", (await starterCount(P)) === 0 && es?.visible && es.text.includes(DICT.pl.genv3.emptyFiltered), { es, req: P.rec.gen.at(-1) });
    await fav.click(); await settle(2);
    check(12, "favourites off again → starter back", (await starterCount(P)) === 1);
    await search.fill("kubek"); await settle(3);
    check(12, "search 'kubek', empty answer → no starter", (await starterCount(P)) === 0, P.rec.gen.at(-1));
    await search.fill(""); await settle(4);
    check(12, "search cleared → starter back", (await starterCount(P)) === 1);
    await P.page.locator(`[data-gallery-toolbar] select[aria-label="${DICT.pl.genv3.sortLabel}"]`).selectOption("asc"); await settle(5);
    info(12, `sort 'oldest' (not a filter) → starter ${(await starterCount(P)) ? "shown" : "hidden"}`);
    await closeP(P);
  }
  {
    const P = await openPage({ url: URLS.generator, guide: guideFor("generator", "pl", { seen: 1 }) });
    const settle = async (n) => { await until(() => P.rec.genServed >= n, 5000); await sleep(400); };
    check(12, "generator: precondition starter visible", (await starterCount(P)) === 1);
    await P.page.locator("[data-gallery-toolbar] button", { hasText: DICT.pl.genv3.sessionAd }).click(); await settle(1);
    check(12, `generator: session chip "${DICT.pl.genv3.sessionAd}" on, empty → no starter`, (await starterCount(P)) === 0, P.rec.gen.at(-1));
    await P.page.locator("[data-gallery-toolbar] button", { hasText: DICT.pl.genv3.filterAll }).click(); await settle(2);
    check(12, `generator: "${DICT.pl.genv3.filterAll}" again → starter back`, (await starterCount(P)) === 1);
    await closeP(P);
  }
  for (const [name, o] of [["hasResults=null", { hasResults: null }], ["hasResults=true", { hasResults: true }], ["live=false", { live: false }], ["starter=null", { noStarter: true }], ["guide=null", { noGuide: true }]]) {
    const P = await openPage({ url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1, ...o }) });
    await sleep(500);
    const es = await emptyState(P);
    check(12, `${name} → no starter; plain empty state visible`, (await starterCount(P)) === 0 && (await P.page.evaluate(() => window.__tg.starterAt)) === null && es?.visible === true, es);
    await closeP(P);
  }
  {
    const P = await openPage({ url: URLS.retouch, guide: g0, guideStatus: 500 });
    await sleep(500);
    const es = await emptyState(P);
    check(12, "guide request HTTP 500 → no starter, no button, plain empty state visible", (await starterCount(P)) === 0 && (await guideBtnCount(P)) === 0 && es?.visible === true, es);
    await closeP(P);
  }
}

/* ── 13. the gallery toolbar ───────────────────────────────────────────── */
if (run("13")) {
  section("13");
  const tools = [["retouch", URLS.retouch, "retouch"], ["flat lay", URLS.flatlay, "fashion_flat_lay"], ["generator", URLS.generator, "generator"]];
  for (const [name, url, key] of tools) for (const w of WIDTHS) for (const l of LOCALES) {
    const combo = `${name} ${w}-${l}`;
    const P = await openPage({ vp: VP[w], locale: l, url, guide: guideFor(key, l, { seen: 1, hasResults: true }) });
    const t = await toolbarGeom(P);
    const ok = t && t.rows === 1 && t.h <= 56 && t.overlaps.length === 0 && t.outside.length === 0 && t.guideVisible && !t.guideClipped && !t.docOverflow;
    check(13, `[${combo}] one row, ≤56px, no collisions, guide button visible`, ok, t && { h: t.h, rows: t.rows, groupTops: t.groupTops, overlaps: t.overlaps, outside: t.outside, guideVisible: t.guideVisible, rightOverflowPx: t.rightOverflowPx });
    check(13, `[${combo}] guide button is the first child of the left group`, t?.guideFirst);
    if (!ok && t) {
      const B = await openPage({ vp: VP[w], locale: l, url, guide: guideFor(key, l, { seen: 1, hasResults: true, live: false }) });
      const b = await toolbarGeom(B);
      info(13, `[${combo}] baseline WITHOUT the guide button: h ${b.h}px, rows ${b.rows}, overlaps ${b.overlaps.length ? b.overlaps.join("; ") : "none"} (with button: h ${t.h}px, rows ${t.rows}, overlaps ${t.overlaps.length ? t.overlaps.join("; ") : "none"})`);
      await shot(P.page, `toolbar-${name.replace(" ", "")}-${w}-${l}`);
      await closeP(B);
    }
    await closeP(P);
  }
}

/* ── 14. compress / resize ─────────────────────────────────────────────── */
async function batchInfo(P) {
  return P.page.evaluate((viewLabel) => {
    const grp = document.querySelector(`[role="group"][aria-label="${viewLabel}"]`);
    const tb = grp?.parentElement;
    const btn = document.querySelector("[data-guide-open]");
    const r = tb?.getBoundingClientRect();
    const rows = new Set([...(tb?.children ?? [])].map((c) => Math.round(c.getBoundingClientRect().top)));
    return {
      inToolbar: Boolean(tb && btn && tb.contains(btn)), toolbarH: r ? Math.round(r.height) : null, rows: rows.size,
      btnInside: btn && r ? (() => { const b = btn.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1; })() : null,
      docOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  }, DICT.pl.batch.viewLabel);
}
if (run("14")) {
  section("14");
  for (const [kind, url, key, emptyKey] of [["compress", URLS.compress, "compress", "compress.emptyTitle"], ["resize", URLS.resize, "resize", "resize.emptyTitle"]]) {
    const emptyTitle = emptyKey.split(".").reduce((o, k) => o[k], DICT.pl);
    for (const w of [1440, 390]) {
      const P = await openPage({ vp: VP[w], url, guide: guideFor(key, "pl", { seen: 1 }) });
      const bi = await batchInfo(P);
      check(14, `[${kind} ${w}] guide button sits in the batch toolbar, inside its box`, bi.inToolbar && bi.btnInside && !bi.docOverflow, bi);
      info(14, `[${kind} ${w}] batch toolbar ${bi.toolbarH}px, ${bi.rows} row(s)`);
      const vis = await starterReady(P);
      check(14, `[${kind} ${w}] starter replaces the empty queue (live, starter, hasResults=false)`, vis && !(await P.page.getByText(emptyTitle).isVisible().catch(() => false)));
      if (vis) {
        const s = await starterGeom(P);
        starterChecks(14, `[${kind} ${w}]`, s, "pl", true);
        await shot(P.page, `starter-${kind}-${w}-light`);
      }
      if (w === 1440) {
        await P.page.locator('input[type="file"]').setInputFiles({ name: "probe.png", mimeType: "image/png", buffer: pngBuf });
        const gone = await until(async () => (await starterCount(P)) === 0, 5000);
        check(14, `[${kind}] a photo added to the queue → starter gone`, gone);
      }
      await closeP(P);
    }
    for (const [name, o] of [["hasResults=true", { hasResults: true }], ["hasResults=null", { hasResults: null }], ["live=false", { live: false }], ["starter=null", { noStarter: true }]]) {
      const P = await openPage({ url, guide: guideFor(key, "pl", { seen: 1, ...o }) });
      await sleep(400);
      const plain = await P.page.getByText(emptyTitle).isVisible().catch(() => false);
      check(14, `[${kind}] ${name} → no starter, the screen's own empty state visible${o.live === false ? ", no button" : ""}`,
        (await starterCount(P)) === 0 && plain && (o.live !== false || (await guideBtnCount(P)) === 0), { starter: await starterCount(P), plain, buttons: await guideBtnCount(P) });
      await closeP(P);
    }
  }
  for (const theme of THEMES) {
    if (theme === "light") continue;
    for (const w of [1440, 390]) {
      const P = await openPage({ vp: VP[w], theme, url: URLS.compress, guide: guideFor("compress", "pl", { seen: 1 }) });
      if (await starterReady(P)) await shot(P.page, `starter-compress-${w}-${theme}`);
      await closeP(P);
    }
  }
}

/* ── P. photo tool ─────────────────────────────────────────────────────── */
if (run("P")) {
  section("P");
  {
    const P = await openPage({ url: URLS.photo, guide: guideFor("tool_remove_bg", "pl", { seen: 1, starterImage: null }) });
    const vis = await starterReady(P);
    check("P", "available, live, starter, hasResults=false → starter visible", vis);
    if (vis) starterChecks("P", "remove_bg (image=null → drawn 'compare' art)", await starterGeom(P), "pl", false);
    const above = await P.page.evaluate(() => {
      const b = document.querySelector("[data-guide-open]");
      const s = document.querySelector("[data-starter-gallery]");
      return b && s ? b.getBoundingClientRect().bottom <= s.getBoundingClientRect().top + 1 : null;
    });
    check("P", "guide button above the gallery", above === true, above);
    await shot(P.page, "starter-photo-remove_bg-1440-light");
    await closeP(P);
  }
  for (const [name, url] of [["available=0", URLS.photo + "&available=0"], ["cursor=c1 (more to load)", URLS.photo + "&cursor=c1"]]) {
    const P = await openPage({ url, guide: guideFor("tool_remove_bg", "pl", { seen: 1 }) });
    await sleep(500);
    const plain = await P.page.getByText(DICT.pl.photoTool.emptyTitle).isVisible().catch(() => false);
    check("P", `${name} → no starter, own empty state visible`, (await starterCount(P)) === 0 && plain, { starter: await starterCount(P), plain });
    await closeP(P);
  }
}

/* ── N + C. network and console over every page ────────────────────────── */
section("N");
{
  const sb = allPages.flatMap((p) => p.rec.supabase);
  const ext = allPages.flatMap((p) => p.rec.external);
  const api = allPages.flatMap((p) => p.rec.api);
  const writes = allPages.flatMap((p) => p.rec.otherWrites);
  const posts = allPages.reduce((n, p) => n + p.rec.actions.length, 0);
  check("N", "no browser request reached *.supabase.co", sb.length === 0, sb.slice(0, 8));
  check("N", "no non-GET request reached the dev server (server actions were all intercepted)", writes.length === 0, writes.slice(0, 8));
  info("N", `server-action POSTs intercepted: ${posts}; other /api/* answered 404 by the probe: ${api.length ? [...new Set(api)].join(", ") : "none"}; external requests aborted: ${ext.length ? [...new Set(ext)].slice(0, 5).join(", ") : "none"}`);
}
section("C");
{
  const errs = allPages.flatMap((p) => p.rec.errors.map((e) => `${p.label}: ${e}`));
  const cons = allPages.flatMap((p) => p.rec.console.filter((m) => !consoleExpected.some((r) => r.test(m))).map((m) => `${p.label}: ${m}`));
  check("C", "no uncaught page errors", errs.length === 0, [...new Set(errs)].slice(0, 6));
  check("C", "no unexpected console errors/warnings", cons.length === 0, [...new Set(cons)].slice(0, 10));
}

await browser.close();

/* ── scoreboard ────────────────────────────────────────────────────────── */
console.log("\n══ SCOREBOARD ══");
let totalPass = 0, totalFail = 0;
for (const [id, name] of GROUPS) {
  const r = results.get(id);
  if (r.pass === 0 && r.fail.length === 0) { console.log(`  –  ${id.padEnd(3)} ${name} (not run)`); continue; }
  totalPass += r.pass; totalFail += r.fail.length;
  console.log(`  ${r.fail.length ? "✗" : "✓"}  ${id.padEnd(3)} ${name} — ${r.pass} passed, ${r.fail.length} failed`);
  for (const f of r.fail) console.log(`        ✗ ${f}`);
}
console.log(`\nTOTAL: ${totalPass} ✓ / ${totalFail} ✗`);
if (shots.length) console.log(`\nscreenshots (${shots.length}):\n${shots.map((s) => "  " + s).join("\n")}`);
process.exit(totalFail ? 1 : 0);
