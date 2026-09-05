/**
 * EDITOR STATE — one description of an edit, shared by both sides.
 *
 * The editor is not a chain of saved images: it is a small set of PARAMETERS
 * that the server bakes into pixels in a single pass. That is what makes undo
 * cheap (a few hundred bytes per step instead of a bitmap), makes a preview and
 * the final export provably the same edit, and lets a future React Native app
 * drive the same pipeline over the same JSON.
 *
 * This module is imported by the browser AND the server, so it holds only
 * shapes, defaults and arithmetic — no sharp, no next/*, no secrets. Every
 * value that reaches it from outside goes through clampEditorState first: the
 * panel is free to be forgiving, the server trusts nothing.
 */

export type BackgroundMode = "keep" | "transparent" | "color" | "image";
export type ShadowPreset = "none" | "soft" | "strong" | "floating" | "wall";
export type EditorRatio = "original" | "1:1" | "4:5" | "3:4" | "16:9" | "9:16" | "custom";

export const BACKGROUND_MODES: readonly BackgroundMode[] = ["keep", "transparent", "color", "image"];
export const SHADOW_PRESET_KEYS: readonly ShadowPreset[] = ["none", "soft", "strong", "floating", "wall"];
export const EDITOR_RATIOS: readonly EditorRatio[] = ["original", "1:1", "4:5", "3:4", "16:9", "9:16", "custom"];

export type EditorState = {
  background: { mode: BackgroundMode; color: string; imageUrl?: string };
  shadow: {
    preset: ShadowPreset;
    /** Percent, 0–100. */
    opacity: number;
    /** Blur radius in pixels. */
    blur: number;
    /** Pixels, relative to the product. */
    offsetX: number;
    offsetY: number;
    color: string;
  };
  format: {
    ratio: EditorRatio;
    /** Explicit export box in pixels; null means "whatever the ratio implies". */
    width: number | null;
    height: number | null;
    /** Height follows the width so the chosen proportions are never broken. */
    lockRatio: boolean;
  };
  /** Every dial is a signed percentage: 0 is the untouched photo. */
  adjust: { brightness: number; contrast: number; saturation: number; temperature: number; sharpness: number };
  transform: {
    /** Degrees, free angle. */
    rotate: number;
    flipH: boolean;
    flipV: boolean;
    /** Zoom inside the frame, in percent. 100 is the untouched frame. */
    scale: number;
    /** Pan inside the frame, as a percentage of its width/height. */
    offsetX: number;
    offsetY: number;
  };
};

export type EditorSection = keyof EditorState;

/**
 * The bounds the panel draws its sliders from and the server re-applies. One
 * table, so a control can never offer a value the pipeline would refuse.
 */
export const EDITOR_LIMITS = {
  shadow: { opacity: [0, 100], blur: [0, 200], offsetX: [-300, 300], offsetY: [-300, 300] },
  format: { width: [16, 8000], height: [16, 8000] },
  adjust: { brightness: [-100, 100], contrast: [-100, 100], saturation: [-100, 100], temperature: [-100, 100], sharpness: [-100, 100] },
  transform: { rotate: [-180, 180], scale: [10, 400], offsetX: [-100, 100], offsetY: [-100, 100] },
} as const;

/**
 * A shadow preset is a LOOK, not a label — picking one adopts its numbers, and
 * the sliders stay live afterwards so the seller can tune from there. The
 * geometry each preset resolves to lives in lib/images/local.ts, next to sharp.
 */
export const SHADOW_PRESETS: Record<Exclude<ShadowPreset, "none">, {
  opacity: number; blur: number; offsetX: number; offsetY: number;
}> = {
  soft: { opacity: 30, blur: 28, offsetX: 0, offsetY: 18 },
  strong: { opacity: 55, blur: 12, offsetX: 0, offsetY: 22 },
  floating: { opacity: 26, blur: 44, offsetX: 0, offsetY: 46 },
  // A wall shadow is the same silhouette thrown sideways, not a different kind
  // of shadow — which is exactly what sharp can cast honestly.
  wall: { opacity: 38, blur: 18, offsetX: 34, offsetY: 10 },
};

export const EDITOR_DEFAULTS: EditorState = {
  background: { mode: "keep", color: "#FFFFFF" },
  shadow: { preset: "none", opacity: 30, blur: 28, offsetX: 0, offsetY: 18, color: "#000000" },
  format: { ratio: "original", width: null, height: null, lockRatio: true },
  adjust: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0 },
  transform: { rotate: 0, flipH: false, flipV: false, scale: 100, offsetX: 0, offsetY: 0 },
};

export type HistoryEntry = {
  id: string;
  /** An i18n KEY, never a sentence — see describePatch. */
  label: string;
  state: EditorState;
};

/* ── validation ────────────────────────────────────────────────────────── */

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads one field of an untrusted object without ever asserting its shape. */
const at = (v: unknown, key: string): unknown => (isObject(v) ? v[key] : undefined);

/** NaN, Infinity, "12abc" and objects all land on the fallback, not on sharp. */
function num(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 1000) / 1000));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Six-digit hex only, upper-cased so two spellings of white compare equal. */
function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(String(value)) ? (value as T) : fallback;
}

/** Null stays null — "no explicit size" is a real answer, not a missing one. */
function side(value: unknown, fallback: number | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  const [min, max] = EDITOR_LIMITS.format.width;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)));
}

/**
 * THE SERVER TRUSTS NOTHING. Everything that reaches the bake — a request body,
 * a saved preset, a restored draft — comes through here first, so composeEditor
 * can read state.transform.scale without asking whether it is a number.
 */
export function clampEditorState(raw: unknown): EditorState {
  const d = EDITOR_DEFAULTS;
  const bg = at(raw, "background");
  const sh = at(raw, "shadow");
  const fm = at(raw, "format");
  const ad = at(raw, "adjust");
  const tr = at(raw, "transform");

  const imageUrl = at(bg, "imageUrl");
  const L = EDITOR_LIMITS;

  return {
    background: {
      mode: oneOf(at(bg, "mode"), BACKGROUND_MODES, d.background.mode),
      color: color(at(bg, "color"), d.background.color),
      // Only http(s) survives: a data: or file: URL here would be a fetch the
      // pipeline makes on the caller's behalf, which is not the editor's job.
      ...(typeof imageUrl === "string" && /^https:\/\/[^\s]{3,2000}$/.test(imageUrl)
        ? { imageUrl }
        : {}),
    },
    shadow: {
      preset: oneOf(at(sh, "preset"), SHADOW_PRESET_KEYS, d.shadow.preset),
      opacity: num(at(sh, "opacity"), L.shadow.opacity[0], L.shadow.opacity[1], d.shadow.opacity),
      blur: num(at(sh, "blur"), L.shadow.blur[0], L.shadow.blur[1], d.shadow.blur),
      offsetX: num(at(sh, "offsetX"), L.shadow.offsetX[0], L.shadow.offsetX[1], d.shadow.offsetX),
      offsetY: num(at(sh, "offsetY"), L.shadow.offsetY[0], L.shadow.offsetY[1], d.shadow.offsetY),
      color: color(at(sh, "color"), d.shadow.color),
    },
    format: {
      ratio: oneOf(at(fm, "ratio"), EDITOR_RATIOS, d.format.ratio),
      width: side(at(fm, "width"), d.format.width),
      height: side(at(fm, "height"), d.format.height),
      lockRatio: bool(at(fm, "lockRatio"), d.format.lockRatio),
    },
    adjust: {
      brightness: num(at(ad, "brightness"), L.adjust.brightness[0], L.adjust.brightness[1], d.adjust.brightness),
      contrast: num(at(ad, "contrast"), L.adjust.contrast[0], L.adjust.contrast[1], d.adjust.contrast),
      saturation: num(at(ad, "saturation"), L.adjust.saturation[0], L.adjust.saturation[1], d.adjust.saturation),
      temperature: num(at(ad, "temperature"), L.adjust.temperature[0], L.adjust.temperature[1], d.adjust.temperature),
      sharpness: num(at(ad, "sharpness"), L.adjust.sharpness[0], L.adjust.sharpness[1], d.adjust.sharpness),
    },
    transform: {
      rotate: num(at(tr, "rotate"), L.transform.rotate[0], L.transform.rotate[1], d.transform.rotate),
      flipH: bool(at(tr, "flipH"), d.transform.flipH),
      flipV: bool(at(tr, "flipV"), d.transform.flipV),
      scale: num(at(tr, "scale"), L.transform.scale[0], L.transform.scale[1], d.transform.scale),
      offsetX: num(at(tr, "offsetX"), L.transform.offsetX[0], L.transform.offsetX[1], d.transform.offsetX),
      offsetY: num(at(tr, "offsetY"), L.transform.offsetY[0], L.transform.offsetY[1], d.transform.offsetY),
    },
  };
}

/* ── editing ───────────────────────────────────────────────────────────── */

/**
 * Apply one panel change. Immutable — the previous state object is untouched,
 * because it is very probably sitting in the history list — and clamped through
 * exactly the same function the server uses, so the preview can never show an
 * edit the bake would refuse.
 */
export function applyPatch<S extends EditorSection>(
  state: EditorState, section: S, patch: Partial<EditorState[S]>,
): EditorState {
  const merged: Record<string, unknown> = { ...state[section], ...patch };

  // Switching preset adopts that look's numbers, unless the same patch sets
  // them itself — a preset the sliders ignore is only a label.
  if (section === "shadow") {
    const preset = merged.preset;
    if (typeof preset === "string" && preset !== state.shadow.preset && preset !== "none") {
      const look = SHADOW_PRESETS[preset as Exclude<ShadowPreset, "none">];
      if (look) {
        for (const key of ["opacity", "blur", "offsetX", "offsetY"] as const) {
          if (!(key in patch)) merged[key] = look[key];
        }
      }
    }
  }

  return clampEditorState({ ...state, [section]: merged });
}

/**
 * Push a step onto the undo stack.
 *
 * History holds STATE OBJECTS, never bitmaps: a step is a few hundred bytes, so
 * fifty of them cost less than one thumbnail. Two rules keep the list honest —
 * a step that changes nothing is not a step, and the ORIGINAL (entry zero) is
 * never the one dropped when the cap is reached. Losing the way back to the
 * untouched photo is the one thing an editor may not do.
 */
export function pushHistory(
  entries: HistoryEntry[], current: EditorState, label: string, limit = 50,
): HistoryEntry[] {
  const cap = Math.max(2, Math.min(500, Math.round(Number.isFinite(limit) ? limit : 50)));
  const last = entries[entries.length - 1];
  if (last && sameState(last.state, current)) return entries;

  const next = [...entries, { id: nextId(), label, state: current }];
  if (next.length <= cap) return next;
  // Keep entry zero, then the most recent (cap - 1) steps: the oldest EDIT is
  // what falls off, never the photo the seller started from.
  return [next[0], ...next.slice(next.length - (cap - 1))];
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Name the step — as an i18n KEY, not a sentence. This module is shared with
 * the browser and has no dictionary; the panel translates what it gets back,
 * so the history reads in Polish, English and German without three copies of
 * this logic. Every key it can emit is listed in lib/i18n/dictionaries.
 */
export function describePatch(section: EditorSection, patch: AnyPatch, prev: EditorState): string {
  switch (section) {
    case "background": {
      const before = prev.background;
      if (patch.mode !== undefined && patch.mode !== before.mode) {
        return patch.mode === "keep" ? "editor.h.bgKept"
          : patch.mode === "transparent" ? "editor.h.bgTransparent"
            : patch.mode === "color" ? "editor.h.bgColor"
              : "editor.h.bgImage";
      }
      if (patch.color !== undefined && patch.color !== before.color) return "editor.h.bgColorChanged";
      if (patch.imageUrl !== undefined && patch.imageUrl !== before.imageUrl) return "editor.h.bgImageChanged";
      return "editor.h.noChange";
    }
    case "shadow": {
      const before = prev.shadow;
      if (patch.preset !== undefined && patch.preset !== before.preset) {
        return patch.preset === "none" ? "editor.h.shadowNone"
          : patch.preset === "soft" ? "editor.h.shadowSoft"
            : patch.preset === "strong" ? "editor.h.shadowStrong"
              : patch.preset === "floating" ? "editor.h.shadowFloating"
                : "editor.h.shadowWall";
      }
      if (patch.color !== undefined && patch.color !== before.color) return "editor.h.shadowColor";
      if ((patch.opacity !== undefined && patch.opacity !== before.opacity)
        || (patch.blur !== undefined && patch.blur !== before.blur)
        || (patch.offsetX !== undefined && patch.offsetX !== before.offsetX)
        || (patch.offsetY !== undefined && patch.offsetY !== before.offsetY)) return "editor.h.shadowTuned";
      return "editor.h.noChange";
    }
    case "format": {
      const before = prev.format;
      if (patch.ratio !== undefined && patch.ratio !== before.ratio) return "editor.h.ratio";
      if ((patch.width !== undefined && patch.width !== before.width)
        || (patch.height !== undefined && patch.height !== before.height)) return "editor.h.size";
      if (patch.lockRatio !== undefined && patch.lockRatio !== before.lockRatio) return "editor.h.ratioLock";
      return "editor.h.noChange";
    }
    case "adjust": {
      const before = prev.adjust;
      const keys = (["brightness", "contrast", "saturation", "temperature", "sharpness"] as const)
        .filter((k) => patch[k] !== undefined && patch[k] !== before[k]);
      if (keys.length === 0) return "editor.h.noChange";
      if (keys.length > 1) return "editor.h.adjusted";
      return `editor.h.${keys[0]}`;
    }
    default: {
      const before = prev.transform;
      const keys = (["rotate", "flipH", "flipV", "scale", "offsetX", "offsetY"] as const)
        .filter((k) => patch[k] !== undefined && patch[k] !== before[k]);
      if (keys.length === 0) return "editor.h.noChange";
      if (keys.length > 1) return "editor.h.transformed";
      const key = keys[0];
      return key === "rotate" ? "editor.h.rotated"
        : key === "flipH" ? "editor.h.flippedH"
          : key === "flipV" ? "editor.h.flippedV"
            : key === "scale" ? "editor.h.scaled"
              : "editor.h.moved";
    }
  }
}

/** The union of every section's fields — no two sections disagree on a type. */
export type AnyPatch =
  Partial<EditorState["background"]>
  & Partial<EditorState["shadow"]>
  & Partial<EditorState["format"]>
  & Partial<EditorState["adjust"]>
  & Partial<EditorState["transform"]>;

/**
 * Does this state render the same photo the seller uploaded?
 *
 * Not a deep equality on the object: a preset switched back to "none" leaves
 * its numbers behind, and those numbers change nothing. The question the panel
 * asks is "is there anything to export or undo", and this answers that one.
 */
export function isPristine(state: EditorState): boolean {
  const d = EDITOR_DEFAULTS;
  const bgPristine = state.background.mode === d.background.mode && !state.background.imageUrl;
  const shadowPristine = state.shadow.preset === "none";
  const formatPristine = state.format.ratio === "original"
    && state.format.width === null && state.format.height === null;
  const adjustPristine = (["brightness", "contrast", "saturation", "temperature", "sharpness"] as const)
    .every((k) => state.adjust[k] === 0);
  const transformPristine = state.transform.rotate === 0 && !state.transform.flipH && !state.transform.flipV
    && state.transform.scale === 100 && state.transform.offsetX === 0 && state.transform.offsetY === 0;
  return bgPristine && shadowPristine && formatPristine && adjustPristine && transformPristine;
}

/** Field-by-field, because two states are compared far too often for JSON. */
function sameState(a: EditorState, b: EditorState): boolean {
  return a.background.mode === b.background.mode
    && a.background.color === b.background.color
    && a.background.imageUrl === b.background.imageUrl
    && a.shadow.preset === b.shadow.preset
    && a.shadow.opacity === b.shadow.opacity
    && a.shadow.blur === b.shadow.blur
    && a.shadow.offsetX === b.shadow.offsetX
    && a.shadow.offsetY === b.shadow.offsetY
    && a.shadow.color === b.shadow.color
    && a.format.ratio === b.format.ratio
    && a.format.width === b.format.width
    && a.format.height === b.format.height
    && a.format.lockRatio === b.format.lockRatio
    && a.adjust.brightness === b.adjust.brightness
    && a.adjust.contrast === b.adjust.contrast
    && a.adjust.saturation === b.adjust.saturation
    && a.adjust.temperature === b.adjust.temperature
    && a.adjust.sharpness === b.adjust.sharpness
    && a.transform.rotate === b.transform.rotate
    && a.transform.flipH === b.transform.flipH
    && a.transform.flipV === b.transform.flipV
    && a.transform.scale === b.transform.scale
    && a.transform.offsetX === b.transform.offsetX
    && a.transform.offsetY === b.transform.offsetY;
}
