import "server-only";
import type { Client } from "@/lib/services/workspace";
import { billingFrom, creditsForCost, quote } from "@/lib/images/pricing";
import { toolBySlug, type PhotoToolSlug } from "@/lib/images/tools";
import { photoToolPath } from "@/lib/server/image-tools";

/**
 * THE FOUR PHOTO TOOLS, FOR THE OPERATOR — what one photo costs us and what it
 * earns, at the prices a seller really pays.
 *
 * The automatic rule (lib/images/pricing.ts) prices a call at the REFERENCE
 * credit price in Admin → Rozliczenia. A seller who bought the largest pack
 * pays far less per credit than that, so the same number of credits can earn
 * a healthy margin from one seller and almost nothing from another. This
 * module puts both next to each other — and proposes, never writes: the price
 * an operator set in the service catalogue stays exactly as it is until they
 * change it themselves.
 */

/** Polish standard VAT. Catalogue prices are shown to sellers as gross; the
 *  net figure is what GrovBase keeps if they are. Labelled as such in the UI. */
export const VAT_RATE = 0.23;

export type PricePoint = {
  key: "reference" | "cheapestGross" | "cheapestNet";
  plnPerCredit: number;
  revenuePln: number;
  marginPln: number;
  marginPercent: number;
};

export type PhotoToolUnit = {
  slug: PhotoToolSlug;
  /** What is called: "remove_background" | "segment_color" | "ai_background" | "ai_shadow". */
  operation: string;
  providerLabel: string;
  endpoint: string;
  environment: "live" | "sandbox" | null;
  costUsd: number;
  costPln: number;
  usdToPln: number;
  /** service_catalog.credits_cost — the operator's floor. */
  floorCredits: number;
  /** What a seller is charged today (the floor or the margin rule, higher). */
  credits: number;
  freeWhenTransparent: boolean;
  /** Revenue and margin of ONE photo at today's price, per credit price. */
  points: PricePoint[];
  /** The cheapest credit on sale and where it comes from (pack or plan). */
  cheapest: { plnPerCredit: number; source: string } | null;
  /** Smallest whole price meeting the margin floor + buffer at the cheapest
   *  credit, gross and net. A proposal for the operator, never applied. */
  minimum: { gross: number | null; net: number | null };
  rule: { minMarginPercent: number; bufferPercent: number; plnPerCredit: number };
  /** Runs in the last 30 days, by key environment. */
  runs30d: { live: number; sandbox: number; local: number; failed: number };
};

const OPERATION: Record<PhotoToolSlug, string> = {
  remove_bg: "remove_background",
  white_bg: "segment_color",
  ai_background: "ai_background",
  ai_shadow: "ai_shadow",
};

/** The cheapest credit any seller can buy: active packs (with their bonus)
 *  and active paid plans (monthly + bonus credits). */
async function cheapestCredit(supabase: Client): Promise<{ plnPerCredit: number; source: string } | null> {
  const [{ data: packs }, { data: plans }] = await Promise.all([
    supabase.from("credit_packages").select("name, price_cents, credits, bonus_credits, currency").eq("active", true),
    supabase.from("subscription_plans").select("name, price_cents, monthly_credits, bonus_credits, currency").eq("active", true),
  ]);
  const offers = [
    ...(packs ?? []).map((p) => ({ name: p.name, cents: p.price_cents, credits: p.credits + (p.bonus_credits ?? 0), currency: p.currency })),
    ...(plans ?? []).map((p) => ({ name: p.name, cents: p.price_cents, credits: p.monthly_credits + (p.bonus_credits ?? 0), currency: p.currency })),
  ].filter((o) => o.cents > 0 && o.credits > 0 && (o.currency ?? "PLN").toUpperCase() === "PLN");
  if (offers.length === 0) return null;
  const best = offers.reduce((a, b) => (a.cents / a.credits <= b.cents / b.credits ? a : b));
  return { plnPerCredit: best.cents / best.credits / 100, source: best.name };
}

export async function readPhotoToolUnit(supabase: Client, slug: PhotoToolSlug): Promise<PhotoToolUnit> {
  const tool = toolBySlug(slug)!;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [path, { data: service }, { data: billingRow }, cheapest, { data: events }] = await Promise.all([
    photoToolPath(supabase, slug),
    supabase.from("service_catalog").select("credits_cost").eq("slug", tool.service).maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
    cheapestCredit(supabase),
    supabase.from("usage_events").select("status, provider_slug, metadata")
      .eq("service_slug", tool.service).gte("created_at", since).limit(20000),
  ]);
  const billing = billingFrom(billingRow?.value);
  const floorCredits = service?.credits_cost ?? 0;
  const priced = quote(path.costUsd, floorCredits, billing);
  const costPln = path.costUsd * billing.usdToPln;

  const point = (key: PricePoint["key"], plnPerCredit: number): PricePoint => {
    const revenuePln = priced.credits * plnPerCredit;
    const marginPln = revenuePln - costPln;
    return { key, plnPerCredit, revenuePln, marginPln, marginPercent: revenuePln > 0 ? (marginPln / revenuePln) * 100 : -100 };
  };
  const points: PricePoint[] = [point("reference", billing.plnPerCredit)];
  if (cheapest) {
    points.push(point("cheapestGross", cheapest.plnPerCredit));
    points.push(point("cheapestNet", cheapest.plnPerCredit / (1 + VAT_RATE)));
  }
  const minimumAt = (plnPerCredit: number) => creditsForCost(path.costUsd, { ...billing, plnPerCredit });

  const runs30d = { live: 0, sandbox: 0, local: 0, failed: 0 };
  for (const e of events ?? []) {
    const env = (e.metadata as Record<string, unknown> | null)?.environment;
    if (e.status === "failed" || e.status === "refunded") runs30d.failed++;
    else if (env === "sandbox") runs30d.sandbox++;
    else if (!e.provider_slug || e.provider_slug === "local") runs30d.local++;
    else runs30d.live++;
  }

  return {
    slug,
    operation: OPERATION[slug],
    providerLabel: path.label,
    endpoint: path.endpoint,
    environment: path.environment,
    costUsd: path.costUsd,
    costPln,
    usdToPln: billing.usdToPln,
    floorCredits,
    credits: priced.credits,
    freeWhenTransparent: tool.freeWhenTransparent === true,
    points,
    cheapest,
    minimum: cheapest
      ? { gross: minimumAt(cheapest.plnPerCredit), net: minimumAt(cheapest.plnPerCredit / (1 + VAT_RATE)) }
      : { gross: null, net: null },
    rule: { minMarginPercent: billing.minMarginPercent, bufferPercent: billing.bufferPercent, plnPerCredit: billing.plnPerCredit },
    runs30d,
  };
}
