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
 *   /probe-tmp/guide?kind=editor                      ImageEditor (available, no initial image) —
 *                                                     the guide "editor", button at the end of the
 *                                                     timeline strip (Cofnij · Ponów · Historia zmian)
 *   /probe-tmp/guide?kind=workbench&slug=upscale      ToolWorkbench — slugs upscale / expand /
 *                                                     watermark (guides tool_upscale / tool_expand /
 *                                                     tool_watermark, button in the "Ustawienia"
 *                                                     header) and relight (no guide: no button, no request)
 *   …&available=0                                     the tool cannot run
 *
 * The editor and the workbenches are v2 surfaces ('editor' / 'workbench'):
 * no results gallery, so no starter gallery — groups E, W and S hold them to
 * that, to their placement against a no-guide baseline, and to the shipped
 * step counts (DEFAULT_STEP_ARTS, read from lib/tool-guides.ts itself).
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
        slug={q.slug ?? "upscale"}
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
import { ImageEditor } from "@/components/editor/image-editor";
import { ToolWorkbench } from "@/components/tools/workbench";
import { PageHeader } from "@/components/ui/page-header";
import type { GalleryItem } from "@/components/genv3/types";
import type { GuideToolKey } from "@/lib/tool-guides";
import type { PhotoToolSlug, ToolSlug } from "@/lib/images/tools";
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
 *  workspace ground (app/(app)/retusz/page.tsx). \`bare\`: a page that renders
 *  straight into <main> (app/(app)/tools/[slug]/page.tsx for a workbench). */
function Shell({ children, bare }: { children: ReactNode; bare?: boolean }) {
  return (
    <div className="app-shell flex min-h-dvh w-full min-w-0 flex-col" data-probe-shell>
      <header className="flex shrink-0 items-center border-b border-line px-4 text-[13px] font-semibold" style={{ height: "var(--header-h)" }}>
        GrovBase · probe
      </header>
      <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pt-4 pb-[var(--page-bottom)] sm:px-6 sm:pt-5 lg:px-8 lg:pb-14 lg:pt-6 xl:px-10">
        {bare ? children : <div className="workspace workspace-page gen-shell pt-1">{children}</div>}
      </main>
    </div>
  );
}

export function Harness({ kind, op, guideTool, items, cursor, available, photo, slug }: {
  kind: string; op: string | null; guideTool: string | null; items: number;
  cursor: string | null; available: boolean; photo: string; slug: string;
}) {
  const [fresh, setFresh] = useState<GalleryItem[]>([]);
  const [balance, setBalance] = useState(100);
  const [initial] = useState(() => Array.from({ length: items }, (_, i) => item(i + 1, op)));

  // app/(app)/tools/editor/page.tsx: the back link + title row, then the editor.
  if (kind === "editor") {
    return (
      <Shell>
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1" data-probe-editor-head>
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted">← Wszystkie narzędzia (probe)</span>
          <h1 className="font-display text-[17px] font-semibold tracking-tight">Edycja obrazu (probe)</h1>
        </div>
        <ImageEditor entry={null} initialImage={null} available={available} reason={available ? "ok" : "maintenance"}
          cutout={{ available: false, credits: 0, reason: "no_provider" }} balance={100} />
      </Shell>
    );
  }
  // app/(app)/tools/[slug]/page.tsx: back link, PageHeader, the workbench.
  if (kind === "workbench") {
    return (
      <Shell bare>
        <span className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted">← Wszystkie narzędzia (probe)</span>
        <PageHeader overline="1 kredyt (probe)" title={"Narzędzie " + slug + " (probe)"} sub="Opis narzędzia (probe)." />
        <ToolWorkbench tool={slug as ToolSlug} available={available} credits={1} providerLabel={null}
          reason={available ? "ok" : "maintenance"} balance={100} />
      </Shell>
    );
  }

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
  320: { name: "320", width: 320, height: 640, touch: true },
  360: { name: "360", width: 360, height: 780, touch: true },
  390: { name: "390", width: 390, height: 844, touch: true },
  834: { name: "834", width: 834, height: 1112, touch: false },
  1024: { name: "1024", width: 1024, height: 768, touch: false },
  1180: { name: "1180", width: 1180, height: 820, touch: false },
  1440: { name: "1440", width: 1440, height: 900, touch: false },
};
const WIDTHS = [390, 834, 1440];
const THEMES = ["light", "dark"];

/** lib/tool-guides.ts DEFAULT_STEP_ARTS, read from the file itself (every
 *  guide tool) so the probe cannot drift from the contract. */
const TG_SRC = fs.readFileSync(new URL("../lib/tool-guides.ts", import.meta.url), "utf8");
const ARTS = Object.fromEntries([.../DEFAULT_STEP_ARTS[^=]*= \{([\s\S]*?)\n\};/.exec(TG_SRC)[1].matchAll(/(\w+): \[([^\]]*)\]/g)]
  .map((m) => [m[1], m[2].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean)]));
/** The v2 tools: their surface, the URL that mounts them, and no starter. */
const V2 = {
  editor: { url: "/probe-tmp/guide?kind=editor", name: "editor" },
  tool_upscale: { url: "/probe-tmp/guide?kind=workbench&slug=upscale", name: "upscale" },
  tool_expand: { url: "/probe-tmp/guide?kind=workbench&slug=expand", name: "expand" },
  tool_watermark: { url: "/probe-tmp/guide?kind=workbench&slug=watermark", name: "watermark" },
};
const WORKBENCH_TOOLS = ["tool_upscale", "tool_expand", "tool_watermark"];
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
    // Has THIS user finished something in the tool? Decides the v1 auto-open.
    usedBefore: o.usedBefore === undefined ? false : o.usedBefore,
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
  editor: V2.editor.url,
  upscale: V2.tool_upscale.url,
  expand: V2.tool_expand.url,
  watermark: V2.tool_watermark.url,
  relight: "/probe-tmp/guide?kind=workbench&slug=relight",
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
  ["13", "[data-gallery-toolbar] vs the no-guide baseline; guide button placement"],
  ["14", "Compress / Resize workbench"],
  ["15", "starter screenshots light/dark × 3 widths"],
  ["P", "PhotoToolWorkspace (tool_remove_bg)"],
  ["E", "editor: button ends the timeline strip (icon below sm), no wrap vs baseline, auto-open, steps, no starter"],
  ["W", "workbenches: button in the Ustawienia header, panel height vs baseline, auto-open, steps, no starter; relight none"],
  ["S", "editor + workbench: PL/EN/DE × light/dark (label, aria, dialog layout, screenshots)"],
  ["X", "open → step 3 → Escape: page did not scroll, gallery pixels unchanged"],
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
    // NOT d.scrollWidth: the two decorative light washes (aria-hidden,
    // absolutely placed -right-24 / -left-24) are meant to bleed out and are
    // clipped by the dialog's overflow-hidden. What counts is content: the
    // header, the step scroller and the footer, each inside the dialog and
    // none wider than itself.
    dlgOverflowX: [...d.children].filter((c) => c.getAttribute("aria-hidden") !== "true").some((c) => {
      const cr = c.getBoundingClientRect();
      return cr.left < r.left - 0.5 || cr.right > r.right + 0.5 || c.scrollWidth > c.clientWidth + 1;
    }) || getComputedStyle(d).overflowX === "visible" && d.scrollWidth > d.clientWidth + 1,
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
    // the frame's border-box vs the room it has (the figure's content box)
    figW: fig ? fig.clientWidth : 0,
    boxLeftGap: br && fig ? Math.round((br.left - fig.getBoundingClientRect().left) * 10) / 10 : null,
    boxRightGap: br && fig ? Math.round((fig.getBoundingClientRect().right - br.right) * 10) / 10 : null,
    maxH: Math.min(innerHeight * 0.62, 560), vw: innerWidth,
    svg: Boolean(box?.querySelector("svg")), img: im, interactive,
    docOverflow: document.documentElement.scrollWidth > innerWidth,
    sRight: s.getBoundingClientRect().right,
  };
});
async function starterReady(P) {
  const loc = P.page.locator("[data-starter-gallery]");
  // The starter is a lazy chunk (components/tool-guide/lazy.tsx): under a
  // loaded `next dev` it can land a moment after the guide answer. Give it
  // 5 s and say how long it took when that was more than a blink.
  const t0 = Date.now();
  await loc.first().waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
  if ((await loc.count()) === 0) return false;
  if (Date.now() - t0 > 300) info("·", `[${P.label}] starter attached ${Date.now() - t0} ms after the guide answer settled`);
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
/** The Samouczek button the customer can see. A gallery renders it twice —
 *  above the gallery below `lg` (…lg:hidden) and inside the toolbar from `lg`
 *  up (span.hidden.lg:contents) — so every action targets the visible one. */
const GUIDE_BTN = "[data-guide-open]:visible";
const guideBtnCount = (P) => P.page.locator(GUIDE_BTN).count();

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
    if (ox > 1 && oy > 1) overlaps.push({ pair: `${a.n} × ${b.n}`, px: Math.round(ox) });
  }
  const rows = [];
  for (const c of ctrls) if (!rows.some((y) => Math.abs(y - c.cy) < 6)) rows.push(c.cy);
  // The guide button(s): the one the customer sees, wherever it is.
  const panel = tb.closest("[data-gallery-panel]") ?? document;
  const all = [...panel.querySelectorAll("[data-guide-open]")];
  const shown = all.filter(vis);
  const btn = shown[0] ?? null;
  const bb = btn?.getBoundingClientRect();
  const firstCtl = [...left.querySelectorAll("button, input, select")].find(vis) ?? null;
  return {
    h: Math.round(r.height * 10) / 10, w: Math.round(r.width), rows: rows.length,
    groupTops: [left, right].map((g) => Math.round(g.getBoundingClientRect().top - r.top)),
    overlaps,
    // 4.5px: the left group bleeds 4px each side on purpose (-mx-1 px-1, room
    // for focus rings in its scroller).
    outside: ctrls.filter((c) => c.x2 > r.right + 4.5 || c.x1 < r.left - 4.5).map((c) => c.n),
    rightOverflowPx: Math.max(0, Math.round(right.scrollWidth - right.clientWidth)),
    toolbarOverflowPx: Math.max(0, Math.round(tb.scrollWidth - tb.clientWidth - 4)),
    leftScrolls: left.scrollWidth > left.clientWidth + 1,
    docOverflow: document.documentElement.scrollWidth > innerWidth,
    guide: btn ? {
      inDom: all.length, shown: shown.length,
      inToolbar: tb.contains(btn),
      firstInLeft: firstCtl === btn,
      above: bb.bottom <= r.top + 0.5,
      overlapsToolbar: !(bb.bottom <= r.top + 0.5 || bb.top >= r.bottom - 0.5 || bb.right <= r.left || bb.left >= r.right),
      rightGap: Math.round((r.right - bb.right) * 10) / 10,
      clipped: btn.scrollWidth > btn.clientWidth + 1,
      inView: bb.left >= -0.5 && bb.right <= innerWidth + 0.5,
    } : { inDom: all.length, shown: 0 },
  };
});
/** Overlaps of `t` that the no-guide baseline `b` does not have (or has
 *  smaller by more than 1px) — the only ones this feature is answerable for. */
const newOverlaps = (t, b) => t.overlaps.filter((o) => !b.overlaps.some((x) => x.pair === o.pair && o.px <= x.px + 1));
const fmtOverlaps = (t) => (t.overlaps.length ? t.overlaps.map((o) => `${o.pair} (${o.px}px)`).join("; ") : "none");

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
  P.guide = (t) => guideFor(t, "pl", { seen: 1, noStarter: true });
  for (const u of [URLS.editor, URLS.upscale]) await go(P, u);
  await go(P, URLS.relight, false);
  await P.page.locator("p.overline").first().waitFor({ timeout: 120000 }).catch(() => {});
  console.log(`warm-up: v2 screens compiled; guide requests ${JSON.stringify(P.rec.guideReqs)}`);
  await closeP(P);
}
// The contract this probe reads: every guide tool's shipped copy has exactly
// one dictionary step per DEFAULT_STEP_ARTS entry, in every language.
{
  const bad = [];
  for (const [tool, arts] of Object.entries(ARTS)) for (const l of LOCALES) {
    const steps = Object.keys(DICT[l].toolGuideDefaults?.[tool]?.tutorial?.steps ?? {});
    if (steps.length !== arts.length) bad.push(`${tool}/${l}: ${steps.length} dictionary steps vs ${arts.length} arts`);
  }
  console.log(`contract: ${Object.keys(ARTS).length} guide tools in DEFAULT_STEP_ARTS${bad.length ? `; MISMATCH ${bad.join("; ")}` : "; dictionary step counts match in pl/en/de"}`);
  if (bad.length) results.get("E").fail.push(`dictionary step counts ≠ DEFAULT_STEP_ARTS: ${bad.join("; ")}`);
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
  // The v1 auto-open follows `usedBefore` (this user's own use of the tool),
  // not `hasResults` (the workspace's gallery, which only drives the starter).
  const cases = [
    { name: "live=false", o: { live: false }, open: false, button: false },
    { name: "usedBefore=true, version 1, seen 0", o: { usedBefore: true }, open: false, button: true },
    { name: "usedBefore=null, version 1, seen 0", o: { usedBefore: null }, open: false, button: true },
    { name: "usedBefore=true + hasResults=false, version 1, seen 0", o: { usedBefore: true, hasResults: false }, open: false, button: true },
    { name: "usedBefore=false + hasResults=true, version 1, seen 0 (hasResults no longer gates)", o: { usedBefore: false, hasResults: true }, open: true, button: true },
    { name: "usedBefore field missing from the answer (→ null), version 1", o: { usedBefore: "omit" }, open: false, button: true },
    { name: "seen 1 ≥ version 1", o: { seen: 1 }, open: false, button: true },
    { name: "seen 3 ≥ version 2", o: { seen: 3, version: 2 }, open: false, button: true },
    { name: "tutorial=null", o: { noTutorial: true }, open: false, button: false },
    { name: "guide=null (published guides unreadable)", o: { noGuide: true }, open: false, button: false },
    { name: "usedBefore=true, version 2, seen 1", o: { usedBefore: true, version: 2, seen: 1 }, open: true, button: true },
    { name: "usedBefore=null, version 2, seen 1", o: { usedBefore: null, version: 2, seen: 1 }, open: true, button: true },
  ];
  for (const c of cases) {
    const body = guideFor("retouch", "pl", c.o);
    if (c.o.usedBefore === "omit") delete body.usedBefore;
    const P = await openPage({ url: URLS.retouch, guide: body });
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
    await sleep(1500);
    check(3, "precondition: auto-open is waiting behind the blocker (no dialog, no POST)", (await dialogCount(P)) === 0 && P.rec.actions.length === 0);
    await P.page.locator(GUIDE_BTN).click();
    await waitDialog(P);
    await sleep(300);
    check(3, "manual open while the auto-open waits → exactly one POST, sent at that open", P.rec.actions.length === 1 && P.rec.actions[0].body.includes('"retouch"'), P.rec.actions.map((a) => a.body));
    await P.page.locator("[data-guide-close]").click();
    await waitClosed(P);
    await sleep(2500);
    check(3, "… closed, blocker still there → nothing reopens", (await dialogCount(P)) === 0 && (await opens(P)) === 1, { opens: await opens(P) });
    await P.page.evaluate(() => document.getElementById("probe-blocker")?.remove());
    await sleep(3000);
    const n = await opens(P);
    check(3, "… blocker removed → it does not reopen by itself (1 open, 1 POST in total)", (await dialogCount(P)) === 0 && n === 1 && P.rec.actions.length === 1,
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
  // The window key handler: shortcuts, already-handled keys and keys aimed at
  // something outside the dialog are not the tutorial's; <body> still is.
  {
    const P = await openPage({ url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1 }) });
    await P.page.locator(GUIDE_BTN).click();
    await waitDialog(P);
    for (const combo of ["Control+ArrowRight", "Alt+ArrowRight", "Meta+ArrowRight"]) {
      await P.page.keyboard.press(combo);
      await sleep(200);
      check(4, `${combo} is ignored (still "1 z 4")`, (await counterText(P)) === "1 z 4", await counterText(P));
    }
    for (const combo of ["Control+Escape", "Alt+Escape", "Meta+Escape"]) {
      await P.page.keyboard.press(combo);
      await sleep(200);
      check(4, `${combo} does not close the dialog`, (await dialogCount(P)) === 1);
    }
    // Already handled: a capture-phase listener earlier in the chain prevents it.
    await P.page.evaluate(() => {
      window.__probeEat = (e) => { if (e.key === "ArrowRight" || e.key === "Escape") e.preventDefault(); };
      document.addEventListener("keydown", window.__probeEat, true);
    });
    await P.page.keyboard.press("ArrowRight");
    await P.page.keyboard.press("Escape");
    await sleep(200);
    check(4, "a key already defaultPrevented elsewhere is ignored (→ and Escape do nothing)", (await counterText(P)) === "1 z 4" && (await dialogCount(P)) === 1, await counterText(P));
    await P.page.evaluate(() => document.removeEventListener("keydown", window.__probeEat, true));
    // Aimed at something stacked above the dialog (a search palette).
    await P.page.evaluate(() => {
      const i = document.createElement("input");
      i.id = "probe-palette"; i.value = "kubek";
      i.style.cssText = "position:fixed;left:10px;top:10px;z-index:70;width:200px;height:32px;font-size:16px";
      document.body.appendChild(i);
      i.focus();
    });
    await P.page.keyboard.press("ArrowRight");
    await P.page.keyboard.press("Escape");
    await sleep(200);
    check(4, "keys typed into an input outside the dialog are ignored (→, Escape)", (await counterText(P)) === "1 z 4" && (await dialogCount(P)) === 1,
      { counter: await counterText(P), open: await dialogCount(P), focus: await P.page.evaluate(() => document.activeElement?.id) });
    await P.page.evaluate(() => { document.getElementById("probe-palette")?.remove(); document.activeElement?.blur?.(); });
    const onBody = await P.page.evaluate(() => document.activeElement === document.body);
    await P.page.keyboard.press("ArrowRight");
    await sleep(250);
    check(4, "focus on <body>: → still moves the tutorial", onBody && (await counterText(P)) === "2 z 4", { onBody, counter: await counterText(P) });
    await P.page.keyboard.press("Escape");
    check(4, "focus on <body>: Escape still closes it", await waitClosed(P));
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
      const b = P.page.locator(GUIDE_BTN);
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
  // 1440: the button is in the toolbar; 834: below lg, above the gallery.
  const focusedOnVisibleButton = (P) => P.page.evaluate(() => {
    const a = document.activeElement;
    return Boolean(a?.hasAttribute("data-guide-open") && a.getBoundingClientRect().width > 0 && getComputedStyle(a).visibility !== "hidden");
  });
  for (const w of [1440, 834]) {
    const P = await openPage({ vp: VP[w], url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1 }) });
    const mounted = () => P.page.locator("[data-tool-tutorial]").count();
    check(6, `[${w}] closed: no [data-tool-tutorial] anywhere in the DOM`, (await mounted()) === 0, await mounted());
    const b = P.page.locator(GUIDE_BTN);
    await b.click();
    await waitDialog(P);
    check(6, `[${w}] open: exactly one [data-tool-tutorial]`, (await mounted()) === 1, await mounted());
    await P.page.locator("[data-guide-next]").click();
    await P.page.locator("[data-guide-next]").click();
    await sleep(300);
    const at3 = await counterText(P);
    await P.page.locator("[data-guide-close]").click();
    await waitClosed(P);
    await b.click();
    await waitDialog(P);
    check(6, `[${w}] reopen starts at step 1`, at3 === "3 z 4" && (await counterText(P)) === "1 z 4", { before: at3, now: await counterText(P) });
    check(6, `[${w}] manual opens make NO server-action POST`, P.rec.actions.length === 0, P.rec.actions.length);
    await P.page.locator("[data-guide-close]").click();
    await waitClosed(P);
    await sleep(100);
    check(6, `[${w}] after X, focus is back on the visible Samouczek button`, await focusedOnVisibleButton(P),
      await P.page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
    await b.click();
    await waitDialog(P);
    await P.page.keyboard.press("Escape");
    await waitClosed(P);
    await sleep(100);
    check(6, `[${w}] after Escape, focus is back on the visible Samouczek button`, await focusedOnVisibleButton(P));
    check(6, `[${w}] closed again: [data-tool-tutorial] unmounted`, (await mounted()) === 0, await mounted());
    await closeP(P);
  }
}

/* ── 7. focus, aria, scroll lock ───────────────────────────────────────── */
if (run("7")) {
  section("7");
  {
    const P = await openPage({ url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1 }) });
    const bodyBefore = await P.page.evaluate(() => ({ inline: document.body.style.overflow, computed: getComputedStyle(document.body).overflow }));
    await P.page.locator(GUIDE_BTN).click();
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
    const afterPic = await P.page.evaluate(() => document.activeElement?.getAttribute("role"));
    path = await walk("Shift+Tab", 2);
    check(7, "after a click on the illustration (focus on the dialog box), Shift+Tab wraps to the LAST control and stays inside",
      afterPic === "dialog" && path[0] === "in:data-guide-next" && path.every((s) => s.startsWith("in:")), { focusAfterClick: afterPic, path });
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
    await P.page.locator(GUIDE_BTN).click();
    await waitDialog(P);
    const describe = () => P.page.evaluate(() => {
      const d = document.querySelector('[data-tool-tutorial] [role="dialog"]');
      const id = d.getAttribute("aria-describedby");
      const el = id ? document.getElementById(id) : null;
      return { id, text: el?.textContent.trim().slice(0, 40) ?? null, inCurrent: Boolean(el?.closest('section[aria-hidden="false"]')) };
    });
    await P.page.locator("[data-guide-next]").click();
    await sleep(300);
    const a = await describe();
    check(7, "step with an empty body: aria-describedby is not set (nothing dangles)", a.id === null, a);
    await P.page.locator("[data-guide-next]").click();
    await sleep(300);
    const b3 = await describe();
    check(7, "… next step (with a body): aria-describedby is back and resolves to that step's text", Boolean(b3.id && b3.text && b3.inCurrent), b3);
    await closeP(P);
  }
  {
    // Real scrolling: 834 is below lg, so the page itself scrolls. Opened by
    // hand so the inline styles can be read before the lock goes on.
    const P = await openPage({ vp: VP[834], url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1 }) });
    const styles = () => P.page.evaluate(() => ({
      html: document.documentElement.style.overflow, gutter: document.documentElement.style.scrollbarGutter,
      body: document.body.style.overflow, scrollbar: innerWidth - document.documentElement.clientWidth,
    }));
    const before = await styles();
    const tbX0 = await P.page.evaluate(() => document.querySelector("[data-gallery-toolbar]").getBoundingClientRect().left);
    await P.page.locator(GUIDE_BTN).click();
    await waitDialog(P);
    const during = await styles();
    const tbX1 = await P.page.evaluate(() => document.querySelector("[data-gallery-toolbar]").getBoundingClientRect().left);
    check(7, "[834] while open: <html> and <body> inline overflow hidden; scrollbar-gutter stable iff a classic scrollbar was showing",
      during.html === "hidden" && during.body === "hidden" && (before.scrollbar > 0 ? during.gutter === "stable" : during.gutter === before.gutter), { before, during });
    check(7, "[834] opening does not shift the page sideways (toolbar x unchanged)", Math.abs(tbX1 - tbX0) < 0.5, { before: tbX0, open: tbX1 });
    const y0 = await P.page.evaluate(() => scrollY);
    const room = await P.page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    await P.page.mouse.move(10, 20);
    await P.page.mouse.wheel(0, 500);
    await sleep(500);
    const y1 = await P.page.evaluate(() => scrollY);
    const lock = await P.page.evaluate(() => ({ html: getComputedStyle(document.documentElement).overflowX + "/" + getComputedStyle(document.documentElement).overflowY, body: getComputedStyle(document.body).overflow }));
    await P.page.keyboard.press("Escape");
    await waitClosed(P);
    const after = await styles();
    check(7, "[834] after close: html overflow, html scrollbar-gutter and body overflow inline styles back to their previous values",
      after.html === before.html && after.gutter === before.gutter && after.body === before.body, { before, after });
    await P.page.evaluate(() => window.scrollTo(0, 0));
    await P.page.mouse.move(10, 400);
    await P.page.mouse.wheel(0, 500);
    await sleep(500);
    const y2 = await P.page.evaluate(() => scrollY);
    check(7, "[834] page scrollable at all (control: wheel scrolls it once the dialog is closed)", room > 0 && y2 > 0, { room, afterClose: y2 });
    check(7, "[834] wheel over the scrim does NOT scroll the page while the dialog is open", y1 === y0, { room, y0, whileOpen: y1, overflow: lock });
    info(7, `[834] scrollbar width in this browser: ${before.scrollbar}px (headless Chromium hides scrollbars — the classic case runs below)`);
    await closeP(P);
  }
  {
    // A CLASSIC scrollbar: Playwright launches headless Chromium with
    // --hide-scrollbars; without it the page has a real 15px scrollbar, which
    // is what the scrollbar-gutter branch of the lock is for.
    const classic = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"], ignoreDefaultArgs: ["--hide-scrollbars"] });
    const ctx = await classic.newContext({ viewport: { width: 834, height: 1112 }, colorScheme: "light", bypassCSP: true, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: "ecs_locale", value: "pl", url: BASE }]);
    await ctx.addInitScript(() => { try { localStorage.setItem("theme", "light"); } catch { /* private mode */ } });
    await ctx.addInitScript(INIT);
    const P = await openPage({ ctx, vp: VP[834], url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1 }) });
    P.ownCtx = true;
    const styles = () => P.page.evaluate(() => ({
      html: document.documentElement.style.overflow, gutter: document.documentElement.style.scrollbarGutter,
      body: document.body.style.overflow, scrollbar: innerWidth - document.documentElement.clientWidth,
      tbX: Math.round(document.querySelector("[data-gallery-toolbar]").getBoundingClientRect().left * 10) / 10,
      tbW: Math.round(document.querySelector("[data-gallery-toolbar]").getBoundingClientRect().width * 10) / 10,
    }));
    const before = await styles();
    await P.page.locator(GUIDE_BTN).click();
    await waitDialog(P);
    const during = await styles();
    await P.page.mouse.move(10, 20);
    await P.page.mouse.wheel(0, 500);
    await sleep(500);
    const y1 = await P.page.evaluate(() => scrollY);
    await P.page.keyboard.press("Escape");
    await waitClosed(P);
    const after = await styles();
    check(7, `[834, classic ${before.scrollbar}px scrollbar] while open: scrollbar-gutter stable, overflow hidden, page width unchanged (no shift)`,
      before.scrollbar > 0 && during.gutter === "stable" && during.html === "hidden" && during.tbX === before.tbX && during.tbW === before.tbW, { before, during });
    check(7, `[834, classic scrollbar] wheel over the scrim does not scroll the page`, y1 === 0, { whileOpen: y1 });
    check(7, `[834, classic scrollbar] after close: inline html/body styles restored, layout unchanged`,
      after.html === before.html && after.gutter === before.gutter && after.body === before.body && after.tbX === before.tbX && after.tbW === before.tbW, { before, after });
    await P.ctx.close().catch(() => {});
    await classic.close();
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

/* ── 9b. 320×640 German: the narrowest phone, the longest labels ───────── */
if (run("9")) {
  for (const theme of THEMES) {
    const combo = `320-${theme}-de`;
    const P = await openPage({ vp: VP[320], theme, locale: "de", url: URLS.retouch, guide: guideFor("retouch", "de", { seen: 0 }) });
    if (!check(9, `[${combo}] dialog opened`, await waitDialog(P))) { await closeP(P); continue; }
    for (let s = 1; s <= 4; s++) {
      if (s > 1) { await press(P, P.page.locator("[data-guide-next]")); await sleep(450); }
      const g = await dialogGeom(P);
      const fails = [];
      if (g.rect.top < -0.5 || g.rect.left < -0.5 || g.rect.right > g.vw + 0.5 || g.rect.bottom > g.vh + 0.5) fails.push(`dialog outside viewport ${JSON.stringify(g.rect)}`);
      if (g.docScrollW > g.vw) fails.push(`page scrollWidth ${g.docScrollW} > ${g.vw}`);
      if (g.dlgOverflowX || g.scrollerOverflowX) fails.push("horizontal overflow inside the dialog");
      for (const b of g.btns.filter((x) => x.vis === "visible")) {
        if (!b.inView || !b.inDialog || !b.hit) fails.push(`${b.k} not fully visible/clickable ${JSON.stringify(b)}`);
        if (b.clipped) fails.push(`${b.k} text clipped "${b.text}"`);
      }
      for (const t of g.texts) if (t.clipped || t.outside) fails.push(`${t.tag} clipped "${t.text}"`);
      const footer = g.btns.filter((x) => x.k !== "data-guide-close").map((b) => `${b.k}${b.vis === "visible" ? "" : "(hidden)"} "${b.text}"`);
      check(9, `[${combo}] step ${s}: dialog inside the viewport, every footer button fully visible and unclipped`, fails.length === 0, fails.length ? fails : footer);
      if (s === 1) {
        const back = await P.page.evaluate(() => {
          const b = document.querySelector("[data-guide-back]");
          const label = b.querySelector("span");
          const r = label?.getBoundingClientRect();
          return { aria: b.getAttribute("aria-label"), text: b.textContent.trim(), labelSrOnly: Boolean(label && r.width <= 1 && r.height <= 1), width: Math.round(b.getBoundingClientRect().width) };
        });
        check(9, `[${combo}] back button is its arrow alone (label sr-only below 381px) and keeps aria-label "${TG("de", "back")}"`, back.aria === TG("de", "back") && back.labelSrOnly && back.text === TG("de", "back"), back);
        info(9, `[${combo}] footer: ${footer.join(" · ")}; step body ${g.scrollerScrollsY ? "scrolls inside the dialog" : "fits"} (dialog ${Math.round(g.rect.height)} of ${g.vh}px)`);
      }
      if (s === 2 || s === 4) await shot(P.page, `tut-${combo}-step${s}`);
    }
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
    ["editor", URLS.editor, "editor"], ["workbench upscale", URLS.upscale, "tool_upscale"],
    ["workbench expand", URLS.expand, "tool_expand"], ["workbench watermark", URLS.watermark, "tool_watermark"],
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
  // THE FRAME (starter-gallery.tsx): width = min(100%, cap × ratio), so the
  // frame has the picture's own shape — no bands — and a picture whose capped
  // height still fills the width uses the full width.
  const ratio = s.img ? s.img.nw / s.img.nh : 16 / 10;
  const frameAspect = s.boxW / s.boxH;
  const wantW = Math.min(s.figW, s.maxH * ratio);
  if (Math.abs(frameAspect / ratio - 1) > 0.02) fails.push(`frame aspect ${frameAspect.toFixed(3)} vs picture ${ratio.toFixed(3)} (bands)`);
  if (Math.abs(s.boxW - wantW) > 2) fails.push(`frame width ${s.boxW.toFixed(1)} vs expected min(${s.figW}, ${(s.maxH * ratio).toFixed(1)})`);
  if (s.img && Math.abs(s.img.paintedW - s.img.elW) > 1.5 && Math.abs(s.img.paintedH - s.img.elH) > 1.5) fails.push("picture smaller than its frame on both axes");
  if (Math.abs(s.boxLeftGap - s.boxRightGap) > 1) fails.push(`frame not centred (${s.boxLeftGap} / ${s.boxRightGap})`);
  return check(id, `${label}: badge/note from dictionary, ${expectImg ? "picture contained at its natural aspect" : "SVG art"}, frame = picture shape (±2%), width min(100%, cap×ratio), ≤ min(62vh,560px), zero controls`, fails.length === 0, fails);
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
      info(11, `[${w}-${theme}] frame ${Math.round(s.boxW)}×${Math.round(s.boxH)} of ${s.figW}px available (aspect ${boxAspect.toFixed(3)} vs 1.569)${s.boxW < s.figW - 2 ? " — height cap reached, frame narrower than the column" : " — full width"}`);
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
    for (const w of [1440, 834, 390]) {
      const P = await openPage({ vp: VP[w], url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1, starterImage: image }) });
      if (check(11, `[${w}] ${name}: starter visible`, await starterReady(P))) {
        const s = await starterGeom(P);
        starterChecks(11, `[${w}] ${name}`, s, "pl", Boolean(image));
        if (image) {
          const boxAspect = s.boxW / s.boxH, nat = image.width / image.height;
          info(11, `[${w}] ${name}: frame ${Math.round(s.boxW)}×${Math.round(s.boxH)} of ${s.figW}px (aspect ${boxAspect.toFixed(3)} vs ${nat.toFixed(3)}), painted ${Math.round(s.img.paintedW)}×${Math.round(s.img.paintedH)}, cap ${Math.round(s.maxH)}`
            + (Math.abs(boxAspect / nat - 1) > 0.02 ? " → BANDS: frame not the picture's shape" : ""));
          if (w === 1440 && name.startsWith("portrait")) {
            check(11, "[1440] portrait 340×425: painted ≈445×556, frame hugs it (no side bands: frame width − painted width ≤ 3px)",
              Math.abs(s.img.paintedW - 445) <= 3 && Math.abs(s.img.paintedH - 556) <= 3 && s.boxW - s.img.paintedW <= 3,
              { painted: [Math.round(s.img.paintedW), Math.round(s.img.paintedH)], frame: [Math.round(s.boxW), Math.round(s.boxH)] });
          }
          if (name.startsWith("banner")) {
            check(11, `[${w}] banner 922×200 (wide): frame uses the full column width`, Math.abs(s.boxW - s.figW) <= 1, { frameW: s.boxW, figW: s.figW });
          }
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
  // Where the button lives: above the gallery below the switch point, in the
  // toolbar's left group from it — `xl` (1280) for a tool's gallery (it has an
  // operation and a narrower column), `lg` (1024) for the generators.
  const tools = [
    ["retouch", URLS.retouch, "retouch", true, [390, 834, 1024, 1180, 1440]],
    ["flat lay", URLS.flatlay, "fashion_flat_lay", true, WIDTHS],
    ["generator", URLS.generator, "generator", false, [390, 834, 1024, 1180, 1440]],
  ];
  const preexisting = [];
  for (const [name, url, key, toolGallery, widths] of tools) for (const w of widths) for (const l of LOCALES) {
    const combo = `${name} ${w}-${l}`;
    // The same screen twice: with the guide (live, button shown) and with
    // guide=null (no button anywhere) — only differences are this feature's.
    const P = await openPage({ vp: VP[w], locale: l, url, guide: guideFor(key, l, { seen: 1, hasResults: true }) });
    const B = await openPage({ vp: VP[w], locale: l, url, guide: guideFor(key, l, { seen: 1, hasResults: true, noGuide: true }) });
    const t = await toolbarGeom(P);
    const b = await toolbarGeom(B);
    if (!t || !b) { check(13, `[${combo}] toolbar rendered`, false, { t: Boolean(t), b: Boolean(b) }); await closeP(P); await closeP(B); continue; }
    const fresh = newOverlaps(t, b);
    const regression = [];
    if (Math.abs(t.h - b.h) > 1) regression.push(`height ${t.h} vs baseline ${b.h}`);
    if (t.rows !== b.rows) regression.push(`rows ${t.rows} vs baseline ${b.rows}`);
    if (fresh.length) regression.push(`new overlaps: ${fresh.map((o) => `${o.pair} (${o.px}px)`).join("; ")}`);
    if (t.rightOverflowPx > b.rightOverflowPx + 1) regression.push(`right group overflow ${t.rightOverflowPx}px vs baseline ${b.rightOverflowPx}px`);
    if (t.toolbarOverflowPx > b.toolbarOverflowPx + 1) regression.push(`toolbar overflow ${t.toolbarOverflowPx}px vs baseline ${b.toolbarOverflowPx}px`);
    if (t.outside.some((n) => !b.outside.includes(n))) regression.push(`controls outside the toolbar: ${t.outside.join(", ")}`);
    if (t.docOverflow && !b.docOverflow) regression.push("page scrolls sideways");
    check(13, `[${combo}] toolbar identical to the no-guide baseline (height, rows, no new overlap or overflow)`, regression.length === 0,
      { regression, with: { h: t.h, rows: t.rows, overlaps: fmtOverlaps(t) }, baseline: { h: b.h, rows: b.rows, overlaps: fmtOverlaps(b) } });
    const clean = t.overlaps.length === 0 && t.rightOverflowPx === 0 && t.toolbarOverflowPx === 0 && t.outside.length === 0 && !t.docOverflow;
    if (!clean) {
      const same = regression.length === 0;
      preexisting.push(`[${combo}] ${fmtOverlaps(t)}; right-group overflow ${t.rightOverflowPx}px${same ? " — identical without the guide" : ""}`);
      info(13, `[${combo}] toolbar has overlaps/overflow: ${fmtOverlaps(t)}, right-group overflow ${t.rightOverflowPx}px (baseline: ${fmtOverlaps(b)}, ${b.rightOverflowPx}px) → ${same ? "PRE-EXISTING, not counted" : "REGRESSION"}`);
    }
    if (toolGallery && (w === 1024 || w === 1180)) {
      // Asked for outright at the two tablet-landscape widths: no overlap, no
      // overflow at all (not merely "no worse than without the guide").
      check(13, `[${combo}] no overlapping controls, no horizontal overflow (absolute)`, clean,
        { overlaps: fmtOverlaps(t), rightOverflowPx: t.rightOverflowPx, toolbarOverflowPx: t.toolbarOverflowPx, outside: t.outside });
    }
    if (toolGallery) {
      check(13, `[${combo}] tool gallery: one row ≤56px (baseline: ${b.rows} row, ${b.h}px)`, t.rows === 1 && t.h <= 56, { h: t.h, rows: t.rows });
    } else if (t.rows !== 1 || t.h > 56) {
      info(13, `[${combo}] generator: ${t.rows} rows / ${t.h}px — baseline ${b.rows} rows / ${b.h}px (pre-existing wrap${t.rows === b.rows ? ", unchanged" : ", CHANGED"})`);
    }
    // Where the button is.
    const g = t.guide;
    const switchAt = toolGallery ? 1280 : 1024;
    const bp = toolGallery ? "xl" : "lg";
    if (w < switchAt) {
      check(13, `[${combo}] <${bp}: one visible guide button, ABOVE the toolbar, not overlapping it, right-aligned, unclipped`,
        g.shown === 1 && !g.inToolbar && g.above && !g.overlapsToolbar && Math.abs(g.rightGap) <= 1 && !g.clipped && g.inView, g);
    } else {
      check(13, `[${combo}] ≥${bp}: one visible guide button, the first control of the toolbar's left group, unclipped`,
        g.shown === 1 && g.inToolbar && g.firstInLeft && !g.clipped, g);
    }
    if (l === "pl" || regression.length) await shot(P.page, `toolbar-${name.replace(" ", "")}-${w}-${l}`);
    if (regression.length) await shot(B.page, `toolbar-BASELINE-noguide-${name.replace(" ", "")}-${w}-${l}`);
    await closeP(P);
    await closeP(B);
  }
  if (preexisting.length) info(13, `toolbars with overlaps/overflow (${preexisting.length}): ${preexisting.join(" | ")}`);
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
  // The empty right column at 1440×900: the button row plus the empty state
  // must fit the column (photo-tool.tsx wraps them in one flex column).
  const column = (P) => P.page.evaluate(() => {
    const grid = document.querySelector("[data-photo-tool]");
    const c = grid && [...grid.children].find((x) => x.classList.contains("thin-scroll"));
    if (!c) return null;
    return {
      scrollH: c.scrollHeight, clientH: c.clientHeight, overflowY: getComputedStyle(c).overflowY,
      button: [...c.querySelectorAll("[data-guide-open]")].some((b) => b.getBoundingClientRect().width > 0),
      starter: Boolean(c.querySelector("[data-starter-gallery]")),
    };
  });
  for (const [name, o, wantButton] of [["empty, guide button shown (hasResults=true)", { hasResults: true }, true], ["empty, no guide (guide=null)", { noGuide: true }, false]]) {
    const P = await openPage({ vp: VP[1440], url: URLS.photo, guide: guideFor("tool_remove_bg", "pl", { seen: 1, ...o }) });
    await sleep(500);
    const col = await column(P);
    check("P", `[1440×900] ${name}: right column does not overflow (scrollHeight ≤ clientHeight + 1)`,
      col && col.scrollH <= col.clientH + 1 && col.button === wantButton && !col.starter, col);
    if (wantButton) await shot(P.page, "photo-remove_bg-1440-empty-with-button");
    await closeP(P);
  }
  {
    const P = await openPage({ vp: VP[1440], url: URLS.photo, guide: guideFor("tool_remove_bg", "pl", { seen: 1 }) });
    await starterReady(P);
    const col = await column(P);
    info("P", `[1440×900] with the starter (image=wide 1808×1152): column scrollHeight ${col?.scrollH} vs clientHeight ${col?.clientH} (${col && col.scrollH > col.clientH + 1 ? "scrolls inside the column" : "fits"})`);
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

/* ── E / W / S. the v2 screens: the editor and the workbenches ─────────── */

const r1 = (v) => Math.round(v * 10) / 10;
/** The editor's timeline strip (Cofnij · Ponów · Historia zmian [· Samouczek]):
 *  rows, height, collisions, truncation, and the guide button inside it. */
const stripGeom = (P) => P.page.evaluate((undoLabel) => {
  const undo = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === undoLabel);
  const strip = undo?.parentElement ?? null;
  if (!strip) return null;
  const r = strip.getBoundingClientRect();
  const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const kids = [...strip.children].filter(vis);
  const rows = [];
  for (const c of kids) { const t = Math.round(c.getBoundingClientRect().top); if (!rows.some((y) => Math.abs(y - t) < 4)) rows.push(t); }
  const boxes = kids.map((c) => { const b = c.getBoundingClientRect(); return { n: (c.getAttribute("aria-label") || c.textContent.trim()).slice(0, 24), x1: b.left, x2: b.right, y1: b.top, y2: b.bottom }; });
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    if (ox > 1 && oy > 1) overlaps.push(`${a.n} × ${b.n} (${Math.round(ox)}px)`);
  }
  const truncated = [...strip.querySelectorAll("span")]
    .filter((s) => getComputedStyle(s).textOverflow === "ellipsis" && s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent.trim());
  const outside = boxes.filter((b) => b.x2 > r.right + 0.5 || b.x1 < r.left - 0.5).map((b) => b.n);
  const btn = strip.querySelector("[data-guide-open]");
  let guide = null;
  if (btn) {
    const bb = btn.getBoundingClientRect();
    const ub = undo.getBoundingClientRect();
    const label = btn.querySelector("span");
    const lr = label?.getBoundingClientRect();
    const ls = label ? getComputedStyle(label) : null;
    const at = document.elementFromPoint(bb.left + bb.width / 2, bb.top + bb.height / 2);
    guide = {
      lastChild: Boolean(strip.lastElementChild?.contains(btn)),
      rightGap: Math.round((r.right - bb.right) * 10) / 10,
      sameRowAsUndo: Math.abs((bb.top + bb.bottom) / 2 - (ub.top + ub.bottom) / 2) <= 2,
      w: Math.round(bb.width), h: Math.round(bb.height),
      labelSrOnly: Boolean(label && ls.position === "absolute" && lr.width <= 1 && lr.height <= 1),
      labelText: label?.textContent.trim() ?? null,
      aria: btn.getAttribute("aria-label"), title: btn.getAttribute("title"), haspopup: btn.getAttribute("aria-haspopup"),
      clipped: btn.scrollWidth > btn.clientWidth + 1,
      inView: bb.left >= -0.5 && bb.right <= innerWidth + 0.5,
      hit: Boolean(at && btn.contains(at)),
    };
  }
  return {
    h: Math.round(r.height * 10) / 10, w: Math.round(r.width), rows: rows.length, count: kids.length, overlaps, truncated, outside, guide,
    inDom: document.querySelectorAll("[data-guide-open]").length,
    docOverflow: document.documentElement.scrollWidth > innerWidth,
  };
}, DICT[P.locale].editor.undo);

/** The workbench's settings panel: its "Ustawienia" header row and the guide button in it. */
const settingsGeom = (P) => P.page.evaluate((label) => {
  const ov = [...document.querySelectorAll("p.overline")].find((p) => p.textContent.trim() === label);
  const head = ov?.parentElement ?? null;
  const panel = head?.parentElement ?? null;
  if (!ov || !panel) return null;
  const pr = panel.getBoundingClientRect(), hr = head.getBoundingClientRect(), or = ov.getBoundingClientRect();
  const next = head.nextElementSibling?.getBoundingClientRect() ?? null;
  const btn = document.querySelector("[data-guide-open]");
  let guide = null;
  if (btn) {
    const bb = btn.getBoundingClientRect();
    const at = document.elementFromPoint(bb.left + bb.width / 2, bb.top + bb.height / 2);
    guide = {
      inHeader: head.contains(btn), inPanel: panel.contains(btn),
      sameRow: Math.abs((bb.top + bb.bottom) / 2 - (or.top + or.bottom) / 2) <= 2.5,
      rightGap: Math.round((hr.right - bb.right) * 10) / 10,
      insidePanelBox: bb.left >= pr.left - 0.5 && bb.right <= pr.right + 0.5 && bb.top >= pr.top - 0.5 && bb.bottom <= pr.bottom + 0.5,
      overlapsOverline: !(bb.left >= or.right || bb.right <= or.left || bb.top >= or.bottom || bb.bottom <= or.top),
      text: btn.textContent.trim(), aria: btn.getAttribute("aria-label"),
      clipped: btn.scrollWidth > btn.clientWidth + 1, w: Math.round(bb.width), h: Math.round(bb.height),
      hit: Boolean(at && btn.contains(at)),
    };
  }
  const R = (v) => Math.round(v * 10) / 10;
  return {
    panelH: R(pr.height), panelW: R(pr.width), headH: R(hr.height), headTop: R(hr.top - pr.top),
    nextTop: next ? R(next.top - pr.top) : null, guide,
    inDom: document.querySelectorAll("[data-guide-open]").length,
    docOverflow: document.documentElement.scrollWidth > innerWidth,
  };
}, DICT[P.locale].tools.settings);

/** The open tutorial's steps: count, titles (own text), art/picture per step. */
const tutorialSteps = (P) => P.page.evaluate(() => {
  const d = document.querySelector('[data-tool-tutorial] [role="dialog"]');
  if (!d) return null;
  const own = (el) => (el ? [...el.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join("").trim() : null);
  return {
    title: d.querySelector("h2")?.textContent.trim() ?? null,
    counter: d.querySelector("[data-guide-counter]")?.textContent.trim() ?? null,
    max: d.querySelector('[role="progressbar"]')?.getAttribute("aria-valuemax") ?? null,
    steps: [...d.querySelectorAll("[data-guide-step]")].map((s) => ({
      n: s.getAttribute("data-guide-step"), title: own(s.querySelector("h3")),
      svg: Boolean(s.querySelector("svg")), img: Boolean(s.querySelector("img")),
    })),
  };
});
/** No starter gallery was ever painted, and none is in the DOM now. */
const noStarterEver = async (P) => (await starterCount(P)) === 0 && (await P.page.evaluate(() => window.__tg.starterAt)) === null;

/** Auto-open rules on one v2 screen, at one width (the shared part of E and W). */
async function autoOpenRules(id, tool, url, w) {
  const key = `"${tool}"`;
  const P = await openPage({ vp: VP[w], url, guide: guideFor(tool, "pl", { seen: 0, noStarter: true }) });
  const opened = await waitDialog(P);
  await sleep(1200);
  check(id, `[${tool} ${w}] seen 0 / v1 / usedBefore false / live → auto-opens exactly once`, opened && (await opens(P)) === 1, { opens: await opens(P) });
  check(id, `[${tool} ${w}] … exactly ONE server-action POST, naming ${key}`, P.rec.actions.length === 1 && P.rec.actions[0].body.includes(key), P.rec.actions.map((a) => a.body));
  const st = await tutorialSteps(P);
  check(id, `[${tool} ${w}] … the ${tool} tutorial ("${DICT.pl.toolGuideDefaults[tool].tutorial.title}", ${ARTS[tool].length} steps)`,
    st?.title === DICT.pl.toolGuideDefaults[tool].tutorial.title && st?.steps.length === ARTS[tool].length, st && { title: st.title, steps: st.steps.length });
  await P.page.keyboard.press("Escape");
  await waitClosed(P);
  await sleep(2500);
  check(id, `[${tool} ${w}] closed and nothing reopened in 2.5 s`, (await dialogCount(P)) === 0 && (await opens(P)) === 1, { opens: await opens(P) });
  const reload = async (o) => {
    P.guide = guideFor(tool, "pl", { noStarter: true, ...o });
    await P.page.reload({ waitUntil: "domcontentloaded" });
    await guideSettled(P);
    await sleep(1800);
  };
  let before = P.rec.actions.length;
  await reload({ seen: 1 });
  check(id, `[${tool} ${w}] reload, seen 1 = v1 → no auto-open, no POST, button there`,
    (await opens(P)) === 0 && P.rec.actions.length === before && (await guideBtnCount(P)) === 1, { opens: await opens(P), posts: P.rec.actions.length - before, buttons: await guideBtnCount(P) });
  before = P.rec.actions.length;
  await reload({ seen: 1, version: 2, usedBefore: true });
  const reopened = await waitDialog(P, 3000);
  await sleep(600);
  check(id, `[${tool} ${w}] new version 2 (seen 1, usedBefore true) → auto-opens once again, one more POST`,
    reopened && (await opens(P)) === 1 && P.rec.actions.length === before + 1, { opens: await opens(P), posts: P.rec.actions.length - before });
  await P.page.keyboard.press("Escape");
  await waitClosed(P);
  before = P.rec.actions.length;
  await reload({ seen: 2, version: 2 });
  check(id, `[${tool} ${w}] reload, seen 2 = v2 → no auto-open, no POST`, (await opens(P)) === 0 && P.rec.actions.length === before, { opens: await opens(P), posts: P.rec.actions.length - before });
  check(id, `[${tool} ${w}] no starter gallery was ever painted on this screen`, await noStarterEver(P));
  await closeP(P);
}
async function negativeRules(id, tool, url) {
  const cases = [
    ["usedBefore=true, v1, seen 0", { usedBefore: true }, false, true],
    ["usedBefore=null, v1, seen 0", { usedBefore: null }, false, true],
    ["live=false", { live: false }, false, false],
    ["tutorial=null", { noTutorial: true }, false, false],
    ["guide=null", { noGuide: true }, false, false],
  ];
  for (const [name, o, , button] of cases) {
    const P = await openPage({ url, guide: guideFor(tool, "pl", { seen: 0, noStarter: true, ...o }) });
    await sleep(2200);
    check(id, `[${tool}] ${name} → no auto-open, no POST, button ${button ? "present" : "absent"}`,
      (await opens(P)) === 0 && P.rec.actions.length === 0 && (await guideBtnCount(P)) === (button ? 1 : 0),
      { opens: await opens(P), posts: P.rec.actions.length, buttons: await guideBtnCount(P) });
    await closeP(P);
  }
  {
    const P = await openPage({ url, guide: guideFor(tool, "pl", { seen: 0 }), guideStatus: 500 });
    await sleep(1500);
    check(id, `[${tool}] guide request HTTP 500 → no button, no dialog, no POST`, (await guideBtnCount(P)) === 0 && (await opens(P)) === 0 && P.rec.actions.length === 0);
    await closeP(P);
  }
  // The server sends starter: null for these tools; even one sent anyway
  // (with hasResults false) has nowhere to appear on a screen with no gallery.
  for (const [name, o] of [["starter=null (what the server sends)", { noStarter: true }], ["a starter sent anyway, hasResults=false", { hasResults: false }], ["a starter sent anyway, hasResults=null", { hasResults: null }]]) {
    const P = await openPage({ url, guide: guideFor(tool, "pl", { seen: 1, ...o }) });
    await sleep(1800);
    check(id, `[${tool}] ${name} → no starter gallery in the DOM, none ever painted`, await noStarterEver(P), { now: await starterCount(P) });
    await closeP(P);
  }
}
/** Open by hand and walk every step: count, titles, art, last step, focus back. */
async function stepsWalk(id, tool, url, l = "pl") {
  const P = await openPage({ locale: l, url, guide: guideFor(tool, l, { seen: 1, noStarter: true, noStepImages: true }) });
  const N = ARTS[tool].length;
  const d = DICT[l].toolGuideDefaults[tool].tutorial;
  const b = P.page.locator(GUIDE_BTN);
  await b.click();
  await waitDialog(P);
  const st = await tutorialSteps(P);
  const wantTitles = Array.from({ length: N }, (_, i) => d.steps[`s${i + 1}`].title);
  check(id, `[${tool}/${l}] ${N} steps = DEFAULT_STEP_ARTS.${tool}.length; progressbar max ${N}; counter "${fill(TG(l, "counter"), { n: 1, total: N })}"`,
    st?.steps.length === N && st?.max === String(N) && st?.counter === fill(TG(l, "counter"), { n: 1, total: N }), st && { steps: st.steps.length, max: st.max, counter: st.counter });
  check(id, `[${tool}/${l}] step titles = the shipped copy s1…s${N}; every step draws its art (no picture)`,
    JSON.stringify(st?.steps.map((s) => s.title)) === JSON.stringify(wantTitles) && st.steps.every((s) => s.svg && !s.img), st?.steps);
  for (let i = 1; i < N; i++) { await P.page.locator("[data-guide-next]").click(); await sleep(120); }
  await sleep(250);
  check(id, `[${tool}/${l}] last step "${fill(TG(l, "counter"), { n: N, total: N })}", primary "${TG(l, "start")}"`,
    (await counterText(P)) === fill(TG(l, "counter"), { n: N, total: N }) && (await P.page.locator('[data-guide-next="start"]').textContent())?.trim() === TG(l, "start"),
    { counter: await counterText(P) });
  await P.page.locator('[data-guide-next="start"]').click();
  await waitClosed(P);
  await sleep(120);
  check(id, `[${tool}/${l}] "${TG(l, "start")}" closes; focus back on the guide button; no POST (manual open)`,
    (await dialogCount(P)) === 0 && (await P.page.evaluate(() => Boolean(document.activeElement?.hasAttribute("data-guide-open")))) && P.rec.actions.length === 0);
  await closeP(P);
}

if (run("E")) {
  section("E");
  // E1. Where the button is, and the strip against a no-guide baseline.
  const pre = [];
  for (const w of [320, 360, 390, 834, 1440]) for (const l of LOCALES) {
    const combo = `${w}-${l}`;
    const P = await openPage({ vp: VP[w], locale: l, url: URLS.editor, guide: guideFor("editor", l, { seen: 1, noStarter: true }) });
    const B = await openPage({ vp: VP[w], locale: l, url: URLS.editor, guide: guideFor("editor", l, { seen: 1, noGuide: true }) });
    const t = await stripGeom(P), b = await stripGeom(B);
    if (!check("E", `[${combo}] timeline strip rendered (with and without the guide)`, Boolean(t && b), { t: Boolean(t), b: Boolean(b) })) { await closeP(P); await closeP(B); continue; }
    const g = t.guide;
    check("E", `[${combo}] the guide button is the LAST item of the timeline strip, right-aligned (ml-auto), clickable, unclipped`,
      Boolean(g && g.lastChild && Math.abs(g.rightGap) <= 1 && g.hit && !g.clipped && g.inView && t.inDom === 1), g ?? { inDom: t.inDom });
    const small = w < 640;
    check("E", `[${combo}] ${small ? "below sm: icon only (label sr-only)" : "sm and up: label visible"}; aria-label "${TG(l, "openAria")}", aria-haspopup dialog`,
      Boolean(g && g.labelSrOnly === small && g.labelText === TG(l, "open") && g.aria === TG(l, "openAria") && g.haspopup === "dialog"), g);
    check("E", `[${combo}] baseline (guide=null): no button anywhere`, b.inDom === 0, b.inDom);
    const reg = [];
    if (t.rows !== b.rows) reg.push(`rows ${t.rows} vs baseline ${b.rows}`);
    if (Math.abs(t.h - b.h) > 1) reg.push(`height ${t.h} vs baseline ${b.h}`);
    if (t.overlaps.length) reg.push(`overlaps: ${t.overlaps.join("; ")}`);
    if (t.outside.length) reg.push(`outside the strip: ${t.outside.join(", ")}`);
    if (t.truncated.length > b.truncated.length) reg.push(`truncated labels: ${t.truncated.join(", ")}`);
    if (t.docOverflow && !b.docOverflow) reg.push("page scrolls sideways");
    // Where the baseline already wraps, the button riding on the second row
    // is the strip's own wrap, not this feature's.
    if (g && !g.sameRowAsUndo && b.rows === 1) reg.push("button not on Cofnij's row");
    check("E", `[${combo}] strip vs no-guide baseline: same rows and height (±1px), no overlap/overflow/truncation${b.rows === 1 ? ", button on Cofnij's row" : ""}`, reg.length === 0,
      { reg, with: { rows: t.rows, h: t.h, n: t.count }, baseline: { rows: b.rows, h: b.h, n: b.count } });
    if (b.rows === 1) check("E", `[${combo}] strip is ONE row with the button (baseline: 1 row, ${b.h}px)`, t.rows === 1, { rows: t.rows, h: t.h });
    else { pre.push(`${combo}: baseline already ${b.rows} rows`); info("E", `[${combo}] baseline strip already wraps (${b.rows} rows, ${b.h}px) — PRE-EXISTING; with the guide ${t.rows} rows, ${t.h}px`); }
    info("E", `[${combo}] strip ${t.w}px wide, ${t.rows} row(s) ${t.h}px, ${t.count} items; button ${g?.w}×${g?.h}`);
    if (l === "pl" || reg.length) await shot(P.page, `editor-strip-${w}-${l}`);
    if (reg.length) await shot(B.page, `editor-strip-BASELINE-noguide-${w}-${l}`);
    await closeP(P);
    await closeP(B);
  }
  if (pre.length) info("E", `pre-existing wraps: ${pre.join(" | ")}`);
  // E2. Auto-open once per version; the rules that keep it closed.
  for (const w of [1440, 390]) await autoOpenRules("E", "editor", URLS.editor, w);
  await negativeRules("E", "editor", URLS.editor);
  // E3. The steps are the shipped ones (DEFAULT_STEP_ARTS.editor).
  for (const l of LOCALES) await stepsWalk("E", "editor", URLS.editor, l);
  // E4. One request, for "editor".
  {
    const P = await openPage({ url: URLS.editor, guide: guideFor("editor", "pl", { seen: 1, noStarter: true }) });
    check("E", "the editor asks /api/tool-guides for tool=editor only", [...new Set(P.rec.guideReqs)].join() === "editor", P.rec.guideReqs);
    await closeP(P);
  }
}

if (run("W")) {
  section("W");
  // W1. The button in the "Ustawienia" header; the panel's height against a no-guide baseline.
  const matrix = [
    ...[320, 390, 834, 1440].flatMap((w) => LOCALES.map((l) => ["tool_upscale", w, l])),
    ...["tool_expand", "tool_watermark"].flatMap((tool) => [390, 1440].flatMap((w) => LOCALES.map((l) => [tool, w, l]))),
  ];
  for (const [tool, w, l] of matrix) {
    const combo = `${V2[tool].name} ${w}-${l}`;
    const P = await openPage({ vp: VP[w], locale: l, url: V2[tool].url, guide: guideFor(tool, l, { seen: 1, noStarter: true }) });
    const B = await openPage({ vp: VP[w], locale: l, url: V2[tool].url, guide: guideFor(tool, l, { seen: 1, noGuide: true }) });
    const t = await settingsGeom(P), b = await settingsGeom(B);
    if (!check("W", `[${combo}] settings panel rendered (with and without the guide)`, Boolean(t && b), { t: Boolean(t), b: Boolean(b) })) { await closeP(P); await closeP(B); continue; }
    const g = t.guide;
    check("W", `[${combo}] the guide button sits in the "${DICT[l].tools.settings}" header: same row, right-aligned, inside the panel, clickable, label "${TG(l, "open")}"`,
      Boolean(g && g.inHeader && g.sameRow && Math.abs(g.rightGap) <= 1 && g.insidePanelBox && !g.overlapsOverline && g.hit && !g.clipped
        && g.text === TG(l, "open") && g.aria === TG(l, "openAria") && t.inDom === 1), g ?? { inDom: t.inDom });
    check("W", `[${combo}] settings panel height = baseline ±1px (${b.panelH}px), header row and the content under it unmoved`,
      Math.abs(t.panelH - b.panelH) <= 1 && Math.abs(t.headH - b.headH) <= 1 && t.nextTop !== null && Math.abs(t.nextTop - b.nextTop) <= 1 && t.panelW === b.panelW && !t.docOverflow,
      { with: { panelH: t.panelH, headH: t.headH, nextTop: t.nextTop, w: t.panelW }, baseline: { panelH: b.panelH, headH: b.headH, nextTop: b.nextTop, w: b.panelW }, docOverflow: t.docOverflow });
    check("W", `[${combo}] baseline (guide=null): no button anywhere`, b.inDom === 0, b.inDom);
    if (l === "pl" && (w === 390 || w === 1440)) await shot(P.page, `workbench-${V2[tool].name}-${w}-pl`);
    await closeP(P);
    await closeP(B);
  }
  // W2. relight is not a guide tool: no request, no button, nothing posted.
  for (const w of [1440, 390]) {
    const P = await openPage({ vp: VP[w], url: URLS.relight, guide: guideFor("retouch", "pl", { seen: 0 }), waitGuide: false });
    const shown = await P.page.locator("p.overline").filter({ hasText: DICT.pl.tools.settings }).first().waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
    await sleep(3000);
    check("W", `[relight ${w}] workbench rendered, NO /api/tool-guides request, no button, no dialog, no POST`,
      shown && P.rec.guideReqs.length === 0 && (await P.page.locator("[data-guide-open]").count()) === 0 && (await opens(P)) === 0 && P.rec.actions.length === 0,
      { shown, reqs: P.rec.guideReqs, buttons: await P.page.locator("[data-guide-open]").count(), posts: P.rec.actions.length });
    check("W", `[relight ${w}] no starter gallery`, await noStarterEver(P));
    await closeP(P);
  }
  // W3. Auto-open once per version; W4. the rules that keep it closed; W5. steps.
  for (const tool of WORKBENCH_TOOLS) await autoOpenRules("W", tool, V2[tool].url, tool === "tool_upscale" ? 1440 : 390);
  await autoOpenRules("W", "tool_upscale", V2.tool_upscale.url, 390);
  for (const tool of WORKBENCH_TOOLS) await negativeRules("W", tool, V2[tool].url);
  for (const tool of WORKBENCH_TOOLS) await stepsWalk("W", tool, V2[tool].url, "pl");
  for (const l of ["en", "de"]) await stepsWalk("W", "tool_watermark", V2.tool_watermark.url, l);
  // W6. A workbench that cannot run (available=false): its own unavailable panel, no button.
  {
    const P = await openPage({ url: URLS.upscale + "&available=0", guide: guideFor("tool_upscale", "pl", { seen: 1, live: false, noStarter: true }) });
    await sleep(800);
    const panel = await P.page.getByText(DICT.pl.tools.unavailableTitle).isVisible().catch(() => false);
    check("W", "[upscale available=0, live=false] the unavailable panel, no button, no dialog, no POST",
      panel && (await guideBtnCount(P)) === 0 && (await opens(P)) === 0 && P.rec.actions.length === 0, { panel, buttons: await guideBtnCount(P) });
    await closeP(P);
  }
  {
    // Not a state the server produces (toolIsLive reads the same catalogue
    // entry as the page) — logged, not counted: what the hook does if the two
    // ever disagreed for one render.
    const P = await openPage({ url: URLS.upscale + "&available=0", guide: guideFor("tool_upscale", "pl", { seen: 0, live: true, noStarter: true }) });
    await sleep(2500);
    info("W", `[upscale available=0 but live=true, seen 0 — inconsistent answer] dialog mounted ${await dialogCount(P)}, mark-seen POSTs ${P.rec.actions.length}${P.rec.actions.length && !(await dialogCount(P)) ? " (marked seen without being shown: the unavailable panel renders no guide.dialog)" : ""}`);
    await closeP(P);
  }
}

if (run("S")) {
  section("S");
  // Every v2 screen in each language and theme: the button's words, the
  // dialog's layout at a phone and a desktop width, screenshots.
  for (const tool of ["editor", "tool_upscale"]) for (const w of [390, 1440]) for (const theme of THEMES) for (const l of LOCALES) {
    const combo = `${V2[tool].name}-${w}-${theme}-${l}`;
    const P = await openPage({ vp: VP[w], theme, locale: l, url: V2[tool].url, guide: guideFor(tool, l, { seen: 1, noStarter: true }) });
    const themeOk = await P.page.evaluate((th) => document.documentElement.classList.contains("dark") === (th === "dark"), theme);
    const btn = await P.page.evaluate(() => {
      const b = document.querySelector("[data-guide-open]");
      const s = b?.querySelector("span");
      return b ? { aria: b.getAttribute("aria-label"), title: b.getAttribute("title"), label: s?.textContent.trim(), srOnly: s ? s.getBoundingClientRect().width <= 1 : null } : null;
    });
    const iconOnly = tool === "editor" && w < 640;
    check("S", `[${combo}] theme applied; button aria/title "${TG(l, "openAria")}", label "${TG(l, "open")}"${iconOnly ? " (sr-only)" : ""}`,
      themeOk && btn && btn.aria === TG(l, "openAria") && btn.title === TG(l, "openAria") && btn.label === TG(l, "open") && btn.srOnly === iconOnly, { themeOk, btn });
    await shot(P.page, `v2-${combo}`);
    const b = P.page.locator(GUIDE_BTN);
    await b.scrollIntoViewIfNeeded();
    await press(P, b);
    if (!check("S", `[${combo}] tutorial opens from the button`, await waitDialog(P))) { await closeP(P); continue; }
    const N = ARTS[tool].length;
    // The sheet's entrance animation scales it (getBoundingClientRect sees
    // ~0.98 × its height until it ends): measure once it has finished.
    const settle = () => P.page.evaluate(() => Promise.race([
      Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, 3000)),
    ])).catch(() => undefined);
    await settle();
    const hs = [await dlgHeight(P)];
    await press(P, P.page.locator("[data-guide-next]"));
    await sleep(450);
    await settle();
    const g = await dialogGeom(P);
    hs.push(g.rect.height);
    const fails = [];
    if (g.counter !== fill(TG(l, "counter"), { n: 2, total: N })) fails.push(`counter "${g.counter}"`);
    if (g.rect.top < -0.5 || g.rect.left < -0.5 || g.rect.right > g.vw + 0.5 || g.rect.bottom > g.vh + 0.5) fails.push(`dialog outside viewport ${JSON.stringify(g.rect)}`);
    if (g.docScrollW > g.vw) fails.push(`page scrollWidth ${g.docScrollW} > ${g.vw}`);
    if (g.dlgOverflowX || g.scrollerOverflowX) fails.push("horizontal overflow inside the dialog");
    for (const x of g.btns.filter((y) => y.vis === "visible")) {
      if (!x.inView || !x.inDialog || !x.hit) fails.push(`button ${x.k} not fully visible/clickable ${JSON.stringify(x)}`);
      if (x.clipped) fails.push(`button ${x.k} text clipped "${x.text}"`);
    }
    for (const x of g.texts) if (x.clipped || x.outside) fails.push(`${x.tag} clipped "${x.text}"`);
    check("S", `[${combo}] dialog inside the viewport, no horizontal overflow, footer visible, nothing clipped`, fails.length === 0, fails);
    await shot(P.page, `v2-${combo}-tutorial-step2`);
    for (let s = 3; s <= N; s++) { await press(P, P.page.locator("[data-guide-next]")); await sleep(350); hs.push(await dlgHeight(P)); }
    check("S", `[${combo}] same dialog height on all ${N} steps`, Math.max(...hs) - Math.min(...hs) <= 1, hs.map(r1));
    await P.page.keyboard.press("Escape");
    check("S", `[${combo}] Escape closes`, await waitClosed(P));
    await closeP(P);
  }
  // The narrowest phone in German, and the other two workbenches once each.
  for (const theme of THEMES) {
    const P = await openPage({ vp: VP[320], theme, locale: "de", url: URLS.editor, guide: guideFor("editor", "de", { seen: 1, noStarter: true }) });
    await shot(P.page, `v2-editor-320-${theme}-de`);
    await P.page.locator(GUIDE_BTN).tap();
    if (await waitDialog(P)) {
      const g = await dialogGeom(P);
      const bad = g.btns.filter((x) => x.vis === "visible" && (!x.inView || !x.inDialog || !x.hit || x.clipped));
      check("S", `[editor-320-${theme}-de] dialog fits, every footer button visible and unclipped`,
        g.rect.left >= -0.5 && g.rect.right <= g.vw + 0.5 && g.rect.bottom <= g.vh + 0.5 && g.docScrollW <= g.vw && bad.length === 0, { rect: g.rect, bad });
      await shot(P.page, `v2-editor-320-${theme}-de-tutorial`);
    } else check("S", `[editor-320-${theme}-de] tutorial opens`, false);
    await closeP(P);
  }
  for (const tool of ["tool_expand", "tool_watermark"]) for (const theme of THEMES) {
    const P = await openPage({ theme, url: V2[tool].url, guide: guideFor(tool, "pl", { seen: 1, noStarter: true }) });
    await shot(P.page, `v2-${V2[tool].name}-1440-${theme}-pl`);
    check("S", `[${V2[tool].name}-1440-${theme}-pl] screenshot`, !SHOTS || fs.existsSync(`${SHOTS}/v2-${V2[tool].name}-1440-${theme}-pl.png`));
    await closeP(P);
  }
}

/* ── X. open → step 3 → Escape: nothing behind it moved ────────────────── */
/** Compare two equally sized PNG crops: pixels with ANY channel difference,
 *  and with a difference above 8/255 (sub-pixel anti-aliasing noise), plus a
 *  red-on-grey mask of the changed pixels and their bounding box. */
async function pixelDiff(a, b, maskPath, exclude = null) {
  const [ra, rb] = await Promise.all([a, b].map((x) => sharp(x).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) return { sizeMismatch: [ra.info, rb.info].map((i) => `${i.width}×${i.height}`) };
  const { width, height } = ra.info, n = width * height;
  const mask = Buffer.alloc(n * 3);
  let any = 0, over8 = 0, outside = 0, x1 = width, y1 = height, x2 = -1, y2 = -1;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(ra.data[i * 3 + c] - rb.data[i * 3 + c]));
    const grey = Math.round((ra.data[i * 3] + ra.data[i * 3 + 1] + ra.data[i * 3 + 2]) / 9) + 150;
    if (m > 0) {
      any++;
      const x = i % width, y = Math.floor(i / width);
      x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
      if (!exclude || x < exclude[0] || x > exclude[2] || y < exclude[1] || y > exclude[3]) outside++;
      mask[i * 3] = 255; mask[i * 3 + 1] = 0; mask[i * 3 + 2] = 0;
    } else { mask[i * 3] = mask[i * 3 + 1] = mask[i * 3 + 2] = Math.min(255, grey); }
    if (m > 8) over8++;
  }
  if (maskPath) await sharp(mask, { raw: { width, height, channels: 3 } }).png().toFile(maskPath).then(() => shots.push(maskPath)).catch(() => {});
  return { pixels: n, any, over8, outside, pctAny: (any / n) * 100, pctOver8: (over8 / n) * 100, box: any ? [x1, y1, x2, y2] : null };
}
if (run("X")) {
  section("X");
  for (const w of WIDTHS) for (const theme of THEMES) {
    const combo = `${w}-${theme}`;
    const P = await openPage({ vp: VP[w], theme, url: URLS.retouch, guide: guideFor("retouch", "pl", { seen: 1 }) });
    await P.page.waitForFunction(() => {
      const img = document.querySelector("[data-starter-gallery] figure img");
      return Boolean(img && img.complete && img.naturalWidth > 0);
    }, null, { timeout: 15000 }).catch(() => {});
    const btn = P.page.locator(GUIDE_BTN);
    await btn.scrollIntoViewIfNeeded();
    if (!P.vp.touch) await P.page.mouse.move(2, 2);
    await sleep(500);
    const state = () => P.page.evaluate(() => {
      const p = document.querySelector("[data-gallery-panel]").getBoundingClientRect();
      return {
        y: scrollY, col: document.querySelector("[data-probe-right]")?.scrollTop ?? null,
        panel: [p.left, p.top, p.width, p.height].map((v) => Math.round(v * 10) / 10), vw: innerWidth, vh: innerHeight,
      };
    });
    const before = await state();
    const shotA = await P.page.screenshot({ animations: "disabled" });
    await press(P, btn);
    await waitDialog(P);
    await press(P, P.page.locator("[data-guide-next]"));
    await press(P, P.page.locator("[data-guide-next]"));
    await sleep(400);
    const at = await counterText(P);
    await P.page.keyboard.press("Escape");
    const closed = await waitClosed(P);
    if (!P.vp.touch) await P.page.mouse.move(2, 2);
    await sleep(700);
    const after = await state();
    const shotB = await P.page.screenshot({ animations: "disabled" });
    check("X", `[${combo}] opened, reached step 3 ("${at}"), Escape closed it`, at === "3 z 4" && closed, { at, closed });
    check("X", `[${combo}] page did not scroll (window scrollY, gallery column scrollTop) and the gallery did not move`,
      before.y === after.y && before.col === after.col && JSON.stringify(before.panel) === JSON.stringify(after.panel), { before, after });
    // The gallery panel's visible part (toolbar + starter), identical crop on both shots.
    const [px, py, pw, ph] = before.panel;
    const left = Math.max(0, Math.floor(px)), top = Math.max(0, Math.floor(py));
    const width = Math.min(before.vw, Math.ceil(px + pw)) - left, height = Math.min(before.vh, Math.ceil(py + ph)) - top;
    const crop = (buf) => sharp(buf).extract({ left, top, width, height }).png().toBuffer();
    const [ca, cb] = await Promise.all([crop(shotA), crop(shotB)]);
    if (SHOTS) {
      for (const [name, buf] of [[`X-${combo}-before`, ca], [`X-${combo}-after`, cb]]) {
        fs.writeFileSync(`${SHOTS}/${name}.png`, buf);
        shots.push(`${SHOTS}/${name}.png`);
      }
    }
    const focus = await P.page.evaluate(() => {
      const a = document.activeElement;
      if (!a?.hasAttribute("data-guide-open")) return null;
      const r = a.getBoundingClientRect();
      return { focusVisible: a.matches(":focus-visible"), rect: [r.left, r.top, r.right, r.bottom].map(Math.round) };
    });
    // The returning focus ring is expected; count what changed outside it too.
    const ring = focus ? [focus.rect[0] - left - 5, focus.rect[1] - top - 5, focus.rect[2] - left + 5, focus.rect[3] - top + 5] : null;
    const d = await pixelDiff(ca, cb, SHOTS ? `${SHOTS}/X-${combo}-diff.png` : null, ring);
    // Criterion: pixels whose colour moved by more than 8/255 on any channel.
    // A strict any-difference count is logged too: once in four runs a single
    // raster tile of the dark starter gradient came back re-dithered by ≤8/255
    // (4.2% of the panel, nothing moved), which is GPU noise, not a change.
    check("X", `[${combo}] gallery panel (${width}×${height}) unchanged: ≤0.5% of pixels differ by more than 8/255`,
      !d.sizeMismatch && d.pctOver8 <= 0.5, d.sizeMismatch ? d : { over8: d.over8, pct: d.pctOver8.toFixed(3) + "%", strictAny: d.any, box: d.box });
    info("X", `[${combo}] ${d.any ?? "?"} of ${d.pixels ?? "?"} px differ (${d.pctAny?.toFixed(3)}%; ${d.over8} above 8/255; ${d.outside} outside the button's focus ring = ${(d.outside / d.pixels * 100).toFixed(3)}%) in box ${JSON.stringify(d.box)}; focus back on the button: ${JSON.stringify(focus)} (panel origin ${left},${top})`);
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
