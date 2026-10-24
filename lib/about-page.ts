import type { CmsBlockContent, CmsItem, CmsPoint, LocaleText } from "./cms";
import { lt } from "./cms";

/**
 * O NAS V2 — the about page's sections, their pictures and their rules.
 *
 * One file both sides read: the renderer (components/cms/about-sections.tsx),
 * the inline editor (which slots a block exposes, which items may be switched
 * off), the builder and the tests. Nothing here renders and nothing here
 * talks to the database.
 *
 * WHERE THE PICTURES LIVE. Every picture of the page is a MEDIA SLOT
 * (media_slots, entity `section` / `about`): framed with the editor's focal
 * point and zoom, a separate phone file, a poster for a clip, alt text per
 * language — the machinery /home already uses, not a URL typed into a block.
 * An empty slot is not an error: each section draws a neutral GrovBase canvas
 * (never a stock photo, never something posing as a generated result) or, for
 * the team, the person's initial.
 *
 * WHAT A VISITOR NEVER RECEIVES. An item switched off (`hidden`) and any text
 * still holding a bracketed placeholder — "[treść do potwierdzenia]",
 * "[nazwa firmy]" — are dropped HERE, on the server, before anything is
 * rendered: they are not in the HTML, not in the RSC payload and not in the
 * FAQ's JSON-LD. A placeholder therefore cannot be published by switching a
 * tile on before its text is written.
 */

export const ABOUT_TYPES = [
  "about_hero", "about_story", "about_process", "about_importance", "about_values",
  "about_audience", "about_team", "about_faq", "about_cta",
] as const;
export type AboutType = (typeof ABOUT_TYPES)[number];

export const isAboutType = (type: string): type is AboutType =>
  (ABOUT_TYPES as readonly string[]).includes(type);

/* ── slots ──────────────────────────────────────────────────────────────── */

export const ABOUT_SLOT = {
  hero: "about.hero.visual",
  story: "about.story.visual",
  importanceMain: "about.importance.main",
  importance1: "about.importance.secondary1",
  importance2: "about.importance.secondary2",
  audienceSmall: "about.audience.small",
  audienceLarge: "about.audience.large",
  teamJakub: "about.team.jakub",
  teamMarcel: "about.team.marcel",
  og: "about.seo.og",
} as const;

export type AboutSlotKey = (typeof ABOUT_SLOT)[keyof typeof ABOUT_SLOT];

export type AboutSlotSpec = {
  key: AboutSlotKey;
  /** media_slots.slot_name (entity `section` / `about`). */
  name: string;
  /** CSS aspect-ratio of the frame the page paints. */
  ratio: string;
  /** Recommended file size in px. */
  width: number;
  height: number;
  /** A clip is allowed here. */
  video: boolean;
  /** A separate phone file (and its own frame) is allowed. */
  mobile: boolean;
  /** media.slot.<label> in Admin → Media, ice.role.<label> in the editor —
   *  one per slot, so two pictures of one kind are never the same name. */
  label: string;
  /** media.fb.<fallback>: what the page draws while the slot is empty. */
  fallback: string;
};

export const ABOUT_SLOTS: readonly AboutSlotSpec[] = [
  { key: ABOUT_SLOT.hero, name: "heroVisual", ratio: "21/9", width: 2520, height: 1080, video: true, mobile: true, label: "aboutHero", fallback: "aboutCanvas" },
  { key: ABOUT_SLOT.story, name: "storyVisual", ratio: "4/3", width: 1600, height: 1200, video: false, mobile: false, label: "aboutStory", fallback: "aboutProcess" },
  { key: ABOUT_SLOT.importanceMain, name: "importanceMain", ratio: "4/5", width: 1200, height: 1500, video: false, mobile: false, label: "aboutImportanceMain", fallback: "aboutCanvas" },
  { key: ABOUT_SLOT.importance1, name: "importanceSecondary1", ratio: "1/1", width: 1000, height: 1000, video: false, mobile: false, label: "aboutImportanceSide1", fallback: "aboutCanvas" },
  { key: ABOUT_SLOT.importance2, name: "importanceSecondary2", ratio: "1/1", width: 1000, height: 1000, video: false, mobile: false, label: "aboutImportanceSide2", fallback: "aboutCanvas" },
  { key: ABOUT_SLOT.audienceSmall, name: "audienceSmall", ratio: "16/10", width: 1600, height: 1000, video: false, mobile: false, label: "aboutAudienceSmall", fallback: "aboutCanvas" },
  { key: ABOUT_SLOT.audienceLarge, name: "audienceLarge", ratio: "16/10", width: 1600, height: 1000, video: false, mobile: false, label: "aboutAudienceLarge", fallback: "aboutCanvas" },
  { key: ABOUT_SLOT.teamJakub, name: "teamJakub", ratio: "1/1", width: 800, height: 800, video: false, mobile: false, label: "aboutTeamJakub", fallback: "aboutInitial" },
  { key: ABOUT_SLOT.teamMarcel, name: "teamMarcel", ratio: "1/1", width: 800, height: 800, video: false, mobile: false, label: "aboutTeamMarcel", fallback: "aboutInitial" },
  { key: ABOUT_SLOT.og, name: "ogImage", ratio: "1200/630", width: 1200, height: 630, video: false, mobile: false, label: "aboutOg", fallback: "aboutOg" },
];

const SPEC = new Map<string, AboutSlotSpec>(ABOUT_SLOTS.map((s) => [s.key, s]));
export const aboutSlotSpec = (key: string): AboutSlotSpec | undefined => SPEC.get(key);

/** The slots a section paints itself, whatever its content says. The share
 *  image travels with the hero: it is the page's own, and the hero is where
 *  an editor looks for "the page's picture". */
export const ABOUT_BLOCK_SLOTS: Readonly<Partial<Record<AboutType, readonly AboutSlotKey[]>>> = {
  about_hero: [ABOUT_SLOT.hero, ABOUT_SLOT.og],
  about_story: [ABOUT_SLOT.story],
  about_importance: [ABOUT_SLOT.importanceMain, ABOUT_SLOT.importance1, ABOUT_SLOT.importance2],
};

/** The slots an ITEM of a section may name (`item.slot`) — the audience
 *  cards and the team members carry their picture with them when an editor
 *  reorders them. Any other value is ignored. */
export const ABOUT_ITEM_SLOTS: Readonly<Partial<Record<AboutType, readonly AboutSlotKey[]>>> = {
  about_audience: [ABOUT_SLOT.audienceSmall, ABOUT_SLOT.audienceLarge],
  about_team: [ABOUT_SLOT.teamJakub, ABOUT_SLOT.teamMarcel],
};

/** The item's slot when its section type allows that key, else null. */
export function itemSlot(type: string, item: CmsItem): AboutSlotKey | null {
  const allowed = isAboutType(type) ? ABOUT_ITEM_SLOTS[type] : undefined;
  return allowed && typeof item.slot === "string" && (allowed as readonly string[]).includes(item.slot)
    ? (item.slot as AboutSlotKey) : null;
}

/** Every slot one section paints or carries (block slots, then its items'). */
export function blockSlotKeys(type: string, content: CmsBlockContent | undefined): AboutSlotKey[] {
  if (!isAboutType(type)) return [];
  const own = ABOUT_BLOCK_SLOTS[type] ?? [];
  const items = (content?.items ?? []).map((it) => itemSlot(type, it)).filter((k): k is AboutSlotKey => k !== null);
  return [...new Set([...own, ...items])];
}

/* ── what may be switched off ───────────────────────────────────────────── */

/** Sections whose items an editor may switch off one by one. */
export const ABOUT_HIDEABLE_ITEMS: ReadonlySet<string> = new Set([
  "about_process", "about_values", "about_audience", "about_team", "about_faq",
]);

/** …and the ones whose items carry their own points (each hideable too). */
export const ABOUT_POINT_ITEMS: ReadonlySet<string> = new Set(["about_audience"]);

/* ── placeholders ───────────────────────────────────────────────────────── */

/** "[treść do potwierdzenia]", "[nazwa firmy]", "NIP [numer]" — a bracketed
 *  run of words is a gap still to be filled, never copy. */
const PLACEHOLDER = /\[[^[\]\n]{1,80}\]/;

export function hasPlaceholder(text: string | undefined | null): boolean {
  return typeof text === "string" && PLACEHOLDER.test(text);
}

/** The text a visitor may read: the visitor's language (lt's fallback rule),
 *  or nothing at all when it still holds a placeholder. */
export function publicText(text: LocaleText | undefined, locale: string): string {
  const v = lt(text, locale).trim();
  return v && !hasPlaceholder(v) ? v : "";
}

/** Points a visitor sees: switched on, with a line to show. */
export function shownPoints(points: CmsPoint[] | undefined, locale: string): CmsPoint[] {
  return (points ?? []).filter((p) => p && !p.hidden && publicText(p.title, locale) !== ""
    && !hasPlaceholder(lt(p.title, locale)));
}

/**
 * Items a visitor sees: switched on, titled, and with NO shown text holding a
 * placeholder — a tile whose description is "[treść do potwierdzenia]" is
 * dropped whole rather than shown with a hole in it.
 */
export function shownItems(items: CmsItem[] | undefined, locale: string): CmsItem[] {
  return (items ?? []).filter((it) => {
    if (!it || it.hidden) return false;
    const fields = [it.title, it.description, it.badge].map((t) => lt(t, locale));
    if (fields.some((v) => hasPlaceholder(v))) return false;
    if ((it.points ?? []).some((p) => !p.hidden && hasPlaceholder(lt(p.title, locale)))) return false;
    return publicText(it.title, locale) !== "";
  });
}

/* ── the "start" button ─────────────────────────────────────────────────── */

/**
 * WHERE "WYPRÓBUJ / ZACZNIJ ZA DARMO" LEADS, decided by the platform's own
 * access settings — never a sign-up form that is switched off:
 *   signed in                 → the app;
 *   sign-up open              → the existing sign-up dialog;
 *   pre-launch with waitlist  → the launch page's waitlist form ("/#zapis");
 *   anything else             → the home page.
 */
export type StartCta =
  | { kind: "dashboard"; href: "/dashboard" }
  | { kind: "register"; href: null }
  | { kind: "waitlist"; href: "/#zapis" }
  | { kind: "home"; href: "/" };

export function startCta(input: {
  signedIn: boolean; allowSignup: boolean; showAuth: boolean; waitlist: boolean; launchHome: boolean;
}): StartCta {
  if (input.signedIn) return { kind: "dashboard", href: "/dashboard" };
  if (input.allowSignup && input.showAuth) return { kind: "register", href: null };
  if (input.waitlist && input.launchHome) return { kind: "waitlist", href: "/#zapis" };
  return { kind: "home", href: "/" };
}
