/**
 * THE MEDIA SLOT SYSTEM, TESTED WHERE IT CAN ACTUALLY GO WRONG.
 *
 * Five things in this feature are load-bearing, and they are what is tested
 * here — not the parts a screenshot would show:
 *
 *   A. THE REGISTRY IS DERIVED. Categories, workflows and tool cards come from
 *      the registries the product itself runs on. If those drift apart, the
 *      admin ends up setting pictures that nothing renders.
 *   B. EVERY DECLARED SLOT IS RENDERED SOMEWHERE. A control that silently does
 *      nothing is worse than a missing control.
 *   C. VALUES BECOME CSS. `object-position` accepts almost anything, including
 *      things that are not positions, so the list is closed and checked twice.
 *   D. THE WRITE PATH REFUSES WHAT IT SHOULD. An unknown key, a video in a
 *      still-image slot, a banner link that is not a link.
 *   E. EVERY LABEL EXISTS IN EVERY LANGUAGE. A slot whose name renders as
 *      "Categorycard" is a bug the operator can see.
 *
 * Run: npm run test:media
 */
import { readFileSync } from "fs";
import {
  MEDIA_SLOTS, OBJECT_FITS, OBJECT_POSITIONS, bannerSlotDef, bannerSlotKey,
  categoryHeroKey, categorySlotKey, entitiesOf, isKnownSlot, isObjectFit,
  isObjectPosition, isSlotMediaType, slotDef, slotsFor, toolSlotKey, workflowSlotKey,
} from "../lib/media-slots";
import { CATEGORIES, offeredWorkflows } from "../lib/categories";
import { CATEGORY_SECTIONS, TOOL_CARDS, TOOL_SECTIONS, toolCard } from "../lib/tool-cards";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const read = (p: string) => readFileSync(p, "utf8");

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("A. THE REGISTRY IS DERIVED FROM THE PRODUCT'S OWN REGISTRIES");

const keys = MEDIA_SLOTS.map((s) => s.key);
check("no slot key is declared twice",
  new Set(keys).size === keys.length,
  `${keys.filter((k, i) => keys.indexOf(k) !== i)}`);

// Dotted segments of registry keys, verbatim — so camelCase is expected
// wherever the registry is camelCase (`…workflow.ghostMannequin.card`). What
// must never appear is whitespace, punctuation or anything that would need
// escaping in a URL or a SQL literal.
const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/;
check("every key is a dotted chain of registry keys",
  keys.every((k) => KEY_SHAPE.test(k)),
  `${keys.filter((k) => !KEY_SHAPE.test(k))}`);
check("a key round-trips to the registry key it was built from",
  CATEGORIES.every((c) => offeredWorkflows(c).every((w) =>
    workflowSlotKey(c.key, w.key).split(".").includes(w.key))));

// Kept, keys unchanged, even though the surfaces that painted them (the
// dashboard grid, the category page's header) were retired: they are the
// category's pictures and an operator may already have set them. See the
// note in lib/media-slots.ts.
check("every category keeps its card and its hero",
  CATEGORIES.every((c) => keys.includes(categorySlotKey(c.key))
    && keys.includes(categoryHeroKey(c.key))));

check("category slots number exactly two per category",
  MEDIA_SLOTS.filter((s) => s.entityType === "category").length === CATEGORIES.length * 2);

const offeredKeys = CATEGORIES.flatMap((c) =>
  offeredWorkflows(c).map((w) => workflowSlotKey(c.key, w.key)));
check("every OFFERED workflow has a card slot",
  offeredKeys.every((k) => keys.includes(k)),
  `${offeredKeys.filter((k) => !keys.includes(k))}`);
check("no HIDDEN workflow has one",
  MEDIA_SLOTS.filter((s) => s.entityType === "workflow").length === offeredKeys.length);

// The reason this file exists: deriving tool slots from FEATURE_REGISTRY gave
// six tools no slot at all and invented slots for module keys the catalogue
// never draws.
const cardKeys = TOOL_CARDS.map((c) => toolSlotKey(c.key));
check("every catalogue card has a slot",
  cardKeys.every((k) => keys.includes(k)),
  `${cardKeys.filter((k) => !keys.includes(k))}`);
check("no tool slot exists for a card the catalogue does not draw",
  MEDIA_SLOTS.filter((s) => s.entityType === "tool")
    .every((s) => TOOL_CARDS.some((c) => c.key === s.entityId)));
check("the catalogue has no category-shaped cards any more — categories are sections",
  TOOL_CARDS.every((c) => !c.href.startsWith("/k/") && !CATEGORIES.some((k) => k.key === c.key)));
check("the six generative tools are covered",
  ["ai_background", "relight", "ai_shadow", "beautify", "uncrop", "ghost_mannequin"]
    .every((k) => keys.includes(toolSlotKey(k))));
check("a category entry point has no second, tool-shaped slot",
  CATEGORIES.every((c) => !keys.includes(toolSlotKey(c.key))));

check("card keys are unique across the whole catalogue",
  new Set(TOOL_CARDS.map((c) => c.key)).size === TOOL_CARDS.length);

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nB. EVERY DECLARED SLOT IS RENDERED BY A REAL SURFACE");

const SOURCES: Record<string, string> = {
  // The category card: the Home's cards (the rail's Moda tile), resolved in
  // lib/home-sections.ts and painted by card-art.
  homeCards: read("lib/home-sections.ts"),
  cardArt: read("components/home/card-art.tsx"),
  catalogue: read("components/tools/tools-catalogue.tsx"),
  // The Home: one loader for /start, /home and "/", and its galleries.
  homeSurface: read("components/home/product-surface.tsx"),
  homeGallery: read("components/home/home-gallery.tsx"),
  homeBanner: read("components/home/grovshot-banner.tsx"),
  tools: read("app/(app)/tools/page.tsx"),
  generator: read("lib/server/generator-ui.ts"),
  banner: read("components/dashboard/banner.tsx"),
};
const all = Object.values(SOURCES).join("\n");

check("the category card is rendered", SOURCES.homeCards.includes("categorySlotKey")
  && SOURCES.cardArt.includes("SlotMedia"));
// A workflow's card is a /tools catalogue card now, painted by the same
// SlotMedia as every other tool, under the slot key it always had.
check("the workflow card is rendered", SOURCES.tools.includes("workflowSlotKey")
  && SOURCES.catalogue.includes("SlotMedia"));
check("the tool card is rendered", SOURCES.catalogue.includes("SlotMedia")
  && SOURCES.tools.includes("toolSlotKey"));
// The old dashboard's hero art went with the dashboard: nothing paints it, so
// it is not declared (no row was ever written under it).
check("the retired dashboard hero is not declared", !keys.includes("dashboard.hero.art"));
// The Home's galleries paint their slots through HOME_SLOT — every accessor,
// each over the tile count HOME_GALLERY declares.
check("the Home's galleries and banners are rendered",
  ["HOME_SLOT.packshot(", "HOME_SLOT.ugc(", "HOME_SLOT.ad(", "HOME_SLOT.ugcArt"].every((k) => SOURCES.homeGallery.includes(k))
  && SOURCES.homeBanner.includes("HOME_SLOT.grovshotArt"));
check("both generator previews are rendered",
  SOURCES.generator.includes("generator.session.advertising.preview")
  && SOURCES.generator.includes("generator.session.lifestyle.preview"));
check("the banner picture is rendered", SOURCES.banner.includes("bannerSlotKey"));

// Section slots are named literally, so each one must appear verbatim in the
// code that paints it.
// (The Home's are generated by HOME_SLOT and proven painted just above.)
const sectionKeys = MEDIA_SLOTS.filter((s) => s.entityType === "section" && s.entityId !== "home").map((s) => s.key);
check("every section slot appears in the code that paints it",
  sectionKeys.every((k) => all.includes(k)),
  `${sectionKeys.filter((k) => !all.includes(k))}`);

// Every surface resolves its slots in ONE call, per the brief's performance
// rule: no screen may fetch one slot at a time.
for (const [name, src] of Object.entries(SOURCES)) {
  const calls = (src.match(/loadSlots\(/g) ?? []).length;
  check(`${name} resolves slots at most once`, calls <= 1, `${calls} calls`);
}

check("every surface renders a fallback rather than an empty box",
  [SOURCES.cardArt, SOURCES.catalogue]
    .every((s) => /fallback=\{[^}]/.test(s)));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nC. A VALUE THAT BECOMES CSS IS FROM A CLOSED LIST");

check("there are exactly nine positions", OBJECT_POSITIONS.length === 9);
check("the nine are the 3×3 grid",
  OBJECT_POSITIONS.every((p) => /^(left|center|right) (top|center|bottom)$/.test(p)));
check("fits are cover and contain only",
  OBJECT_FITS.length === 2 && OBJECT_FITS.includes("cover") && OBJECT_FITS.includes("contain"));

for (const bad of [
  "url(javascript:alert(1))", "center center; background:url(x)", "50% 50%",
  "left  top", "LEFT TOP", "", "inherit", "var(--x)",
]) {
  check(`rejects position ${JSON.stringify(bad)}`, !isObjectPosition(bad));
}
check("accepts every declared position", OBJECT_POSITIONS.every(isObjectPosition));
check("rejects a fit that is not one of the two",
  !isObjectFit("fill") && !isObjectFit("none") && !isObjectFit("scale-down"));
check("media type is image or video only",
  isSlotMediaType("image") && isSlotMediaType("video")
  && !isSlotMediaType("file") && !isSlotMediaType("audio") && !isSlotMediaType(""));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nD. THE WRITE PATH REFUSES WHAT IT SHOULD");

check("a declared key is known", keys.every(isKnownSlot));
for (const bad of [
  "", "dashboard.category.nonexistent.card", "tools.made_up.card",
  "banner.", "banner.x", "../etc/passwd", "dashboard.hero",
]) {
  check(`refuses unknown key ${JSON.stringify(bad)}`, !isKnownSlot(bad));
}
check("a banner key is known once the banner exists",
  isKnownSlot(bannerSlotKey("dashboard.promo"))
  && slotDef(bannerSlotKey("dashboard.promo"))?.entityId === "dashboard.promo");
check("a banner slot accepts video", bannerSlotDef("x").video);

const action = read("app/actions/media-slots.ts");
check("the save action refuses an unknown slot", action.includes("unknown_slot"));
check("the save action refuses a video in a still slot", action.includes("no_video_here"));
check("the save action re-validates fit and position",
  action.includes("isObjectFit") && action.includes("isObjectPosition"));
check("every write establishes the admin first",
  (action.match(/requireAdmin\(\)/g) ?? []).length
    >= (action.match(/export async function/g) ?? []).length - 1);
check("a save invalidates the customer-facing cache",
  action.includes("revalidateTag(MEDIA_SLOT_TAG)"));
check("a banner link must be internal or https",
  action.includes('cta.startsWith("/")') && action.includes("^https:"));

// The renderer is the other half of the write path: a row whose file was
// deleted must not paint a broken image.
const server = read("lib/server/media-slots.ts");
check("a slot with no file resolves to nothing, not to a broken URL",
  server.includes("if (!desktop) return null"));
check("an external URL must be https", server.includes('/^https:\\/\\//i.test(external)'));
check("the customer-facing read goes through the definer function",
  server.includes("media_slots_resolve") && !server.includes('from("media_slots")'));
check("the shared cache entry is built with an anonymous client",
  server.includes("createAnonClient"));

// Slots a card cannot hold. A still-image surface must not offer video.
check("a tool card does not offer video",
  MEDIA_SLOTS.filter((s) => s.entityType === "tool").every((s) => !s.video));
check("a workflow card does not offer video",
  MEDIA_SLOTS.filter((s) => s.entityType === "workflow").every((s) => !s.video));
check("a category tile does offer video",
  MEDIA_SLOTS.filter((s) => s.entityType === "category" && s.slotName === "card")
    .every((s) => s.video));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nE. EVERY LABEL EXISTS IN EVERY LANGUAGE");

type Dict = Record<string, unknown>;
const lookup = (dict: Dict, key: string): string | undefined => {
  const parts = key.split(".");
  let node: unknown = dict;
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== "object") return undefined;
    const obj = node as Dict;
    const rest = parts.slice(i).join(".");
    if (typeof obj[rest] === "string") return obj[rest] as string;
    node = obj[parts[i]];
  }
  return typeof node === "string" ? node : undefined;
};

const NEEDED = [
  ...new Set(MEDIA_SLOTS.flatMap((s) => [s.labelKey, s.fallbackKey])),
  bannerSlotDef("x").labelKey, bannerSlotDef("x").fallbackKey,
  ...OBJECT_POSITIONS.map((p) => `media.pos.${p.replace(" ", "-")}`),
  ...["biblioteka", "kategorie", "narzedzia", "sekcje", "bannery"].map((k) => `media.tab.${k}`),
  ...["unknown_slot", "media_type", "no_video_here", "fit", "position", "generic",
    "not_admin", "unauthenticated", "same_file", "missing", "placement", "cta_url",
    "window", "bannerKey", "bannerExists"].map((k) => `media.err.${k}`),
  ...["slot", "cms_page"].map((k) => `media.usage.${k}`),
  ...["dashboard", "tools", "library", "generator"].map((k) => `media.banners.place.${k}`),
  "media.typeImage", "media.typeVideo", "media.fitCover", "media.fitContain",
  "media.desktop", "media.tablet", "media.mobile", "media.advanced", "media.restore",
  "media.usedIn", "media.usedInPlaces", "media.replaceEverywhere", "media.deleteAnyway",
  "media.slotsIntro", "media.fallbackLabel", "media.posterMissing", "media.dropHint",
];

for (const lang of ["pl", "en", "de"]) {
  const dict = JSON.parse(read(`lib/i18n/dictionaries/${lang}.json`)) as Dict;
  const missing = NEEDED.filter((k) => !lookup(dict, k));
  check(`${lang}: every media key resolves`, missing.length === 0, `${missing.slice(0, 8)}`);

  // Section entities are named in the dictionary too.
  const sections = entitiesOf("section").map((id) => `media.section.${id}`);
  const missingSections = sections.filter((k) => !lookup(dict, k));
  check(`${lang}: every application section is named`, missingSections.length === 0,
    `${missingSections}`);

  // Tool and category names come from the product's own dictionary entries.
  const names = [
    ...CATEGORIES.map((c) => `cats.${c.key}`),
    ...TOOL_SECTIONS.flatMap((s) => [s.titleKey, ...s.cards.map((c) => c.titleKey)]),
    ...CATEGORIES.flatMap((c) => offeredWorkflows(c).map((w) => `wf.${c.key}.${w.key}.name`)),
  ];
  const missingNames = names.filter((k) => !lookup(dict, k));
  check(`${lang}: every entity on the admin screen has a name`,
    missingNames.length === 0, `${missingNames.slice(0, 8)}`);
}

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nF. THE ADMIN SCREEN LISTS WHAT EXISTS, AND ONLY THAT");

check("slotsFor returns an entity's slots in declaration order",
  slotsFor("category", "moda").map((s) => s.slotName).join(",") === "card,hero");
check("slotsFor on something that is not an entity returns nothing",
  slotsFor("category", "made-up").length === 0
  && slotsFor("tool", "made-up").length === 0);
check("entitiesOf lists each entity once",
  new Set(entitiesOf("tool")).size === entitiesOf("tool").length);
check("entitiesOf('tool') matches the catalogue",
  entitiesOf("tool").length === TOOL_CARDS.length);
check("toolCard finds a card by key",
  toolCard("retouch")?.href === "/retusz" && toolCard("nope") === undefined);

const adminPage = read("app/admin/media/page.tsx");
check("the admin screen reads the library once for every tab",
  (adminPage.match(/listLibrary\(/g) ?? []).length === 1);
check("the admin screen reads the configured slots once",
  (adminPage.match(/listConfiguredSlots\(/g) ?? []).length === 1);
check("the admin screen has the five tabs the brief asks for",
  ["biblioteka", "kategorie", "narzedzia", "sekcje", "bannery"]
    .every((k) => adminPage.includes(`"${k}"`)));

const picker = read("components/admin/media/asset-picker.tsx");
check("the picker has no URL field — a file is picked or uploaded",
  !/type="url"|placeholder=\{?"https/.test(picker));
check("the picker guards the bucket's size limit", picker.includes("50 * 1024 * 1024"));
check("an uploaded image gets its smaller copies", picker.includes("deriveMedia"));

const editor = read("components/admin/media/slot-editor.tsx");
check("the editor previews all three devices",
  ["desktop", "tablet", "mobile"].every((d) => editor.includes(`data-preview-device={key}`)
    && editor.includes(`"${d}"`)));
check("advanced options are folded away", editor.includes("media.advanced"));
check("clearing a slot deletes the row rather than blanking it",
  editor.includes("clearSlotAction"));

const manager = read("components/admin/media-manager.tsx");
check("delete asks what would break before it happens",
  manager.includes("mediaUsageAction") && manager.includes("media.usedInPlaces"));
check("delete offers to replace everywhere instead",
  manager.includes("replaceMediaAction") && manager.includes("media.replaceEverywhere"));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nG. ONE LIBRARY, ONE UPLOADER");

const uploaders = [
  "components/admin/media-manager.tsx",
  "components/admin/media/asset-picker.tsx",
].filter((p) => read(p).includes('storage.from("media").upload'));
check("only the library and its picker upload to the media bucket",
  uploaders.length === 2, `${uploaders}`);
check("the banner editor has no uploader of its own",
  !read("components/admin/media/banner-editor.tsx").includes(".upload("));
check("the banner's picture is an ordinary slot",
  read("components/admin/media/banner-editor.tsx").includes("bannerSlotDef"));

const migration = read("supabase/migrations/0090_media_slots.sql");
check("the slot table is admin-only", migration.includes("is_admin()"));
check("the definer functions revoke public execute first",
  (migration.match(/revoke all on function/g) ?? []).length === 2);
check("the customer-facing read is granted, the admin-facing one is not",
  migration.includes("grant execute on function public.media_slots_resolve(text[]) to anon, authenticated")
  && migration.includes("grant execute on function public.media_usage(uuid) to authenticated"));
check("a deleted file nulls its references rather than deleting the slot",
  (migration.match(/on delete set null/g) ?? []).length >= 4);

// 0091: the resolve function returns only slots that can actually be painted.
// Found on production — deleting a file left the slot answering with every
// file column null, which the renderer discarded but should never have been
// sent. The application-side guard above stays as the second line.
const renderable = read("supabase/migrations/0091_media_slots_renderable.sql");
check("the resolve function inner-joins the desktop file",
  /\n  join public\.media_assets d on d\.id = s\.media_id/.test(renderable));
check("…and still left-joins the three optional ones",
  (renderable.match(/left join public\.media_assets/g) ?? []).length === 3);
check("…and refuses a file row that points at nothing",
  renderable.includes("d.storage_path is not null or d.external_url is not null"));
check("…and re-revokes execute after replacing the function",
  renderable.includes("revoke all on function public.media_slots_resolve(text[]) from public, anon, authenticated"));

console.log(failures === 0 ? "\nAll media tests passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
