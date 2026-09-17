/**
 * MEDIA SLOTS, MEASURED IN A REAL BROWSER.
 *
 * The unit tests pin what the registry DECLARES and what the actions REFUSE.
 * This pins what a browser actually DOES with a filled slot — which is the
 * part the brief is really asking about and the part a string comparison
 * cannot answer:
 *
 *   THE FALLBACK IS REAL. A slot with nothing in it must paint exactly the
 *   art the surface painted before this feature existed — not an empty box,
 *   not a placeholder, not a broken image.
 *   THE RESPONSIVE OVERRIDE IS REAL. A tile with a mobile file must SERVE the
 *   mobile file at 390 and the desktop file at 1440. `<source media>` either
 *   works in the browser or it does not; there is no partial credit.
 *   THE FRAME HOLDS ITS SHAPE. A card must not grow when its picture arrives,
 *   so the frame's ratio is measured before and independently of the file.
 *   VIDEO COSTS NOTHING UNTIL IT IS NEEDED. A clip far below the fold must
 *   still be `preload="none"` with no src attached.
 *   NOTHING OVERFLOWS. Six tiles and a dozen tool cards at 320px.
 *
 *   node scripts/media-probe.mjs --harness
 *   npm run build && npx next start -p 3121 &
 *   node scripts/media-probe.mjs http://127.0.0.1:3121
 *   node scripts/media-probe.mjs --clean
 */
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/media";

/* Three PNGs of three different WIDTHS, so which file a viewport was served is
 * a number the probe can read off `naturalWidth` rather than a guess. */
const DESKTOP = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAABCAIAAABsYngUAAAADklEQVR4nGO4o7EFKwIArTkNwXrZgRMAAAAASUVORK5CYII=";
const TABLET = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAADUlEQVR4nGPQ2HIHjgAp7QbhABK5OwAAAABJRU5ErkJggg==";
const MOBILE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4cEIDiAAOtwPBvuim9AAAAABJRU5ErkJggg==";

const FIXTURE_SRC = `import type { ResolvedSlot, SlotMap } from "@/lib/server/media-slots";

/** Three files of three different widths, so the probe can tell which one a
 *  viewport was served by reading naturalWidth. */
export const DESKTOP = "${DESKTOP}";
export const TABLET = "${TABLET}";
export const MOBILE = "${MOBILE}";

const base = (key: string): ResolvedSlot => ({
  key, mediaType: "image", alt: "", fit: "cover", position: "center center",
  autoplay: true, muted: true, loop: true, controls: false, desktop: DESKTOP,
});

export const SLOTS: SlotMap = new Map<string, ResolvedSlot>([
  // Moda: a plain image, no overrides. Ecommerce: all three widths.
  ["dashboard.category.moda.card", base("dashboard.category.moda.card")],
  ["dashboard.category.ecommerce.card", {
    ...base("dashboard.category.ecommerce.card"), tablet: TABLET, mobile: MOBILE,
  }],
  // Social: a video, far below the fold on purpose.
  ["dashboard.category.social.card", {
    ...base("dashboard.category.social.card"), mediaType: "video",
    desktop: "/probe-clip.mp4", poster: DESKTOP,
  }],
  // Mailing: contain + a corner, to prove both reach the element's style.
  ["dashboard.category.mailing.card", {
    ...base("dashboard.category.mailing.card"), fit: "contain", position: "right bottom",
    alt: "Opis kafelka",
  }],
  // Two tool cards: one filled, the rest fall back to their drawn motifs.
  ["tools.retouch.card", base("tools.retouch.card")],
  ["tools.compress.card", { ...base("tools.compress.card"), mobile: MOBILE }],
]);

/** The same surfaces with nothing configured — the fallback path. */
export const EMPTY: SlotMap = new Map();
`;

const PAGE_SRC = `import { CategoryGrid } from "@/components/home/category-grid";
import { ToolsCatalogue } from "@/components/tools/tools-catalogue";
import { Wrench } from "lucide-react";
import { FEATURE_KEYS, type AvailabilityMap } from "@/lib/features";
import { SLOTS, EMPTY } from "@/app/probe-tmp/media/fixture";

export const dynamic = "force-static";

/** Everything open: this probe is about pictures, not about the switchboard. */
const AVAIL = Object.fromEntries(FEATURE_KEYS.map((k) => [k, {
  status: "ACTIVE" as const, hiddenFromMenu: false, customTitle: null,
  customMessage: null, reopensAt: null,
}])) as AvailabilityMap;

const CARDS = [
  { key: "retouch", href: "/retusz", icon: Wrench, motif: "wipe" as const,
    title: "Retusz", body: "Poprawki", slotKey: "tools.retouch.card" },
  { key: "compress", href: "/tools/compress", icon: Wrench, motif: "compress" as const,
    title: "Kompresja", body: "Mniejszy plik", slotKey: "tools.compress.card" },
  { key: "resize", href: "/tools/resize", icon: Wrench, motif: "scale" as const,
    title: "Format", body: "Zmiana rozmiaru", slotKey: "tools.resize.card" },
];

/** The REAL components, with a fixture slot map instead of a database — the
 *  renderer only ever sees a SlotMap, so this exercises production exactly. */
export default function Page() {
  return (
    <div className="min-h-dvh bg-bg p-4">
      <section data-probe="filled">
        <CategoryGrid t={(k) => k} slots={SLOTS}
          previews={["/fallback-a.png", null, null, null, null, null]} />
      </section>

      <section data-probe="empty" className="mt-6">
        <CategoryGrid t={(k) => k}
          previews={["/fallback-a.png", null, null, null, null, null]} />
      </section>

      <section data-probe="tools" className="mt-6">
        <ToolsCatalogue t={(k) => k} isAdmin avail={AVAIL} slots={SLOTS}
          sections={[{ key: "edit", icon: Wrench, title: "Edytuj", cards: CARDS }]} />
      </section>

      <section data-probe="tools-empty" className="mt-6">
        <ToolsCatalogue t={(k) => k} isAdmin avail={AVAIL} slots={EMPTY}
          sections={[{ key: "edit", icon: Wrench, title: "Edytuj", cards: CARDS }]} />
      </section>

      {/* Three screens of nothing, so the grid below is genuinely out of
          reach of the observer's one-screen margin — the case the lazy video
          exists for. */}
      <div aria-hidden style={{ height: "3000px" }} />
      <section data-probe="below">
        <CategoryGrid t={(k) => k} slots={SLOTS} />
      </section>
    </div>
  );
}
`;


/* The ADMIN screen, at phone widths. §20 of the brief is a sentence — "zero
 * horizontal scroll" — and it is the one thing about an admin panel that is
 * either true or false and cannot be argued about. */
const ADMIN_SRC = `"use client";
import { I18nProvider } from "@/lib/i18n/provider";
import { SlotsPanel } from "@/components/admin/media/slots-panel";
import { BannerEditor } from "@/components/admin/media/banner-editor";
import { MEDIA_SLOTS, bannerSlotKey } from "@/lib/media-slots";
import type { LibraryItem, SlotRow, BannerRow } from "@/lib/services/media-slots";
import dict from "@/lib/i18n/dictionaries/pl.json";

const LIBRARY: LibraryItem[] = [
  { id: "a1", kind: "image", url: "${DESKTOP}", posterUrl: null,
    title: "zdjecie-produktowe-bardzo-dluga-nazwa-pliku.png", alt: null, folder: "kampanie",
    tags: [], width: 1600, height: 1000, sizeBytes: 482000, mime: "image/png",
    createdAt: "2026-01-01T00:00:00Z" },
  { id: "a2", kind: "video", url: "/probe-clip.mp4", posterUrl: "${DESKTOP}",
    title: "klip.mp4", alt: null, folder: null, tags: [], width: null, height: null,
    sizeBytes: 9400000, mime: "video/mp4", createdAt: "2026-01-02T00:00:00Z" },
];

const CONFIGURED: SlotRow = {
  slotKey: "dashboard.category.moda.card", mediaType: "image", mediaId: "a1",
  tabletMediaId: null, mobileMediaId: null, posterMediaId: null,
  altText: "Kafelek Moda", objectFit: "cover", objectPosition: "right bottom",
  autoplay: true, muted: true, loop: true, controls: false, enabled: true,
  updatedAt: null, updatedBy: null,
};

const GROUPS = ["moda", "ecommerce", "social", "mailing", "inne", "matching", "x1", "x2"]
  .map((id, i) => ({
    id, name: i < 6 ? "Kategoria " + id : "Dodatkowa " + id, sub: "/k/" + id,
    slots: MEDIA_SLOTS.filter((s) => s.entityType === "category" && s.entityId === id)
      .map((def) => ({ def, row: def.slotName === "card" ? CONFIGURED : null })),
  }))
  .filter((g) => g.slots.length > 0);

const BANNERS: BannerRow[] = [{
  bannerKey: "dashboard.promo", placement: "dashboard",
  label: { pl: "Promocja" }, body: { pl: "Tresc" }, ctaLabel: { pl: "Sprawdz" },
  ctaUrl: "/tools", active: true, startsAt: null, endsAt: null, sortOrder: 10,
  slotKey: bannerSlotKey("dashboard.promo"),
}];

export default function Page() {
  return (
    <I18nProvider locale="pl" dict={dict}>
      <div className="min-h-dvh bg-bg p-4">
        <section data-probe="admin-slots">
          <SlotsPanel groups={GROUPS} library={LIBRARY} emptyLabel="brak" />
        </section>
        <section data-probe="admin-banners" className="mt-6">
          <BannerEditor banners={BANNERS} library={LIBRARY}
            slotRows={{ [bannerSlotKey("dashboard.promo")]: null }} />
        </section>
      </div>
    </I18nProvider>
  );
}
`;

const WIDTHS = [320, 360, 390, 414, 639, 640, 768, 834, 1023, 1024, 1280, 1440, 1920];

if (process.argv.includes("--harness")) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${DIR}/fixture.ts`, FIXTURE_SRC);
  fs.writeFileSync(`${DIR}/page.tsx`, PAGE_SRC);
  fs.mkdirSync(`${DIR}/admin`, { recursive: true });
  fs.writeFileSync(`${DIR}/admin/page.tsx`, ADMIN_SRC);
  console.log(`harness written to ${DIR}`);
  process.exit(0);
}
if (process.argv.includes("--clean")) {
  fs.rmSync("app/probe-tmp", { recursive: true, force: true });
  console.log("harness removed");
  process.exit(0);
}

const BASE = process.argv[2] ?? "http://127.0.0.1:3121";
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`); }
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

for (const theme of ["light", "dark"]) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      colorScheme: theme === "dark" ? "dark" : "light",
    });
    await page.goto(`${BASE}/probe-tmp/media`, { waitUntil: "networkidle" });
    const label = `${theme} ${width}px`;

    const r = await page.evaluate(() => {
      const q = (sel, root = document) => [...root.querySelectorAll(sel)];
      const filled = document.querySelector('[data-probe="filled"]');
      const empty = document.querySelector('[data-probe="empty"]');
      const tools = document.querySelector('[data-probe="tools"]');
      const toolsEmpty = document.querySelector('[data-probe="tools-empty"]');
      const below = document.querySelector('[data-probe="below"]');

      const slotBox = (root, key) => {
        const el = root.querySelector(`[data-slot="${key}"]`);
        if (!el) return null;
        const img = el.querySelector("img");
        const video = el.querySelector("video");
        const box = el.getBoundingClientRect();
        return {
          kind: el.getAttribute("data-slot-kind"),
          w: Math.round(box.width), h: Math.round(box.height),
          natural: img ? img.naturalWidth : null,
          currentSrc: img ? (img.currentSrc || img.src).slice(0, 40) : null,
          fit: img ? getComputedStyle(img).objectFit : null,
          pos: img ? getComputedStyle(img).objectPosition : null,
          alt: img ? img.getAttribute("alt") : null,
          loading: img ? img.getAttribute("loading") : null,
          sources: q("source", el).map((s) => s.getAttribute("media")),
          videoPreload: video ? video.getAttribute("preload") : null,
          videoHasSrc: video ? Boolean(video.getAttribute("src")) : null,
        };
      };

      return {
        docScroll: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        // FILLED: four configured tiles.
        moda: slotBox(filled, "dashboard.category.moda.card"),
        ecom: slotBox(filled, "dashboard.category.ecommerce.card"),
        social: slotBox(filled, "dashboard.category.social.card"),
        socialBelow: slotBox(below, "dashboard.category.social.card"),
        mailing: slotBox(filled, "dashboard.category.mailing.card"),
        // The two tiles with nothing configured must fall through.
        inneFilled: Boolean(filled.querySelector('[data-slot="dashboard.category.inne.card"]')),
        filledFrames: q(".media-frame", filled).length,
        // EMPTY: no slot markup at all, and the shared <Media> frames instead.
        emptySlots: q("[data-slot]", empty).length,
        emptyFrames: q(".media-frame", empty).length,
        emptyFirstSrc: (empty.querySelector(".media-frame img") || {}).src ?? null,
        // TOOLS: one filled, one with a mobile override, one falling back.
        retouch: slotBox(tools, "tools.retouch.card"),
        compress: slotBox(tools, "tools.compress.card"),
        resizeFilled: Boolean(tools.querySelector('[data-slot="tools.resize.card"]')),
        toolsEmptySlots: q("[data-slot]", toolsEmpty).length,
        toolsEmptyMotifs: q('[data-tool-card] svg', toolsEmpty).length,
        toolCards: q("[data-tool-card]", tools).length,
      };
    });

    /* ── NOTHING OVERFLOWS ───────────────────────────────────────────── */
    check(`${label}: no horizontal overflow`,
      r.docScroll <= r.clientW + 1, `${r.docScroll} > ${r.clientW}`);

    /* ── THE FALLBACK IS REAL ────────────────────────────────────────── */
    check(`${label}: an unconfigured grid renders no slot markup`,
      r.emptySlots === 0, `${r.emptySlots}`);
    check(`${label}: an unconfigured grid still renders six frames`,
      r.emptyFrames === 6, `${r.emptyFrames}`);
    check(`${label}: the unconfigured tile keeps the account's own preview`,
      String(r.emptyFirstSrc).includes("/fallback-a.png"), `${r.emptyFirstSrc}`);
    check(`${label}: an unconfigured tile inside a configured grid falls back`,
      r.inneFilled === false);
    check(`${label}: every unconfigured tool card keeps its drawn motif`,
      r.toolsEmptySlots === 0 && r.toolsEmptyMotifs >= 3,
      `${r.toolsEmptySlots} slots / ${r.toolsEmptyMotifs} motifs`);
    check(`${label}: an unconfigured tool card inside a configured catalogue falls back`,
      r.resizeFilled === false);

    /* ── THE FILLED SLOT IS REAL ─────────────────────────────────────── */
    check(`${label}: a configured tile renders an image slot`,
      r.moda?.kind === "image", `${r.moda?.kind}`);
    check(`${label}: a configured tool card renders an image slot`,
      r.retouch?.kind === "image", `${r.retouch?.kind}`);
    check(`${label}: the catalogue still draws all three cards`,
      r.toolCards === 3, `${r.toolCards}`);

    /* ── THE RESPONSIVE OVERRIDE IS REAL ─────────────────────────────── */
    // 8px wide = the desktop file, 4 = tablet, 2 = mobile.
    const want = width <= 639 ? 2 : width <= 1023 ? 4 : 8;
    check(`${label}: the tile with three files is served the right one`,
      r.ecom?.natural === want, `natural=${r.ecom?.natural} want=${want}`);
    check(`${label}: a tile with only a desktop file is served it everywhere`,
      r.moda?.natural === 8, `${r.moda?.natural}`);
    check(`${label}: a tool card with only a mobile override switches at 640`,
      r.compress?.natural === (width <= 639 ? 2 : 8), `${r.compress?.natural}`);
    check(`${label}: a slot with no overrides emits no <source>`,
      r.moda?.sources.length === 0, `${r.moda?.sources}`);
    check(`${label}: the mobile source is offered before the tablet one`,
      r.ecom?.sources.join("|") === "(max-width: 639px)|(max-width: 1023px)",
      `${r.ecom?.sources}`);

    /* ── THE FRAME HOLDS ITS SHAPE ───────────────────────────────────── */
    // 16/10, measured. A 8×1 picture inside a 16/10 frame must not make the
    // frame 8×1 — that is the layout shift this design exists to prevent.
    for (const [name, box] of [["moda", r.moda], ["ecommerce", r.ecom], ["retouch", r.retouch]]) {
      const ratio = box ? box.w / box.h : 0;
      check(`${label}: the ${name} frame holds 16/10`,
        Math.abs(ratio - 1.6) < 0.06, `${box?.w}×${box?.h} = ${ratio.toFixed(2)}`);
    }

    /* ── CROP AND ALT REACH THE ELEMENT ──────────────────────────────── */
    check(`${label}: object-fit reaches the picture`,
      r.moda?.fit === "cover" && r.mailing?.fit === "contain",
      `${r.moda?.fit} / ${r.mailing?.fit}`);
    check(`${label}: object-position reaches the picture`,
      r.mailing?.pos === "100% 100%" || r.mailing?.pos === "right bottom",
      `${r.mailing?.pos}`);
    check(`${label}: the admin's alt text is on the image`,
      r.mailing?.alt === "Opis kafelka", `${r.mailing?.alt}`);
    check(`${label}: a tile below the fold is lazy`,
      r.moda?.loading === "lazy", `${r.moda?.loading}`);

    /* ── VIDEO COSTS NOTHING UNTIL IT IS NEEDED ──────────────────────── */
    check(`${label}: a video slot renders a video`,
      r.social?.kind === "video", `${r.social?.kind}`);
    // A clip WITHIN a screen of the viewport is allowed to start loading —
    // that is what the one-screen margin is for. Three screens down it must
    // still be costing nothing.
    check(`${label}: a clip near the viewport is allowed to prepare`,
      r.social?.videoPreload === "metadata",
      `preload=${r.social?.videoPreload}`);
    check(`${label}: a clip three screens down is not fetched`,
      r.socialBelow?.videoPreload === "none" && r.socialBelow?.videoHasSrc === false,
      `preload=${r.socialBelow?.videoPreload} src=${r.socialBelow?.videoHasSrc}`);

    await page.close();
  }
}

/* ── THE CLIP LOADS WHEN IT IS SCROLLED TO ───────────────────────────── */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
  await page.goto(`${BASE}/probe-tmp/media`, { waitUntil: "networkidle" });
  const sel = '[data-probe="below"] [data-slot="dashboard.category.social.card"] video';
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const after = await page.evaluate((s) => {
    const v = document.querySelector(s);
    return { preload: v?.getAttribute("preload"), hasSrc: Boolean(v?.getAttribute("src")) };
  }, sel);
  check("a clip scrolled into view starts loading",
    after.preload === "metadata" && after.hasSrc === true, JSON.stringify(after));
}

/* ── REDUCED MOTION IS HONOURED ──────────────────────────────────────── */
{
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 }, reducedMotion: "reduce",
  });
  await page.goto(`${BASE}/probe-tmp/media`, { waitUntil: "networkidle" });
  const sel = '[data-probe="below"] [data-slot="dashboard.category.social.card"] video';
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const calm = await page.evaluate((s) => {
    const v = document.querySelector(s);
    return { autoplay: v?.hasAttribute("autoplay"), controls: v?.hasAttribute("controls") };
  }, sel);
  check("prefers-reduced-motion stops the loop and offers a control",
    calm.autoplay === false && calm.controls === true, JSON.stringify(calm));
}


/* ── THE ADMIN SCREEN ON A PHONE ─────────────────────────────────────── */
for (const width of [320, 360, 390, 414, 768, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${BASE}/probe-tmp/media/admin`, { waitUntil: "networkidle" });
  const label = `admin ${width}px`;

  // Open a group so the editor itself — the widest thing on the screen — is
  // measured rather than assumed.
  await page.locator("[data-slot-group] button").first().click();
  await page.waitForTimeout(150);
  // And open "Zaawansowane", which holds the 3×3 grid and the toggles.
  const adv = page.locator('[data-slot-editor] button[aria-expanded]').first();
  if (await adv.count()) { await adv.click(); await page.waitForTimeout(150); }

  const r = await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    const over = q("*").filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > document.documentElement.clientWidth + 1 || b.left < -1);
    }).slice(0, 4).map((el) => `${el.tagName}.${(el.className || "").toString().slice(0, 40)}`);
    // EFFECTIVE hit area, not the painted box. The house Switch is a 24px
    // pill with `after:-inset-2.5`, i.e. a 44px target — measuring the button
    // alone would fail a control that is in fact the most thumb-friendly
    // thing on the screen.
    const hitBox = (el) => {
      const b = el.getBoundingClientRect();
      const a = getComputedStyle(el, "::after");
      if (!a || a.content === "none") return b.height;
      const grow = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n < 0 ? -n : 0; };
      return b.height + grow(a.top) + grow(a.bottom);
    };
    const tap = q("[data-slot-editor] button").filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && hitBox(el) < 28;
    }).length;
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      editors: q("[data-slot-editor]").length,
      previews: q("[data-slot-preview]").length,
      devices: q("[data-preview-device]").length,
      positions: q("[data-position]").length,
      groups: q("[data-slot-group]").length,
      banners: q("[data-banner]").length,
      saves: q("[data-slot-save]").length,
      overflowing: over,
      smallTargets: tap,
    };
  });

  check(`${label}: zero horizontal scroll`,
    r.scrollW <= r.clientW + 1, `${r.scrollW} > ${r.clientW}`);
  check(`${label}: nothing sticks out of the viewport`,
    r.overflowing.length === 0, `${r.overflowing}`);
  check(`${label}: the opened group shows its editors`, r.editors >= 1, `${r.editors}`);
  check(`${label}: each editor previews the card`, r.previews === r.editors,
    `${r.previews}/${r.editors}`);
  check(`${label}: each editor offers all three devices`,
    r.devices === r.editors * 3, `${r.devices}`);
  check(`${label}: the position picker is the full 3×3`,
    r.positions === 9, `${r.positions}`);
  check(`${label}: every category is listed as a group`, r.groups === 6, `${r.groups}`);
  check(`${label}: the banner editor renders`, r.banners === 1, `${r.banners}`);
  check(`${label}: the editor has a save`, r.saves >= 1, `${r.saves}`);
  check(`${label}: every control has a 28px+ hit area`, r.smallTargets === 0, `${r.smallTargets}`);

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nAll media probes passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
