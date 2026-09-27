/**
 * ADMIN → NARZĘDZIA I SILNIKI: KEY MODAL + WORKFLOW + MODELE/KOSZTY, IN A REAL
 * BROWSER (Chromium, desktop and phone emulation).
 *
 * The harness mounts the REAL components — the provider card and its key
 * modal, the tool tab bar, the vertical workflow builder, the test panel, the
 * execution-path card and both price editors — inside the REAL admin chrome
 * (sidebar + mobile dock), with fixture props, at /probe-tmp/workflow. It needs
 * no session and no database: nothing is saved, and the probe never presses a
 * save, publish, test or switch button.
 *
 *   API1 the key modal opens ABOVE everything and its input has focus
 *   API2 typing reaches the input and enables "Zapisz"
 *   API3 pasting reaches the input
 *   API4 phone: the input renders at ≥16 px (no iOS focus-zoom), is on screen
 *        and not covered; the modal is a child of <body> (portal), not of the
 *        card whose transform/backdrop-filter used to trap it
 *   + the full-key never appears in the page; only the mask
 *
 * Responsive, at 320/360/375/390/430/768/1024/1280/1440/1920 × light/dark: no
 * sideways page scroll; the tab bar scrolls instead of squeezing labels; the
 * builder's steps, the last step and "Opublikuj" are not under the dock; the
 * step editor and prompt fields fit; the execution/costs card fits.
 *
 *   node scripts/workflow-probe.mjs --harness
 *   npm run build && npx next start -p 3131 &
 *   node scripts/workflow-probe.mjs http://127.0.0.1:3131
 *   node scripts/workflow-probe.mjs --clean
 */
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/workflow";

const PAGE_SRC = `import { getScopedDictionary, getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { I18nScope } from "@/lib/i18n/provider";
import { AdminShell } from "@/components/layout/admin-mobile";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { ProviderCard, type ProviderView } from "@/components/admin/provider-card";
import type { ExecutionSummary, PathModel, ToolApiPath } from "@/lib/server/tool-api-path";
import type { WorkflowVersionRow } from "@/lib/services/ai-tools";
import { ToolTabs } from "@/components/admin/tool-tabs";
import { WorkflowBuilder } from "@/components/admin/workflow-builder";
import { WorkflowTestPanel } from "@/components/admin/workflow-test";
import { ExecutionPathCard } from "@/components/admin/tool-api-path";
import { UnitPriceEditor } from "@/components/admin/unit-prices";
import { TokenPriceEditor } from "@/components/admin/token-prices";

export const dynamic = "force-dynamic";

const provider: ProviderView = {
  id: "p1", slug: "google", name: "Google (Gemini) — dostawca o bardzo długiej nazwie", active: true,
  modelsActive: 3, modelsTotal: 4, modelNames: ["Nano Banana Pro", "Gemini Flash", "Imagen 4"], toolKeys: ["retouch", "fashion_flat_lay"],
  state: "connected", stateReason: null,
  credential: {
    masked: "•••• 9f2k", source: "vault", readable: true, updatedAt: "2026-09-20T10:00:00Z", lastTestedAt: "2026-09-20T10:01:00Z",
    lastTestStatus: "connected", lastTestDetail: null, latencyMs: 412, baseUrl: null,
    lastImageTestAt: null, lastImageTestStatus: null, lastImageTestError: null,
    lastSuccessAt: "2026-09-20T10:01:00Z", lastErrorAt: null, lastErrorCode: null,
  },
};
const wfVersions: WorkflowVersionRow[] = [
  { id: "w3", version: 3, status: "draft", summary: "Retusz → sceny → 5 generacji", reason: null, stepCount: 3, maxOutputs: 5, createdAt: "2026-09-22T10:00:00Z", publishedAt: null, authorName: "Anna Admin" },
  { id: "w2", version: 2, status: "published", summary: "Analiza + obraz", reason: "Test", stepCount: 2, maxOutputs: 1, createdAt: "2026-09-12T10:00:00Z", publishedAt: "2026-09-12T10:00:00Z", authorName: "Anna Admin" },
  { id: "w1", version: 1, status: "superseded", summary: null, reason: "Start", stepCount: 1, maxOutputs: 1, createdAt: "2026-09-02T10:00:00Z", publishedAt: "2026-09-02T10:00:00Z", authorName: null },
];
const models = [
  { id: "m1", name: "Nano Banana Pro — bardzo długa nazwa modelu obrazu", refs: true },
  { id: "m2", name: "GPT Image 1", refs: true },
];
const exec: ExecutionSummary = {
  engineMode: "grovbase", workflowEnabled: true,
  workflow: { id: "w2", version: 2, maxOutputs: 5, concurrency: 3, steps: [
    { n: 1, name: "Retusz zdjęcia produktu", operation: "tool", enabled: true, forEach: null, maxItems: null, model: null, fallback: null, textProvider: null, textModel: null, toolSlug: "retouch" },
    { n: 2, name: "Analiza i scenariusze sprzedażowe", operation: "ai_text", enabled: true, forEach: null, maxItems: 5, model: null, fallback: null, textProvider: "openai", textModel: "gpt-5", toolSlug: null },
    { n: 3, name: "Generacje scen", operation: "image_generation", enabled: true, forEach: "scene_prompts", maxItems: 5, model: "Google · Nano Banana Pro", fallback: "OpenAI · GPT Image 1", textProvider: null, textModel: null, toolSlug: null },
  ] },
};
const pm = (id, name, cost) => ({ id, providerSlug: "google", providerName: "Google", model: name, identifier: name, ready: true,
  costPerImageUsdMicros: cost, costSource: cost === null ? "unknown" : "unit_price" });
const path: ToolApiPath = { kind: "assigned", primary: pm("m1", "gemini-3-pro-image-preview", 134000), fallback: pm("m2", "gpt-image-1", null), defaulted: false };
const units = {
  rows: [{ providerSlug: "google", model: "gemini-3-pro-image-preview", unitKind: "image", resolution: "2K", quality: "*", usdPerUnit: 0.134, updatedAt: null }],
  models: [
    { providerSlug: "google", model: "gemini-3-pro-image-preview", name: "Nano Banana Pro", flatUsdPerImage: 0.04, priced: true },
    { providerSlug: "openai", model: "gpt-image-1", name: "GPT Image 1", flatUsdPerImage: null, priced: false },
  ],
};
const prices = [{ providerSlug: "openai", model: "gpt-5", inputUsdPerM: 1.25, outputUsdPerM: 10, cachedInputUsdPerM: 0.125, updatedAt: null, unpricedCalls: 0 }];

export default async function Probe() {
  const { dict, locale } = await getDictionary();
  const { dict: adminDict } = await getScopedDictionary("admin");
  const t = makeT(dict);
  const stats = { users: 12, usersToday: 1, revenueTodayCents: 0, revenue30dCents: 0 };
  return (
    <I18nScope dict={adminDict}>
      <div className="flex min-h-dvh w-full min-w-0">
        <AdminSidebar name="Probe Admin" email="probe@grovbase.test" role="admin" stats={stats} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminShell name="Probe Admin" email="probe@grovbase.test" role="admin" stats={stats} />
          <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-4 pb-[calc(var(--dock-h)+2rem+env(safe-area-inset-bottom))] pt-5 sm:px-5 lg:px-6 lg:pb-12 lg:pt-6 xl:px-7">
            <PageHeader overline={t("aicc.category.editing")} title="Retusz zdjęć" sub="/retusz" />
            <ToolTabs toolKey="retouch" tabs={["basics", "engine", "workflow", "models", "knowledge"]} active="workflow" label={t("aicc.tabsLabel")} t={t} />
            <div className="space-y-4">
              <div data-probe-provider><ProviderCard p={provider} locale={locale} /></div>
              <Card className="p-4 sm:p-5"><CardHeader title={t("aicc.wf2.title")} sub={t("aicc.wf2.sub")} />
                <div className="pt-4"><WorkflowBuilder toolKey="retouch" versions={wfVersions} models={models} locale={locale} enabled={false} /></div></Card>
              <Card className="p-4 sm:p-5"><CardHeader title={t("aicc.wf2.test.title")} />
                <div className="pt-4"><WorkflowTestPanel toolKey="retouch" versions={wfVersions} workspaceId="11111111-1111-4111-8111-111111111111" /></div></Card>
              <Card className="p-4 sm:p-5" data-probe-exec><CardHeader title={t("aicc.exec.title")} />
                <div className="pt-4"><ExecutionPathCard exec={exec} path={path} toolKey="retouch" t={t} /></div></Card>
              <Card className="p-4 sm:p-5" data-probe-prices><TokenPriceEditor rows={prices} /><div className="mt-4"><UnitPriceEditor rows={units.rows} models={units.models} /></div></Card>
            </div>
          </main>
        </div>
      </div>
    </I18nScope>
  );
}
`;

if (process.argv.includes("--harness")) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${DIR}/page.tsx`, PAGE_SRC.replace(/^const pm = \(id, name, cost\) =>/m, "const pm = (id: string, name: string, cost: number | null): PathModel =>"));
  console.log(`harness written to ${DIR}`);
  process.exit(0);
}
if (process.argv.includes("--clean")) {
  fs.rmSync(DIR, { recursive: true, force: true });
  if (fs.existsSync("app/probe-tmp") && fs.readdirSync("app/probe-tmp").length === 0) fs.rmSync("app/probe-tmp", { recursive: true });
  console.log("harness removed");
  process.exit(0);
}

const BASE = process.argv[2] ?? "http://127.0.0.1:3131";
const URL = `${BASE}/probe-tmp/workflow`;
const WIDTHS = [320, 360, 375, 390, 430, 768, 1024, 1280, 1440, 1920];
const SHOTS = process.env.SHOTS ?? "";
const KEY = "sk-probe-FULLKEY-abcdef0123456789";
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failed++; console.log(`  ✗ ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`); }
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });

/* ── API1–API4: the key modal ─────────────────────────────────────────────*/
for (const device of [
  { name: "desktop 1280", viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false },
  { name: "iPhone 390 (mobile emulation)", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
  { name: "phone 320", viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true },
]) {
  const ctx = await browser.newContext({ ...device, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "networkidle" });
  const tag = device.name;
  const open = page.locator("[data-probe-provider] button", { hasText: /Zmień klucz|Change key|Schlüssel ändern/ }).first();
  await open.scrollIntoViewIfNeeded();
  // Hover and press like a person (the old bug moved the card on :active).
  await open.hover();
  await open.click();
  const input = page.locator("[data-provider-key-form] input[type='password'], [data-provider-key-form] input[autocomplete='new-password']").first();
  await input.waitFor({ state: "visible", timeout: 5000 });
  const focused = await input.evaluate((el) => document.activeElement === el);
  check(`API1 ${tag}: the modal opens and the key input has focus`, focused);
  const portal = await input.evaluate((el) => {
    const dialog = el.closest("[role='dialog']");
    let n = dialog; while (n && n.parentElement && n.parentElement !== document.body) n = n.parentElement;
    return Boolean(dialog) && n?.parentElement === document.body && !el.closest("[data-probe-provider]");
  });
  check(`API1 ${tag}: the modal is portalled to <body>, outside the card`, portal);
  const onTop = await input.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || el.contains(hit);
  });
  check(`API1 ${tag}: nothing covers the input`, onTop);
  const save = page.locator("[data-provider-key-form] button[type='submit']");
  check(`API2 ${tag}: "Zapisz" is disabled while empty`, await save.isDisabled());
  await input.click();
  await page.keyboard.type(KEY, { delay: 2 });
  check(`API2 ${tag}: typing reaches the input`, (await input.inputValue()) === KEY, await input.inputValue());
  check(`API2 ${tag}: …and enables "Zapisz"`, await save.isEnabled());
  await input.fill("");
  await input.focus();
  await input.evaluate((el, text) => {
    const dt = new DataTransfer(); dt.setData("text/plain", text);
    const ok = el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    // A browser inserts the text only when nothing cancelled the paste.
    if (ok) { el.setRangeText(text, el.selectionStart ?? 0, el.selectionEnd ?? 0, "end"); el.dispatchEvent(new Event("input", { bubbles: true })); }
  }, KEY);
  check(`API3 ${tag}: pasting reaches the input (not cancelled)`, (await input.inputValue()) === KEY, await input.inputValue());
  check(`API3 ${tag}: …and enables "Zapisz"`, await save.isEnabled());
  const font = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  if (device.isMobile) check(`API4 ${tag}: input font ≥ 16 px (no iOS focus zoom)`, font >= 16, font);
  const box = await input.boundingBox();
  check(`API4 ${tag}: the input is fully on screen`, !!box && box.x >= 0 && box.x + box.width <= device.viewport.width + 1 && box.y >= 0 && box.y + box.height <= device.viewport.height, box);
  const attrs = await input.evaluate((el) => ({ ac: el.getAttribute("autocomplete"), cap: el.getAttribute("autocapitalize"), lp: el.getAttribute("data-lpignore") }));
  check(`API4 ${tag}: no autofill/autocapitalise interference`, attrs.ac === "new-password" && attrs.cap === "off" && attrs.lp === "true", attrs);
  const baseUrl = page.locator("[data-provider-key-form] input[type='url']");
  await baseUrl.fill("http://127.0.0.1/v1");
  check(`API5 ${tag}: an unsafe Base URL blocks "Zapisz" in the modal already`, await save.isDisabled());
  await baseUrl.fill("https://gateway.example.com/v1");
  check(`API5 ${tag}: a valid Base URL lets it save`, await save.isEnabled());
  // The full key exists ONLY in the input the admin typed into.
  // React mirrors a controlled input's value into its own attribute; outside
  // that one input the key must appear nowhere (no preview, no echo, no label).
  const html = await page.evaluate((k) => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("[data-provider-key-form] input[autocomplete='new-password']").forEach((el) => el.remove());
    return clone.outerHTML.split(k).length - 1 + document.body.innerText.split(k).length - 1;
  }, KEY);
  check(`API7 ${tag}: the typed key exists only inside its own input`, html === 0, html);
  const mask = await page.locator("[data-probe-provider]").innerText();
  check(`API6 ${tag}: the card shows only the mask`, /•••• 9f2k/.test(mask));
  await page.keyboard.press("Escape");
  check(`${tag}: no client errors`, errors.length === 0, errors.slice(0, 2));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/key-modal-${tag.replace(/\W+/g, "-")}.png` });
  await ctx.close();
}

/* ── responsive matrix ────────────────────────────────────────────────────*/
for (const theme of ["light", "dark"]) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 800 : 900 }, colorScheme: theme, hasTouch: width < 1024 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(URL, { waitUntil: "networkidle" });
    if (theme === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
    const tag = `${theme} ${width}`;
    const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${tag}: no sideways page scroll`, (await over()) <= 1, await over());
    // Tabs: full labels, the bar scrolls instead of squeezing.
    const tabs = await page.evaluate(() => {
      const nav = document.querySelector("[data-tool-tabs]");
      const links = [...(nav?.querySelectorAll("a") ?? [])];
      return { n: links.length, clipped: links.some((a) => a.scrollWidth > a.clientWidth + 1), wraps: links.some((a) => a.getBoundingClientRect().height > 40) };
    });
    check(`${tag}: 5 tabs, no squeezed or wrapped label`, tabs.n === 5 && !tabs.clipped && !tabs.wraps, tabs);
    // Builder: insert the example flow (3 steps), all fit, fields usable.
    await page.locator("[data-workflow-builder] button", { hasText: /Wstaw przykład|Insert example|Beispiel einfügen/ }).click();
    const steps = page.locator("[data-workflow-builder] [data-step]");
    check(`${tag}: the example flow has 3 vertical steps`, (await steps.count()) === 3);
    const stepOver = await page.evaluate(() => [...document.querySelectorAll("[data-step]")].some((el) => el.scrollWidth > el.clientWidth + 1));
    check(`${tag}: step cards do not overflow`, !stepOver);
    const ta = steps.nth(2).locator("textarea");
    const taBox = await ta.boundingBox();
    check(`${tag}: the prompt editor fits and is usable`, !!taBox && taBox.height >= 120 && taBox.x >= 0 && taBox.x + taBox.width <= width + 1, taBox);
    if (width < 640) {
      const f = await ta.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      check(`${tag}: prompt text is ≥ 16 px on a phone`, f >= 16, f);
    }
    const invalid = await page.locator("[data-workflow-invalid]").count();
    check(`${tag}: the example flow validates (same rules as the server)`, invalid === 0);
    // Add one more step of every type: no artificial cap, nothing overflows.
    for (const label of [/AI tekst|AI text|KI-Text/, /Edycja obrazu|Image edit|Bildbearbeitung/]) {
      await page.locator("[data-add-step] button", { hasText: label }).click();
    }
    check(`${tag}: steps can be added beyond three`, (await steps.count()) === 5);
    // The last step and Publish are reachable, not under the dock.
    for (const [name, loc] of [["last step", steps.last().locator("input").first()], ["Opublikuj", page.locator("[data-publish]")]]) {
      await loc.scrollIntoViewIfNeeded();
      const covered = await loc.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !hit || !(hit === el || el.contains(hit) || hit.contains(el));
      });
      check(`${tag}: ${name} is not covered by the dock`, !covered);
    }
    const execBox = await page.locator("[data-execution-path]").boundingBox();
    check(`${tag}: the execution/costs card fits`, !!execBox && execBox.x + execBox.width <= width + 1);
    check(`${tag}: it says "Sterowane przez Workflow" with an editor link`,
      (await page.locator("[data-workflow-driven]").count()) === 1 && (await page.locator("[data-workflow-driven] a[href*='tab=workflow']").count()) === 1);
    check(`${tag}: an unpriced model shows UNKNOWN, never 0.00`, /NIEZNANY|UNKNOWN|UNBEKANNT/.test(await page.locator("[data-execution-path]").innerText()));
    const priceOver = await page.evaluate(() => [...document.querySelectorAll("[data-unit-row], [data-unit-new], [data-token-prices] > div")].some((el) => el.scrollWidth > el.clientWidth + 1));
    check(`${tag}: price editors do not overflow`, !priceOver);
    check(`${tag}: still no sideways scroll after edits`, (await over()) <= 1, await over());
    check(`${tag}: no client errors`, errors.length === 0, errors.slice(0, 2));
    if (SHOTS && [320, 390, 768, 1280, 1920].includes(width)) await page.screenshot({ path: `${SHOTS}/workflow-${theme}-${width}.png`, fullPage: true });
    await ctx.close();
  }
}
await browser.close();
console.log(failed === 0 ? "\nAll workflow/API probe checks passed." : `\n${failed} FAILED`);
process.exit(failed ? 1 : 0);
