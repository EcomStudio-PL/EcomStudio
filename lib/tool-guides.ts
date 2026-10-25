import type { AiToolKey } from "@/lib/services/ai-tools";
import type { Locale } from "@/lib/i18n/config";
import { LOCALES } from "@/lib/i18n/config";
import { hasInvisible } from "@/lib/ice/stega";
import { normaliseText } from "@/lib/ice/validate";

/**
 * TOOL GUIDES — a tutorial per tool and a "starter gallery" in place of an
 * empty results gallery. This file is the contract both sides share: which
 * tools have one, what a guide is made of, the limits every write is held to,
 * and the two decisions the client makes (open the tutorial by itself? show
 * the starter gallery?). Client-safe: no server import, no dictionary.
 *
 * A guide is keyed by the tool's ADMIN key (AiToolKey) — the identifier
 * /admin/ai/[tool] uses, the availability switchboard uses and the database
 * row uses — never by a URL or a catalogue card (several cards open one
 * screen). It is PRESENTATION ONLY: nothing here is ever sent to a model, a
 * provider or a billing path, and reading or showing a guide costs nothing.
 */

/**
 * The tools that have a guide: every tool a customer can open and run. Where
 * the screen has a RESULTS GALLERY the tutorial's button sits above it and the
 * starter gallery replaces its empty state; the one-shot workbenches (upscale,
 * expand, watermark) and the editor have no gallery, so they get the tutorial
 * alone, its button in their settings / timeline strip. Video is absent: it is
 * not released and has nothing to explain yet.
 */
export const GUIDE_TOOL_KEYS = [
  "prompts", "generator", "retouch", "ecommerce_thumbnail",
  "fashion_ghost_mannequin", "fashion_flat_lay", "fashion_iron", "fashion_change_person", "fashion_change_face",
  "tool_remove_bg", "tool_white_bg", "tool_ai_background", "tool_ai_shadow",
  "resize", "compress",
  "editor", "tool_upscale", "tool_expand", "tool_watermark",
] as const satisfies readonly AiToolKey[];
export type GuideToolKey = (typeof GUIDE_TOOL_KEYS)[number];

export function isGuideTool(value: unknown): value is GuideToolKey {
  return typeof value === "string" && (GUIDE_TOOL_KEYS as readonly string[]).includes(value);
}

/** The gallery a tool's screen shows — which decides how "no results yet" is
 *  known (see starterVisible) — or, for the screens without one, what they
 *  are: a session workbench or the editor. */
export type GuideSurface = "generations" | "photo" | "batch" | "workbench" | "editor";

const PHOTO_TOOLS: readonly GuideToolKey[] = ["tool_remove_bg", "tool_white_bg", "tool_ai_background", "tool_ai_shadow"];
const WORKBENCH_TOOLS: readonly GuideToolKey[] = ["tool_upscale", "tool_expand", "tool_watermark"];

export function guideSurface(tool: GuideToolKey): GuideSurface {
  if (tool === "resize" || tool === "compress") return "batch";
  if (tool === "editor") return "editor";
  if (WORKBENCH_TOOLS.includes(tool)) return "workbench";
  if (PHOTO_TOOLS.includes(tool)) return "photo";
  return "generations";
}

/** Does the tool's screen have a results gallery whose empty state a starter
 *  gallery can stand in for? The workbenches and the editor do not. */
export function guideHasStarter(tool: GuideToolKey): boolean {
  const surface = guideSurface(tool);
  return surface === "generations" || surface === "photo" || surface === "batch";
}

/** The ToolWorkbench slug a guide belongs to (one component serves seven
 *  slugs; only these three are guide tools). */
export function guideToolForWorkbench(slug: string): GuideToolKey | null {
  if (slug === "upscale") return "tool_upscale";
  if (slug === "expand") return "tool_expand";
  if (slug === "watermark") return "tool_watermark";
  return null;
}

/**
 * The tool a GenerationGallery belongs to, from the `operation` it already
 * filters by (lib/server/retouch.ts RETOUCH_OPERATION, lib/thumbnail/config.ts
 * THUMBNAIL_OPERATION, lib/fashion-tools.ts operation === toolKey). Hosts that
 * list the whole workspace (the generators) say which tool they are instead.
 */
export function guideToolForOperation(operation: string | undefined): GuideToolKey | null {
  if (!operation) return null;
  if (operation === "image_retouch") return "retouch";
  return isGuideTool(operation) && guideSurface(operation) === "generations" ? operation : null;
}

/**
 * The tool of a gallery that lists the whole workspace (no `operation`): the
 * generator screens, by their route. /generator is Własny prompt; /prompts and
 * every preset under /k/<category>/<workflow> run the managed generator. The
 * route is enough because these screens mount no other gallery, and it keeps
 * the generator workspace itself untouched.
 */
export function guideToolForPath(pathname: string | null | undefined): GuideToolKey | null {
  if (!pathname) return null;
  const path = pathname.replace(/\/+$/, "");
  if (path === "/generator") return "generator";
  if (path === "/prompts" || /^\/k\/[^/]+\/[^/]+$/.test(path)) return "prompts";
  return null;
}

/** "tool_remove_bg" → "remove_bg": the photo tools' slug in tool_results. */
export function photoSlugOf(tool: GuideToolKey): string | null {
  return guideSurface(tool) === "photo" ? tool.slice("tool_".length) : null;
}

/* ── ILLUSTRATIONS ─────────────────────────────────────────────────────── */

/**
 * The built-in illustrations a step can carry (components/tool-guide/
 * guide-art.tsx). Drawn, not photographed: they show the CONTROL a step is
 * about (an upload, a ratio, a palette), never a result the tool would be
 * claimed to produce. An admin can put a picture from the media library over
 * any of them.
 */
export const GUIDE_ARTS = [
  "upload", "order", "session", "settings", "format", "prompt", "inspiration",
  "retouch", "generate", "result", "compare", "download",
  "background", "color", "scene", "shadow",
  "garment", "person", "face", "resize", "compress",
  "adjust", "upscale", "expand", "watermark",
] as const;
export type GuideArt = (typeof GUIDE_ARTS)[number];

export const isGuideArt = (v: unknown): v is GuideArt =>
  typeof v === "string" && (GUIDE_ARTS as readonly string[]).includes(v);

/**
 * THE SHIPPED TUTORIALS: how many steps each tool's default has, and the
 * illustration of each. The words are in the dictionaries
 * (`toolGuideDefaults.<tool>.tutorial.steps.s<n>`), one entry per step here —
 * scripts/tool-guide-tests.ts holds the two in step.
 */
export const DEFAULT_STEP_ARTS: Record<GuideToolKey, readonly GuideArt[]> = {
  prompts: ["upload", "session", "settings", "prompt", "result"],
  generator: ["upload", "inspiration", "prompt", "settings", "result"],
  retouch: ["upload", "settings", "format", "result"],
  ecommerce_thumbnail: ["order", "retouch", "generate", "result"],
  fashion_ghost_mannequin: ["garment", "settings", "prompt", "result"],
  fashion_flat_lay: ["garment", "settings", "result"],
  fashion_iron: ["garment", "settings", "result"],
  fashion_change_person: ["garment", "person", "format", "result"],
  fashion_change_face: ["person", "face", "format", "result"],
  tool_remove_bg: ["upload", "background", "generate", "compare"],
  tool_white_bg: ["upload", "color", "generate", "compare"],
  tool_ai_background: ["upload", "scene", "inspiration", "compare"],
  tool_ai_shadow: ["upload", "shadow", "background", "compare"],
  resize: ["upload", "resize", "generate", "download"],
  compress: ["upload", "compress", "generate", "download"],
  editor: ["upload", "color", "shadow", "format", "adjust", "download"],
  tool_upscale: ["upload", "upscale", "generate", "compare", "download"],
  tool_expand: ["upload", "expand", "generate", "compare", "download"],
  tool_watermark: ["upload", "watermark", "adjust", "generate", "download"],
};

/* ── PICTURES: media slots, keyed by position ──────────────────────────── */

/**
 * A guide's pictures are ordinary media slots — the one library, the one
 * resolver, usage counting and "replace everywhere" for free. entity_type
 * 'tool', entity_id = the tool key, slot_name `tutorial.<n>` / `starter.1`.
 * They are NOT in MEDIA_SLOTS (Admin → Media lists catalogue surfaces only);
 * this file is their registry and the guide editor their only writer.
 */
export const GUIDE_MAX_STEPS = 6;

export function guideSlotKey(tool: GuideToolKey, kind: "tutorial" | "starter", n: number): string {
  return `guide.${tool}.${kind}.${n}`;
}

export function isGuideSlotKey(key: string): boolean {
  const m = /^guide\.([a-z_]+)\.(tutorial|starter)\.([1-9]\d*)$/.exec(key);
  if (!m || !isGuideTool(m[1])) return false;
  const n = Number(m[3]);
  return m[2] === "starter" ? n === 1 : n >= 1 && n <= GUIDE_MAX_STEPS;
}

/* ── CONTENT ───────────────────────────────────────────────────────────── */

/** Text per language. A missing language falls back to Polish, then to the
 *  shipped default (lib/server/tool-guides.ts). */
export type LocaleText = Partial<Record<Locale, string>>;

export type GuideStepContent = { title: LocaleText; body: LocaleText; art: GuideArt };

/** What an admin saves (tool_guides.content). */
export type GuideContent = {
  tutorial: { title: LocaleText; body: LocaleText; steps: GuideStepContent[] };
  starter: { title: LocaleText; body: LocaleText };
  /** Short lines on the tool's own screen. `reorder` is the line under a
   *  reorderable photo grid (Drag & drop zdjęć V2): saved empty = hidden;
   *  absent = the shipped default. */
  hints?: { reorder?: LocaleText };
};

export const GUIDE_LIMITS = {
  tutorialTitle: 80,
  tutorialBody: 300,
  stepTitle: 80,
  stepBody: 400,
  starterTitle: 80,
  starterBody: 240,
  reorderHint: 120,
} as const;

export type GuideProblem =
  | "shape" | "steps_min" | "steps_max" | "art" | "too_long" | "invisible" | "markup" | "required";

/** One text field, tidied the way the inline editor tidies (whitespace
 *  collapsed, no line breaks) and checked against the same rules the
 *  database enforces (tool_guide_content_ok → content_text_ok). */
function cleanText(raw: unknown, max: number): { value: LocaleText } | { problem: GuideProblem } {
  const out: LocaleText = {};
  if (raw === undefined || raw === null) return { value: out };
  if (typeof raw !== "object" || Array.isArray(raw)) return { problem: "shape" };
  for (const locale of LOCALES) {
    const v = (raw as Record<string, unknown>)[locale];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return { problem: "shape" };
    // One paragraph per field: a line break typed into the form is a space.
    const text = normaliseText(v.replace(/[\r\n]+/g, " "));
    if (!text) continue;
    if (text.length > max) return { problem: "too_long" };
    if (/[<>]/.test(text)) return { problem: "markup" };
    if (hasInvisible(text)) return { problem: "invisible" };
    out[locale] = text;
  }
  return { value: out };
}

/**
 * Validate and tidy what the admin form sends. Structure is fixed here — the
 * browser never chooses a key — and every string is held to the length and
 * character rules. Polish is required for every title (the default language
 * and the fallback for the other two).
 */
export function normalizeGuideContent(input: unknown): { ok: true; content: GuideContent } | { ok: false; problem: GuideProblem } {
  if (!input || typeof input !== "object") return { ok: false, problem: "shape" };
  const src = input as { tutorial?: unknown; starter?: unknown };
  const tut = (src.tutorial ?? {}) as { title?: unknown; body?: unknown; steps?: unknown };
  const sta = (src.starter ?? {}) as { title?: unknown; body?: unknown };
  if (typeof tut !== "object" || typeof sta !== "object") return { ok: false, problem: "shape" };
  if (!Array.isArray(tut.steps)) return { ok: false, problem: "shape" };
  if (tut.steps.length < 1) return { ok: false, problem: "steps_min" };
  if (tut.steps.length > GUIDE_MAX_STEPS) return { ok: false, problem: "steps_max" };

  const field = (raw: unknown, max: number, required: boolean): LocaleText | GuideProblem => {
    const r = cleanText(raw, max);
    if ("problem" in r) return r.problem;
    if (required && !r.value.pl) return "required";
    return r.value;
  };

  const tTitle = field(tut.title, GUIDE_LIMITS.tutorialTitle, true);
  if (typeof tTitle === "string") return { ok: false, problem: tTitle };
  const tBody = field(tut.body, GUIDE_LIMITS.tutorialBody, false);
  if (typeof tBody === "string") return { ok: false, problem: tBody };
  const steps: GuideStepContent[] = [];
  for (const raw of tut.steps as unknown[]) {
    if (!raw || typeof raw !== "object") return { ok: false, problem: "shape" };
    const s = raw as { title?: unknown; body?: unknown; art?: unknown };
    if (!isGuideArt(s.art)) return { ok: false, problem: "art" };
    const title = field(s.title, GUIDE_LIMITS.stepTitle, true);
    if (typeof title === "string") return { ok: false, problem: title };
    const body = field(s.body, GUIDE_LIMITS.stepBody, false);
    if (typeof body === "string") return { ok: false, problem: body };
    steps.push({ title, body, art: s.art });
  }
  const sTitle = field(sta.title, GUIDE_LIMITS.starterTitle, true);
  if (typeof sTitle === "string") return { ok: false, problem: sTitle };
  const sBody = field(sta.body, GUIDE_LIMITS.starterBody, false);
  if (typeof sBody === "string") return { ok: false, problem: sBody };

  // The reorder line: optional, and an explicitly empty one is kept as such
  // (it hides the line), which is why `hints` is written whenever it is sent.
  const rawHints = (src as { hints?: unknown }).hints;
  let hints: GuideContent["hints"];
  if (rawHints !== undefined && rawHints !== null) {
    if (typeof rawHints !== "object" || Array.isArray(rawHints)) return { ok: false, problem: "shape" };
    const reorder = field((rawHints as { reorder?: unknown }).reorder, GUIDE_LIMITS.reorderHint, false);
    if (typeof reorder === "string") return { ok: false, problem: reorder };
    hints = { reorder };
  }

  return {
    ok: true,
    content: {
      tutorial: { title: tTitle, body: tBody, steps },
      starter: { title: sTitle, body: sBody },
      ...(hints ? { hints } : {}),
    },
  };
}

/* ── WHAT THE CUSTOMER'S SCREEN RECEIVES ───────────────────────────────── */

/** A picture, already resolved to public URLs (never a storage path). */
export type GuideImage = {
  url: string;
  srcSet?: string;
  width?: number;
  height?: number;
  alt: string;
};

export type ResolvedStep = { title: string; body: string; art: GuideArt; image: GuideImage | null };

export type ResolvedGuide = {
  tool: GuideToolKey;
  /** Bumped by an admin to show the tutorial again to everyone. */
  version: number;
  tutorial: { title: string; body: string; steps: ResolvedStep[] } | null;
  starter: { title: string; body: string; image: GuideImage | null } | null;
};

/** GET /api/tool-guides answer. */
export type GuideResponse = {
  guide: ResolvedGuide | null;
  /** Highest tutorial version this user has seen (0 = never). */
  seen: number;
  /** The tool is switched on (ACTIVE) and can run for this viewer. A tool
   *  that is "Wkrótce", in maintenance or unable to run never opens a
   *  tutorial by itself and never shows example effects. */
  live: boolean;
  /** Does this workspace already have results in the gallery this tool
   *  shows? null = unknown (the read failed) → the gallery stays as it is. */
  hasResults: boolean | null;
  /** Has this user finished something in this tool before (their own
   *  jobs)? null = unknown. */
  usedBefore: boolean | null;
  /** The line under a reorderable photo grid: the admin's wording, null =
   *  hidden by the admin, undefined = the shipped default. */
  reorderHint?: string | null;
};

/* ── THE TWO DECISIONS ─────────────────────────────────────────────────── */

/** Open the tutorial by itself? Only on a live tool, only for a version this
 *  user has not seen, never over another dialog or the visual editor — and
 *  the first version only for someone new to the tool (a seller who already
 *  made something here knows it); a version an admin raised, for everyone. */
export function shouldAutoOpen(r: GuideResponse | null, blocked: boolean): boolean {
  return Boolean(
    r && r.live && r.guide?.tutorial && r.guide.tutorial.steps.length > 0
    && r.seen < r.guide.version && !blocked
    && (r.usedBefore === false || r.guide.version > 1),
  );
}

/**
 * Show example effects instead of the empty gallery? Every condition is
 * about the REAL gallery: nothing loaded, nothing loading, nothing in flight,
 * no filter that could be hiding results, no page still to fetch — and the
 * server confirmed there are no results at all (not "the read failed").
 */
export function starterVisible(input: {
  response: GuideResponse | null;
  itemCount: number;
  pendingCount: number;
  loading: boolean;
  filtered: boolean;
  moreToLoad: boolean;
  /** Results this screen made since it opened (fresh items). */
  madeHere: boolean;
}): boolean {
  const r = input.response;
  return Boolean(
    r && r.live && r.guide?.starter && r.hasResults === false
    && input.itemCount === 0 && input.pendingCount === 0 && !input.loading
    && !input.filtered && !input.moreToLoad && !input.madeHere,
  );
}
