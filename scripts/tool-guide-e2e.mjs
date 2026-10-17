/**
 * TOOL GUIDES v2 — REAL LOGGED-IN END-TO-END PROBE against the LOCAL Supabase
 * stack (never PROD, never DEV): a real `next build` + `next start`, real
 * GoTrue sessions (the e-mailed step-up read from the local Mailpit), real
 * server actions, PostgREST + RLS and Storage. No AI provider is ever called:
 * the probe never presses a run/process button, and the only provider
 * credentials it creates (phase `stubs`) are dummies whose base URL is a dead
 * local port (https://127.0.0.1:9).
 *
 * PREREQUISITES — the local E2E environment (its README documents it):
 *   E2E=<dir with login.mjs, stack-up.sh, build-app.sh, app-start.sh, app-stop.sh>
 *   bash $E2E/stack-up.sh                 # containers + migrations 0001…0142 + seed
 *   bash $E2E/build-app.sh                # copies THIS working tree to $E2E/app and builds it
 *   bash $E2E/app-start.sh                # http://localhost:3400, PID in $E2E/app.pid
 *   node $E2E/seed-ui.mjs                 # publishes a placeholder Retusz prompt (retouch live)
 *
 * RUN:
 *   export TG_E2E_DIR=$E2E TG_E2E_BASE=http://localhost:3400 TG_E2E_SHOTS=$E2E/shots-v2
 *   node scripts/tool-guide-e2e.mjs stubs      # LOCAL DB stubs that make the photo tools,
 *                                              # upscale/expand and the generators live (idempotent)
 *   node scripts/tool-guide-e2e.mjs baseline   # on the OLD build: STEP 0 pages → $TG_E2E_SHOTS/baseline
 *                                              # (TG_E2E_APP=<old build dir> so meta.json names its commit)
 *   …rebuild ($E2E/build-app.sh) and restart ($E2E/app-stop.sh && $E2E/app-start.sh)…
 *   Run `stubs` BEFORE the baseline; every capture (baseline / regress) first clears the guide
 *   rows and guide pictures (LOCAL DB), so the old and the new build are photographed over the
 *   same data.
 *   node scripts/tool-guide-e2e.mjs all        # on the NEW build: regress (check 12) then checks 1–11
 *   node scripts/tool-guide-e2e.mjs checks     # only checks 1–11 (TG_E2E_ONLY=1,4,7 to subset)
 *   node scripts/tool-guide-e2e.mjs regress    # only check 12 (needs the baseline)
 *   node scripts/tool-guide-e2e.mjs reset      # LOCAL DB: drop the guide rows/pictures this probe wrote
 *   node scripts/tool-guide-e2e.mjs unstub     # LOCAL DB: remove the stubs again (back to the stack's seed)
 *   After `reset` (direct SQL) restart the app before `regress`: published guides are served from
 *   Next's data cache (300 s; media slots 600 s) and only an admin save busts it — the capture
 *   checks /api/tool-guides first and stops on a stale answer (or waits TG_E2E_CACHE_WAIT s).
 *
 * Env: TG_E2E_DIR (login.mjs dir, required), TG_E2E_BASE (app URL, default
 * http://localhost:3400), TG_E2E_SHOTS (output dir, default $TG_E2E_DIR/shots-v2),
 * TG_E2E_DB (Postgres URL — must be 127.0.0.1/localhost; default the local stack),
 * TG_E2E_REST (Kong, default http://127.0.0.1:54321), TG_E2E_KEY (local publishable key),
 * TG_E2E_APP (the built app dir, for the server-action ids; default $TG_E2E_DIR/app),
 * TG_E2E_ONLY (comma list of check numbers), TG_E2E_REPO (dictionaries; default this repo).
 *
 * Output: progress on stderr; the scoreboard JSON on stdout and in
 * $TG_E2E_SHOTS/report-<phase>.json; screenshots and diff images in $TG_E2E_SHOTS.
 *
 * What it writes, LOCAL DB only: the stubs below; user_preferences.metadata.tool_tutorials
 * of the two local test users (to reset "seen" between visits); tool_guides rows and
 * media_slots guide.* rows of the tools it edits (through the real admin UI; `reset` and the
 * start of `checks` delete them again so a re-run starts from the shipped guides); media
 * library files uploaded through the real picker when the library is empty.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const REPO = process.env.TG_E2E_REPO ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E2E_DIR = process.env.TG_E2E_DIR;
if (!E2E_DIR || !fs.existsSync(path.join(E2E_DIR, "login.mjs"))) {
  console.error("TG_E2E_DIR must point at the local E2E directory (the one holding login.mjs)");
  process.exit(2);
}
const BASE = (process.env.TG_E2E_BASE ?? "http://localhost:3400").replace(/\/$/, "");
const SHOTS = process.env.TG_E2E_SHOTS ?? path.join(E2E_DIR, "shots-v2");
const DB = process.env.TG_E2E_DB ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const REST = (process.env.TG_E2E_REST ?? "http://127.0.0.1:54321").replace(/\/$/, "");
const KEY = process.env.TG_E2E_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const APP_DIR = process.env.TG_E2E_APP ?? path.join(E2E_DIR, "app");
const ONLY = new Set((process.env.TG_E2E_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number));
const PHASE = process.argv[2] ?? "all";

// The probe touches only a LOCAL database and a LOCAL app.
for (const [name, value] of [["TG_E2E_DB", DB], ["TG_E2E_REST", REST], ["TG_E2E_BASE", BASE]]) {
  const host = new URL(value.replace(/^postgresql:/, "http:")).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    console.error(`${name} must be local (127.0.0.1/localhost), got ${host} — refusing`);
    process.exit(2);
  }
}

const { login, launchBrowser, USERS } = await import(pathToFileURL(path.join(E2E_DIR, "login.mjs")).href);
const requireRepo = createRequire(path.join(REPO, "package.json"));
const sharp = requireRepo("sharp");

fs.mkdirSync(SHOTS, { recursive: true });
const log = (s) => console.error(`[tg-e2e] ${s}`);

/* ── dictionaries ──────────────────────────────────────────────────────── */

const DICT = Object.fromEntries(["pl", "en", "de"].map((l) =>
  [l, JSON.parse(fs.readFileSync(path.join(REPO, "lib/i18n/dictionaries", `${l}.json`), "utf8"))]));
/** lib/i18n/t.ts lookup: nested, or "the rest of the path stored flat". */
function lookup(dict, key) {
  const parts = key.split(".");
  let node = dict;
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== "object") return undefined;
    const rest = parts.slice(i).join(".");
    if (typeof node[rest] === "string") return node[rest];
    node = node[parts[i]];
  }
  return typeof node === "string" ? node : undefined;
}
function t(locale, key, vars = {}) {
  const raw = lookup(DICT[locale], key) ?? lookup(DICT.pl, key);
  if (raw === undefined) throw new Error(`dictionary key missing: ${key}`);
  return raw.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
function shippedTutorial(locale, tool) {
  const base = lookup(DICT[locale], `toolGuideDefaults.${tool}.tutorial.title`) !== undefined ? DICT[locale] : DICT.pl;
  const g = base.toolGuideDefaults[tool].tutorial;
  return { title: g.title, steps: Object.keys(g.steps).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((k) => g.steps[k].title) };
}

/* ── the contract under test (mirrors lib/tool-guides.ts) ───────────────── */

const GUIDE_TOOLS = [
  "prompts", "generator", "retouch", "ecommerce_thumbnail",
  "fashion_ghost_mannequin", "fashion_flat_lay", "fashion_iron", "fashion_change_person", "fashion_change_face",
  "tool_remove_bg", "tool_white_bg", "tool_ai_background", "tool_ai_shadow",
  "resize", "compress",
  "editor", "tool_upscale", "tool_expand", "tool_watermark",
];
const NO_STARTER = new Set(["editor", "tool_upscale", "tool_expand", "tool_watermark"]);
const TOOL_PAGE = {
  prompts: "/prompts", generator: "/generator", retouch: "/retusz", ecommerce_thumbnail: "/k/ecommerce/thumbnail",
  fashion_ghost_mannequin: "/k/moda/ghostMannequin", fashion_flat_lay: "/k/moda/flatlay", fashion_iron: "/k/moda/iron",
  fashion_change_person: "/k/moda/changePerson", fashion_change_face: "/k/moda/changeFace",
  tool_remove_bg: "/tools/remove_bg", tool_white_bg: "/tools/white_bg", tool_ai_background: "/tools/ai_background",
  tool_ai_shadow: "/tools/ai_shadow", resize: "/tools/resize", compress: "/tools/compress", editor: "/tools/editor",
  tool_upscale: "/tools/upscale", tool_expand: "/tools/expand", tool_watermark: "/tools/watermark",
};

/** STEP 0 / check 12 pages. */
const REGRESS_CUSTOMER = ["/retusz", "/tools/compress", "/tools/resize", "/tools/editor", "/tools/upscale",
  "/tools/expand", "/tools/watermark", "/generator", "/prompts"];
const REGRESS_VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const REGRESS_ADMIN = ["/admin/ai/retouch?tab=basics", "/admin/ai/compress?tab=basics"];

/* ── local DB ──────────────────────────────────────────────────────────── */

const sql = (q) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-Atc", q], { encoding: "utf8" }).trim();
const sqlJson = (q) => JSON.parse(sql(`select coalesce(json_agg(x), '[]'::json) from (${q}) x`) || "[]");
const uid = (email) => sql(`select id from auth.users where email = '${email}'`);
const CUSTOMER_ID = uid(USERS.customer.email);
const ADMIN_ID = uid(USERS.admin.email);

function prefsOf(userId) {
  const raw = sql(`select metadata::text from public.user_preferences where user_id = '${userId}'`);
  return raw ? JSON.parse(raw) : null;
}
const seenOf = (userId) => prefsOf(userId)?.tool_tutorials ?? {};
function resetSeen(userId) {
  sql(`update public.user_preferences set metadata = metadata - 'tool_tutorials' where user_id = '${userId}'`);
}
function setSeen(userId, map) {
  sql(`update public.user_preferences set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{tool_tutorials}', '${JSON.stringify(map)}'::jsonb, true) where user_id = '${userId}'`);
}
/** Every guide tool "seen" at the highest version: no auto-open anywhere (baseline / regression captures). */
const markAllSeen = (userId) => setSeen(userId, Object.fromEntries(GUIDE_TOOLS.map((k) => [k, 1000000])));
const guideRow = (tool) => sqlJson(`select tool_key, tutorial_enabled, starter_enabled, tutorial_version, content, updated_at, updated_by from public.tool_guides where tool_key = '${tool}'`)[0] ?? null;
const guideSlots = (tool) => sqlJson(`select slot_key, media_id, updated_at from public.media_slots where slot_key like 'guide.${tool}.%' order by slot_key`);
const allGuideState = () => ({
  rows: sqlJson("select tool_key, tutorial_enabled, starter_enabled, tutorial_version, content, updated_at from public.tool_guides order by tool_key"),
  slots: sqlJson("select slot_key, media_id, updated_at from public.media_slots where slot_key like 'guide.%' order by slot_key"),
});

/* ── phase: stubs (LOCAL DB ONLY) ──────────────────────────────────────── */

/**
 * The minimum to make the remaining guide tools live locally, all on the LOCAL DB:
 *  - photoroom (the four photo tools) and fal (upscale + expand) providers active; google already is;
 *  - one ai_provider_credentials row each for photoroom, fal and google: vault sentinel columns,
 *    last_four 'STUB', base_url https://127.0.0.1:9 (a dead local port — every adapter routes
 *    to it, so even a mistaken run could reach no provider);
 *  - the matching Vault secret grovbase.provider.<id> = 'local-e2e-stub-not-a-key' (not a
 *    Photoroom sandbox key, so toolCatalogue treats it as live);
 *  - feature_availability ACTIVE for tool_remove_bg / tool_white_bg / tool_ai_background /
 *    tool_ai_shadow (registry default COMING_SOON).
 * Moda (fashion_*) and video stay COMING_SOON; Miniaturka stays not ready (no price, no OpenAI
 * key, no approved prompt) — those are the negative cases.
 */
function applyStubs() {
  const slugs = "('photoroom','fal','google')";
  sql(`begin;
    update public.ai_providers set active = true where slug in ${slugs};
    insert into public.ai_provider_credentials (provider_id, encrypted_value, iv, auth_tag, last_four, base_url, active)
      select id, 'vault', 'vault', 'vault', 'STUB', 'https://127.0.0.1:9', true from public.ai_providers where slug in ${slugs}
    on conflict (provider_id) do update set encrypted_value = 'vault', iv = 'vault', auth_tag = 'vault',
      last_four = 'STUB', base_url = 'https://127.0.0.1:9', active = true, updated_at = now();
    select vault.create_secret('local-e2e-stub-not-a-key', 'grovbase.provider.' || p.id, 'LOCAL E2E stub — not a provider key')
      from public.ai_providers p
     where p.slug in ${slugs} and not exists (select 1 from vault.secrets s where s.name = 'grovbase.provider.' || p.id);
    insert into public.feature_availability (feature_key, status)
      values ('tool_remove_bg','ACTIVE'), ('tool_white_bg','ACTIVE'), ('tool_ai_background','ACTIVE'), ('tool_ai_shadow','ACTIVE')
    on conflict (feature_key) do update set status = 'ACTIVE', updated_at = now();
    commit;`);
  return {
    providers: sqlJson(`select slug, active from public.ai_providers where slug in ${slugs} order by slug`),
    credentials: sqlJson(`select p.slug, c.last_four, c.base_url, c.active from public.ai_provider_credentials c join public.ai_providers p on p.id = c.provider_id order by p.slug`),
    vault: sqlJson(`select name from vault.secrets where name like 'grovbase.provider.%' order by name`),
    availability: sqlJson("select feature_key, status from public.feature_availability order by feature_key"),
  };
}

/** Undo applyStubs (LOCAL DB): the stub credentials and their Vault secrets, photoroom/fal back to
 *  inactive (google stays active, as the stack's seed has it), the four ACTIVE overrides removed. */
function removeStubs() {
  const slugs = "('photoroom','fal','google')";
  sql(`begin;
    delete from vault.secrets s using public.ai_providers p
     where p.slug in ${slugs} and s.name = 'grovbase.provider.' || p.id and s.description = 'LOCAL E2E stub — not a provider key';
    delete from public.ai_provider_credentials c using public.ai_providers p
     where p.id = c.provider_id and p.slug in ${slugs} and c.last_four = 'STUB' and c.base_url = 'https://127.0.0.1:9';
    update public.ai_providers set active = false where slug in ('photoroom','fal');
    delete from public.feature_availability where feature_key in ('tool_remove_bg','tool_white_bg','tool_ai_background','tool_ai_shadow');
    commit;`);
  return {
    providers: sqlJson(`select slug, active from public.ai_providers where slug in ${slugs} order by slug`),
    credentials: sqlJson("select provider_id from public.ai_provider_credentials"),
    vault: sqlJson("select name from vault.secrets where name like 'grovbase.provider.%'"),
    availability: sqlJson("select feature_key, status from public.feature_availability order by feature_key"),
  };
}

/** Drop what the guide checks wrote (rows + guide.* picture slots), so a run starts from the shipped guides. */
function resetGuides() {
  sql("begin; delete from public.media_slots where slot_key like 'guide.%'; delete from public.tool_guides; commit;");
}

/* ── scoreboard ────────────────────────────────────────────────────────── */

const board = [];
const issues = [];
function record(check, name, ok, evidence) {
  board.push({ check, name, ok: Boolean(ok), evidence });
  log(`${ok ? "✓" : "✗"} [${check}] ${name}${evidence !== undefined ? ` — ${JSON.stringify(evidence).slice(0, 400)}` : ""}`);
  return Boolean(ok);
}
async function guarded(check, fn) {
  if (ONLY.size > 0 && !ONLY.has(check)) return;
  try { await fn(); } catch (e) {
    record(check, `check ${check} crashed`, false, String(e?.stack ?? e).slice(0, 1200));
  }
}

/* ── browser helpers ───────────────────────────────────────────────────── */

const DESKTOP = { width: 1440, height: 900 };
let shotN = 0;
const shot = async (page, name, opts = {}) => {
  const file = path.join(SHOTS, `${String(++shotN).padStart(3, "0")}-${name}.png`);
  await page.screenshot({ path: file, animations: "disabled", caret: "hide", ...opts });
  return path.basename(file);
};

/** Console errors, page errors, failed requests and 4xx/5xx responses, per visited URL. */
function watch(page, role) {
  const where = () => { try { const u = new URL(page.url()); return `${u.pathname}${u.search}`; } catch { return page.url(); } };
  page.on("console", (m) => { if (m.type() === "error") issues.push({ role, page: where(), kind: "console", text: m.text().slice(0, 400) }); });
  page.on("pageerror", (e) => issues.push({ role, page: where(), kind: "pageerror", text: String(e).slice(0, 400) }));
  // net::ERR_ABORTED = the browser cancelled the request itself (a Link prefetch or an
  // in-flight fetch when the probe navigated on, a form POST answered by a redirect):
  // kept in the report, but not an app failure.
  page.on("requestfailed", (r) => {
    const err = r.failure()?.errorText ?? "";
    issues.push({ role, page: where(), kind: "requestfailed", text: `${r.method()} ${r.url().slice(0, 200)} ${err}`, expected: err === "net::ERR_ABORTED" ? "navigation-abort" : undefined });
  });
  page.on("response", (r) => { if (r.status() >= 400) issues.push({ role, page: where(), kind: `http${r.status()}`, text: `${r.request().method()} ${r.url().slice(0, 200)}` }); });
}

async function newRole(browser, role, next) {
  const ctx = await browser.newContext({ viewport: DESKTOP, locale: "pl-PL", reducedMotion: "reduce" });
  // next-themes (attribute="class", defaultTheme="dark"): the theme under test is
  // chosen through localStorage before any page script runs.
  await ctx.addInitScript(() => {
    try { localStorage.setItem("theme", localStorage.getItem("tg-e2e-theme") || "light"); } catch { /* no storage */ }
  });
  const page = await ctx.newPage();
  watch(page, role);
  const user = USERS[role];
  const r = await login(page, user.email, user.password, { next, baseURL: BASE, log: (s) => log(`  ${role}: ${s}`) });
  log(`${role} logged in (stepped up: ${r.steppedUp}) → ${r.url}`);
  return { ctx, page };
}

async function setTheme(page, theme) {
  await page.evaluate((v) => { localStorage.setItem("tg-e2e-theme", v); localStorage.setItem("theme", v); }, theme);
}
async function setLocale(ctx, locale) {
  const u = new URL(BASE);
  await ctx.addCookies([{ name: "ecs_locale", value: locale, domain: u.hostname, path: "/", sameSite: "Lax" }]);
}

/** Let a page finish: network idle, fonts, lazy pictures, and the guide fetch that runs after paint. */
async function settle(page, extra = 800) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.evaluate(async () => {
    await document.fonts?.ready;
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 150));
    window.scrollTo(0, 0);
    await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 4000); })));
  }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(extra);
}

async function go(page, url, extra) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await settle(page, extra);
}

const TUTORIAL = '[data-tool-tutorial] [role="dialog"]';

/** The open tutorial as a customer sees it: title, counter, every step's title (sr-only prefix removed). */
async function readTutorial(page) {
  return page.evaluate((sel) => {
    const d = document.querySelector(sel);
    if (!d) return null;
    const clean = (el) => { const c = el.cloneNode(true); c.querySelectorAll(".sr-only").forEach((n) => n.remove()); return c.textContent.trim(); };
    return {
      title: d.querySelector("h2")?.textContent.trim() ?? null,
      counter: d.querySelector("[data-guide-counter]")?.textContent.trim() ?? null,
      next: d.querySelector("[data-guide-next]")?.textContent.trim() ?? null,
      steps: [...d.querySelectorAll("section[data-guide-step]")].map((s) => ({
        title: clean(s.querySelector("h3")),
        img: s.querySelector("img")?.getAttribute("src") ?? null,
      })),
    };
  }, TUTORIAL);
}

async function visibleCount(page, selector) {
  return page.locator(selector).evaluateAll((els) => els.filter((e) => {
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  }).length);
}

async function guideApi(page, tool) {
  return page.evaluate(async (k) => {
    const r = await fetch(`/api/tool-guides?tool=${k}`, { cache: "no-store" });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, tool);
}

/* ── pixel diff (sharp) ────────────────────────────────────────────────── */

async function diffPng(aFile, bFile, outFile) {
  const read = async (f) => { const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
  const A = await read(aFile), B = await read(bFile);
  const W = Math.max(A.w, B.w), H = Math.max(A.h, B.h);
  const out = Buffer.alloc(W * H * 4);
  let diff = 0;
  const rows = new Array(H).fill(null);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const inA = x < A.w && y < A.h, inB = x < B.w && y < B.h;
      let differ = !(inA && inB), luma = 255;
      if (inA && inB) {
        const ia = (y * A.w + x) * 4, ib = (y * B.w + x) * 4;
        const d = Math.max(Math.abs(A.data[ia] - B.data[ib]), Math.abs(A.data[ia + 1] - B.data[ib + 1]), Math.abs(A.data[ia + 2] - B.data[ib + 2]));
        differ = d > 24;
        luma = 0.299 * A.data[ia] + 0.587 * A.data[ia + 1] + 0.114 * A.data[ia + 2];
      }
      if (differ) {
        diff++;
        out[o] = 255; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 255;
        const r = rows[y] ?? (rows[y] = [x, x]); r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x);
      } else {
        const g = Math.round(170 + luma / 3.1); out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
      }
    }
  }
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(outFile);
  // Bands of consecutive differing rows, with their x extent.
  const bands = [];
  for (let y = 0; y < H; y++) {
    if (!rows[y]) continue;
    const last = bands[bands.length - 1];
    if (last && y - last.y1 <= 2) { last.y1 = y; last.x0 = Math.min(last.x0, rows[y][0]); last.x1 = Math.max(last.x1, rows[y][1]); }
    else bands.push({ y0: y, y1: y, x0: rows[y][0], x1: rows[y][1] });
  }
  return { size: { baseline: `${A.w}x${A.h}`, current: `${B.w}x${B.h}` }, diffPixels: diff, diffPct: Number(((diff / (W * H)) * 100).toFixed(3)), bands: bands.slice(0, 12), bandCount: bands.length };
}

/* ── capture (STEP 0 and check 12) ─────────────────────────────────────── */

const slugOf = (url) => url.replace(/^\//, "").replace(/[/?=&]+/g, "_") || "root";

/** Spread (mean channel stdev) of the whole picture and of its first viewport: a flat,
 *  unpainted capture has almost none. */
async function spreadOf(file, height) {
  const sd = (st) => st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
  const meta = await sharp(file).metadata();
  const top = await sharp(file).extract({ left: 0, top: 0, width: meta.width, height: Math.min(height, meta.height) }).stats();
  return { all: sd(await sharp(file).stats()), top: sd(top) };
}

/**
 * One full-page capture, retaken (up to twice) when it came out unpainted — an empty <main>
 * or a flat picture. Seen on this loaded machine for one tall page per run, on either
 * build; every retake is recorded in meta.json, never hidden.
 */
async function snap(page, url, file, height) {
  const painted = () => page.evaluate(() => (document.querySelector("main")?.innerText ?? "").trim().length);
  let retakes = 0, text = 0, spread = { all: 0, top: 0 };
  for (let attempt = 0; attempt < 3; attempt++) {
    await go(page, url, attempt === 0 ? 1200 : 2500);
    text = await painted();
    // Tutorials are closed for comparable pages (all marked seen); close one if it opened anyway.
    if (await page.locator(TUTORIAL).count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }
    await page.screenshot({ path: file, fullPage: true, animations: "disabled", caret: "hide" });
    spread = await spreadOf(file, height);
    if (text >= 40 && spread.all >= 12 && spread.top >= 10) break;
    retakes++;
  }
  return { retakes, mainText: text, spread: { all: Number(spread.all.toFixed(1)), top: Number(spread.top.toFixed(1)) } };
}

/** The first visible match's box in page (document) coordinates — what a full-page capture shows. */
async function docRect(page, selector) {
  return page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x0: Math.round(r.left + scrollX), y0: Math.round(r.top + scrollY), x1: Math.round(r.right + scrollX), y1: Math.round(r.bottom + scrollY) };
  }, selector);
}

async function capture(browser, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const meta = { at: new Date().toISOString(), base: BASE, build: fs.existsSync(path.join(APP_DIR, ".e2e-source-rev")) ? fs.readFileSync(path.join(APP_DIR, ".e2e-source-rev"), "utf8").trim().split("\n")[0] : null, pages: [] };
  // Both builds are photographed over the same data: the shipped guides (no saved rows or
  // guide pictures — what the checks below write is cleared first) and every tutorial seen.
  const hadRows = sqlJson("select tool_key from public.tool_guides").map((r) => r.tool_key);
  const hadSlots = Number(sql("select count(*) from public.media_slots where slot_key like 'guide.%'"));
  resetGuides();
  markAllSeen(CUSTOMER_ID);
  markAllSeen(ADMIN_ID);
  const cust = await newRole(browser, "customer", "/retusz");
  // A reset by SQL bypasses the admin save's revalidateTag: the app keeps serving the old guide
  // from Next's data cache (published guides 300 s, media slots 600 s). Comparing over stale
  // data would be meaningless, so a stale answer stops the capture (restart the app — its
  // start script clears the data cache — or wait TG_E2E_CACHE_WAIT seconds).
  {
    const deadline = Date.now() + Number(process.env.TG_E2E_CACHE_WAIT ?? 0) * 1000;
    const stale = async () => {
      const out = [];
      for (const tool of GUIDE_TOOLS) {
        const r = await guideApi(cust.page, tool);
        if (r.status === 400 && r.body?.error === "unknown_tool") continue; // an older build without this guide
        const g = r.body?.guide;
        const fresh = g && g.version === 1 && g.tutorial?.title === shippedTutorial("pl", tool).title && g.tutorial.steps.every((x) => !x.image);
        if (!fresh) out.push(tool);
      }
      return out;
    };
    let left = await stale();
    while (left.length > 0 && Date.now() < deadline) { await cust.page.waitForTimeout(15_000); left = await stale(); }
    meta.cacheCheck = { hadRows, hadSlots, stale: left };
    if (left.length > 0) throw new Error(`the app still serves pre-reset guides for ${left.join(", ")} from its data cache — restart it (app-stop.sh && app-start.sh) or set TG_E2E_CACHE_WAIT=660`);
  }
  for (const vp of REGRESS_VIEWPORTS) {
    await cust.page.setViewportSize(vp);
    for (const url of REGRESS_CUSTOMER) {
      const file = path.join(dir, `c-${slugOf(url)}-${vp.width}.png`);
      const q = await snap(cust.page, url, file, vp.height);
      const button = await visibleCount(cust.page, "[data-guide-open]");
      const buttonRect = await docRect(cust.page, "[data-guide-open]");
      meta.pages.push({ role: "customer", url, viewport: `${vp.width}x${vp.height}`, file: path.basename(file), guideButton: button, buttonRect, ...q });
      log(`captured ${path.basename(file)} (guide button visible: ${button}, retakes ${q.retakes}, spread ${q.spread.all}/${q.spread.top})`);
    }
  }
  await cust.ctx.close();
  const adm = await newRole(browser, "admin", "/admin/ai/retouch?tab=basics");
  for (const url of REGRESS_ADMIN) {
    const file = path.join(dir, `a-${slugOf(url)}-1440.png`);
    const q = await snap(adm.page, url, file, DESKTOP.height);
    const tabs = await adm.page.locator("nav[data-tool-tabs] a").allTextContents();
    const guideSection = await adm.page.locator("[data-tool-guide-admin]").count();
    const tabsRect = await docRect(adm.page, "nav[data-tool-tabs]");
    const sectionRect = await docRect(adm.page, "[data-tool-guide-admin]");
    meta.pages.push({ role: "admin", url, viewport: "1440x900", file: path.basename(file), tabs, guideSectionOnPage: guideSection, tabsRect, sectionRect, ...q });
    log(`captured ${path.basename(file)} tabs=${JSON.stringify(tabs)} guideSection=${guideSection} retakes ${q.retakes} spread ${q.spread.all}/${q.spread.top}`);
  }
  await adm.ctx.close();
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  return meta;
}

/* ── fixtures (pictures uploaded through the real picker when the library is empty) ── */

async function fixture(name, label, color) {
  const file = path.join(SHOTS, "fixtures", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><rect width="960" height="600" fill="${color}"/><rect x="40" y="40" width="880" height="520" rx="36" fill="none" stroke="#fff" stroke-width="10"/><text x="480" y="330" font-family="sans-serif" font-size="72" font-weight="700" fill="#fff" text-anchor="middle">${label}</text></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(file);
  }
  return file;
}

/** In an open AssetPicker: pick an existing library image other than `avoid`, uploading `file`
 *  first if there is none — or always, with `upload: true` (exercises the picker's upload). */
async function pickInPicker(page, file, avoid = [], { upload = false } = {}) {
  const picker = page.locator('[role="dialog"]').filter({ has: page.locator("[data-picker-search]") }).last();
  await picker.waitFor({ state: "visible", timeout: 15_000 });
  const ids = async () => picker.locator("[data-picker-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-picker-item")));
  let have = upload ? [] : (await ids()).filter((id) => !avoid.includes(id));
  let uploaded = false;
  if (have.length === 0) {
    const before = new Set(await ids());
    await picker.locator('input[type="file"]').setInputFiles(file);
    uploaded = true;
    for (let i = 0; i < 60 && have.length === 0; i++) {
      await page.waitForTimeout(500);
      have = (await ids()).filter((id) => !before.has(id) && !avoid.includes(id));
    }
    if (have.length === 0) throw new Error("upload through the picker produced no library item");
    // Let the "uploading" state finish (derived variants) before picking.
    await picker.getByRole("button", { name: t("pl", "media.upload") }).waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  }
  const id = have[0];
  await page.waitForTimeout(1500);
  // How many tiles the picker shows for this one library file (should be exactly one).
  const tiles = await picker.locator(`[data-picker-item="${id}"]`).count();
  const shotName = await shot(page, `a5-picker-${uploaded ? "after-upload" : "existing"}`);
  await picker.locator(`[data-picker-item="${id}"]`).first().click();
  await picker.waitFor({ state: "hidden", timeout: 10_000 });
  return { id, uploaded, tiles, shot: shotName };
}

/* ── admin editor helpers ──────────────────────────────────────────────── */

async function openGuideTab(page, tool) {
  await go(page, `/admin/ai/${tool}?tab=guide`, 600);
  await page.locator(`[data-tool-guide-editor="${tool}"]`).waitFor({ state: "visible", timeout: 30_000 });
}
async function saveGuide(page, tool, check) {
  const before = guideRow(tool)?.updated_at ?? null;
  await page.locator("[data-guide-save]").click();
  for (let i = 0; i < 60; i++) {
    const row = guideRow(tool);
    if (row && row.updated_at !== before) {
      await page.locator("[data-guide-published]").filter({ hasText: /\S/ }).waitFor({ timeout: 15_000 }).catch(() => {});
      await settle(page, 400);
      return row;
    }
    await page.waitForTimeout(500);
  }
  const err = await page.locator("[data-guide-error], [data-guide-conflict]").allTextContents();
  record(check, `save of ${tool} landed in tool_guides`, false, { err });
  return null;
}
const editorLang = (page, l) => page.locator("[data-guide-settings] [role=group] button").filter({ hasText: new RegExp(`^${l.toUpperCase()}`) }).click();
async function tutorialSwitch(page, on) {
  const sw = page.locator(`[data-guide-settings] [role="switch"][aria-label="${t("pl", "aicc.guide.tutorialEnabled")}"]`);
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
  return sw.getAttribute("aria-checked");
}

/* ── customer helpers ──────────────────────────────────────────────────── */

/** Visit a tool page as the customer; did the tutorial open by itself? */
async function customerVisit(page, tool, { wait = 6000 } = {}) {
  await page.goto(`${BASE}${TOOL_PAGE[tool]}`, { waitUntil: "domcontentloaded" });
  const opened = await page.locator(TUTORIAL).waitFor({ state: "visible", timeout: wait }).then(() => true).catch(() => false);
  await settle(page, 300);
  return opened || (await page.locator(TUTORIAL).count()) > 0;
}

/* ═════════════════════════════ PHASES ═════════════════════════════════ */

const report = { phase: PHASE, base: BASE, shots: SHOTS, startedAt: new Date().toISOString() };

if (PHASE === "stubs") {
  report.stubs = applyStubs();
  log(JSON.stringify(report.stubs, null, 2));
} else if (PHASE === "unstub") {
  report.unstub = removeStubs();
  log(JSON.stringify(report.unstub, null, 2));
} else if (PHASE === "reset") {
  resetGuides();
  report.reset = allGuideState();
} else if (PHASE === "baseline") {
  const browser = await launchBrowser();
  try { report.baseline = await capture(browser, path.join(SHOTS, "baseline")); } finally { await browser.close(); }
  report.issues = issues;
} else if (["all", "checks", "regress"].includes(PHASE)) {
  const browser = await launchBrowser();
  try {
    if (PHASE !== "checks") await guarded(12, () => check12(browser));
    if (PHASE !== "regress") await runChecks(browser);
  } finally { await browser.close(); }
  report.issues = issues;
  // Console errors / failed requests on every visited page (part of check 12's ask).
  if (ONLY.size === 0 || ONLY.has(12)) {
    const bad = issues.filter((i) => !i.expected);
    const aborted = issues.filter((i) => i.expected === "navigation-abort").length;
    const pages = [...new Set(issues.map((i) => `${i.role} ${i.page.split("?")[0]}`))].length;
    record(12, "no console errors and no failed requests on any visited page", bad.length === 0,
      { total: issues.length, navigationAborts: aborted, unexpected: bad.length, pagesWithEntries: pages, sample: bad.slice(0, 20) });
  }
} else {
  console.error(`unknown phase ${PHASE}`);
  process.exit(2);
}

report.finishedAt = new Date().toISOString();
report.scoreboard = board;
report.passed = board.filter((b) => b.ok).length;
report.failed = board.filter((b) => !b.ok).length;
fs.writeFileSync(path.join(SHOTS, `report-${PHASE}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ phase: PHASE, passed: report.passed, failed: report.failed, scoreboard: board.map((b) => `${b.ok ? "✓" : "✗"} [${b.check}] ${b.name}`) }, null, 2));
process.exit(report.failed > 0 ? 1 : 0);

/* ═════════════════════════════ CHECK 12 ═══════════════════════════════ */

async function check12(browser) {
  const baseDir = path.join(SHOTS, "baseline");
  if (!fs.existsSync(path.join(baseDir, "meta.json"))) { record(12, "baseline exists", false, baseDir); return; }
  const before = JSON.parse(fs.readFileSync(path.join(baseDir, "meta.json"), "utf8"));
  const after = await capture(browser, path.join(SHOTS, "regress"));
  const diffDir = path.join(SHOTS, "diff");
  fs.mkdirSync(diffDir, { recursive: true });
  report.regression = [];
  for (const p of after.pages) {
    const b = before.pages.find((x) => x.file === p.file);
    if (!b) { record(12, `baseline for ${p.file}`, false); continue; }
    const d = await diffPng(path.join(baseDir, p.file), path.join(SHOTS, "regress", p.file), path.join(diffDir, p.file));
    const row = { file: p.file, role: p.role, url: p.url, viewport: p.viewport, ...d,
      guideButton: { baseline: b.guideButton, current: p.guideButton }, tabs: { baseline: b.tabs, current: p.tabs },
      guideSection: { baseline: b.guideSectionOnPage, current: p.guideSectionOnPage }, diffImage: path.join("diff", p.file) };
    // Where a difference is ALLOWED: customer pages — the Samouczek button's box (either
    // build); admin basics — the tab bar (the new tab) and, from the removed guide section's
    // top down, everything (the page is shorter by that section).
    const pad = 8;
    const inside = (band, r) => r && band.x0 >= r.x0 - pad && band.x1 <= r.x1 + pad && band.y0 >= r.y0 - pad && band.y1 <= r.y1 + pad;
    const limitY = p.role === "admin" && b.sectionRect ? b.sectionRect.y0 - 24 : Infinity;
    const allowed = p.role === "customer" ? [p.buttonRect, b.buttonRect] : [p.tabsRect, b.tabsRect];
    const outside = d.bands.filter((band) => band.y0 < limitY && !allowed.some((r) => inside(band, r)));
    row.allowedAreas = { rects: allowed, belowY: Number.isFinite(limitY) ? limitY : null };
    row.unexplainedBands = outside;
    report.regression.push(row);
    log(`diff ${p.file}: ${d.diffPct}% (${d.size.baseline} → ${d.size.current}), bands ${JSON.stringify(d.bands.slice(0, 4))}, unexplained ${outside.length}`);
    record(12, `${p.file}: ${d.diffPct}% differs; every difference inside the allowed area (${p.role === "customer" ? "the Samouczek button" : "the tab bar + the removed guide section"})`,
      outside.length === 0 && d.bandCount <= 12, { diffPct: d.diffPct, size: d.size, bands: d.bands.slice(0, 6), unexplained: outside.slice(0, 6), button: { baseline: b.guideButton, current: p.guideButton }, tabs: p.tabs, diffImage: row.diffImage });
  }
  record(12, "regression pages re-captured and diffed (per-page % + diff image; see report.regression)", report.regression.length === after.pages.length,
    report.regression.map((r) => `${r.file}: ${r.diffPct}%`));
}

/* ═════════════════════════════ CHECKS 1–11 ════════════════════════════ */

async function runChecks(browser) {
  resetGuides();
  resetSeen(CUSTOMER_ID);
  resetSeen(ADMIN_ID);
  const admin = await newRole(browser, "admin", "/admin/ai/retouch?tab=guide");
  const cust = await newRole(browser, "customer", "/home");
  const A = admin.page, C = cust.page;
  const live = {};

  /* 1 — every live tool shows its own tutorial on first visit; not-live ones show nothing. */
  await guarded(1, async () => {
    for (const tool of GUIDE_TOOLS) {
      resetSeen(CUSTOMER_ID);
      await go(C, "/home", 200);
      const api = await guideApi(C, tool);
      live[tool] = api.body?.live === true;
      const opened = await customerVisit(C, tool);
      if (!live[tool]) {
        await C.waitForTimeout(2500);
        const dialogs = await C.locator(TUTORIAL).count();
        const buttons = await visibleCount(C, "[data-guide-open]");
        const s = await shot(C, `c1-${tool}-not-live`);
        record(1, `${tool} (${TOOL_PAGE[tool]}) not live locally → no auto-open, no Samouczek button`, !opened && dialogs === 0 && buttons === 0,
          { live: false, apiStatus: api.status, opened, dialogs, buttons, shot: s });
        continue;
      }
      const want = shippedTutorial("pl", tool);
      const tut = opened ? await readTutorial(C) : null;
      const s1 = await shot(C, `c1-${tool}-auto-open`);
      const titlesOk = Boolean(tut) && tut.title === want.title && JSON.stringify(tut.steps.map((x) => x.title)) === JSON.stringify(want.steps);
      record(1, `${tool} (${TOOL_PAGE[tool]}) auto-opens on first visit with its own steps (toolGuideDefaults.${tool})`, opened && titlesOk,
        { title: tut?.title, steps: tut?.steps.map((x) => x.title), want, shot: s1 });
      const seen = seenOf(CUSTOMER_ID)[tool];
      record(1, `${tool}: opening marked v1 seen (mark_tool_tutorial_seen)`, seen === 1, { seen });
      // Close with the X.
      await C.locator("[data-guide-close]").click().catch(() => {});
      await C.locator(TUTORIAL).waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      const closed = (await C.locator(TUTORIAL).count()) === 0;
      const btn = C.locator("[data-guide-open]:visible").first();
      const btnVisible = await btn.isVisible().catch(() => false);
      const s2 = await shot(C, `c1-${tool}-closed-with-button`);
      record(1, `${tool}: X closes it and the Samouczek button is visible`, closed && btnVisible, { closed, btnVisible, shot: s2 });
      // Reopen by hand, walk every step to the end, finish with the primary button.
      let walked = false, reopened = false;
      if (btnVisible) {
        await btn.click();
        reopened = await C.locator(TUTORIAL).waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
        if (reopened) {
          const n = want.steps.length;
          const counters = [];
          for (let i = 0; i < n; i++) {
            counters.push((await C.locator("[data-guide-counter]").textContent())?.trim());
            await C.locator("[data-guide-next]").click();
            await C.waitForTimeout(120);
          }
          walked = (await C.locator(TUTORIAL).count()) === 0 && counters[n - 1] === t("pl", "toolGuide.counter", { n, total: n });
        }
      }
      record(1, `${tool}: the button reopens it; Dalej walks all steps and "Rozpocznij" closes it`, reopened && walked, { reopened, walked });
      // A reload does not open it again (seen).
      const again = await customerVisit(C, tool, { wait: 3500 });
      record(1, `${tool}: second visit does not auto-open`, !again, { again });
    }
    // Video is not a guide tool: no tutorial, no button.
    await go(C, "/wideo", 2500);
    const vDialogs = await C.locator(TUTORIAL).count();
    const vButtons = await visibleCount(C, "[data-guide-open]");
    const vs = await shot(C, "c1-video-wideo");
    record(1, "video (/wideo, COMING_SOON) → no auto-open, no Samouczek button", vDialogs === 0 && vButtons === 0, { vDialogs, vButtons, shot: vs });
    report.live = live;
  });

  /* 2 + 3 — every guide tool has the Samouczek tab (last), reachable by click and by URL. */
  await guarded(2, async () => {
    const label = t("pl", "aicc.tab.guide");
    for (const tool of GUIDE_TOOLS) {
      await go(A, `/admin/ai/${tool}?tab=basics`, 300);
      const tabs = await A.locator("nav[data-tool-tabs] a").evaluateAll((els) => els.map((e) => ({ text: e.textContent.trim(), href: e.getAttribute("href"), current: e.getAttribute("aria-current") })));
      const last = tabs[tabs.length - 1];
      const basicsHasGuide = await A.locator("[data-tool-guide-admin], [data-tool-guide-editor]").count();
      record(2, `${tool}: tab bar ends with "${label}" (→ ?tab=guide); Podstawowe has no guide section`,
        last?.text === label && last?.href === `/admin/ai/${tool}?tab=guide` && basicsHasGuide === 0, { tabs: tabs.map((x) => x.text), basicsHasGuide });
      // 3 — the tab opens from a click in the tab bar. A click that did not navigate
      // within 15 s is retried once and reported (clickRetried) — never hidden.
      let clickRetried = false;
      await A.locator("nav[data-tool-tabs] a").filter({ hasText: label }).click();
      const navigated = await A.waitForURL((u) => u.search.includes("tab=guide"), { timeout: 15_000 }).then(() => true).catch(() => false);
      if (!navigated) {
        clickRetried = true;
        await A.locator("nav[data-tool-tabs] a").filter({ hasText: label }).click();
        await A.waitForURL((u) => u.search.includes("tab=guide"), { timeout: 20_000 }).catch(() => {});
      }
      const editor = await A.locator(`[data-tool-guide-editor="${tool}"]`).waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false);
      const current = await A.locator('nav[data-tool-tabs] a[aria-current="page"]').textContent().catch(() => null);
      const starterForm = await A.locator("[data-guide-starter-form]").getAttribute("data-guide-starter-form").catch(() => null);
      // data-guide-starter-form: "none" without a starter gallery; a bare attribute (React writes "true") with one.
      const starterOk = NO_STARTER.has(tool) ? starterForm === "none" : starterForm !== null && starterForm !== "none";
      const s = await shot(A, `a2-${tool}-guide-tab`);
      record(3, `${tool}: clicking "${label}" opens ?tab=guide with the editor (tab marked current)`, editor && current?.trim() === label && new URL(A.url()).searchParams.get("tab") === "guide",
        { url: A.url(), current, clickRetried, shot: s });
      if (clickRetried) report.flakes = [...(report.flakes ?? []), `check 3 ${tool}: first tab click did not navigate within 15 s`];
      record(2, `${tool}: the editor renders (${NO_STARTER.has(tool) ? "no starter controls" : "starter controls"})`, editor && starterOk, { starterForm });
      // By URL as well.
      await go(A, `/admin/ai/${tool}?tab=guide`, 200);
      const byUrl = await A.locator(`[data-tool-guide-editor="${tool}"]`).isVisible().catch(() => false);
      record(2, `${tool}: /admin/ai/${tool}?tab=guide renders the editor directly`, byUrl);
    }
    // Video: no Samouczek tab, and ?tab=guide falls back to the first tab.
    await go(A, "/admin/ai/video", 300);
    const vtabs = await A.locator("nav[data-tool-tabs] a").allTextContents();
    await go(A, "/admin/ai/video?tab=guide", 300);
    const vEditor = await A.locator("[data-tool-guide-editor], [data-tool-guide-admin]").count();
    const vCurrent = await A.locator('nav[data-tool-tabs] a[aria-current="page"]').textContent().catch(() => null);
    const vs = await shot(A, "a2-video-tab-guide");
    record(2, "/admin/ai/video has NO Samouczek tab; ?tab=guide shows no editor (falls back to the first tab)",
      !vtabs.map((x) => x.trim()).includes(label) && vEditor === 0, { tabs: vtabs, current: vCurrent, shot: vs });
  });
  if (ONLY.has(3) && !ONLY.has(2)) record(3, "check 3 runs inside check 2 (TG_E2E_ONLY must include 2)", false);

  /* 4 + 8 — switching the tutorial OFF hides it for customers (no auto-open, no button); ON brings it back. */
  await guarded(4, async () => {
    for (const tool of ["compress", "tool_watermark"]) {
      await openGuideTab(A, tool);
      const off = await tutorialSwitch(A, false);
      const s0 = await shot(A, `a4-${tool}-switch-off`);
      const row = await saveGuide(A, tool, 4);
      record(4, `${tool}: admin switched the tutorial OFF and saved (tool_guides.tutorial_enabled = false)`, off === "false" && row?.tutorial_enabled === false,
        { ariaChecked: off, row: row && { tutorial_enabled: row.tutorial_enabled, version: row.tutorial_version }, shot: s0 });
      resetSeen(CUSTOMER_ID);
      const opened = await customerVisit(C, tool, { wait: 6000 });
      await C.waitForTimeout(1500);
      const buttons = await visibleCount(C, "[data-guide-open]");
      const api = await guideApi(C, tool);
      const s1 = await shot(C, `c4-${tool}-off`);
      record(8, `${tool} OFF: no auto-open for a fresh customer`, !opened, { opened, shot: s1 });
      record(8, `${tool} OFF: no Samouczek button`, buttons === 0, { buttons });
      record(4, `${tool} OFF: /api/tool-guides sends no tutorial`, api.body?.guide?.tutorial === null, { tutorial: api.body?.guide?.tutorial ?? "missing", live: api.body?.live });
      await openGuideTab(A, tool);
      const on = await tutorialSwitch(A, true);
      const row2 = await saveGuide(A, tool, 4);
      record(4, `${tool}: admin switched it ON again and saved`, on === "true" && row2?.tutorial_enabled === true, { row: row2 && { tutorial_enabled: row2.tutorial_enabled } });
      resetSeen(CUSTOMER_ID);
      const back = await customerVisit(C, tool, { wait: 8000 });
      const s2 = await shot(C, `c4-${tool}-on-again`);
      await C.keyboard.press("Escape");
      await C.waitForTimeout(300);
      const btn = await visibleCount(C, "[data-guide-open]");
      record(4, `${tool} ON again: auto-open and the button are back`, back && btn > 0, { back, buttons: btn, shot: s2 });
    }
  });

  /* 5 / 6 / 7 — edit, persist, publish to the customer, show again. */
  const E = { tool: "compress" };
  await guarded(5, async () => {
    const tool = E.tool;
    await openGuideTab(A, tool);
    const tutForm = A.locator("[data-guide-tutorial-form]");
    E.titles = { pl: "E2E PL: Kompresja — samouczek testowy", en: "E2E EN: Compression test tutorial", de: "E2E DE: Komprimierung Testanleitung" };
    E.added = { pl: "E2E krok dodany", en: "E2E added step", de: "E2E hinzugefügter Schritt" };
    E.starter = { pl: "E2E PL: Przykładowa kompresja", en: "E2E EN: Example compression" };
    const shipped = shippedTutorial("pl", tool);
    for (const l of ["pl", "en", "de"]) {
      await editorLang(A, l);
      await tutForm.locator("input").first().fill(E.titles[l]);
    }
    await editorLang(A, "pl");
    // Add a step (titles in all three languages).
    const before = await A.locator("li[data-guide-step-form]").count();
    await tutForm.getByRole("button", { name: t("pl", "aicc.guide.step.add") }).click();
    const n = before + 1;
    for (const l of ["pl", "en", "de"]) {
      await editorLang(A, l);
      await A.locator(`li[data-guide-step-form="${n}"] input`).first().fill(E.added[l]);
    }
    await editorLang(A, "pl");
    const afterAdd = await A.locator("li[data-guide-step-form]").count();
    record(5, `${tool}: "Dodaj krok" added step ${n}`, afterAdd === before + 1, { before, afterAdd });
    // Delete step 2 — through the confirm dialog.
    await A.getByRole("button", { name: t("pl", "aicc.guide.step.remove", { n: 2 }), exact: true }).click();
    const confirm = A.locator(`[role="dialog"][aria-label="${t("pl", "aicc.guide.step.removeConfirmTitle", { n: 2 })}"]`);
    const asked = await confirm.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
    const sc = await shot(A, `a5-${tool}-delete-confirm`);
    const stillThere = await A.locator("li[data-guide-step-form]").count();
    await confirm.getByRole("button", { name: t("pl", "aicc.guide.step.removeConfirm"), exact: true }).click();
    const afterDel = await A.locator("li[data-guide-step-form]").count();
    E.deleted = shipped.steps[1];
    record(5, `${tool}: deleting step 2 asks first (confirm dialog), nothing removed until confirmed, then removed`, asked && stillThere === afterAdd && afterDel === afterAdd - 1,
      { asked, stillThere, afterDel, deletedTitle: E.deleted, shot: sc });
    // Step 1: a picture from the library through "Zmień ilustrację" → "Wybierz z biblioteki".
    await A.locator('[data-guide-change-illustration="1"]').click();
    const chooser = A.locator("[data-guide-illustration-chooser]");
    await chooser.waitFor({ state: "visible", timeout: 5000 });
    const sch = await shot(A, `a5-${tool}-illustration-chooser`);
    await chooser.getByRole("button", { name: t("pl", "aicc.guide.pickFromLibrary") }).click();
    const libBefore = Number(sql("select count(*) from public.media_assets where kind = 'image'"));
    const p1 = await pickInPicker(A, await fixture("e2e-step-1.png", "E2E STEP 1", "#7c3aed"));
    E.stepAsset = p1.id;
    const step1 = await A.locator('li[data-guide-step-form="1"] [data-guide-step-illustration]').getAttribute("data-guide-step-illustration");
    record(5, `${tool}: step 1 illustration changed to a library picture via the picker (${libBefore === 0 ? "library was empty → uploaded through the picker" : "picked from the existing library"})`,
      step1 === "photo", { asset: p1.id, uploaded: p1.uploaded, libraryImagesBefore: libBefore, shot: sch });
    record(5, `${tool}: the picker lists the ${p1.uploaded ? "just-uploaded" : "picked"} picture once`, p1.tiles === 1, { tiles: p1.tiles, shot: p1.shot });
    // Step 3: a different drawing.
    await A.locator('[data-guide-change-illustration="3"]').click();
    await chooser.waitFor({ state: "visible", timeout: 5000 });
    await chooser.locator('[data-guide-art="download"]').click();
    await chooser.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    const step3 = await A.locator('li[data-guide-step-form="3"] [data-guide-step-illustration]').getAttribute("data-guide-step-illustration");
    record(5, `${tool}: step 3 drawing changed to "download" in the chooser`, step3 === "art", { step3 });
    // Starter: text + picture.
    const starterForm = A.locator("[data-guide-starter-form]");
    for (const l of ["pl", "en"]) {
      await editorLang(A, l);
      await starterForm.locator("input").first().fill(E.starter[l]);
    }
    await editorLang(A, "pl");
    await starterForm.getByRole("button", { name: new RegExp(`^(${t("pl", "aicc.guide.pickFromLibrary")}|${t("pl", "aicc.guide.changePhoto")})$`) }).click();
    // The starter picture is always UPLOADED through the picker (a fresh file per run), so every
    // run covers both paths: picking an existing library file (step 1) and uploading one.
    const p2 = await pickInPicker(A, await fixture(`e2e-starter-${Date.now()}.png`, "E2E STARTER", "#0ea5e9"), [p1.id], { upload: true });
    E.starterAsset = p2.id;
    record(5, `${tool}: starter picture chosen through the picker (${p2.uploaded ? "uploaded" : "existing library file"}), listed once`, Boolean(p2.id) && p2.tiles === 1,
      { asset: p2.id, uploaded: p2.uploaded, tiles: p2.tiles, shot: p2.shot });
    const sform = await shot(A, `a5-${tool}-form-before-save`, { fullPage: true });
    const row = await saveGuide(A, tool, 5);
    record(5, `${tool}: "Zapisz i opublikuj" saved the edits`, Boolean(row), { version: row?.tutorial_version, shot: sform });
    E.row = row;
  });

  await guarded(6, async () => {
    const tool = E.tool;
    await openGuideTab(A, tool);
    const tutForm = A.locator("[data-guide-tutorial-form]");
    const read = async () => ({
      title: await tutForm.locator("input").first().inputValue(),
      steps: await A.locator("li[data-guide-step-form]").evaluateAll((els) => els.map((li) => li.querySelector("input")?.value ?? "")),
      ill: await A.locator("li[data-guide-step-form] [data-guide-step-illustration]").evaluateAll((els) => els.map((e) => e.getAttribute("data-guide-step-illustration"))),
      starter: await A.locator("[data-guide-starter-form] input").first().inputValue(),
    });
    const pl = await read();
    await editorLang(A, "en");
    const en = await read();
    await editorLang(A, "de");
    const de = await read();
    await editorLang(A, "pl");
    const shipped = shippedTutorial("pl", tool);
    const wantSteps = [shipped.steps[0], shipped.steps[2], shipped.steps[3], E.added.pl];
    const s = await shot(A, `a6-${tool}-after-reload`, { fullPage: true });
    record(6, `${tool}: after reload the admin form shows every saved change (PL)`,
      pl.title === E.titles.pl && JSON.stringify(pl.steps) === JSON.stringify(wantSteps) && pl.ill[0] === "photo" && pl.starter === E.starter.pl && !pl.steps.includes(E.deleted),
      { pl, wantSteps, shot: s });
    record(6, `${tool}: after reload EN/DE titles are still there`, en.title === E.titles.en && de.title === E.titles.de && en.steps[3] === E.added.en && de.steps[3] === E.added.de && en.starter === E.starter.en,
      { en: { title: en.title, added: en.steps[3], starter: en.starter }, de: { title: de.title, added: de.steps[3] } });
    // The starter control names the chosen library file (its title, e.g. "e2e-starter.png").
    const starterName = await A.locator("[data-guide-starter-form]").textContent();
    const chosenTitle = E.starterAsset ? sql(`select coalesce(title, '') from public.media_assets where id = '${E.starterAsset}'`) : "";
    record(6, `${tool}: after reload the starter picture is the chosen file`, Boolean(chosenTitle) && (starterName ?? "").includes(chosenTitle),
      { chosen: E.starterAsset, title: chosenTitle, shown: (starterName ?? "").includes(chosenTitle) });
    // The database.
    const row = guideRow(tool);
    const c = row?.content;
    const dbSteps = c?.tutorial?.steps ?? [];
    record(6, `${tool}: tool_guides row holds the content (titles PL/EN/DE, 4 steps, step 3 art "download", starter title)`,
      row && c?.tutorial?.title?.pl === E.titles.pl && c.tutorial.title.en === E.titles.en && c.tutorial.title.de === E.titles.de
        && dbSteps.length === 4 && dbSteps[3]?.title?.pl === E.added.pl && dbSteps[2]?.art === "download"
        && !dbSteps.some((x) => x.title?.pl === E.deleted) && c.starter?.title?.pl === E.starter.pl,
      { version: row?.tutorial_version, enabled: row?.tutorial_enabled, steps: dbSteps.map((x) => [x.title?.pl, x.art]), starter: c?.starter?.title });
    const slots = guideSlots(tool);
    const slot = (k) => slots.find((x) => x.slot_key === k)?.media_id ?? null;
    record(6, `${tool}: media_slots guide.${tool}.tutorial.1 and .starter.1 hold the chosen library files`,
      slot(`guide.${tool}.tutorial.1`) === E.stepAsset && slot(`guide.${tool}.starter.1`) === E.starterAsset, { slots });
  });

  await guarded(7, async () => {
    const tool = E.tool;
    // Customer: reload — the published copy, steps and pictures, without any cache wait.
    await go(C, TOOL_PAGE[tool], 600);
    if (await C.locator(TUTORIAL).count()) { await C.keyboard.press("Escape"); await C.waitForTimeout(300); }
    const starter = await C.evaluate(() => {
      const s = document.querySelector("[data-starter-gallery]");
      return s ? { title: s.querySelector("h2")?.textContent.trim(), img: s.querySelector("img")?.getAttribute("src") ?? null } : null;
    });
    const sStarter = await shot(C, `c7-${tool}-starter-gallery`, { fullPage: true });
    const assetPath = (id) => (id ? sql(`select storage_path from public.media_assets where id = '${id}'`) : "(no asset chosen in check 5)");
    record(7, `${tool}: the customer's starter gallery shows the new text and picture`, starter?.title === E.starter.pl && Boolean(starter?.img?.includes(assetPath(E.starterAsset))),
      { starter, want: { title: E.starter.pl, path: assetPath(E.starterAsset) }, shot: sStarter });
    await C.locator("[data-guide-open]:visible").first().click();
    await C.locator(TUTORIAL).waitFor({ state: "visible", timeout: 5000 });
    const tut = await readTutorial(C);
    const shipped = shippedTutorial("pl", tool);
    const wantSteps = [shipped.steps[0], shipped.steps[2], shipped.steps[3], E.added.pl];
    const sTut = await shot(C, `c7-${tool}-tutorial-published`);
    record(7, `${tool}: the customer's tutorial shows the new title, the 4 edited steps and the step-1 picture`,
      tut?.title === E.titles.pl && JSON.stringify(tut.steps.map((x) => x.title)) === JSON.stringify(wantSteps) && Boolean(tut.steps[0].img?.includes(assetPath(E.stepAsset))) && !tut.steps[2].img,
      { title: tut?.title, steps: tut?.steps, shot: sTut });
    await C.keyboard.press("Escape");
    // "Pokaż ponownie wszystkim" (confirmed) → exactly one more auto-open for someone who had seen it.
    const seenBefore = seenOf(CUSTOMER_ID);
    await openGuideTab(A, tool);
    const vBefore = guideRow(tool)?.tutorial_version;
    await A.locator("[data-guide-show-again]").click();
    const dlg = A.locator(`[role="dialog"][aria-label="${t("pl", "aicc.guide.again.confirmTitle")}"]`);
    const asked = await dlg.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
    const sAsk = await shot(A, `a7-${tool}-show-again-confirm`);
    await dlg.getByRole("button", { name: t("pl", "aicc.guide.again.confirm"), exact: true }).click();
    let vAfter = vBefore;
    for (let i = 0; i < 40 && vAfter === vBefore; i++) { await A.waitForTimeout(500); vAfter = guideRow(tool)?.tutorial_version; }
    await settle(A, 300);
    const shownVersion = (await A.locator("[data-guide-version]").textContent())?.trim();
    const sDone = await shot(A, `a7-${tool}-show-again-done`);
    record(7, `${tool}: "Pokaż ponownie wszystkim" asks for confirmation, then raises the version by one`, asked && vAfter === vBefore + 1 && shownVersion === String(vAfter),
      { asked, vBefore, vAfter, shownVersion, shots: [sAsk, sDone] });
    const contentSame = JSON.stringify(guideRow(tool)?.content) === JSON.stringify(E.row?.content);
    record(7, `${tool}: show-again changed only the version (content unchanged)`, contentSame);
    const first = await customerVisit(C, tool, { wait: 8000 });
    const sAgain = await shot(C, `c7-${tool}-auto-open-again`);
    await C.keyboard.press("Escape");
    const seenAfter = seenOf(CUSTOMER_ID);
    const second = await customerVisit(C, tool, { wait: 3500 });
    const others = Object.fromEntries(Object.entries(seenBefore).filter(([k]) => k !== tool));
    const othersAfter = Object.fromEntries(Object.entries(seenOf(CUSTOMER_ID)).filter(([k]) => k !== tool));
    record(7, `${tool}: the customer who had seen v${seenBefore[tool]} gets it again exactly once (v${vAfter})`, first && !second && seenAfter[tool] === vAfter,
      { first, second, seenBefore: seenBefore[tool], seenAfter: seenAfter[tool], shot: sAgain });
    record(7, "other tools' seen state untouched by show-again", JSON.stringify(others) === JSON.stringify(othersAfter), { others, othersAfter });
  });

  /* 9 — PL/EN/DE × light/dark on one admin page and one customer page. */
  await guarded(9, async () => {
    const tool = E.tool;
    for (const l of ["pl", "en", "de"]) {
      for (const theme of ["light", "dark"]) {
        await setLocale(admin.ctx, l);
        await setLocale(cust.ctx, l);
        await setTheme(A, theme);
        await setTheme(C, theme);
        await go(A, `/admin/ai/${tool}?tab=guide`, 400);
        const a = await A.evaluate(() => ({
          lang: document.documentElement.lang,
          dark: document.documentElement.classList.contains("dark"),
          tab: document.querySelector('nav[data-tool-tabs] a[aria-current="page"]')?.textContent.trim(),
          heading: document.querySelector("[data-guide-settings] h3")?.textContent.trim(),
        }));
        const sa = await shot(A, `a9-${tool}-${l}-${theme}`);
        record(9, `admin /admin/ai/${tool}?tab=guide in ${l.toUpperCase()}/${theme}: tab + editor texts in ${l.toUpperCase()}`,
          a.tab === t(l, "aicc.tab.guide") && a.heading === t(l, "aicc.guide.settings.heading") && a.dark === (theme === "dark"), { ...a, shot: sa });
        await go(C, TOOL_PAGE[tool], 400);
        if (await C.locator(TUTORIAL).count()) { await C.keyboard.press("Escape"); await C.waitForTimeout(300); }
        const btnText = (await C.locator("[data-guide-open]:visible").first().textContent())?.trim();
        await C.locator("[data-guide-open]:visible").first().click();
        await C.locator(TUTORIAL).waitFor({ state: "visible", timeout: 5000 });
        const tut = await readTutorial(C);
        const dark = await C.evaluate(() => document.documentElement.classList.contains("dark"));
        const sc = await shot(C, `c9-${tool}-${l}-${theme}`);
        record(9, `customer ${TOOL_PAGE[tool]} tutorial in ${l.toUpperCase()}/${theme}: admin's ${l.toUpperCase()} title, ${l.toUpperCase()} chrome`,
          tut?.title === E.titles[l] && tut?.counter === t(l, "toolGuide.counter", { n: 1, total: tut?.steps.length }) && btnText === t(l, "toolGuide.open")
            && tut?.steps[3]?.title === E.added[l] && dark === (theme === "dark"),
          { title: tut?.title, counter: tut?.counter, next: tut?.next, button: btnText, added: tut?.steps[3]?.title, dark, shot: sc });
        await C.keyboard.press("Escape");
      }
      // A tool on the shipped copy, in this language.
      await setTheme(C, "light");
      await go(C, TOOL_PAGE.resize, 400);
      if (await C.locator(TUTORIAL).count()) { await C.keyboard.press("Escape"); await C.waitForTimeout(300); }
      await C.locator("[data-guide-open]:visible").first().click();
      await C.locator(TUTORIAL).waitFor({ state: "visible", timeout: 5000 });
      const tut = await readTutorial(C);
      const want = shippedTutorial(l, "resize");
      const sr = await shot(C, `c9-resize-shipped-${l}`);
      record(9, `customer /tools/resize shipped tutorial in ${l.toUpperCase()} (toolGuideDefaults from ${l}.json)`,
        tut?.title === want.title && JSON.stringify(tut.steps.map((x) => x.title)) === JSON.stringify(want.steps), { title: tut?.title, want: want.title, shot: sr });
      await C.keyboard.press("Escape");
    }
    await setLocale(admin.ctx, "pl");
    await setLocale(cust.ctx, "pl");
    await setTheme(A, "light");
    await setTheme(C, "light");
  });

  /* 10 — the admin panel on phone, tablet and PC. */
  await guarded(10, async () => {
    for (const tool of ["compress", "tool_upscale"]) {
      for (const vp of [{ width: 390, height: 844, name: "phone" }, { width: 834, height: 1112, name: "tablet" }, DESKTOP]) {
        await A.setViewportSize({ width: vp.width, height: vp.height });
        await go(A, `/admin/ai/${tool}?tab=basics`, 300);
        // The tab bar: scrollable, and Samouczek reachable by a click.
        const bar = await A.locator("nav[data-tool-tabs]").evaluate((n) => ({ overflowX: getComputedStyle(n).overflowX, scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }));
        await A.locator("nav[data-tool-tabs] a").filter({ hasText: t("pl", "aicc.tab.guide") }).click();
        await A.waitForURL((u) => u.search.includes("tab=guide"), { timeout: 20_000 }).catch(() => {});
        await A.locator(`[data-tool-guide-editor="${tool}"]`).waitFor({ state: "visible", timeout: 30_000 });
        await settle(A, 300);
        const m = await A.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const root = document.querySelector("[data-tool-guide-editor]");
          const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden"; };
          // A switch's ::after is its deliberate 44 px touch area, wider than the switch: not clipped text.
          const clippedButtons = [...root.querySelectorAll("button")].filter(vis).filter((b) => {
            const r = b.getBoundingClientRect();
            const textOverflow = b.getAttribute("role") !== "switch" && b.scrollWidth > b.clientWidth + 1;
            const cut = [...b.querySelectorAll("span")].some((s) => s.scrollWidth > s.clientWidth + 1 && getComputedStyle(s).overflow === "hidden");
            return r.left < -1 || r.right > vw + 1 || textOverflow || cut;
          }).map((b) => ({ text: (b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 50), left: Math.round(b.getBoundingClientRect().left), right: Math.round(b.getBoundingClientRect().right), sw: b.scrollWidth, cw: b.clientWidth }));
          const cards = [...root.querySelectorAll("li[data-guide-step-form]")].map((li) => { const r = li.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; });
          const inputs = [...root.querySelectorAll("input, textarea")].filter(vis).map((i) => Math.round(i.getBoundingClientRect().width));
          const nav = document.querySelector("nav[data-tool-tabs]");
          const guideLink = [...nav.querySelectorAll("a")].find((a) => a.getAttribute("aria-current") === "page");
          const gr = guideLink?.getBoundingClientRect(); const nr = nav.getBoundingClientRect();
          return {
            vw, docScroll: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth,
            clippedButtons, cards, minInput: inputs.length ? Math.min(...inputs) : null,
            activeTabVisible: Boolean(gr && gr.left >= nr.left - 1 && gr.right <= nr.right + 1),
          };
        });
        const s = await shot(A, `a10-${tool}-${vp.name ?? "pc"}`, { fullPage: true });
        const cardsOk = m.cards.every((c) => c.left >= 0 && c.right <= m.vw + 1);
        record(10, `${tool} admin Samouczek at ${vp.width}×${vp.height}: no horizontal page overflow`, m.docScroll <= m.vw + 1 && m.bodyScroll <= m.vw + 1, { vw: m.vw, docScroll: m.docScroll, bodyScroll: m.bodyScroll, shot: s });
        record(10, `${tool} at ${vp.width}×${vp.height}: tab bar usable (overflow-x ${bar.overflowX}, ${bar.scrollWidth}/${bar.clientWidth}px), Samouczek reached by click and in view`,
          ["auto", "scroll"].includes(bar.overflowX) && m.activeTabVisible, { bar, activeTabVisible: m.activeTabVisible });
        record(10, `${tool} at ${vp.width}×${vp.height}: step cards inside the viewport, inputs readable (min ${m.minInput}px), no clipped button`,
          cardsOk && (m.minInput ?? 0) >= 200 && m.clippedButtons.length === 0, { cards: m.cards.slice(0, 2), minInput: m.minInput, clippedButtons: m.clippedButtons });
      }
    }
    await A.setViewportSize(DESKTOP);
  });

  /* 11 — security: the customer cannot change a tutorial by any door. */
  await guarded(11, async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(APP_DIR, ".next/server/server-reference-manifest.json"), "utf8"));
    const idOf = (file, name) => Object.entries(manifest.node).find(([, v]) => v.filename === file && v.exportedName === name)?.[0];
    const saveId = idOf("app/actions/tool-guides.ts", "saveToolGuideAction");
    const againId = idOf("app/actions/tool-guides.ts", "showToolGuideAgainAction");
    record(11, "server-action ids found in the built manifest", Boolean(saveId && againId), { saveId, againId });
    const before = allGuideState();
    const base = guideRow("compress")?.updated_at ?? null;
    const call = (page, id, arg, at = "/admin/ai/compress?tab=guide") => page.evaluate(async ({ id, arg, at }) => {
      const r = await fetch(at, { method: "POST", headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body: JSON.stringify([arg]) });
      const text = await r.text();
      const hit = text.split("\n").map((l) => l.replace(/^[0-9a-f]+:/, "")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j && typeof j === "object" && "ok" in j);
      return { status: r.status, result: hit ?? null, raw: hit ? undefined : text.slice(0, 300) };
    }, { id, arg, at });
    await go(C, "/retusz", 200);
    const saveArg = { tool: "compress", tutorialEnabled: false, starterEnabled: false, content: null, images: { steps: [], starter: null }, base, imageBases: undefined, showAgain: true };
    const r1 = await call(C, saveId, saveArg);
    const r2 = await call(C, againId, { tool: "compress", base });
    const r1b = await call(C, saveId, saveArg, "/retusz");
    const afterActions = allGuideState();
    record(11, "(a) customer → saveToolGuideAction: not_admin", r1.result?.ok === false && r1.result?.error === "not_admin", r1);
    record(11, "(a) customer → saveToolGuideAction posted from a customer page (/retusz): not_admin", r1b.result?.ok === false && r1b.result?.error === "not_admin", r1b);
    record(11, "(a) customer → showToolGuideAgainAction: not_admin", r2.result?.ok === false && r2.result?.error === "not_admin", r2);
    record(11, "(a) no DB change after the customer's action calls (tool_guides + guide.* slots)", JSON.stringify(before) === JSON.stringify(afterActions));
    // Signed-out action calls (no cookies at all): at the admin route the request is
    // turned away before any action runs (307 to the login); at a public page the
    // action itself answers. Either way nothing may change.
    const anonPost = async (at) => {
      const r = await fetch(`${BASE}${at}`, { method: "POST", redirect: "manual", headers: { "Next-Action": saveId, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", Origin: BASE }, body: JSON.stringify([saveArg]) });
      const text = await r.text();
      const hit = text.split("\n").map((l) => l.replace(/^[0-9a-f]+:/, "")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j && typeof j === "object" && "ok" in j);
      return { status: r.status, location: r.headers.get("location"), result: hit ?? null, raw: hit ? undefined : text.slice(0, 120) };
    };
    const r3 = await anonPost("/admin/ai/compress?tab=guide");
    const r4 = await anonPost("/retusz");
    const afterAnon = allGuideState();
    record(11, "(a) signed-out → saveToolGuideAction at the admin route: redirected to the login before any action runs",
      r3.status === 307 && /auth=login|\/login/.test(r3.location ?? ""), r3);
    record(11, "(a) signed-out → saveToolGuideAction at a customer route: refused (redirect or unauthenticated), no DB change",
      ((r4.status >= 300 && r4.status < 400) || (r4.result?.ok === false && r4.result?.error === "unauthenticated")) && JSON.stringify(afterAnon) === JSON.stringify(before), r4);
    const anonCtx = await browser.newContext({ viewport: DESKTOP });
    const anonPage = await anonCtx.newPage();
    watch(anonPage, "anon");
    // Signed-out admin URL → login.
    await anonPage.goto(`${BASE}/admin/ai/retouch?tab=guide`, { waitUntil: "domcontentloaded" });
    await anonPage.waitForLoadState("networkidle").catch(() => {});
    const out = new URL(anonPage.url());
    const sOut = await shot(anonPage, "s11-signed-out-admin-guide");
    record(11, "signed-out /admin/ai/retouch?tab=guide redirects to the login", /login/.test(out.pathname) || out.searchParams.get("auth") === "login",
      { url: anonPage.url(), shot: sOut });
    await anonCtx.close();

    // (b)(c)(d) PostgREST with the customer's own access token (from the session cookie).
    const cookies = await cust.ctx.cookies();
    const parts = cookies.filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    let raw = parts.map((c) => c.value).join("");
    if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
    const token = JSON.parse(decodeURIComponent(raw)).access_token;
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    record(11, "customer access token taken from the real session cookie", claims.sub === CUSTOMER_ID, { sub: claims.sub, role: claims.role });
    const rest = async (method, p, body, auth = token) => {
      const r = await fetch(`${REST}${p}`, { method, headers: { apikey: KEY, ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "Content-Type": "application/json", Prefer: "return=representation" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
      return { status: r.status, body: json ?? text.slice(0, 200) };
    };
    const b0 = allGuideState();
    const g1 = await rest("GET", "/rest/v1/tool_guides?select=*");
    const g2 = await rest("POST", "/rest/v1/tool_guides", { tool_key: "resize", tutorial_enabled: false });
    const g3 = await rest("PATCH", "/rest/v1/tool_guides?tool_key=eq.compress", { tutorial_enabled: false, tutorial_version: 999 });
    const g4 = await rest("DELETE", "/rest/v1/tool_guides?tool_key=eq.compress");
    const g5 = await rest("POST", "/rest/v1/rpc/media_slots_write", { p_writes: [{ key: "guide.compress.tutorial.1", entity_type: "tool", entity_id: "compress", slot_name: "tutorial.1", media_type: "image", media_id: "", tablet_media_id: "", mobile_media_id: "", poster_media_id: "", alt_text: "", object_fit: "cover", object_position: "center center", base: "" }], p_action: "save" });
    const g6 = await rest("PATCH", "/rest/v1/media_slots?slot_key=eq.guide.compress.tutorial.1", { media_id: null });
    const g7 = await rest("POST", "/rest/v1/media_slots", { slot_key: "guide.resize.starter.1", entity_type: "tool", entity_id: "resize", slot_name: "starter.1", media_type: "image" });
    const g8 = await rest("DELETE", "/rest/v1/media_slots?slot_key=like.guide.*");
    const b1 = allGuideState();
    const empty = (r) => r.status === 200 && Array.isArray(r.body) && r.body.length === 0;
    const refused = (r) => r.status === 401 || r.status === 403 || (r.status >= 400 && /42501|permission|policy|admin|forbidden/i.test(JSON.stringify(r.body)));
    record(11, "(b) customer SELECT tool_guides → no rows (admin-only RLS)", empty(g1), g1);
    record(11, "(b) customer INSERT tool_guides → refused by RLS", refused(g2), g2);
    record(11, "(b) customer UPDATE tool_guides → 0 rows (RLS)", empty(g3) || refused(g3), g3);
    record(11, "(b) customer DELETE tool_guides → 0 rows (RLS)", empty(g4) || refused(g4), g4);
    record(11, "(b) customer RPC media_slots_write on a guide slot → refused", refused(g5), g5);
    record(11, "(b) customer UPDATE/INSERT/DELETE media_slots guide.* → refused / 0 rows", (empty(g6) || refused(g6)) && refused(g7) && (empty(g8) || refused(g8)), { update: g6, insert: g7, delete: g8 });
    record(11, "(b) no DB change after the PostgREST attempts", JSON.stringify(b0) === JSON.stringify(b1));
    // (c) the published read.
    const c1 = await rest("POST", "/rest/v1/rpc/tool_guides_published", {});
    const c2 = await rest("POST", "/rest/v1/rpc/tool_guides_published", {}, null);
    const cols = Array.isArray(c1.body) && c1.body[0] ? Object.keys(c1.body[0]).sort() : [];
    record(11, "(c) tool_guides_published() readable by the customer (and anon), presentation columns only",
      c1.status === 200 && Array.isArray(c1.body) && c1.body.length > 0 && c2.status === 200 && Array.isArray(c2.body)
        && JSON.stringify(cols) === JSON.stringify(["starter", "starter_enabled", "tool_key", "tutorial", "tutorial_enabled", "tutorial_version"]),
      { customer: { status: c1.status, rows: Array.isArray(c1.body) ? c1.body.length : c1.body }, anon: { status: c2.status, rows: Array.isArray(c2.body) ? c2.body.length : c2.body }, cols });
    // (d) mark_tool_tutorial_seen writes only the caller's own preferences.
    const adminBefore = prefsOf(ADMIN_ID);
    const custBefore = seenOf(CUSTOMER_ID);
    const d1 = await rest("POST", "/rest/v1/rpc/mark_tool_tutorial_seen", { p_tool_key: "generator", p_version: 77 });
    const d2 = await rest("PATCH", `/rest/v1/user_preferences?user_id=eq.${ADMIN_ID}`, { metadata: { tool_tutorials: { generator: 1 } } });
    const d3 = await rest("POST", "/rest/v1/rpc/mark_tool_tutorial_seen", { p_tool_key: "generator", p_version: 5 }, null);
    const adminAfter = prefsOf(ADMIN_ID);
    const custAfter = seenOf(CUSTOMER_ID);
    record(11, "(d) mark_tool_tutorial_seen changes only the caller's own row (customer generator → 77; admin untouched)",
      (d1.status === 200 || d1.status === 204) && custAfter.generator === Math.max(77, custBefore.generator ?? 0) && JSON.stringify(adminBefore) === JSON.stringify(adminAfter),
      { status: d1.status, custBefore: custBefore.generator, custAfter: custAfter.generator, adminUnchanged: JSON.stringify(adminBefore) === JSON.stringify(adminAfter) });
    record(11, "(d) customer PATCH of the admin's user_preferences → 0 rows (RLS)", empty(d2) || refused(d2), d2);
    record(11, "(d) anon mark_tool_tutorial_seen → refused", refused(d3) || d3.status >= 400, d3);
  });

  await admin.ctx.close();
  await cust.ctx.close();
}
