import "server-only";
import type { Client } from "@/lib/services/workspace";
import {
  FEATURE_REGISTRY, defaultStateFor, type FeatureGroup, type FeatureStatus,
} from "@/lib/features";
import { getAvailabilityMap } from "@/lib/server/feature-availability";

/**
 * THE SECTIONS WHOSE CONTENT IS THE PRODUCT.
 *
 * Three section types must never be typed out by hand:
 *
 *   NARZĘDZIA   — the tool list is FEATURE_REGISTRY. A marketing page that
 *                 keeps its own copy promises tools that were switched off
 *                 last week and omits the one shipped yesterday.
 *   MODELE AI   — the model list is ai_models, filtered to what is actually
 *                 active and visible.
 *   CENNIK      — the plan table is subscription_plans, the same rows the
 *                 app bills against.
 *
 * So the CMS stores the SHAPE of those sections (heading, which categories to
 * show, how many columns) and this file supplies the CONTENT at render time.
 * There is no second registry anywhere in this feature.
 *
 * Everything is fetched in ONE round trip per page and only when a section
 * that needs it is present — a homepage without a pricing teaser does not
 * query the plan table.
 */

export type ToolCardData = {
  key: string;
  href: string;
  nameKey: string;
  group: FeatureGroup;
  status: FeatureStatus;
};

export type ModelCardData = {
  id: string;
  name: string;
  description: string | null;
  badge: string | null;
  badgeTone: string | null;
};

export type PlanCardData = {
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  annualPriceCents: number | null;
  currency: string;
  monthlyCredits: number;
  featured: boolean;
  features: string[];
};

export type CmsLiveData = {
  tools: ToolCardData[];
  models: ModelCardData[];
  plans: PlanCardData[];
};

export const EMPTY_LIVE_DATA: CmsLiveData = { tools: [], models: [], plans: [] };

/** Groups a visitor would recognise as "narzędzia". `main` and `account` are
 *  the workspace's own furniture — a library and a credit balance are not
 *  things to advertise on a marketing page. */
const PUBLIC_GROUPS: readonly FeatureGroup[] = ["image", "create", "edit", "video"];

/**
 * The public tool list. A DISABLED tool is left out entirely — advertising a
 * module an operator switched off is the "visible button that does nothing"
 * this codebase refuses. COMING_SOON is kept, because "wkrótce" is honest and
 * is exactly what the badge says.
 */
export async function loadPublicTools(supabase: Client): Promise<ToolCardData[]> {
  const availability = await getAvailabilityMap(supabase);
  return FEATURE_REGISTRY
    .filter((f) => PUBLIC_GROUPS.includes(f.group))
    .map((f) => ({
      key: f.key,
      href: f.path,
      nameKey: f.nameKey,
      group: f.group,
      status: (availability[f.key] ?? defaultStateFor(f.key)).status,
    }))
    .filter((t) => t.status !== "DISABLED");
}

/** Models the product genuinely runs on, in the order the admin arranged. */
export async function loadPublicModels(supabase: Client): Promise<ModelCardData[]> {
  const { data } = await supabase.from("ai_models")
    .select("id, name, display_name, description, badge, badge_tone, sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .limit(24);
  return (data ?? []).map((m) => ({
    id: m.id,
    name: m.display_name || m.name,
    description: m.description,
    badge: m.badge,
    badgeTone: m.badge_tone,
  }));
}

/** The plan table, exactly as the app bills it. */
export async function loadPublicPlans(supabase: Client): Promise<PlanCardData[]> {
  const { data } = await supabase.from("subscription_plans")
    .select("slug, name, description, price_cents, annual_price_cents, currency, monthly_credits, featured, features, sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .limit(8);
  return (data ?? []).map((p) => ({
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceCents: p.price_cents,
    annualPriceCents: p.annual_price_cents,
    currency: p.currency,
    monthlyCredits: p.monthly_credits,
    featured: Boolean(p.featured),
    features: toStringList(p.features),
  }));
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").slice(0, 12);
}

/**
 * Everything the given blocks need, and nothing they do not. One call per
 * page; the three queries inside it run together.
 */
export async function loadLiveData(
  supabase: Client, types: ReadonlySet<string>,
): Promise<CmsLiveData> {
  const [tools, models, plans] = await Promise.all([
    types.has("tools_grid") ? loadPublicTools(supabase) : Promise.resolve([]),
    types.has("models") ? loadPublicModels(supabase) : Promise.resolve([]),
    types.has("pricing_table") ? loadPublicPlans(supabase) : Promise.resolve([]),
  ]);
  return { tools, models, plans };
}
