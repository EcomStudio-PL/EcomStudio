import {
  BEFORE_AFTER, BEFORE_AFTER_SIZE, BANNER_FRAME, CAROUSEL, FEATURED, INTEREST_KEYS, PROMO_BANNERS, SESSIONS, SHOWCASE,
  THUMBNAILS, TOOL_TILE, UPLOAD_TOOLS, ratioOf, type MediaSrc,
} from "@/lib/seller-home-config";
import { CATEGORIES, findCategory } from "@/lib/categories";
import { CATALOG_ITEMS } from "@/lib/tool-cards";
import { LAYOUT_SECTIONS, itemLabelKey } from "@/lib/tool-layout";
import { categorySlotKey, toolSlotKey, workflowSlotKey } from "@/lib/media-slots";
import { PHOTO_TOOLS, TOOLS } from "@/lib/images/tools";
import { LAUNCH_V2_BUILDER_ONLY, LAUNCH_V2_TEXT_FIELDS } from "@/lib/launch/fields";
import { ABOUT_SLOTS } from "@/lib/about-page";
import {
  PUBLIC_TOOLS, TOOL_EXAMPLE_PAIRS, TOOL_PAGE_SHARED_KEYS, toolExampleSlot, toolPageTextKeys,
} from "@/lib/public-tools";
import type { IceElement, IceLinkFormat, IcePage, IceSection, IceSlotSpec } from "./types";

/**
 * THE INLINE EDITOR'S REGISTRY — every page the visual editor can open, and on
 * it every element an admin may change. Nothing outside this file is
 * editable: a key that is not listed here is refused by the server, never
 * marked in edit mode, and never applied from the database.
 *
 * Texts are listed ONE KEY AT A TIME, never by namespace: a namespace mixes
 * presentation with values the product computes or sends somewhere (prices,
 * statuses, AI style hints, file-name suffixes, form placeholders). The
 * element id of a text is its i18n key, so a tile and its loop copies share
 * one entry, and a key reads the same wherever it renders.
 *
 * Pictures and clips are media_slots rows: the /home section slots below
 * (entity "global" / "sellerHome", painted only by /home), and the existing
 * tool-card slots, which /home shares with /tools and edits in place.
 */

/* ── text limits ─────────────────────────────────────────────────────────── */

const SHORT = 60;   // a label, a button, a badge
const TITLE = 120;  // a heading
const LINE = 240;   // a one-line description

const text = (key: string, role: string, maxLength: number, index?: number): IceElement => ({
  id: key, kind: "text", role, text: { key, maxLength }, ...(index !== undefined ? { index } : {}),
});

/* ── /home slots ─────────────────────────────────────────────────────────── */

const ratio = (w: number, h: number) => `${w}/${h}`;

const homeSlot = (m: MediaSrc, extra: Partial<IceSlotSpec> = {}): IceSlotSpec => ({
  key: m.configKey,
  ratio: ratio(m.width, m.height),
  width: m.width,
  height: m.height,
  video: m.kind === "video",
  entityType: "global",
  entityId: "sellerHome",
  slotName: m.configKey.slice("homeMedia.".length),
  ...extra,
});

/** The tool-card slot a /home tile shares with /tools (same rule as
 *  lib/server/seller-home.ts adminSlotKey — the ice tests hold them equal). */
export function cardSlotKey(item: string): string {
  if (item.startsWith("cat:")) return categorySlotKey(item.slice(4));
  const [cat, wf] = item.split(".");
  if (wf && findCategory(cat)) return workflowSlotKey(cat, wf);
  return toolSlotKey(item);
}

function cardSlot(item: string): IceSlotSpec {
  const key = cardSlotKey(item);
  const [cat, wf] = item.split(".");
  const category = item.startsWith("cat:");
  const workflow = !category && Boolean(wf && findCategory(cat));
  return {
    key,
    ratio: ratioOf(TOOL_TILE),
    width: TOOL_TILE.width,
    height: TOOL_TILE.height,
    video: false,
    positionOnly: true,
    sharedWith: "/tools",
    frames: [{ label: "tools", ratio: ratioOf(TOOL_TILE) }],
    entityType: category ? "category" : workflow ? "workflow" : "tool",
    // The same entity columns Admin → Media writes (lib/media-slots.ts): a
    // workflow is `<category>.<workflow>`.
    entityId: category ? item.slice(4) : workflow ? `${cat}.${wf}` : item,
    slotName: "card",
  };
}

const media = (slot: IceSlotSpec, role: string, dom: string, index?: number): IceElement => ({
  id: slot.key, kind: "media", role, slots: [slot], dom, ...(index !== undefined ? { index } : {}),
});

const cfg = (key: string) => `[data-config-key="${key}"]`;

function homePage(): IcePage {
  const sections: IceSection[] = [
    {
      key: "carousel",
      elements: CAROUSEL.flatMap((tile, i) => [
        text(tile.nameKey, "toolName", SHORT, i + 1),
        text(tile.subKey, "toolLine", LINE, i + 1),
        media(cardSlot(tile.item), "tileImage", cfg(tile.media.configKey), i + 1),
      ]),
    },
    {
      key: "upload",
      elements: [
        text("sellerHome.upload.lead.thumbnail", "lead", LINE),
        text("sellerHome.upload.lead.retouch", "lead", LINE),
        text("sellerHome.upload.lead.outdoor", "lead", LINE),
        text("sellerHome.upload.lead.default", "lead", LINE),
        text("sellerHome.upload.create", "button", SHORT),
        text("sellerHome.upload.opensTool", "hint", LINE),
        ...UPLOAD_TOOLS.map((u) => text(u.pillKey, "pill", SHORT)),
        text("sellerHome.samples", "caption", LINE),
        ...UPLOAD_TOOLS.map((u): IceElement => ({
          id: `samples:${u.key}`, kind: "samples", role: `samples.${u.key}`,
          slots: u.samples.map((s) => homeSlot(s, { sample: true, video: false })),
          dom: u.samples.map((s) => `[data-sample="${s.configKey}"],[data-sample-empty="${s.configKey}"]`).join(","),
        })),
      ],
    },
    {
      key: "beforeAfter",
      elements: [
        text("sellerHome.ba.title", "title", TITLE),
        text("sellerHome.ba.sub", "sub", LINE),
        text("sellerHome.before", "badge", SHORT),
        text("sellerHome.after", "badge", SHORT),
        ...BEFORE_AFTER.map((b, i): IceElement => ({
          id: `pair:${i + 1}`, kind: "pair", role: "pair", index: i + 1,
          slots: [homeSlot(b.media.before, { ratio: ratioOf(BEFORE_AFTER_SIZE), width: BEFORE_AFTER_SIZE.width, height: BEFORE_AFTER_SIZE.height }),
            homeSlot(b.media.after, { ratio: ratioOf(BEFORE_AFTER_SIZE), width: BEFORE_AFTER_SIZE.width, height: BEFORE_AFTER_SIZE.height })],
          dom: `[data-ba-card="${b.key}"] [data-before-after]`,
        })),
        ...["home_garden", "tools", "beauty", "fashion", "automotive", "pets"].map((k) => text(`sellerHome.industry.${k}`, "industry", SHORT)),
      ],
    },
    ...Object.values(PROMO_BANNERS).map((b, i): IceSection => ({
      key: `promo${i + 1}`,
      elements: [
        ...(b.badgeKey ? [text(b.badgeKey, "badge", SHORT)] : []),
        ...(b.titleKey ? [text(b.titleKey, "title", TITLE)] : []),
        ...(b.subKey ? [text(b.subKey, "sub", LINE)] : []),
        ...(b.ctaKey ? [text(b.ctaKey, "button", SHORT)] : []),
        media(homeSlot(b.media, {
          video: true, mobile: true,
          frames: [
            { label: "wide", ratio: ratioOf(BANNER_FRAME.wide) },
            { label: "tablet", ratio: ratioOf(BANNER_FRAME.tablet) },
            { label: "phone", ratio: ratioOf(BANNER_FRAME.phone) },
          ],
        }), "banner", `[data-promo="${b.key}"]`),
      ],
    })),
    {
      key: "showcase",
      elements: [
        text(SHOWCASE.ctaKey, "button", SHORT),
        media(homeSlot(SHOWCASE.visual, {
          video: true,
          frames: [
            { label: "phone", ratio: ratioOf(SHOWCASE.frame.phone) },
            { label: "tablet", ratio: ratioOf(SHOWCASE.frame.tablet) },
          ],
        }), "visual", cfg(SHOWCASE.visual.configKey)),
        ...SHOWCASE.gallery.map((m, i) => media(homeSlot(m), "galleryImage", cfg(m.configKey), i + 1)),
      ],
    },
    {
      key: "thumbnails",
      elements: [
        text(THUMBNAILS.titleKey, "title", TITLE),
        text(THUMBNAILS.subKey, "sub", LINE),
        text(THUMBNAILS.tryKey, "link", SHORT),
        text(THUMBNAILS.ctaKey, "button", SHORT),
        ...THUMBNAILS.tiles.map((tile, i) => media(homeSlot(tile.media), "thumbnail", cfg(tile.media.configKey), i + 1)),
      ],
    },
    {
      key: "sessions",
      elements: [
        text(SESSIONS.titleKey, "title", TITLE),
        text(SESSIONS.subKey, "sub", LINE),
        text(SESSIONS.studio.labelKey, "button", SHORT),
        text(SESSIONS.outdoor.labelKey, "button", SHORT),
        ...SESSIONS.tiles.map((tile, i) => media(homeSlot(tile.media), "session", cfg(tile.media.configKey), i + 1)),
      ],
    },
    {
      key: "featured",
      elements: [
        text("sellerHome.featured.title", "title", TITLE),
        text("sellerHome.featured.sub", "sub", LINE),
        ...FEATURED.flatMap((f, i) => [
          text(f.nameKey, "toolName", SHORT, i + 1),
          text(f.subKey, "toolLine", LINE, i + 1),
          media(cardSlot(f.item), "tileImage", cfg(f.media.configKey), i + 1),
        ]),
      ],
    },
    {
      key: "soon",
      elements: [
        text("sellerHome.soon.title", "title", TITLE),
        text("sellerHome.soon.sub", "sub", LINE),
        text("sellerHome.soon.notify", "button", SHORT),
        ...INTEREST_KEYS.map((k) => text(`sellerHome.soon.${k}`, "chip", SHORT)),
      ],
    },
  ];
  const slotsOf = (section: string) => sections.find((s) => s.key === section)!.elements
    .filter((e) => e.kind === "media").map((e) => e.slots![0].key);
  return {
    key: "home",
    path: "/home",
    type: "app",
    sections,
    bulk: [
      { key: "thumbnails", slots: slotsOf("thumbnails") },
      { key: "showcase", slots: slotsOf("showcase").filter((k) => k !== SHOWCASE.visual.configKey) },
      { key: "sessions", slots: slotsOf("sessions") },
      { key: "carousel", slots: slotsOf("carousel") },
      ...UPLOAD_TOOLS.map((u) => ({ key: `samples.${u.key}`, slots: u.samples.map((s) => s.configKey) })),
      { key: "beforeAfter", slots: BEFORE_AFTER.flatMap((b) => [b.media.before.configKey, b.media.after.configKey]), pairs: true },
    ],
  };
}

/* ── /plany (and /plan) ──────────────────────────────────────────────────── */

const PLAN_TIERS = ["starter", "pro", "business"] as const;
// Only presentation copy. Everything that states what credits are, cost or
// buy, how a subscription changes, or how payment works (the sub-headline,
// the top-up section, every FAQ answer) is a commercial statement owned by
// whoever owns those terms — never the visual editor.

function plansPage(): IcePage {
  return {
    key: "plans",
    path: "/plany",
    type: "public",
    sections: [
      { key: "plansHero", elements: [text("pricing.title", "title", TITLE)] },
      {
        key: "planCards",
        elements: PLAN_TIERS.flatMap((tier, i) => [
          text(`pricing.plan.badge.${tier}`, "badge", SHORT, i + 1),
          text(`pricing.plan.audience.${tier}`, "planDescription", LINE, i + 1),
        ]),
      },
      {
        key: "planGroups",
        elements: ["highlights", "tools", "output", "team", "support"].map((g) => text(`pricing.group.${g}`, "groupTitle", SHORT)),
      },
      { key: "compare", elements: [text("pricing.compare.title", "title", TITLE)] },
      { key: "faq", elements: [text("pricing.faq.overline", "overline", SHORT)] },
    ],
  };
}

/* ── /tools ──────────────────────────────────────────────────────────────── */

// Labels that belong to another screen's controls, or to the menu: shown on a
// card too, but owned elsewhere — not edited from the catalogue.
const FOREIGN_LABEL = /^(editor|nav|mega)\./;

function catalogueSlot(item: (typeof CATALOG_ITEMS)[number]): IceSlotSpec {
  const isCategory = CATEGORIES.some((c) => c.key === item.key);
  const key = item.workflow ? workflowSlotKey(item.workflow.category, item.workflow.key)
    : isCategory ? categorySlotKey(item.key) : toolSlotKey(item.key);
  return {
    key,
    ratio: ratioOf(TOOL_TILE),
    width: TOOL_TILE.width,
    height: TOOL_TILE.height,
    video: false,
    positionOnly: true,
    sharedWith: "/home",
    frames: [{ label: "tools", ratio: ratioOf(TOOL_TILE) }],
    entityType: item.workflow ? "workflow" : isCategory ? "category" : "tool",
    entityId: item.workflow ? `${item.workflow.category}.${item.workflow.key}` : item.key,
    slotName: "card",
  };
}

function toolsPage(): IcePage {
  const seen = new Set<string>();
  const once = (e: IceElement[]) => e.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  return {
    key: "tools",
    path: "/tools",
    type: "app",
    sections: [
      { key: "toolsSections", elements: once(LAYOUT_SECTIONS.map((s) => text(s.titleKey, "sectionTitle", SHORT))) },
      {
        key: "toolsCards",
        elements: once(CATALOG_ITEMS.flatMap((item) => {
          const els: IceElement[] = [];
          const title = itemLabelKey(item);
          if (!FOREIGN_LABEL.test(title)) els.push(text(title, "cardTitle", SHORT));
          if (!FOREIGN_LABEL.test(item.bodyKey)) els.push(text(item.bodyKey, "cardBody", LINE));
          els.push(media(catalogueSlot(item), "cardImage", `[data-tool-card="${item.key}"]`));
          return els;
        })),
      },
      {
        key: "toolsRequest",
        elements: [text("hub.request.title", "title", TITLE), text("hub.request.body", "sub", LINE), text("hub.request.cta", "button", SHORT)],
      },
    ],
  };
}

/* ── a tool's own page ───────────────────────────────────────────────────── */

const OWN_ROUTE = new Set(["editor", "compress", "format", "shadow"]);

function toolPages(): IcePage[] {
  const photo = new Set<string>(PHOTO_TOOLS);
  return TOOLS.filter((t) => !OWN_ROUTE.has(t.slug)).map((t): IcePage => ({
    key: `tool.${t.slug}`,
    path: `/tools/${t.slug}`,
    type: "tool",
    sections: [{
      key: "toolHeader",
      // A photo tool's page title is its own key (photoTool.name.*), not the
      // catalogue name the /tools card shows: editing it here would make the
      // tool two names. The catalogue name stays the one place it is edited
      // (on /tools); the page keeps its description.
      elements: photo.has(t.slug)
        ? [text(`photoTool.body.${t.slug}`, "sub", LINE)]
        : [text(`tools.${t.slug}.name`, "title", TITLE), text(`tools.${t.slug}.body`, "sub", LINE)],
    }],
  }));
}

/* ── a public tool's block (Public Tools V1) ─────────────────────────────── */

/**
 * The copy and the before/after examples under a tool's panel — what a
 * visitor reads there (components/public-tools/tool-seo.tsx), and the page's
 * <title> and description. Only the block: the panel above it stays what it
 * was, a workspace of controls. Its shared labels (the examples overline, the
 * badges, the button) read the same on every tool, so they are one key each.
 *
 * Not for Retusz: that path is frozen ("Ścieżka zamrożona") — its block keeps
 * the shipped copy.
 */
const PUBLIC_BLOCK_EXCLUDED = new Set(["retouch"]);

function exampleSlot(tool: string, n: number, side: "before" | "after"): IceSlotSpec {
  return {
    key: toolExampleSlot(tool, n, side),
    ratio: ratioOf(BEFORE_AFTER_SIZE),
    width: BEFORE_AFTER_SIZE.width,
    height: BEFORE_AFTER_SIZE.height,
    video: false,
    // Page content, not a catalogue card — the same entity columns as the
    // home page's own before/after pairs (global / sellerHome).
    entityType: "global",
    entityId: "toolPage",
    slotName: toolExampleSlot(tool, n, side).slice("toolPage.".length),
  };
}

function toolPublicSection(tool: string): IceSection {
  const keys = toolPageTextKeys(tool);
  return {
    key: "toolPublic",
    elements: [
      text(keys.headline, "title", TITLE),
      text(keys.lead, "sub", LINE),
      text(TOOL_PAGE_SHARED_KEYS.examples, "overline", SHORT),
      text(TOOL_PAGE_SHARED_KEYS.before, "badge", SHORT),
      text(TOOL_PAGE_SHARED_KEYS.after, "badge", SHORT),
      text(TOOL_PAGE_SHARED_KEYS.faq, "title", TITLE),
      text(TOOL_PAGE_SHARED_KEYS.cta, "button", SHORT),
      text(TOOL_PAGE_SHARED_KEYS.ctaSub, "hint", LINE),
      ...Array.from({ length: TOOL_EXAMPLE_PAIRS }, (_, i): IceElement => ({
        id: `pair:${i + 1}`, kind: "pair", role: "pair", index: i + 1,
        slots: [exampleSlot(tool, i + 1, "before"), exampleSlot(tool, i + 1, "after")],
        dom: `[data-tool-example="${i + 1}"] [data-before-after]`,
      })),
    ],
  };
}

/** The tool pages with their public block: a tool that already has a page
 *  gains the section; one whose screen had none (a workspace) gets a page
 *  that holds only the block. */
function withPublicBlocks(pages: IcePage[]): IcePage[] {
  const out = [...pages];
  for (const tool of PUBLIC_TOOLS) {
    // Retusz (frozen) and every tool without a public block of its own.
    if (PUBLIC_BLOCK_EXCLUDED.has(tool.key) || tool.seo === false) continue;
    const bulk = {
      key: "toolExamples",
      slots: Array.from({ length: TOOL_EXAMPLE_PAIRS }, (_, i) =>
        [toolExampleSlot(tool.key, i + 1, "before"), toolExampleSlot(tool.key, i + 1, "after")]).flat(),
      pairs: true,
    };
    const at = out.findIndex((p) => p.path === tool.path);
    if (at >= 0) {
      const page = out[at];
      out[at] = { ...page, sections: [...page.sections, toolPublicSection(tool.key)], bulk: [...(page.bulk ?? []), bulk] };
    } else {
      out.push({ key: `public.${tool.key}`, path: tool.path, type: "tool", sections: [toolPublicSection(tool.key)], bulk: [bulk] });
    }
  }
  return out;
}

/* ── the registry ────────────────────────────────────────────────────────── */

export const ICE_PAGES: readonly IcePage[] = [homePage(), plansPage(), toolsPage(), ...withPublicBlocks(toolPages())];

/** Paths that show the same page as another (same component, same copy). */
const ALIASES: Readonly<Record<string, string>> = { "/plan": "/plany" };

const BY_PATH = new Map(ICE_PAGES.map((p) => [p.path, p]));

export function icePageFor(pathname: string): IcePage | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return BY_PATH.get(ALIASES[clean] ?? clean) ?? null;
}

export function icePageByKey(key: string): IcePage | null {
  return ICE_PAGES.find((p) => p.key === key) ?? null;
}

/** The page's text keys, in a fixed order — a marker carries an index into
 *  this list, so the server and the editor must build it identically. */
export function pageTextKeys(page: IcePage): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of page.sections) for (const e of s.elements) {
    if (e.kind === "text" && e.text && !seen.has(e.text.key)) { seen.add(e.text.key); out.push(e.text.key); }
  }
  return out;
}

export function allElements(page: IcePage): IceElement[] {
  return page.sections.flatMap((s) => s.elements);
}

/* ── the O nas page's pictures (a CMS page, lib/about-page.ts) ──────────── */

/**
 * The about page is a CMS page, so its words are block fields (CMS_FIELDS
 * below); its pictures are media slots, framed exactly like /home's — the
 * same panel, crop and phone file. They are listed here so the server knows
 * every key the editor may write (slotSpec), whichever page paints them.
 */
export const ABOUT_ICE_SLOTS: readonly IceSlotSpec[] = ABOUT_SLOTS.map((a) => {
  const [w, h] = a.ratio.split("/").map(Number);
  return {
    key: a.key,
    ratio: `${w}/${h}`,
    width: a.width,
    height: a.height,
    video: a.video,
    ...(a.mobile ? { mobile: true, frames: [{ label: "phone" as const, ratio: "4/3" }] } : {}),
    entityType: "section" as const,
    entityId: "about",
    slotName: a.name,
  };
});

/** The editor element of one about slot: found on the page by the frame's
 *  data-config-key; the share image has no frame and is reached from the
 *  list of elements. */
export function aboutSlotElement(key: string): IceElement | null {
  const spec = ABOUT_ICE_SLOTS.find((x) => x.key === key);
  const about = ABOUT_SLOTS.find((x) => x.key === key);
  return spec && about ? media(spec, about.label, cfg(key)) : null;
}

const TEXTS = new Map<string, IceElement>();
const SLOTS = new Map<string, IceSlotSpec>();
for (const p of ICE_PAGES) for (const e of allElements(p)) {
  if (e.kind === "text" && e.text) TEXTS.set(e.text.key, e);
  for (const s of e.slots ?? []) SLOTS.set(s.key, s);
}
for (const s of ABOUT_ICE_SLOTS) SLOTS.set(s.key, s);

/** Every text key any page may edit. */
export const ICE_TEXT_KEYS: ReadonlySet<string> = new Set(TEXTS.keys());

export function textSpec(key: string): IceElement | undefined {
  return TEXTS.get(key);
}

export function slotSpec(key: string): IceSlotSpec | undefined {
  return SLOTS.get(key);
}

/** Pages a text key appears on (for "również używane na…"). */
export function pagesOfText(key: string): string[] {
  return ICE_PAGES.filter((p) => pageTextKeys(p).includes(key)).map((p) => p.path);
}

/* ── never editable ──────────────────────────────────────────────────────── */

/**
 * Keys that may never be registered, whatever a future edit of this file
 * tries: values the product computes (prices, credits, balances, statuses),
 * what it sends to an AI model (style hints), what names a file, what a form
 * needs (placeholders, consent), and commercial or legal promises. The tests
 * hold every registered key against this list, and the server checks it again
 * before applying anything from the database.
 */
const DENY: readonly RegExp[] = [
  /(^|\.)[a-zA-Z]*[sS]tyle$/, /\.style$/, /\.suffix$/, /\.directive/,
  /(^|\.)(status|state|badgeSoon|badgeMaintenance|badgeDisabled|unavailable|creditsTotal|costPer|price|prices)(\.|$)/,
  /^pricing\.(notice|feat|premiere|meta|free|period)\b/, /^pricing\.plan\.(approx|choose|current|hasPlan|perMonth|costVisible|billed|save|perCredit|unavailable)/,
  /^pricing\.topups\.(?!title$|sub$)/, /^pricing\.faq\.(refunds|methods|renewal|premiere|title)\b/,
  /^(plans|packs|checkout|credits|creditsPanel|retouch|thumb|genv3|fashion|auth|auth2|legal|security|loginSec)\./,
  /^wf\.[^.]+\.[^.]+\.(?!name$|sub$)/,
  /^sellerHome\.(noCredits|status|channel|slot|carousel|pageTitle|sampleTry|sampleEmpty|upload\.(pick|open|change|remove|toolsLabel|unavailable)|soon\.saved|ba\.slider|promo\.label|showcase\.label)\b/,
  /(^|\.)(placeholder|Placeholder|consent|seo|meta)(\.|$)/,
];
const AMOUNT = /\{(balance|per|k2|k4|model|price|credits|n|amount|total)\}/;

export function isDeniedKey(key: string, defaultValue?: string): boolean {
  if (DENY.some((r) => r.test(key))) return true;
  return typeof defaultValue === "string" && AMOUNT.test(defaultValue);
}

/* ── public CMS pages (/admin/www) ───────────────────────────────────────── */

/**
 * What the editor may change inside a published CMS block, by block type.
 * Text fields are LocaleText ({pl,en,de}); `items.*.x` is every item. Media
 * fields are image URLs. Left out on purpose: links, styles, code, forms'
 * handlers and consent, prices and deadlines, live-data content, the
 * comparison table's marks (the renderer reads them as tick/cross), and rich
 * text (edited in Strony WWW).
 */
export const CMS_FIELDS: Readonly<Record<string, { text: string[]; media: string[] }>> = {
  hero: { text: ["badge", "title", "subtitle", "ctaLabel", "cta2Label"], media: ["mediaUrl"] },
  cta: { text: ["title", "description", "ctaLabel", "cta2Label"], media: [] },
  text: { text: ["title", "description"], media: [] },
  faq: { text: ["title", "items.*.title", "items.*.description"], media: [] },
  stats: { text: ["items.*.title"], media: [] },
  media: { text: ["title", "description"], media: ["mediaUrl"] },
  video: { text: ["title", "subtitle"], media: [] },
  gallery: { text: ["title", "description", "items.*.title"], media: ["items.*.mediaUrl"] },
  showcase: { text: ["title", "description", "items.*.title"], media: ["items.*.mediaUrl"] },
  before_after: { text: ["title", "description"], media: ["mediaUrl", "media2Url"] },
  logo_cloud: { text: ["items.*.title"], media: ["items.*.mediaUrl"] },
  features: { text: ["title", "description", "items.*.title", "items.*.badge", "items.*.description"], media: ["items.*.mediaUrl"] },
  benefits: { text: ["title", "description", "items.*.title", "items.*.badge", "items.*.description"], media: ["items.*.mediaUrl"] },
  cards: { text: ["title", "description", "items.*.title", "items.*.badge", "items.*.description"], media: ["items.*.mediaUrl"] },
  workflow: { text: ["title", "description", "items.*.title", "items.*.description"], media: [] },
  use_cases: { text: ["title", "items.*.title"], media: [] },
  testimonials: { text: ["title", "description", "items.*.title", "items.*.description"], media: ["items.*.mediaUrl"] },
  product_lock: { text: ["badge", "title", "description", "items.*.title"], media: [] },
  text_image: { text: ["title", "description", "ctaLabel", "cta2Label"], media: ["mediaUrl"] },
  tools_grid: { text: ["title", "description"], media: [] },
  models: { text: ["title", "description"], media: [] },
  pricing_table: { text: ["title", "description"], media: [] },
  contact: { text: ["title", "description", "items.*.title", "items.*.description"], media: [] },
  contact_form: { text: ["title", "description", "ctaLabel"], media: [] },
  newsletter: { text: ["title", "description", "ctaLabel"], media: [] },
  countdown: { text: ["title", "subtitle", "badge", "ctaLabel"], media: [] },
  urgency_cta: { text: ["title", "description", "badge", "ctaLabel"], media: [] },
  offer: { text: ["badge", "title", "description", "items.*.title", "ctaLabel"], media: [] },
  bonus: { text: ["badge", "title", "description", "items.*.title", "items.*.description", "ctaLabel"], media: ["mediaUrl"] },
  guarantee: { text: ["title", "description", "items.*.title", "items.*.description"], media: [] },
  trust_badges: { text: ["title", "description", "items.*.title", "items.*.description"], media: [] },
  sticky_cta: { text: ["title", "ctaLabel"], media: [] },
  page_hero: { text: ["badge", "title", "subtitle", "ctaLabel", "cta2Label"], media: ["mediaUrl", "media2Url"] },
  // The topics are <option>s and the tile addresses are links: both stay in
  // Strony WWW, like every other value a visitor's click depends on.
  contact_hub: { text: ["title", "description", "ctaLabel", "badge", "tiles.*.title", "tiles.*.description"], media: [] },
  // O NAS V2 (lib/about-page.ts). Pictures are media slots (ABOUT_ICE_SLOTS),
  // not URL fields; addresses, icons, the team's initial and the item's slot
  // name stay in Strony WWW.
  about_hero: { text: ["badge", "title", "subtitle"], media: [] },
  about_story: { text: ["badge", "title", "description", "ctaLabel"], media: [] },
  about_process: { text: ["badge", "title", "items.*.title", "items.*.description"], media: [] },
  about_importance: { text: ["badge", "title", "description", "ctaLabel"], media: [] },
  about_values: { text: ["badge", "title", "items.*.title", "items.*.description"], media: [] },
  about_audience: { text: ["badge", "title", "items.*.title", "items.*.description", "items.*.points.*.title"], media: [] },
  about_team: { text: ["badge", "title", "items.*.title", "items.*.badge", "items.*.description"], media: [] },
  // FAQ V1: the heading only — the questions are the FAQ base's, edited in
  // the editor's "FAQ" panel (the same records /faq and /plany show).
  about_faq: { text: ["badge", "title"], media: [] },
  about_cta: { text: ["title", "subtitle", "ctaLabel", "cta2Label"], media: [] },
  // Kontakt V2: the header, each channel's name and line, each FAQ link's
  // question, the company's name and address. The section's other words live
  // in content.fields (CONTACT_TEXT_KEYS) and its addresses are CMS_LINKS.
  contact_page: {
    text: ["badge", "title", "subtitle", "items.*.title", "items.*.description", "tiles.*.title", "company.title", "company.description"],
    media: [],
  },
  // FAQ V1: the /faq page's hero and closing tile; its other words are
  // content.fields (FAQ_TEXT_KEYS) and its addresses CMS_LINKS. The questions
  // are the FAQ base's — the editor's "FAQ" panel.
  faq_page: { text: ["badge", "title", "subtitle", "ctaLabel", "description", "cta2Label"], media: [] },
};

/** CMS text fields whose value is split into paragraphs on blank lines. */
export const CMS_MULTILINE = new Set(["description"]);

/**
 * KONTAKT V2: the addresses of a section — plain values, edited in the
 * editor's "Widoczność i kolejność" panel (they are not painted as text), each
 * checked against its format before it is saved (lib/contact-page.ts).
 */
export const CMS_LINKS: Readonly<Record<string, readonly { path: string; format: IceLinkFormat }[]>> = {
  contact_page: [
    { path: "items.*.url", format: "channel" },
    { path: "items.*.url2", format: "messenger" },
    { path: "tiles.*.url", format: "faq" },
    { path: "company.value", format: "nip" },
    { path: "company.url", format: "email" },
  ],
  faq_page: [
    { path: "ctaUrl", format: "page" },
    { path: "cta2Url", format: "page" },
  ],
};

/**
 * The launch page's own copy ("/" when the premiere page is the homepage).
 *
 * The Landing V2 lines are APPENDED (a marker carries a field's index in this
 * list, so the existing ones keep their numbers), and are every new localized
 * key except the builder-only ones: the consent sentence and its two link
 * labels are a legal statement reviewed in Strony WWW, never retyped on the
 * live page — the same policy as hero.consent, form.safety, the e-mail
 * placeholder and seo.* (scripts/ice-tests.ts A14).
 *
 * Lines with a value token ({credits} in hero.offer / benefit.1, {referral} in
 * ref.body) ARE editable here, by design: the admin edits the sentence, the
 * number is still the approved campaign value, and a line whose value is not
 * approved is not shown at all. What may not be typed is any other token —
 * cmsSave refuses it (`text_token`, lib/launch/fields.ts ALLOWED_TOKENS).
 */
export const LAUNCH_TEXT_FIELDS: readonly string[] = [
  "hero.badge", "hero.h1", "hero.h1Accent", "hero.sub", "hero.cta",
  "feature.1t", "feature.1b", "feature.2t", "feature.2b", "feature.3t", "feature.3b",
  "form.title", "form.sub", "perks.heading",
  "benefit.1", "benefit.1sub", "benefit.2", "benefit.2sub", "benefit.3", "benefit.3sub",
  "social.heading", "success.title", "success.body", "success.follow",
  ...LAUNCH_V2_TEXT_FIELDS.filter((k) => !(LAUNCH_V2_BUILDER_ONLY as readonly string[]).includes(k)),
];

/* ── what is NOT in the editor, and why (shown in Admin → Edytor wizualny) ── */

export const ICE_UNSUPPORTED: readonly { path: string; reason: string }[] = [
  { path: "/k/…", reason: "workflow" },
  { path: "/retusz", reason: "frozen" },
  { path: "/checkout, /credits", reason: "money" },
  { path: "/library, /settings, /support", reason: "userData" },
  { path: "/blog, /grovnews", reason: "ownEditor" },
  // Enforced, not only listed: lib/server/ice (cmsPageAt, setEdit, cmsSave,
  // iceSupportedPaths, markPublishedPage) refuses every LEGAL_DOCS slug — a
  // legal document is edited whole in Strony WWW (lib/legal/docs.ts).
  { path: "/regulamin, /polityka-prywatnosci, /polityka-cookies, /umowa-powierzenia-danych", reason: "legal" },
  { path: "/login, /register, /auth/…", reason: "security" },
  { path: "/admin/…", reason: "admin" },
  { path: "/wideo, /inspirations", reason: "later" },
];
