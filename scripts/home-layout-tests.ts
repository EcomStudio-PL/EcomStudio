/**
 * „EDYTUJ STRONĘ” V2 ON /home — the layout (lib/home-layout.ts), the page it
 * draws (components/seller-home), the editor's registry and bulk pairing, the
 * footer, and the server-side guards.
 *
 *   npm run test:homelayout          (this file)
 *   npm run test:homelayout:sql      (0170 against a real Postgres)
 *
 *   A  tool visibility is one rule: hidden tool → gone for a customer,
 *      marked „Narzędzie ukryte” in edit mode; no gaps, no empty slides
 *   B  sections: hide, order, no empty wrapper, marked „Ukryta” in edit mode
 *   C  lists: add / hide / move / remove / edit, slot numbers never reused,
 *      unsafe text and links refused, the default layout = the page as it was
 *   D  photo grids and product photos (`<slot>.ref`): registry, media slot
 *   E  bulk upload: „name” + „name-ref” pairing, problems never guessed,
 *      single files and the before/after pairing unchanged
 *   F  the footer: the shared SiteFooter, /home only, after „Zgłoś błąd”
 *   G  server: admin-only, re-validated, compare-and-set, history, no
 *      parallel systems
 */
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HOME_SECTION_IDS, LIST_LIMITS, SLOT_MAX, addEntry, cleanHref, cleanText, defaultHomeLayout, elementVisible, familySlot,
  gridSlotKey, layoutItems, layoutKey, layoutSlotKeys, moveEntry, moveSection, normalizeHomeLayout, ownText, refSlotKey,
  keepCounters, removeEntry, sectionItem, setEntryHidden, setSectionHidden, setSectionItem, updateEntry,
  type HomeLayout, type HomeToolEntry,
} from "@/lib/home-layout";
import {
  BEFORE_AFTER, CAROUSEL, FEATURED, PROMO_BANNERS, SESSIONS, SHOWCASE, THUMBNAILS, UPLOAD_TOOLS,
} from "@/lib/seller-home-config";
import type { ItemState, ItemStatus } from "@/lib/seller-home-model";
import { CATEGORIES } from "@/lib/categories";
import { CATALOG_ITEMS } from "@/lib/tool-cards";
import type { SellerHomeData } from "@/lib/server/seller-home";
import { referencedItems } from "@/lib/server/seller-home";
import { SellerHomeView } from "@/components/seller-home/seller-home";
import { ToolCarousel } from "@/components/seller-home/tool-carousel";
import { gridTiles, pairCards, toolTiles } from "@/components/seller-home/home-view";
import { MediaSlot } from "@/components/seller-home/media-slot";
import { SQUARE_BREAKPOINTS, fadeMask, masonryCut, squareRows } from "@/components/seller-home/grid-window";
import { homePage, icePageFor, slotSpec } from "@/lib/ice/registry";
import { groupPairs, groupRefs, refSuffix } from "@/lib/ice/pairs";
import { planBulk } from "@/components/ice/editor/bulk-panel";
import { slotReadBatches, SLOT_READ_CAP } from "@/lib/server/seller-home-slots";
import type { ResolvedSlot } from "@/lib/server/media-slots";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail ? `\n      ${detail}` : ""}`);
}
const section = (title: string) => console.log(`\n${title}`);
const read = (p: string) => readFileSync(p, "utf8");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const T = (k: string, v?: Record<string, string | number>) => (v ? `${k}(${Object.values(v).join(",")})` : k);
const S = (key: string, status: ItemStatus = "live", extra: Partial<ItemState> = {}): ItemState => ({ key, href: `/t/${key}`, status, credits: 4, ...extra });

const ALL_KEYS = referencedItems(defaultHomeLayout());
const allLive = (omit: readonly string[] = [], hiddenForCustomers: readonly string[] = []) =>
  Object.fromEntries(ALL_KEYS.filter((k) => !omit.includes(k)).map((k) => [k, S(k, "live", hiddenForCustomers.includes(k) ? { customerHidden: true } : {})]));
const D = (over: Partial<SellerHomeData> = {}): SellerHomeData => ({
  balance: 10, items: allLive(), uploadTools: [], toolSlots: {}, channel: null, askChannel: false, interests: [], soon: [],
  pro: null, banners: [], slots: new Map(), isAdmin: false, layout: defaultHomeLayout(), editing: false, ...over,
});
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/* ── A ─────────────────────────────────────────────────────────────────── */

section("A. TOOL VISIBILITY — ONE RULE, ON THE SERVER, FOR EVERY ELEMENT");
{
  // A customer: the loader leaves a tool they are not offered out of `items`.
  const hiddenTool = CAROUSEL[2].item;
  const customer = D({ items: allLive([hiddenTool]) });
  const tiles = toolTiles("carousel", customer, T, "pl", { width: 1, height: 1 });
  check("A1 a tool hidden by the admin is not on the customer's carousel — and takes no place (no empty slide)",
    tiles.length === CAROUSEL.length - 1 && !tiles.some((x) => x.item === hiddenTool));
  const page = html(createElement(ToolCarousel, { data: customer, t: T, locale: "pl" }));
  check("A2 …nor in the rendered page (no tile, no clone)", !page.includes(`data-carousel-tile="${hiddenTool}"`) && !page.includes(`data-carousel-clone="${hiddenTool}"`));
  // The same tool in every list it can be bound to.
  const ba = BEFORE_AFTER[0].item;
  const feat = FEATURED[0].item;
  const gone = D({ items: allLive([ba, feat]) });
  check("A3 …nor in before/after or the Moda tools",
    !pairCards(gone, T, "pl").some((p) => p.item === ba) && !toolTiles("featured", gone, T, "pl", { width: 1, height: 1 }).some((x) => x.item === feat));
  // A section bound to a hidden tool disappears whole.
  const promoTool = sectionItem(defaultHomeLayout(), "promo1")!;
  const noPromo = html(createElement(SellerHomeView, { data: D({ items: allLive([promoTool]) }), t: T, locale: "pl" }));
  check("A4 a banner whose tool is hidden is not drawn at all", !noPromo.includes(`data-promo="${PROMO_BANNERS.first.key}"`));
  // The admin in „Edytuj stronę”: shown, marked, dimmed.
  const admin = D({ isAdmin: true, editing: true, items: allLive([], [hiddenTool]) });
  const marked = toolTiles("carousel", admin, T, "pl", { width: 1, height: 1 }).find((x) => x.item === hiddenTool);
  check("A5 edit mode: a tool hidden for customers is drawn marked „Narzędzie ukryte”", Boolean(marked) && marked!.flags.includes("tool"));
  const editHtml = html(createElement(ToolCarousel, { data: admin, t: T, locale: "pl" }));
  check("A6 …with the flag on the tile, never on a loop copy", count(editHtml, /data-home-flag="tool"/g) === 1);
  // „Podgląd jako klient” is viewerIsAdmin=false: isAdmin false, editing false → exactly the customer page.
  const preview = html(createElement(SellerHomeView, { data: D({ items: allLive([hiddenTool]) }), t: T, locale: "pl" }));
  check("A7 the customer preview has no edit marks, no section handles and no hidden tool",
    !/data-home-flag|data-home-section/.test(preview) && !preview.includes(`data-carousel-tile="${hiddenTool}"`));
  check("A8 the visibility rule: section, item, tool — all three",
    elementVisible({ sectionHidden: false, hidden: false, tool: "x", toolShown: () => true })
    && !elementVisible({ sectionHidden: true, hidden: false, tool: "x", toolShown: () => true })
    && !elementVisible({ sectionHidden: false, hidden: true, tool: "x", toolShown: () => true })
    && !elementVisible({ sectionHidden: false, hidden: false, tool: "x", toolShown: () => false })
    && elementVisible({ sectionHidden: false, hidden: false, tool: null, toolShown: () => false }));
  // Server-side: a direct URL is the route guard's (FeatureGate), which this task does not touch.
  check("A9 a hidden tool's direct URL stays guarded on the server: FeatureGate still answers notFound() to a customer",
    /notFound\(\)/.test(read("components/feature-gate.tsx")) && /viewerIsAdmin|isAdminUser/.test(read("components/feature-gate.tsx")));
  // Every tool a layout binds is read by the loader (its state decides).
  const unused = CATALOG_ITEMS.map((c) => c.key).find((k) => !ALL_KEYS.includes(k))!;
  const extra: HomeLayout = { ...defaultHomeLayout(), carousel: [...defaultHomeLayout().carousel, { id: "cnew", item: unused }] };
  check("A10 a tool the admin binds to a new tile is read by the loader like the config's (its state decides)",
    Boolean(unused) && !referencedItems(defaultHomeLayout()).includes(unused) && referencedItems(extra).includes(unused) && layoutItems(extra).includes(unused));
  // The loop only with ≥5 tiles; fewer is the plain rail.
  const few = D({ items: Object.fromEntries(CAROUSEL.slice(0, 4).map((c) => [c.item, S(c.item)])) });
  const fewHtml = html(createElement(ToolCarousel, { data: few, t: T, locale: "pl" }));
  check("A11 under five visible tiles: no loop, no copies; five or more: the loop", !fewHtml.includes("data-carousel-clone")
    && html(createElement(ToolCarousel, { data: D(), t: T, locale: "pl" })).includes("data-carousel-clone"));
  const hiddenMany = D({ layout: CAROUSEL.slice(0, CAROUSEL.length - 4).reduce((l, c) => setEntryHidden(l, "carousel", l.carousel.find((e) => e.item === c.item)!.id, true), defaultHomeLayout()) });
  check("A12 …counted after hiding (admin-hidden tiles do not count)", !html(createElement(ToolCarousel, { data: hiddenMany, t: T, locale: "pl" })).includes("data-carousel-clone"));
}

/* ── B ─────────────────────────────────────────────────────────────────── */

section("B. SECTIONS — VISIBILITY, ORDER, NO GAPS");
{
  const base = html(createElement(SellerHomeView, { data: D(), t: T, locale: "pl" }));
  const hidden = setSectionHidden(defaultHomeLayout(), "thumbnails", true);
  const page = html(createElement(SellerHomeView, { data: D({ layout: hidden }), t: T, locale: "pl" }));
  check("B1 a hidden section is not in the customer's page", base.includes("data-seller-thumbnails") && !page.includes("data-seller-thumbnails"));
  check("B2 …and leaves no wrapper behind (the customer DOM has no section wrappers at all)", !/data-home-section/.test(page) && !/data-home-section/.test(base));
  const edit = html(createElement(SellerHomeView, { data: D({ layout: hidden, isAdmin: true, editing: true }), t: T, locale: "pl" }));
  check("B3 edit mode: the hidden section stays in place, greyed and marked „Ukryta”",
    /data-home-section="thumbnails" data-home-hidden="true"/.test(edit) && /data-home-flag="section"/.test(edit) && /opacity-45 grayscale/.test(edit) && edit.includes("data-seller-thumbnails"));
  const moved = moveSection(defaultHomeLayout(), "featured", 0);
  const movedHtml = html(createElement(SellerHomeView, { data: D({ layout: moved }), t: T, locale: "pl" }));
  check("B4 a moved section is drawn in its new place", movedHtml.indexOf("data-featured=") < movedHtml.indexOf("data-carousel-tile="));
  check("B5 the default order is the page's order (12 sections, none hidden)", defaultHomeLayout().sections.map((s) => s.id).join() === HOME_SECTION_IDS.join()
    && defaultHomeLayout().sections.every((s) => !s.hidden));
  const n = normalizeHomeLayout({ v: 1, sections: [{ id: "soon" }, { id: "evil" }, { id: "carousel" }, { id: "soon" }] });
  check("B6 the stored order keeps its stable ids; an unknown or repeated section is dropped and a missing one comes back after its default predecessor",
    n.sections.length === 12 && new Set(n.sections.map((s) => s.id)).size === 12 && n.sections[0].id === "soon" && n.sections[1].id === "carousel"
    && n.sections[2].id === "upload" && !n.sections.some((s) => (s.id as string) === "evil"));
  check("B7 a section's button tool can be changed (catalogue items only) and back to the default",
    sectionItem(setSectionItem(defaultHomeLayout(), "promo1", "retouch"), "promo1") === "retouch"
    && sectionItem(setSectionItem(setSectionItem(defaultHomeLayout(), "promo1", "retouch"), "promo1", null), "promo1") === "generator"
    && sectionItem(setSectionItem(defaultHomeLayout(), "promo1", "not-a-tool"), "promo1") === "generator");
  // Empty placeholders are not hidden by anything here.
  check("B8 empty slots keep their placeholders: with nothing filled every grid tile is still drawn (as the empty slot)",
    count(base, /data-square-tile/g) === THUMBNAILS.tiles.length && count(base, /data-media-slot="empty"/g) > 0);
  const withSoon = html(createElement(SellerHomeView, { data: D({ soon: ["video"] as SellerHomeData["soon"] }), t: T, locale: "pl" }));
  check("B9 a section with nothing to show draws nothing (no campaign, nothing coming) — no wrapper, no gap",
    !base.includes("data-banner") && !base.includes("data-seller-soon") && withSoon.includes("data-seller-soon"));
}

/* ── C ─────────────────────────────────────────────────────────────────── */

section("C. LISTS — ADD, HIDE, MOVE, REMOVE, EDIT; SAFE TEXT AND LINKS");
{
  const d = defaultHomeLayout();
  check("C1 the default layout IS the config: carousel, featured, before/after, pills, grids — same items, same order, same slots",
    d.carousel.map((e) => e.item).join() === CAROUSEL.map((c) => c.item).join()
    && d.featured.map((e) => e.item).join() === FEATURED.map((f) => f.item).join()
    && d.beforeAfter.map((e) => e.item).join() === BEFORE_AFTER.map((b) => b.item).join()
    && d.pills.map((p) => p.id).join() === UPLOAD_TOOLS.map((u) => u.key).join()
    && d.thumbnails.map((e) => gridSlotKey("thumbnails", e.n)).join() === THUMBNAILS.tiles.map((x) => x.media.configKey).join()
    && d.sessions.map((e) => gridSlotKey("sessions", e.n)).join() === SESSIONS.tiles.map((x) => x.media.configKey).join()
    && d.showcase.map((e) => gridSlotKey("showcase", e.n)).join() === SHOWCASE.gallery.map((m) => m.configKey).join());
  check("C2 normalize(default) = default; garbage = default", layoutKey(normalizeHomeLayout(JSON.parse(JSON.stringify(d)))) === layoutKey(d)
    && layoutKey(normalizeHomeLayout(null)) === layoutKey(d) && layoutKey(normalizeHomeLayout({ v: 2 })) === layoutKey(d) && layoutKey(normalizeHomeLayout("x")) === layoutKey(d));
  const added = addEntry(d, "thumbnails");
  check("C3 a new photo takes the next slot number", "layout" in added && added.layout.thumbnails.at(-1)!.n === 21 && added.layout.seq.thumbnails === 21);
  if ("layout" in added) {
    const removed = removeEntry(added.layout, "thumbnails", added.id);
    const again = addEntry(removed, "thumbnails");
    check("C4 …and a removed photo's number is never reused (its pictures come back with an undo)", "layout" in again && again.layout.thumbnails.at(-1)!.n === 22);
    check("C5 the counter never goes back through a save — not even a restore of an older version (the server keeps the higher one)",
      keepCounters(normalizeHomeLayout({ ...removed, seq: { ...removed.seq, thumbnails: 3 } }), removed).seq.thumbnails === 21
      && keepCounters(defaultHomeLayout(), removed).seq.thumbnails === 21 && /keepCounters\(normalizeHomeLayout\(input\.doc\), before\.layout\)/.test(read("lib/server/ice/home.ts")));
  }
  const first = d.carousel[0].id;
  check("C6 hide / show an item", setEntryHidden(d, "carousel", first, true).carousel[0].hidden === true && !setEntryHidden(setEntryHidden(d, "carousel", first, true), "carousel", first, false).carousel[0].hidden);
  check("C7 move an item (drag and the buttons are the same operation)", moveEntry(d, "carousel", first, 3).carousel[3].id === first && moveEntry(d, "carousel", first, 99).carousel[0].id === first);
  check("C8 remove takes the item off the list only", removeEntry(d, "carousel", first).carousel.length === d.carousel.length - 1);
  const freeCat = CATEGORIES.map((c) => `cat:${c.key}`).find((k) => !d.carousel.some((e) => e.item === k))!;
  const tool = addEntry(d, "carousel", { item: freeCat });
  check("C9 a new tool tile is bound to a real tool; the same tool twice on one list is refused", "layout" in tool && tool.layout.carousel.at(-1)!.item === freeCat
    && "error" in addEntry("layout" in tool ? tool.layout : d, "carousel", { item: freeCat })
    && normalizeHomeLayout({ v: 1, carousel: [{ id: "a", item: "retouch" }, { id: "b", item: "retouch" }] }).carousel.length === 1);
  check("C9b the default ids survive a save (camelCase config keys: c-aiBackground)", d.carousel.every((e) => normalizeHomeLayout(d).carousel.some((x) => x.id === e.id))
    && d.featured.every((e) => normalizeHomeLayout(d).featured.some((x) => x.id === e.id)));
  check("C10 limits: a full list refuses another item", "error" in addEntry({ ...d, pills: d.pills }, "pills") && LIST_LIMITS.carousel === 30);
  check("C11 a slot family is bounded (beforeAfter 60, grids 120)", SLOT_MAX.beforeAfter === 60 && SLOT_MAX.thumbnails === 120
    && "error" in addEntry({ ...d, seq: { ...d.seq, thumbnails: 120 } }, "thumbnails"));
  // Safe text and links.
  check("C12 text with markup, control or invisible characters is dropped; plain text is kept and trimmed",
    cleanText({ pl: "<script>alert(1)</script>" }, 80) === undefined && cleanText({ pl: "a​b" }, 80) === undefined
    && cleanText({ pl: "x\u0007" }, 80) === undefined && JSON.stringify(cleanText({ pl: "  Buty  zimowe ", en: "Shoes" }, 80)) === '{"pl":"Buty zimowe","en":"Shoes"}'
    && cleanText({ pl: "x".repeat(81) }, 80) === undefined);
  check("C13 links: only an in-app path — no scheme, no host, no //, no ..",
    cleanHref("/k/moda/street") === "/k/moda/street" && cleanHref("https://evil.example") === undefined && cleanHref("//evil.example") === undefined
    && cleanHref("javascript:alert(1)") === undefined && cleanHref("/a/../admin") === undefined && cleanHref("/x\"onmouseover=1") === undefined);
  const dirty = normalizeHomeLayout({
    v: 1,
    carousel: [
      { id: "c1", item: "generator", name: { pl: "<b>x</b>", en: "Good" }, href: "https://evil.example" },
      { id: "c1", item: "retouch" },
      { id: "BAD ID", item: "retouch" },
      { id: "c2", item: "no.such.tool" },
      { id: "c3", item: "generator" },
    ],
    thumbnails: [{ id: "t1", n: 5 }, { id: "t2", n: 5 }, { id: "t3", n: 999 }],
  });
  check("C14 the server's normalize drops bad ids, unknown tools, duplicate tools/ids/slots, unsafe text and outside links item by item",
    dirty.carousel.length === 1 && dirty.carousel[0].id === "c1" && JSON.stringify(dirty.carousel[0].name) === '{"en":"Good"}' && !dirty.carousel[0].href
    && dirty.thumbnails.length === 1 && dirty.thumbnails[0].n === 5);
  const own: HomeToolEntry = { ...d.carousel[0], name: { pl: "Moja nazwa" } };
  const withOwn = updateEntry(d, "carousel", own);
  const ownTiles = toolTiles("carousel", D({ layout: withOwn }), T, "pl", { width: 1, height: 1 });
  check("C15 an own name shows in its language; another language keeps the tool's translated name (no Polish on the English page)",
    ownTiles[0].name === "Moja nazwa" && toolTiles("carousel", D({ layout: withOwn }), T, "en", { width: 1, height: 1 })[0].name !== "Moja nazwa"
    && ownText({ pl: "x" }, "de") === null);
  const linked = updateEntry(d, "carousel", { ...d.carousel[0], href: "/k/moda/street" });
  check("C16 an own link applies only while the tool is live (an inert tile opens nothing)",
    toolTiles("carousel", D({ layout: linked }), T, "pl", { width: 1, height: 1 })[0].state.href === "/k/moda/street"
    && toolTiles("carousel", D({ layout: linked, items: { ...allLive(), [d.carousel[0].item]: S(d.carousel[0].item, "soon") } }), T, "pl", { width: 1, height: 1 })[0].state.href !== "/k/moda/street");
  const hiddenItem = setEntryHidden(d, "featured", d.featured[0].id, true);
  check("C17 a hidden item is gone for a customer and marked „Ukryty element” in edit mode",
    !toolTiles("featured", D({ layout: hiddenItem }), T, "pl", { width: 1, height: 1 }).some((x) => x.id === d.featured[0].id)
    && toolTiles("featured", D({ layout: hiddenItem, editing: true, isAdmin: true }), T, "pl", { width: 1, height: 1 }).find((x) => x.id === d.featured[0].id)!.flags.includes("item"));
  const delSource = read("components/ice/editor/layout-panel.tsx");
  check("C18 removing asks first, and offers an undo that puts back exactly that item", /window\.confirm\(t\("ice\.layout\.confirmRemove"\)\)/.test(delSource)
    && /label: t\("ice\.layout\.undo"\)/.test(delSource) && /arr\.splice\(Math\.min\(index, arr\.length\), 0, e\)/.test(delSource));
  check("C19 removing never touches media, tools or generations: the panel's only write is the layout document",
    !/slotSave|media_assets|generation|deleteAsset|\.delete\(/.test(delSource.slice(delSource.indexOf("const remove = async"), delSource.indexOf("const bulk = BULK_GROUP"))));
}

/* ── D ─────────────────────────────────────────────────────────────────── */

section("D. PHOTO GRIDS AND PRODUCT PHOTOS");
{
  const l = defaultHomeLayout();
  const added = addEntry(l, "sessions");
  const lay = "layout" in added ? added.layout : l;
  const page = homePage(lay);
  const ids = page.sections.flatMap((s) => s.elements.map((e) => e.id));
  const newKey = gridSlotKey("sessions", 17);
  check("D1 the editor's page is built from the layout: a new photo and its product photo are elements", ids.includes(newKey) && ids.includes(refSlotKey(newKey)));
  check("D2 a family key the registry did not list still has a spec (same frame as its photo); anything else does not",
    slotSpec(gridSlotKey("thumbnails", 99))?.ratio === slotSpec(gridSlotKey("thumbnails", 1))?.ratio
    && slotSpec(refSlotKey(gridSlotKey("thumbnails", 99)))?.ratio === slotSpec(gridSlotKey("thumbnails", 1))?.ratio
    && slotSpec("homeMedia.thumbnails.999") === undefined && slotSpec("homeMedia.evil.1") === undefined
    && familySlot("homeMedia.beforeAfter.61.before") === null);
  check("D3 the static registry is the default layout (texts, deny checks and tests read it)", layoutKey(defaultHomeLayout()) === layoutKey(normalizeHomeLayout(null))
    && JSON.stringify(icePageFor("/home")?.sections.map((s) => s.elements.map((e) => e.id))) === JSON.stringify(homePage().sections.map((s) => s.elements.map((e) => e.id))));
  const bulk = page.bulk ?? [];
  check("D4 the grids' bulk groups take product photos; carousel and samples do not", ["thumbnails", "showcase", "sessions"].every((k) => bulk.find((g) => g.key === k)?.refs === true)
    && !bulk.find((g) => g.key === "carousel")?.refs && !bulk.find((g) => g.key === "beforeAfter")?.refs);
  check("D5 every grid tile has its product-photo key, and the page reads both (batched under the resolver's bound)",
    gridTiles("thumbnails", D()).every((x) => x.refKey === `${x.media.configKey}.ref`)
    && layoutSlotKeys(l).filter((k) => k.endsWith(".ref")).length === 48
    && slotReadBatches(Array.from({ length: 190 }, (_, i) => `k${i}`), layoutSlotKeys(l)).every((b) => b.length <= SLOT_READ_CAP));
  // The media slot: product photo only on a filled image result.
  const img = (key: string, id: string): ResolvedSlot => ({
    key, mediaType: "image", alt: "", fit: "cover", position: "center center", autoplay: false, muted: true, loop: false, controls: false,
    desktop: `https://cdn.example/${id}.webp`, desktopWidth: 1200, desktopHeight: 1200,
  } as ResolvedSlot);
  const media = { configKey: gridSlotKey("thumbnails", 1), kind: "image" as const, src: null, width: 1200, height: 1200 };
  const home = (slots: Record<string, ResolvedSlot>) => ({ slots, locale: "pl" });
  const both = html(createElement(MediaSlot, { media, refKey: refSlotKey(media.configKey), home: home({ [media.configKey]: img(media.configKey, "r"), [refSlotKey(media.configKey)]: img(refSlotKey(media.configKey), "p") }), label: "x", hint: "y", sizes: "100vw" }));
  const only = html(createElement(MediaSlot, { media, refKey: refSlotKey(media.configKey), home: home({ [media.configKey]: img(media.configKey, "r") }), label: "x", hint: "y", sizes: "100vw" }));
  check("D6 a result with a product photo: both layers in the same frame (the swap), the product photo hidden from assistive tech",
    /data-ref-swap/.test(both) && /data-has-ref/.test(both) && /data-ref="true" aria-hidden="true"/.test(both) && both.includes("p.webp") && both.includes("r.webp"));
  check("D7 no product photo → exactly as before (no swap layer)", !/data-ref-swap/.test(only) && only.includes("r.webp"));
  const css = read("app/globals.css");
  const swap = read("components/seller-home/ref-swap.tsx");
  check("D8 desktop: a 250 ms crossfade on hover only where a real pointer hovers; reduced motion → instant",
    /\.ref-swap > \[data-ref\] \{ opacity: 0; transition: opacity 250ms ease; \}/.test(css) && /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.ref-swap:hover > \[data-ref\] \{ opacity: 1; \}\s*\}/.test(css)
    && /@media \(prefers-reduced-motion: reduce\) \{\s*\.ref-swap > \[data-ref\] \{ transition: none; \}\s*\}/.test(css) && /\.ref-swap\[data-on\] > \[data-ref\] \{ opacity: 1; \}/.test(css));
  check("D9 phone: a held finger (≥350 ms, still) shows it; lifting, moving (a scroll), cancel or leaving puts the result back; nothing is prevented on touch start",
    /const HOLD_MS = 350;/.test(swap) && /SLOP_PX = 8/.test(swap) && /onPointerUp=\{cancel\} onPointerCancel=\{cancel\}/.test(swap)
    && /onPointerLeave/.test(swap) && !/onTouchStart|preventDefault\(\);\s*\n\s*start\.current/.test(swap) && /if \(e\.pointerType === "mouse"\) return;/.test(swap));
  check("D10 …the click a long press ends in is swallowed (no accidental open), a short tap is untouched; no callout menu on iOS",
    /onClickCapture=\{onClickCapture\}/.test(swap) && /if \(!swallow\.current\) return;/.test(swap) && /-webkit-touch-callout: none/.test(css));
  check("D11 the product photo is never written over the result: its own slot (`.ref`), its own crop", refSlotKey("homeMedia.thumbnails.1") === "homeMedia.thumbnails.1.ref"
    && /ratio/.test(JSON.stringify(slotSpec("homeMedia.thumbnails.1.ref"))));
}

/* ── D2: the grids measured from what is shown ─────────────────────────── */

section("D2. PHOTO GRIDS — ROWS, FADE AND BUTTON FROM THE VISIBLE PHOTOS ONLY");
{
  const rows = (n: number) => SQUARE_BREAKPOINTS.map((b) => squareRows(n, b.cols, b.max)).join();
  check("D2a all 20 Miniaturki: 3 / 3 / 4 rows (the page as it was)", rows(20) === "3,3,4");
  check("D2b 10 shown: 3 / 3 / 2 rows — no empty rows on a desktop", rows(10) === "3,3,2");
  check("D2c 5 shown: 3 / 2 / 1; one shown: 1 / 1 / 1; none: 0", rows(5) === "3,2,1" && rows(1) === "1,1,1" && rows(0) === "0,0,0");
  check("D2d the fade starts on the last shown row; one row has none", fadeMask(2).startsWith("linear-gradient(to bottom,black 50%") && fadeMask(1) === "none");
  const half = D({ layout: defaultHomeLayout().thumbnails.slice(10).reduce((l, e) => setEntryHidden(l, "thumbnails", e.id, true), defaultHomeLayout()) });
  const html10 = html(createElement(SellerHomeView, { data: half, t: T, locale: "pl" }));
  const gallery = /<div[^>]*data-square-gallery[^>]*>/.exec(html10)?.[0] ?? "";
  check("D2e the page: 10 of 20 hidden → 10 tiles, the window set for 2 desktop rows, the 2-row fade there",
    (html10.match(/data-square-tile/g) ?? []).length === 10 && /--sq-r-lg:2/.test(gallery) && /--sq-mask-lg:linear-gradient\(to bottom,black 50%/.test(gallery));
  const one = D({ layout: defaultHomeLayout().thumbnails.slice(3).reduce((l, e) => setEntryHidden(l, "thumbnails", e.id, true), defaultHomeLayout()) });
  const html3 = html(createElement(SellerHomeView, { data: one, t: T, locale: "pl" }));
  check("D2f 3 shown (one desktop row): no fade on a desktop and the button under the photos, not over them",
    /--sq-mask-lg:none/.test(html3) && /lg:relative lg:inset-auto lg:mt-3/.test(html3));
  const none = D({ layout: defaultHomeLayout().thumbnails.reduce((l, e) => setEntryHidden(l, "thumbnails", e.id, true), defaultHomeLayout()) });
  const html0 = html(createElement(SellerHomeView, { data: none, t: T, locale: "pl" }));
  check("D2g none shown: no grid, no fade, no empty box — the section keeps its heading and its button",
    !/data-square-gallery/.test(html0) && /data-square-cta/.test(html0) && /data-seller-thumbnails/.test(html0));
  const sess = D({ layout: defaultHomeLayout().sessions.slice(2).reduce((l, e) => setEntryHidden(l, "sessions", e.id, true), defaultHomeLayout()) });
  const htmlS = html(createElement(SellerHomeView, { data: sess, t: T, locale: "pl" }));
  check("D2h Sesje with 2 photos: a window only as tall as they are (max-height, not a fixed box), no first-paint fade",
    /data-fade-gallery/.test(htmlS) && /max-h-\[var\(--fw-h\)\]/.test(htmlS) && !/data-cut/.test(htmlS.slice(htmlS.indexOf("data-seller-sessions")))
    && (htmlS.match(/data-home-item="sessions:/g) ?? []).length === 2 && !masonryCut(SESSIONS.tiles.slice(0, 2).map((x) => x.media), 4, [4, 2.75]),
    JSON.stringify({ fg: /data-fade-gallery/.test(htmlS), mh: /max-h-\[var\(--fw-h\)\]/.test(htmlS), n: (htmlS.match(/data-home-item="sessions:/g) ?? []).length }));
}

/* ── E ─────────────────────────────────────────────────────────────────── */

section("E. BULK UPLOAD — PHOTO + PRODUCT PHOTO PAIRS");
{
  const f = (name: string, id = name) => ({ id, name });
  check("E1 „-ref” before the extension, any case; anything else is a photo", refSuffix("buty-ref.jpg") === "buty" && refSuffix("Buty-REF.PNG") === "Buty"
    && refSuffix("buty.jpg") === null && refSuffix("ref.jpg") === null && refSuffix("buty-ref-2.jpg") === null);
  const r = groupRefs([f("buty.jpg"), f("buty-ref.jpg"), f("Kubek.png"), f("kubek-REF.webp"), f("torba.jpg")]);
  check("E2 pairs by base name regardless of case and extension; a photo without one is alone", r.units.length === 3 && r.problems.length === 0
    && r.units.find((u) => u.name === "buty.jpg")!.files.map((x) => x.name).join() === "buty.jpg,buty-ref.jpg"
    && r.units.find((u) => u.name === "Kubek.png")!.files.length === 2 && r.units.find((u) => u.name === "torba.jpg")!.files.length === 1);
  const orphan = groupRefs([f("a.jpg"), f("b-ref.jpg")]);
  check("E3 a product photo with no photo is a problem (refOrphan), never guessed", orphan.units.length === 1 && orphan.units[0].files.length === 1 && orphan.problems[0]?.reason === "refOrphan");
  const dup = groupRefs([f("a.jpg"), f("a-ref.jpg"), f("a-ref.png")]);
  check("E4 two product photos for one photo: both flagged (refDuplicate), the photo stays alone", dup.units[0].files.length === 1 && dup.problems.length === 2 && dup.problems.every((p) => p.reason === "refDuplicate"));
  const amb = groupRefs([f("a.jpg"), f("A.png"), f("a-ref.jpg")]);
  check("E5 a name that fits two photos is ambiguous (refAmbiguous)", amb.units.every((u) => u.files.length === 1) && amb.problems[0]?.reason === "refAmbiguous");
  const fixed = groupRefs([f("a.jpg", "p1"), f("A.png", "p2"), f("a-ref.jpg", "r1")], { r1: "p2" });
  check("E6 a manual link resolves it (and wins over the name)", fixed.problems.length === 0 && fixed.units.find((u) => u.id === "p2")!.files[1]?.id === "r1");
  check("E7 a folder without any -ref file is exactly what it was: one unit per file, natural order",
    groupRefs([f("10.jpg"), f("2.jpg"), f("1.jpg")]).units.map((u) => u.name).join() === "1.jpg,2.jpg,10.jpg");
  const keys = ["g.1", "g.1.ref", "g.2", "g.2.ref", "g.3", "g.3.ref"];
  const filled = new Set(["g.1", "g.2.ref"]);
  const plan = planBulk({ slots: keys, pairs: false, refs: true, mode: "empty", files: [f("x.jpg"), f("x-ref.jpg"), f("y.jpg")], order: null, filled: (k) => filled.has(k) });
  check("E8 the plan: a row per photo [photo, product photo]; „fill empty” looks at the PHOTO (a leftover product photo does not make a row taken)",
    plan.rows.length === 3 && plan.rows.every((row) => row.keys.length === 2 && row.keys[1] === `${row.keys[0]}.ref`)
    && plan.rows[0].unit === null && plan.rows[1].unit?.name === "x.jpg" && plan.rows[2].unit?.name === "y.jpg");
  check("E9 …and counts as replaced only a filled slot that actually receives a file", plan.replaced === 1);
  const replace = planBulk({ slots: keys, pairs: false, refs: true, mode: "replace", files: [f("y.jpg")], order: null, filled: (k) => filled.has(k) });
  check("E10 replacing a photo with no product photo leaves the old product photo alone", replace.replaced === 1 && replace.rows[0].unit?.files.length === 1);
  const single = planBulk({ slots: ["s.1", "s.2"], pairs: false, mode: "empty", files: [f("b.jpg"), f("a-ref.jpg")], order: null, filled: () => false });
  check("E11 groups without product photos are untouched: a „-ref” name is an ordinary file there", single.units.length === 2 && single.problems.length === 0);
  const pairs = groupPairs([f("a-przed.jpg"), f("a-po.jpg")]);
  check("E12 the before/after pairing is unchanged", pairs.pairs.length === 1 && pairs.problems.length === 0);
  const panel = read("components/ice/editor/bulk-panel.tsx");
  check("E13 the write is still ONE slotSave (all or nothing), only to the group's own keys — a product photo goes in with its photo",
    (panel.match(/transport\.slotSave\(/g) ?? []).length === 1 && /if \(!inGroup\.has\(key\) \|\| !mediaId\) return;/.test(panel)
    && /keys\.push\(k, ref\)/.test(panel));
  check("E14 the admin can fix pairing by hand: link a product photo to a photo, or remove it from a pair",
    /data-ref-link=\{p\.file\.id\}/.test(panel) && /setLinks\(\(m\) => \(\{ \.\.\.m, \[p\.file\.id\]: to \}\)\)/.test(panel) && /ice\.bulk\.unlinkRef/.test(panel));
}

/* ── F ─────────────────────────────────────────────────────────────────── */

section("F. THE FOOTER — THE SHARED SiteFooter, /home ONLY, AFTER „ZGŁOŚ BŁĄD”");
{
  const layout = read("app/(app)/layout.tsx");
  const switcher = read("components/seller-home/home-footer.tsx");
  const main = layout.indexOf("<FeedbackCTA />");
  const mainEnd = layout.lastIndexOf("</main>");
  const footer = layout.indexOf("<SiteFooter");
  check("F1 the footer is the public site's own component (imported, not copied)", /import \{ SiteFooter \} from "@\/components\/cms\/site-shell";/.test(layout)
    && !/<footer/.test(switcher) && count(read("components/cms/site-shell.tsx"), /export function SiteFooter/g) === 1);
  check("F2 order: the page (Nadchodzi last) → „Zgłoś błąd” (end of <main>) → the footer", main > 0 && mainEnd > main && footer > mainEnd);
  check("F3 /home only, decided by the page on screen (a client-side move between pages cannot leave it behind)",
    /usePathname\(\) === "\/home"/.test(switcher) && /<HomeFooter>\s*<SiteFooter/.test(layout));
  check("F4 it follows the theme (no forceDark) and the language (the layout's locale)", !/forceDark/.test(layout.slice(footer, footer + 200)) && /locale=\{appLocale\}/.test(layout));
  const css = read("app/globals.css");
  check("F5 its last row clears the phone navigation and the „Edytuj stronę” button", /--home-footer-room: var\(--dock-h\);/.test(css)
    && /html:has\(\[data-ice-launch\]:not\(\[data-ice-launch="compact"\]\)\) \[data-home-footer\]/.test(css)
    && /padding-bottom: calc\(1\.25rem \+ env\(safe-area-inset-bottom\) \+ var\(--home-footer-room\) \+ var\(--home-footer-fab\)\);/.test(css));
  check("F6 the footer gets no visibility switch (not a layout section)", !(HOME_SECTION_IDS as readonly string[]).includes("footer") && !/footer/.test(JSON.stringify(defaultHomeLayout().sections)));
  check("F7 „Zgłoś błąd” is untouched: still mounted once at the end of <main>", count(layout, /<FeedbackCTA \/>/g) === 1);
  check("F8 the footer's data rides the layout's one batch (no serial await)", /getGlobalSections\(\),\s*getNavPages\(\),\s*getPublicSite\(supabase\),\s*\]\);/.test(layout));
}

/* ── G ─────────────────────────────────────────────────────────────────── */

section("G. THE SERVER — ADMIN ONLY, RE-VALIDATED, COMPARE-AND-SET, HISTORY");
{
  const server = read("lib/server/ice/home.ts");
  const sql = read("supabase/migrations/0170_home_layout.sql");
  check("G1 every read and write starts with requireIceAdmin (role + device step-up), on the server",
    (server.match(/await requireIceAdmin\(\)/g) ?? []).length === 2);
  check("G2 whatever the browser sends is normalized on the server before it is stored", /const layout = keepCounters\(normalizeHomeLayout\(input\.doc\), before\.layout\);/.test(server)
    && server.indexOf("normalizeHomeLayout(input.doc)") < server.indexOf('rpc("home_layout_write"'));
  check("G3 the database refuses a non-admin and writes only through the definer function (no direct table writes)",
    /if not public\.is_admin\(\) then raise exception 'not_admin'/.test(sql) && /revoke insert, update, delete on public\.home_layout from anon, authenticated;/.test(sql));
  check("G4 compare-and-set: a stale base is a conflict, never an overwrite; the editor then shows what is there now",
    /raise exception 'conflict'/.test(sql) && /throw new IceRefusal\("conflict", await readState\(supabase\)\)/.test(server)
    && /res\.error === "conflict" && res\.current/.test(read("components/ice/editor/layout-panel.tsx")));
  check("G5 every write is a history row (the same content_versions, target 'layout': before, after, author, date)",
    /insert into public\.content_versions \(target, key, locale, action, before, after, created_by\)/.test(sql) && /'layout', 'home'/.test(sql));
  check("G6 undo restores a state in the database (action 'restore'), from the session or from the history",
    /save\(\(\) => prev, "restore"/.test(read("components/ice/editor/layout-panel.tsx")) && /onRestoreLayout\(layoutDoc\(v\.before\)\)/.test(read("components/ice/editor/page-panels.tsx")));
  check("G7 a save re-renders /home for everyone and is audited", /revalidatePath\("\/home"\)/.test(server) && /action: "ice\.layout\.saved"/.test(server));
  check("G8 the public read gives the document only (no author, no drafts)", /returns jsonb/.test(sql) && /select jsonb_build_object\('doc', l\.doc, 'updated_at', l\.updated_at\)/.test(sql));
  check("G9 no parallel systems: media through media_slots (slotSave), history through content_versions, no second editor",
    !existsSync("lib/server/home-cms.ts") && !/create table[^;]*(home_media|home_history)/i.test(sql));
  check("G10 the stored document is bounded (200 kB) and versioned (v = 1)", /octet_length\(doc::text\) <= 200000/.test(sql) && /\(p_doc->>'v'\) is distinct from '1'/.test(sql));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`${failed} HOME-LAYOUT TEST(S) FAILED`);
  process.exit(1);
}
