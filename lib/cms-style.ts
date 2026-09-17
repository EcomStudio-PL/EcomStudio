/**
 * TURNING A SECTION'S STYLE CHOICES INTO CSS.
 *
 * The editor stores presets — "duży odstęp", "wąska kolumna", "3 kolumny" —
 * per breakpoint. This file is the only place that knows what those mean in
 * pixels, and it expresses them as CSS CUSTOM PROPERTIES on the section
 * element rather than as a generated stylesheet:
 *
 *     <section style="--cms-pt:4.5rem; --cms-pt-m:2rem; --cms-cols:3">
 *
 * The rules that consume them live once in app/globals.css, under `.cms-sec`.
 * Doing it this way matters for three reasons:
 *
 *   · one <style> per section would be thirty extra stylesheets on a long
 *     page, each blocking paint;
 *   · a variable inherits, so a breakpoint that was never overridden falls
 *     back to the next one up with no duplicated declarations;
 *   · there is no string interpolation into CSS anywhere, so an authored
 *     value cannot become a rule. Every value below comes from these tables,
 *     never from the database.
 *
 * Spacing is `clamp()`-based on purpose: "duży" should be generous on a
 * 1920 monitor and merely roomy on a 360 phone WITHOUT the admin having to
 * set three values, which is the difference between a responsive site and a
 * desktop site with three copies.
 */
import type { Background, Breakpoint, SectionStyle, Space, StyleValues, Width } from "./cms";

const SPACE: Record<Space, string> = {
  none: "0rem",
  xs: "clamp(0.75rem, 1.5vw, 1rem)",
  sm: "clamp(1.25rem, 3vw, 2rem)",
  md: "clamp(2rem, 4.5vw, 3.25rem)",
  lg: "clamp(2.75rem, 6vw, 5rem)",
  xl: "clamp(3.5rem, 9vw, 8rem)",
};

const WIDTH: Record<Width, string> = {
  narrow: "46rem",
  normal: "72rem",
  wide: "88rem",
  full: "100%",
};

/** Every background a section may have, as a complete `background` value.
 *  `soft` and `gradient` are the brand wash; both read correctly in dark mode
 *  because they are built from the theme's own variables. */
const BACKGROUND: Record<Background, string> = {
  none: "transparent",
  surface: "rgb(var(--surface))",
  sunken: "rgb(var(--sunken, var(--raised)))",
  soft: "rgb(var(--accent-soft) / 0.55)",
  gradient: "linear-gradient(135deg, rgb(var(--accent) / 0.12), rgb(var(--accent2) / 0.08) 55%, transparent)",
};

const ALIGN = new Set(["left", "center", "right"]);

/** Suffix for each breakpoint's variables. `base` has none — it is the value
 *  the others fall back to. */
const SUFFIX: Record<Breakpoint, string> = { base: "", tablet: "-t", mobile: "-m" };

const DEFAULTS: StyleValues = {
  paddingTop: "lg",
  paddingBottom: "lg",
  align: "left",
  background: "none",
  width: "normal",
};

function isSpace(v: unknown): v is Space {
  return typeof v === "string" && v in SPACE;
}
function isWidth(v: unknown): v is Width {
  return typeof v === "string" && v in WIDTH;
}
function isBackground(v: unknown): v is Background {
  return typeof v === "string" && v in BACKGROUND;
}

/** Variables for one breakpoint. Only what was actually set is emitted, so an
 *  untouched breakpoint costs nothing and inherits. */
function varsFor(values: StyleValues | undefined, bp: Breakpoint, out: Record<string, string>) {
  if (!values) return;
  const s = SUFFIX[bp];
  if (isSpace(values.paddingTop)) out[`--cms-pt${s}`] = SPACE[values.paddingTop];
  if (isSpace(values.paddingBottom)) out[`--cms-pb${s}`] = SPACE[values.paddingBottom];
  if (isWidth(values.width)) out[`--cms-w${s}`] = WIDTH[values.width];
  if (ALIGN.has(values.align ?? "")) out[`--cms-align${s}`] = values.align as string;
  if (typeof values.columns === "number" && values.columns >= 1 && values.columns <= 6) {
    out[`--cms-cols${s}`] = String(Math.round(values.columns));
  }
  // A background belongs to the section, not to the width it is read at.
  if (bp === "base" && isBackground(values.background)) out["--cms-bg"] = BACKGROUND[values.background];
}

export type ResolvedStyle = {
  className: string;
  style: Record<string, string>;
};

/**
 * The inline variables and the class list for one section.
 *
 * `hide` becomes three classes rather than three variables: `display` cannot
 * be driven by a custom property without a rule per value, and a class is
 * what a media query wants anyway.
 */
export function resolveStyle(style: SectionStyle | undefined, extra?: string): ResolvedStyle {
  const vars: Record<string, string> = {};
  varsFor({ ...DEFAULTS, ...(style?.base ?? {}) }, "base", vars);
  varsFor(style?.tablet, "tablet", vars);
  varsFor(style?.mobile, "mobile", vars);

  const classes = ["cms-sec"];
  if (style?.hide?.desktop) classes.push("cms-hide-d");
  if (style?.hide?.tablet) classes.push("cms-hide-t");
  if (style?.hide?.mobile) classes.push("cms-hide-m");
  if (style?.base?.panel) classes.push("cms-panel");
  if (extra) classes.push(extra);

  return { className: classes.join(" "), style: vars };
}

/** The preset lists the editor offers. Kept here so the editor and the
 *  renderer can never disagree about which values exist. */
export const SPACE_OPTIONS = Object.keys(SPACE) as Space[];
export const WIDTH_OPTIONS = Object.keys(WIDTH) as Width[];
export const BACKGROUND_OPTIONS = Object.keys(BACKGROUND) as Background[];
export const ALIGN_OPTIONS = ["left", "center", "right"] as const;
export const COLUMN_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

/**
 * DEVICE PRESETS for the editor's preview frame, and the widths this site is
 * expected to survive. Taken from the brief rather than invented: these are
 * the real viewport widths of the phones and tablets customers use.
 */
export const DEVICE_PRESETS = {
  desktop: [1920, 1600, 1440, 1366],
  tablet: [1180, 1024, 834, 820, 768],
  mobile: [430, 414, 412, 393, 390, 375, 360, 320],
} as const;

export type DeviceKind = keyof typeof DEVICE_PRESETS;
