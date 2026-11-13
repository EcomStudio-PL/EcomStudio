import "server-only";
import type { Client } from "@/lib/services/workspace";

/**
 * CENNIK V2 — the prices of the tools whose price is not "the model's price".
 *
 * One source of truth: `service_catalog` rows an admin can edit (their price
 * history is kept by the table's trigger). The approved values (0175):
 *
 *   prompt_generation    2     GrovShot: product analysis, once per order
 *   grovshot_image_2k    1     GrovShot: one image at 2K (and 1K)
 *   grovshot_image_4k    1.25  GrovShot: one image at 4K
 *   tool_thumbnail       2     Miniaturka (+ Packshot at its own 2K price
 *                              for each input photo it retouches)
 *
 * Packshot and „Stwórz zdjęcie" are priced by the model's own table
 * (ai_models.pricing, per size) — the same table for both, so one change is
 * one price everywhere. A GrovShot image costs the same whichever model
 * renders it: the model is GrovBase's choice, not the customer's.
 */

export const GROVSHOT_SERVICES = {
  analysis: "prompt_generation",
  image2k: "grovshot_image_2k",
  image4k: "grovshot_image_4k",
} as const;

export type GrovshotPrices = { analysis: number | null; image2k: number | null; image4k: number | null };

export async function grovshotPrices(supabase: Client): Promise<GrovshotPrices> {
  const { data } = await supabase.from("service_catalog").select("slug, credits_cost, enabled")
    .in("slug", Object.values(GROVSHOT_SERVICES));
  const of = (slug: string) => {
    const row = (data ?? []).find((r) => r.slug === slug);
    const n = row && row.enabled !== false ? Number(row.credits_cost) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return { analysis: of(GROVSHOT_SERVICES.analysis), image2k: of(GROVSHOT_SERVICES.image2k), image4k: of(GROVSHOT_SERVICES.image4k) };
}

/** One GrovShot image at `resolution`; null while the rows are not configured. */
export function grovshotImagePrice(prices: GrovshotPrices, resolution: string | null | undefined): number | null {
  const p = resolution === "4K" ? prices.image4k : prices.image2k;
  return p !== null && p > 0 ? p : null;
}

/** Hundredths, exactly: 1.25 × 3 = 3.75, never 3.7500000000000004. */
export const credits2 = (n: number) => Math.round(n * 100) / 100;
