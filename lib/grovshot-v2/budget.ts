/**
 * GROVBASE SHOT V2 — the internal API budget of ONE order.
 *
 * The customer pays per delivered image; candidates, QC calls and the single
 * retry are GrovBase's cost. The cap (config: base + shots × per_shot, USD
 * micros) is fixed when the order starts and stored with it. Before every
 * paid call the engine asks whether the projected spend still fits; when it
 * does not, the optional work goes first (the 2nd candidate, then the retry),
 * and a shot that cannot even afford one generation + its QC is not started
 * and not charged. A call whose provider reported no price counts at the
 * config's estimate — never as free.
 */
import type { EngineConfig } from "@/lib/grovshot-v2/config";

export type SpendEntry = { usd_micros: number | null };

/** Spend so far: known costs, unknown ones at the configured estimate. */
export function spent(entries: readonly SpendEntry[], cfg: EngineConfig["budget"]): number {
  return entries.reduce((sum, e) => sum + (e.usd_micros ?? cfg.unknown_text_call_usd_micros), 0);
}

/** What one image generation + its QC call is expected to cost. */
export function generationEstimate(unitPriceMicros: number, cfg: EngineConfig["budget"]): number {
  return unitPriceMicros + cfg.image_token_allowance_usd_micros + cfg.vision_call_usd_micros;
}

export function fits(spentMicros: number, capMicros: number, nextMicros: number): boolean {
  return spentMicros + nextMicros <= capMicros;
}
