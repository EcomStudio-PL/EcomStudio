/**
 * GROVBASE SHOT V2 — the automatic COLOUR CHECK (spec: „Porównanie próbki
 * koloru produktu na referencji i na wyniku, automatycznie, w kodzie.
 * Szczególnie przy pastelach i w ciepłym świetle”).
 *
 * Pure math over decoded RGB pixels (the server decodes with sharp). The
 * sample boxes come from the card (reference) and the QC model (candidate);
 * each box is shrunk by 20% so edges and background stay out, and the colour
 * is the per-channel MEDIAN in CIELAB. The check is honest about what it
 * cannot measure: a missing or tiny box, a sample that is not one colour
 * (high L* spread), or a near-neutral reference (hue is meaningless on grey)
 * make it INCONCLUSIVE, and an inconclusive check never rejects anything.
 */
import type { EngineConfig } from "@/lib/grovshot-v2/config";

export type Box = { x: number; y: number; w: number; h: number };
export type Pixels = { data: Uint8Array | Buffer; width: number; height: number; channels: number };
export type LabSample = { L: number; a: number; b: number; C: number; h: number; lStd: number; n: number };

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB (D65) → CIELAB. */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Median Lab of a box (fractions of the image), shrunk by `shrink` on each side. */
export function sampleBox(px: Pixels, box: Box, shrink = 0.2): LabSample | null {
  const bx = box.x + box.w * shrink, by = box.y + box.h * shrink;
  const bw = box.w * (1 - 2 * shrink), bh = box.h * (1 - 2 * shrink);
  const x0 = Math.max(0, Math.floor(bx * px.width)), y0 = Math.max(0, Math.floor(by * px.height));
  const x1 = Math.min(px.width, Math.ceil((bx + bw) * px.width)), y1 = Math.min(px.height, Math.ceil((by + bh) * px.height));
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;
  // At most ~4 000 pixels: a regular grid over the box is plenty for a median.
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
  const Ls: number[] = [], As: number[] = [], Bs: number[] = [];
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * px.width + x) * px.channels;
      const [L, a, b] = rgbToLab(px.data[i], px.data[i + 1], px.data[i + 2]);
      Ls.push(L); As.push(a); Bs.push(b);
    }
  }
  if (Ls.length < 9) return null;
  const L = median(Ls), a = median(As), b = median(Bs);
  // Unreadable pixels are no evidence either way.
  if (![L, a, b].every(Number.isFinite)) return null;
  const mean = Ls.reduce((p, c) => p + c, 0) / Ls.length;
  const lStd = Math.sqrt(Ls.reduce((p, c) => p + (c - mean) ** 2, 0) / Ls.length);
  const C = Math.hypot(a, b);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { L, a, b, C, h, lStd, n: Ls.length };
}

export type ColorCheck =
  | { conclusive: false; reason: "disabled" | "no_reference_box" | "no_candidate_box" | "box_too_small" | "not_uniform" | "neutral_reference" | "sample_failed" }
  | { conclusive: true; shift: boolean; hueDiff: number; chromaRatio: number; ref: LabSample; cand: LabSample };

export function compareColors(
  ref: { px: Pixels; box: Box | null } , cand: { px: Pixels; box: Box | null },
  cfg: EngineConfig["qc"]["color"], pastel: boolean,
): ColorCheck {
  if (!cfg.enabled) return { conclusive: false, reason: "disabled" };
  if (!ref.box) return { conclusive: false, reason: "no_reference_box" };
  if (!cand.box) return { conclusive: false, reason: "no_candidate_box" };
  if (ref.box.w * ref.box.h < cfg.min_box_area || cand.box.w * cand.box.h < cfg.min_box_area) return { conclusive: false, reason: "box_too_small" };
  const r = sampleBox(ref.px, ref.box);
  const c = sampleBox(cand.px, cand.box);
  if (!r || !c) return { conclusive: false, reason: "sample_failed" };
  if (r.lStd > cfg.max_l_std || c.lStd > cfg.max_l_std) return { conclusive: false, reason: "not_uniform" };
  if (r.C < cfg.neutral_chroma) return { conclusive: false, reason: "neutral_reference" };
  const d = Math.abs(r.h - c.h);
  const hueDiff = Math.min(d, 360 - d);
  const chromaRatio = c.C / Math.max(r.C, 1e-6);
  const maxHue = pastel ? cfg.hue_max_deg_pastel : cfg.hue_max_deg;
  const shift = hueDiff > maxHue || chromaRatio < cfg.chroma_ratio_min || chromaRatio > cfg.chroma_ratio_max;
  return { conclusive: true, shift, hueDiff: Math.round(hueDiff * 10) / 10, chromaRatio: Math.round(chromaRatio * 100) / 100, ref: r, cand: c };
}
