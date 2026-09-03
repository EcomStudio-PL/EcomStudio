"use client";
import { Sparkles } from "lucide-react";
import { RATIO_SHAPE } from "@/lib/ai/types";
import { RatioGlyph, type DropdownOption } from "@/components/ui/dropdown";

/**
 * FORMAT, IN ONE LINE.
 *
 * The ratio says everything: "4:5" IS the tall feed crop, and a shape drawn
 * to scale next to it needs no caption. Names like "Pionowy – klasyczny" only
 * made the list longer and forced the customer to read prose to find a number
 * they already knew, so the option is the ratio plus its glyph — nothing else.
 *
 * "auto" is the one entry without a ratio, so it keeps its word ("Auto") and
 * a sparkle, and it stays first: it is the safe default.
 */

export type T = (key: string, vars?: Record<string, string | number>) => string;

/** What a format is called in the UI: the ratio itself, except "auto". */
export function ratioName(t: T, ratio: string): string {
  return ratio === "auto" ? t("genv3.fmtAuto") : ratio;
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
 * surprised. "auto" leads the list; the rest keep the catalogue's order.
 */
export function ratioOptions(t: T, ratios: string[], exact: string[]): DropdownOption<string>[] {
  const exactSet = new Set(exact);
  const ordered = [
    ...ratios.filter((r) => r === "auto"),
    ...ratios.filter((r) => r !== "auto"),
  ];
  return ordered.map((r) => ({
    value: r,
    label: ratioName(t, r),
    icon: ratioIcon(r),
    note: r !== "auto" && !exactSet.has(r) ? "≈" : undefined,
  }));
}

/** The closed trigger: glyph + ratio, the same two things as the open row. */
export function RatioValue({ t, ratio }: { t: T; ratio: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-muted">{ratioIcon(ratio, 13)}</span>
      <span className="min-w-0 truncate tabular-nums">{ratioName(t, ratio)}</span>
    </span>
  );
}
