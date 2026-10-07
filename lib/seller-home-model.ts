import { FASHION_TOOLS } from "./fashion-tools";
import {
  CHANNEL_DEFAULT_TASK, DEFAULT_HERO_TASK, GALLERY, GALLERY_MAX, HANDOFF_ROUTES, HERO_TASKS,
  SURVEY_CHANNEL, isSellerChannel,
  type GalleryDef, type HeroTaskDef, type HeroTaskKey, type Industry, type MediaPair, type SellerChannel,
} from "./seller-home-config";

/**
 * THE SIGNED-IN START (/home) — the arithmetic and the decisions, pure.
 *
 * No I/O and no React: lib/server/seller-home.ts gathers the facts (what is
 * available, what it costs, what the wallet holds), and everything below
 * turns them into what the page shows. Kept pure so scripts/seller-home-tests
 * can drive every branch without a database or a browser.
 */

/** What /home knows about one catalogue item for THIS viewer. */
export type ItemState = {
  key: string;
  /** The existing route the item opens. */
  href: string;
  /** Usable right now: its switch, its gates and its own runtime agree. */
  available: boolean;
  /** Credits ONE image costs at the tool's default size/quality, from the
   *  tool's own price source. 0 = free; null = no price could be read. */
  credits: number | null;
  /** Images one press of the tool makes by default (workflow shots), when
   *  the tool is a managed preset. */
  shots: number | null;
};

export type ItemStates = Readonly<Record<string, ItemState>>;

/** A hero task as the page renders it. */
export type ResolvedTask = {
  /** The slot it fills (allegro / packshot / lifestyle / mannequin). */
  slot: HeroTaskKey;
  /** The task actually shown — `slot`, or its replacement. */
  key: HeroTaskKey;
  nameKey: string;
  effectKey: string;
  unit: HeroTaskDef["unit"];
  badgeKey: string | null;
  media: MediaPair;
  item: string;
  href: string;
  available: boolean;
  credits: number | null;
  shots: number | null;
  /** The target screen takes the photo chosen here. */
  handoff: boolean;
  notesField: null;
};

function pick(def: HeroTaskDef, items: ItemStates): ItemState | null {
  for (const k of def.items) {
    const s = items[k];
    if (s?.available) return s;
  }
  return null;
}

function toResolved(slot: HeroTaskKey, def: HeroTaskDef, state: ItemState | null): ResolvedTask {
  return {
    slot,
    key: def.key,
    nameKey: def.nameKey,
    effectKey: def.effectKey,
    unit: def.unit,
    badgeKey: def.badgeKey ?? null,
    media: def.media,
    item: state?.key ?? def.items[0],
    href: state?.href ?? "",
    available: Boolean(state?.available),
    credits: state?.credits ?? null,
    shots: state?.shots ?? null,
    handoff: Boolean(state && HANDOFF_ROUTES.includes(state.href)),
    notesField: def.notesField,
  };
}

/**
 * The four hero cards. A task none of whose tools is available is replaced
 * by its configured stand-in (never shown as a dead card). A slot with
 * nothing available at all stays, marked unavailable — the page then shows
 * it inert rather than pretending.
 */
export function resolveHeroTasks(items: ItemStates): ResolvedTask[] {
  return HERO_TASKS.map((def) => {
    const own = pick(def, items);
    if (own) return toResolved(def.key, def, own);
    if (def.replaceWith) {
      const alt = pick(def.replaceWith, items);
      if (alt) return toResolved(def.key, def.replaceWith, alt);
    }
    return toResolved(def.key, def, null);
  });
}

/** The selectable tasks, by the key "Zrób to samo" and the store use. */
export function taskByKey(tasks: readonly ResolvedTask[], key: HeroTaskKey | null): ResolvedTask | null {
  if (!key) return null;
  return tasks.find((t) => t.key === key && t.available) ?? null;
}

/* ── credits → effects ────────────────────────────────────────────────────*/

/**
 * "Masz X kredytów = ok. N miniaturek": whole images the balance pays for at
 * the task's per-image price. Null when there is no honest answer — no price,
 * a free tool, or a negative balance.
 */
export function imagesAffordable(balance: number, perImage: number | null): number | null {
  if (perImage === null || !(perImage > 0) || !Number.isFinite(balance) || balance < 0) return null;
  return Math.floor(balance / perImage);
}

/** Polish plural form for a count: 1 → one, 2–4 (not 12–14) → few, else many. */
export function pluralForm(n: number): "one" | "few" | "many" {
  if (n === 1) return "one";
  const last = n % 10;
  const teen = n % 100 >= 12 && n % 100 <= 14;
  return last >= 2 && last <= 4 && !teen ? "few" : "many";
}

/** True when one image cannot be paid for — the "no credits" moment. */
export function cannotAfford(balance: number, perImage: number | null): boolean {
  return perImage !== null && perImage > 0 && balance < perImage;
}

/* ── price anchor ─────────────────────────────────────────────────────────*/

/**
 * What `images` images cost in GrovBase money: credits per image × images ×
 * the price of one credit on the anchor plan (grosze per credit, from the
 * plan row). Null when any input is missing — the anchor is then not shown.
 */
export function anchorCents(images: number, perImage: number | null, centsPerCredit: number | null): number | null {
  if (perImage === null || !(perImage > 0) || centsPerCredit === null || !(centsPerCredit > 0) || !(images > 0)) return null;
  return Math.round(images * perImage * centsPerCredit);
}

/* ── seller channel ───────────────────────────────────────────────────────*/

/** A channel from the welcome-bonus survey's "sales_channels" answer. */
export function channelFromSurvey(answer: readonly string[] | null | undefined): SellerChannel | null {
  const mapped = Array.from(new Set((answer ?? []).map((a) => SURVEY_CHANNEL[a]).filter(Boolean)));
  if (mapped.length === 0) return null;
  return mapped.length > 1 ? "multi" : mapped[0];
}

/** The task the hero opens on: the channel's, if that task is available;
 *  otherwise the default; otherwise the first available one. */
export function defaultTaskFor(channel: SellerChannel | null, tasks: readonly ResolvedTask[]): HeroTaskKey | null {
  const wanted = channel && isSellerChannel(channel) ? CHANNEL_DEFAULT_TASK[channel] : DEFAULT_HERO_TASK;
  return (taskByKey(tasks, wanted) ?? taskByKey(tasks, DEFAULT_HERO_TASK) ?? tasks.find((t) => t.available))?.key ?? null;
}

/**
 * Whether to ask "Gdzie sprzedajesz?" now. Only a seller with no generation
 * yet, who has not answered or dismissed it, whose answer is not already
 * known from the bonus survey, and who is not about to see the welcome-bonus
 * dialog (which asks a survey of its own — two dialogs would stack).
 */
export function shouldAskChannel(input: {
  generations: number;
  askedAt: string | null;
  channel: SellerChannel | null;
  surveyChannel: SellerChannel | null;
  bonusPending: boolean;
}): boolean {
  return input.generations === 0 && !input.askedAt && !input.channel && !input.surveyChannel && !input.bonusPending;
}

/* ── gallery ──────────────────────────────────────────────────────────────*/

/** The before/after cards a viewer may see: only those whose task is live,
 *  at most GALLERY_MAX, in config order. */
export function visibleGallery(tasks: readonly ResolvedTask[]): GalleryDef[] {
  return GALLERY.filter((g) => taskByKey(tasks, g.task) !== null).slice(0, GALLERY_MAX);
}

export function filterGallery<T extends { industry: string }>(items: readonly T[], industry: Industry): T[] {
  return industry === "all" ? [...items] : items.filter((g) => g.industry === industry);
}

/* ── recent projects ──────────────────────────────────────────────────────*/

/**
 * Where "Powtórz z nowym produktem" goes for a past result, and how the tool
 * is named. Decided only from what the job really recorded: Retusz and the
 * Moda tools record their operation; the custom generator its origin;
 * everything else came from the managed generator. A preset is never guessed
 * from the style text. The destination opens EMPTY — the old photo is not
 * carried over.
 */
export function recentRoute(item: { operation: string | null; origin: "engine" | "custom" | null }): { href: string; labelKey: string } {
  if (item.operation === "image_retouch") return { href: "/retusz", labelKey: "tools.retouch.name" };
  const fashion = item.operation ? FASHION_TOOLS.find((f) => f.operation === item.operation) : undefined;
  if (fashion) return { href: `/k/moda/${fashion.key}`, labelKey: `wf.moda.${fashion.key}.name` };
  if (item.origin === "custom") return { href: "/generator", labelKey: "mega.custom" };
  return { href: "/prompts", labelKey: "mega.createImage" };
}

/** One card per generation (a job can hold several images), newest first. */
export function recentCards<T extends { generationId: string }>(items: readonly T[], max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const i of items) {
    if (seen.has(i.generationId)) continue;
    seen.add(i.generationId);
    out.push(i);
    if (out.length >= max) break;
  }
  return out;
}
