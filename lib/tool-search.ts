import type { LucideIcon } from "lucide-react";
import { PenLine, Sparkles } from "lucide-react";
import { CATEGORIES, VIDEO_ICON, categoryPath, workflowHref, type CategoryAccent } from "./categories";
import { IMAGE_EDIT, IMAGE_EDIT_MORE, editLabelKey } from "./topnav";
import { TOOLS } from "./images/tools";
import {
  FEATURE_REGISTRY, featureForHref, featureForToolSlug, menuVisible,
  type AvailabilityMap, type FeatureKey,
} from "./features";

/**
 * WHAT THE SEARCH KNOWS ABOUT A TOOL — an enrichment, not a second registry.
 *
 * The global search needs four things per tool that FEATURE_REGISTRY does not
 * carry: an icon, an accent, whether it is AI, and the words a seller might
 * type to find it. Declaring those next to a NAME and a ROUTE would create the
 * parallel list this codebase is built to avoid — two places that both claim to
 * know where "Usuń tło" lives, drifting the first time one moves.
 *
 * So nothing here repeats a name or a path. Every card takes both from
 * FEATURE_REGISTRY, and the extras are resolved out of the structures that
 * already hold them:
 *
 *   icon + accent   the categories, the mega-menu (IMAGE_EDIT / …) and the
 *                   category workflows, matched to a feature THROUGH the
 *                   registry's own route table (featureForHref), so an entry
 *                   that moves keeps its icon without anything being edited.
 *   AI              the tool catalogue's own `kind`: a "paid" tool is one that
 *                   calls a model. Nothing is labelled AI by hand.
 *   words           dictionary keys, because a seller searches in their own
 *                   language — "tło" and "background" and "Hintergrund" all
 *                   have to find the same screen.
 *
 * The only literal list below is WHICH features are searchable as tools, and
 * that is derived from the registry's groups. A feature added to the registry
 * shows up here the moment it is declared.
 */

/** Which result tab an entry belongs to. */
export type ToolFacet = "image" | "video" | "tools";

/** Anything the search can offer and open. */
export type ToolEntry = {
  /** Unique inside the index. A feature's key, or the section's own key. */
  id: string;
  href: string;
  /** i18n key of the display name — the same one the menus use. */
  nameKey: string;
  /** i18n key of the one-line description shown under the name. */
  descKey: string;
  /** i18n key of the comma-separated search words for this entry. */
  wordsKey: string;
  icon: LucideIcon;
  /** `r g b`, for the accent tile. Absent = the product's own accent. */
  accent?: string;
  /** The second stop of the category's gradient, for the card's surface. */
  accent2?: string;
  /** Whether running this calls an AI model, so the tile can say so. */
  ai: boolean;
  facet: ToolFacet;
};

/** A searchable entry that is also a FEATURE, and can therefore be ranked. */
export type ToolCard = ToolEntry & { key: FeatureKey };

/* ── icons and accents, resolved from what already declares them ─────────── */

type Visual = { icon: LucideIcon; accent?: CategoryAccent };

/**
 * Every place in the app that already pairs a ROUTE with an ICON. Order is
 * first-wins, which is why the categories come before their deeper workflows:
 * /k/moda should be the category's own icon, not its first tool's.
 */
const VISUAL_SOURCES: readonly { href: string; icon: LucideIcon; accent?: CategoryAccent }[] = [
  // The categories by their PATH: their menu link is a section of /tools,
  // which the route table would read as the hub rather than the category.
  ...CATEGORIES.map((c) => ({ href: categoryPath(c), icon: c.icon, accent: c.accent })),
  ...IMAGE_EDIT.map((e) => ({ href: e.href, icon: e.icon })),
  ...IMAGE_EDIT_MORE.map((e) => ({ href: e.href, icon: e.icon })),
  // The Moda tools live inside the category, so their icons do too.
  ...CATEGORIES.flatMap((c) =>
    c.workflows.map((w) => ({ href: workflowHref(c, w), icon: w.icon, accent: c.accent }))),
  { href: "/prompts", icon: Sparkles },
  { href: "/generator", icon: PenLine },
  { href: "/wideo", icon: VIDEO_ICON },
];

const VISUALS: ReadonlyMap<FeatureKey, Visual> = (() => {
  const map = new Map<FeatureKey, Visual>();
  for (const source of VISUAL_SOURCES) {
    const key = featureForHref(source.href);
    if (key && !map.has(key)) map.set(key, { icon: source.icon, accent: source.accent });
  }
  return map;
})();

/* ── which features the search offers as tools ───────────────────────────── */

/**
 * The groups a searchable tool can live in, and the one exclusion: /tools is
 * the catalogue you open when you do NOT know which tool you want, so listing
 * it among the tools is circular. It gets its own footer link instead.
 */
const TOOL_GROUPS: readonly string[] = ["image", "create", "edit", "video"];

/**
 * Whether running this feature calls an AI model.
 *
 * Generative features obviously do. For the image tools the answer is already
 * recorded: `kind: "paid"` in the tool catalogue means a provider call, `local`
 * means sharp in our own runtime. The editor comes out AI because it hosts
 * operations that are — removing a background is a model call — which is the
 * honest answer for a screen that is partly local and partly not.
 */
const GENERATIVE: ReadonlySet<string> = new Set(
  FEATURE_REGISTRY
    .filter((f) => f.group === "image" || f.group === "create" || f.group === "video")
    .map((f) => f.key)
    .concat("retouch"),
);

function isAi(key: FeatureKey): boolean {
  if (GENERATIVE.has(key)) return true;
  return TOOLS.some((t) => featureForToolSlug(t.slug) === key && t.kind === "paid");
}

/**
 * Which result tab an entry belongs to. Read off the feature's own key, so a
 * new category or tool lands in the right tab without a second list to update.
 */
function facetOf(key: FeatureKey): ToolFacet {
  if (key === "video") return "video";
  if (key.startsWith("image_") || key.startsWith("fashion_")
    || key === "prompts" || key === "generator") return "image";
  return "tools";
}

/**
 * Every tool the search can offer, in registry order. Built once at module
 * scope: it depends on nothing that changes at runtime, so no component ever
 * rebuilds it and opening the modal costs no work at all.
 */
export const TOOL_CARDS: readonly ToolCard[] = FEATURE_REGISTRY
  .filter((f) => f.key !== "tools" && TOOL_GROUPS.includes(f.group))
  .map((f) => {
    const visual = VISUALS.get(f.key);
    return {
      id: f.key,
      key: f.key,
      href: f.path,
      nameKey: f.nameKey,
      descKey: `toolsearch.${f.key}.desc`,
      wordsKey: `toolsearch.${f.key}.words`,
      icon: visual?.icon ?? Sparkles,
      accent: visual?.accent?.rgb,
      accent2: visual?.accent?.rgb2,
      ai: isAi(f.key),
      facet: facetOf(f.key),
    };
  });

export const TOOL_CARD_BY_KEY: ReadonlyMap<FeatureKey, ToolCard> =
  new Map(TOOL_CARDS.map((c) => [c.key, c]));

/**
 * SECTIONS — the jobs that are real, named and findable, but are not screens.
 *
 * "Usuń tło", "Białe tło" and "Cień produktu" moved INTO the editor; each is a
 * deep link at /tools/editor?tool=…, not a page of its own. They still have to
 * be findable by name — the brief's own example is a seller typing „tło" — and
 * dropping them would mean the search knows less than the menu used to.
 *
 * They are NOT features, so they are never ranked: a background removal already
 * counts towards the editor in usage_events, and giving a section its own place
 * in the popularity list would count the same run twice. And they need no
 * availability rule of their own — `menuVisible` resolves their href through
 * the registry's route table, which lands on the editor that owns them.
 *
 * Derived from IMAGE_EDIT_MORE rather than typed out again: an entry there with
 * a query string IS a section by definition, since the path alone is a screen.
 */
export const TOOL_SECTIONS: readonly ToolEntry[] = IMAGE_EDIT_MORE
  .filter((e) => e.href.includes("?"))
  .map((e) => ({
    id: `section:${e.key}`,
    href: e.href,
    nameKey: editLabelKey(e),
    descKey: `toolsearch.${e.key}.desc`,
    wordsKey: `toolsearch.${e.key}.words`,
    icon: e.icon,
    // The owning feature decides whether this is an AI job: these three are
    // editor operations, and the editor's answer is already worked out above.
    ai: isAi(featureForHref(e.href) ?? "editor"),
    facet: "tools" as const,
  }));

/** Everything the field can match. Ranked entries plus the sections. */
export const SEARCHABLE: readonly ToolEntry[] = [...TOOL_CARDS, ...TOOL_SECTIONS];

/** Where the "see everything" link at the foot of the modal goes. */
export const ALL_TOOLS_HREF =
  FEATURE_REGISTRY.find((f) => f.key === "tools")?.path ?? "/tools";

/* ── matching ─────────────────────────────────────────────────────────────── */

/** Accent-insensitive, case-insensitive. "tlo" has to find "tło". */
export function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    // Combining marks. Polish ł has no decomposition, so it is mapped by hand
    // below — without it "tlo" misses "tło", which is the brief's own example.
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l");
}

/** One tool's searchable text, already normalised. Built by the caller once
 *  per language, never per keystroke. */
export type ToolIndexEntry = { entry: ToolEntry; name: string; haystack: string };

export function buildToolIndex(
  entries: readonly ToolEntry[],
  t: (key: string) => string,
): ToolIndexEntry[] {
  return entries.map((entry) => {
    const name = normalise(t(entry.nameKey));
    // The words list is a translated, comma-separated string: aliases, the
    // category it belongs to, and what a seller would actually type.
    const words = normalise(t(entry.wordsKey)).replace(/,/g, " ");
    return { entry, name, haystack: `${name} ${normalise(t(entry.descKey))} ${words}` };
  });
}

/**
 * Rank matches for a query. Local, synchronous, no request: the whole index is
 * a few dozen short strings, so this runs in microseconds on every keystroke
 * and never needs debouncing.
 *
 * A name that STARTS with the query beats a name that merely contains it,
 * which beats a hit that only came from the alias list — so typing "kom" puts
 * Kompresja first rather than whatever happens to mention compression.
 */
export function matchTools(index: readonly ToolIndexEntry[], query: string): ToolEntry[] {
  const term = normalise(query.trim());
  if (!term) return [];
  const scored: { entry: ToolEntry; score: number }[] = [];
  for (const row of index) {
    const score = row.name.startsWith(term) ? 0
      : row.name.includes(term) ? 1
        : row.haystack.includes(term) ? 2
          : -1;
    if (score >= 0) scored.push({ entry: row.entry, score });
  }
  // Stable within a score: the registry order the index was built in.
  return scored.sort((a, b) => a.score - b.score).map((s) => s.entry);
}

/* ── what the modal actually shows ───────────────────────────────────────── */

/**
 * Turn a ranking into the two lists the modal renders.
 *
 * Availability is applied HERE, after ranking and before slicing, which is the
 * only order that works: a tool switched to "Wkrótce" this morning drops out
 * and the next one moves up, so the grid is always full and never offers a
 * screen the customer cannot open. The ranking is stored deeper than 3 + 6 for
 * exactly this reason.
 */
export function splitPopular(
  keys: readonly FeatureKey[],
  avail: AvailabilityMap,
  isAdmin: boolean,
  counts: { top: number; popular: number },
): { top: ToolCard[]; popular: ToolCard[] } {
  const usable: ToolCard[] = [];
  const seen = new Set<FeatureKey>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    const card = TOOL_CARD_BY_KEY.get(key);
    if (!card || !menuVisible(avail, card.href, isAdmin)) continue;
    seen.add(key);
    usable.push(card);
  }
  // A registry that grew past the stored ranking, or an availability map that
  // hid most of it, still fills the grid — "nigdy pusty modal".
  for (const card of TOOL_CARDS) {
    if (usable.length >= counts.top + counts.popular) break;
    if (seen.has(card.key) || !menuVisible(avail, card.href, isAdmin)) continue;
    seen.add(card.key);
    usable.push(card);
  }
  return {
    top: usable.slice(0, counts.top),
    popular: usable.slice(counts.top, counts.top + counts.popular),
  };
}
