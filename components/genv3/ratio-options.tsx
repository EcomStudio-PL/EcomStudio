"use client";
import { Sparkles } from "lucide-react";
import { RATIO_SHAPE } from "@/lib/ai/types";
import { RatioGlyph, type DropdownOption } from "@/components/ui/dropdown";

/**
 * FORMAT, IN PLAIN LANGUAGE.
 *
 * "9:16" is a ratio, not a choice a seller can make. Every format therefore
 * carries the shape drawn to scale, a name that says what it is for, and the
 * ratio as the technical footnote — orientation first ("Pionowy – Stories"),
 * so the list reads as a hierarchy rather than ten numbers.
 *
 * i18n keys live in `genv3.fmt*`; the ratio itself is never translated.
 */
const NAME_KEY: Record<string, string> = {
  auto: "genv3.fmtAuto",
  "1:1": "genv3.fmtSquare",
  "4:5": "genv3.fmtPortraitFeed",
  "3:4": "genv3.fmtPortraitClassic",
  "2:3": "genv3.fmtPortraitPhoto",
  "9:16": "genv3.fmtPortraitStories",
  "5:4": "genv3.fmtLandscapeLight",
  "4:3": "genv3.fmtLandscapeClassic",
  "3:2": "genv3.fmtLandscapePhoto",
  "16:9": "genv3.fmtLandscapeWide",
  "21:9": "genv3.fmtLandscapePanorama",
};

export type T = (key: string, vars?: Record<string, string | number>) => string;

/** The customer-facing name of a format ("Kwadrat"), or the raw ratio for
 *  anything a future model declares that this catalogue does not name. */
export function ratioName(t: T, ratio: string): string {
  const key = NAME_KEY[ratio];
  return key ? t(key) : ratio;
}

/** The glyph for a ratio — a sparkle for "auto", which has no fixed shape
 *  because the engine picks it. */
export function ratioIcon(ratio: string, size = 15) {
  if (ratio === "auto") return <Sparkles size={13} aria-hidden />;
  const shape = RATIO_SHAPE[ratio as keyof typeof RATIO_SHAPE];
  return shape ? <RatioGlyph w={shape.w} h={shape.h} size={size} /> : null;
}

/**
 * Build the format list for one engine. `exact` is what the engine renders
 * true to the request; everything else is marked "≈" and explained, because
 * a customer who picks 4:5 and receives 2:3 should have been told, not
 * surprised.
 */
export function ratioOptions(t: T, ratios: string[], exact: string[]): DropdownOption<string>[] {
  const exactSet = new Set(exact);
  return ratios.map((r) => ({
    value: r,
    label: ratioName(t, r),
    meta: r === "auto" ? undefined : r,
    sub: r === "auto" ? t("genv3.fmtAutoSub") : undefined,
    icon: ratioIcon(r),
    note: r !== "auto" && !exactSet.has(r) ? "≈" : undefined,
  }));
}

/** "Kwadrat · 1:1" for the closed trigger — the name first, because that is
 *  what the customer chose; the ratio stays as the quiet confirmation. */
export function RatioValue({ t, ratio }: { t: T; ratio: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-muted">{ratioIcon(ratio, 13)}</span>
      <span className="min-w-0 truncate">{ratioName(t, ratio)}</span>
      {ratio !== "auto" && (
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-faint">· {ratio}</span>
      )}
    </span>
  );
}
