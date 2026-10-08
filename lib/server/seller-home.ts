import "server-only";
import { getCurrentWorkspace, getProfile, type Client } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { getAvailabilityMap, viewerIsAdmin } from "@/lib/server/feature-availability";
import { toolCatalogue } from "@/lib/server/image-tools";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { fashionModel, fashionPrice, fashionToolAvailable } from "@/lib/server/fashion";
import { engineOutputsPerRun, engineToolConfigured } from "@/lib/server/engine/tool-run";
import { RETOUCH_DEFAULT_RESOLUTION, retouchModel, retouchPrice, retouchWorkflowSize } from "@/lib/server/retouch";
import { loadBanners, loadSlots, type LiveBanner, type SlotMap } from "@/lib/server/media-slots";
import { bannerSlotKey, categorySlotKey, toolSlotKey, workflowSlotKey } from "@/lib/media-slots";
import { getBonusConfig, getCampaignStart, readOffer, toView } from "@/lib/server/welcome-bonus";
import { paymentsEnabled } from "@/lib/stripe/config";
import { sellable } from "@/lib/server/stripe-pricing";
import { getToolsLayout } from "@/lib/server/tool-layout";
import { customModels, getUsableModels, toClientModel } from "@/lib/ai/router";
import { menuBadge, menuVisible, routeReachable, type MenuBadge } from "@/lib/features";
import { catalogItem } from "@/lib/tool-cards";
import { itemBadge, itemReachable } from "@/lib/tool-layout";
import { CATEGORIES, categoryGates, categoryHref, findCategory } from "@/lib/categories";
import { FASHION_TOOLS } from "@/lib/fashion-tools";
import { snapQuality, unitPrice, type GenModel } from "@/components/genv3/types";
import {
  BEFORE_AFTER, CAROUSEL, FEATURED, INTEREST_GATES, INTEREST_KEYS, PROMO_BANNERS, SESSIONS, SHOWCASE,
  THUMBNAILS, UPLOAD_TOOLS,
  isInterestKey, isSellerChannel, type InterestKey, type SellerChannel,
} from "@/lib/seller-home-config";
import {
  channelFromSurvey, resolveUploadTools, shouldAskChannel,
  type ItemState, type ItemStates, type ItemStatus, type UploadToolView,
} from "@/lib/seller-home-model";

/**
 * THE SIGNED-IN START (/home) — every fact the page shows, in one batch.
 *
 * Nothing here decides a price or an availability of its own: each tool is
 * asked through the SAME helper its own screen uses —
 *   managed presets / Grovshot → conceptModelOptions + unitPrice (the
 *     generator workspace's default model, size and quality)
 *   Własny prompt → its own model list (customModels)
 *   image tools (Białe tło, Tło AI, Cień AI, …) → toolCatalogue()
 *   Retusz → retouchModel + retouchPrice at its default size (read only —
 *     nothing of Retusz runs from here)
 *   Moda tools → fashionModel + fashionToolAvailable
 * and every item first passes the switchboard (itemReachable + its badge) and
 * the /tools layout's "Narzędzia" flag, so a module an operator switched off,
 * hid or marked "Wkrótce" is never offered as live here.
 *
 * Reads only. The page that renders this writes nothing; the two writes /home
 * can make (seller channel, "Powiadom mnie") are server actions in
 * app/actions/seller-home.ts.
 */

export type ProOffer = {
  id: string;
  name: string;
  priceCents: number;
  credits: number;
  currency: string;
  /** Checkout can sell it right now: Stripe on, a monthly Price mapped and
   *  in sync with the displayed price, and no live subscription already
   *  (a subscriber changes plan on /plan, never through a second checkout). */
  payable: boolean;
};

export type SellerHomeData = {
  balance: number;
  /** Every catalogue item the page references, for this viewer. An item the
   *  viewer must not see at all (switched off, taken off /tools) is absent. */
  items: ItemStates;
  uploadTools: UploadToolView[];
  /** item key → the admin media slot (Admin → Media) that dresses its card,
   *  only for slots an admin actually filled. */
  toolSlots: Readonly<Record<string, string>>;
  channel: SellerChannel | null;
  askChannel: boolean;
  interests: InterestKey[];
  /** "Nadchodzi" chips: only modules that are not live yet. */
  soon: InterestKey[];
  pro: ProOffer | null;
  banners: LiveBanner[];
  slots: SlotMap;
  isAdmin: boolean;
};

function emptyData(): SellerHomeData {
  return {
    balance: 0, items: {}, uploadTools: [], toolSlots: {}, channel: null, askChannel: false,
    interests: [], soon: [], pro: null, banners: [], slots: new Map(), isAdmin: false,
  };
}

/** Every catalogue item any section references. */
export function referencedItems(): string[] {
  const keys = new Set<string>();
  CAROUSEL.forEach((c) => keys.add(c.item));
  UPLOAD_TOOLS.forEach((u) => keys.add(u.item));
  BEFORE_AFTER.forEach((b) => keys.add(b.item));
  Object.values(PROMO_BANNERS).forEach((b) => { if (b.item) keys.add(b.item); });
  keys.add(SHOWCASE.item);
  keys.add(THUMBNAILS.item);
  keys.add(SESSIONS.studio.item);
  keys.add(SESSIONS.outdoor.item);
  FEATURED.forEach((f) => keys.add(f.item));
  return [...keys];
}

/** The admin media slot that dresses an item's card (Admin → Media). */
export function adminSlotKey(item: string): string | null {
  if (item.startsWith("cat:")) return categorySlotKey(item.slice(4));
  const [cat, wf] = item.split(".");
  if (wf && findCategory(cat)) return workflowSlotKey(cat, wf);
  return toolSlotKey(item);
}

/** The status a switchboard badge means, before the runtime is asked. */
function statusOfBadge(badge: MenuBadge): ItemStatus | null {
  if (badge === "soon") return "soon";
  if (badge === "maintenance") return "maintenance";
  if (badge === "disabled") return "disabled";
  return null;
}

export async function loadSellerHome(supabase: Client, user: {
  id: string; email_confirmed_at?: string | null; created_at?: string;
}): Promise<SellerHomeData> {
  const [workspace, profile] = await Promise.all([
    getCurrentWorkspace(supabase, user.id),
    getProfile(supabase, user.id),
  ]);
  if (!workspace || !profile) return emptyData();

  const [
    wallet, availability, isAdmin, catalogue, modelOptions, usable, engineRows, keyed,
    retouch, retouchConfigured, retouchOutputs, fashion, fashionAvail, planRow, activeSub,
    generationCount, interestRows, surveyRow, bonusConfig, offer, campaignStart, banners, layout,
  ] = await Promise.all([
    getWallet(supabase, workspace.id),
    getAvailabilityMap(supabase),
    viewerIsAdmin(supabase),
    toolCatalogue(supabase),
    conceptModelOptions(supabase),
    // Własny prompt's own model list — exactly what /generator opens on.
    getUsableModels(supabase),
    // The same engine check the workflow page makes (k/[cat]/[wf]/page.tsx):
    // an active planner provider that actually holds a credential.
    supabase.from("ai_providers").select("id").eq("active", true).in("slug", ["openai", "google"]),
    supabase.rpc("providers_with_credentials"),
    retouchModel(supabase),
    engineToolConfigured(supabase, "retouch", false),
    // Workflow ON: one photo yields (and is priced for) the workflow's count —
    // the same figure the Retusz screen multiplies by.
    engineOutputsPerRun(supabase, "retouch"),
    fashionModel(supabase),
    Promise.all(FASHION_TOOLS.map(async (f) => [f.key, await fashionToolAvailable(supabase, f.toolKey), await engineOutputsPerRun(supabase, f.toolKey)] as const)),
    supabase.from("subscription_plans")
      .select("id, name, price_cents, monthly_credits, bonus_credits, currency, stripe_price_id_monthly, stripe_price_monthly_cents, stripe_sync_status, active")
      .eq("slug", "pro").eq("active", true).maybeSingle(),
    // The same "already subscribed" read /plan makes.
    supabase.from("subscriptions").select("id").eq("workspace_id", workspace.id).eq("status", "active").limit(1),
    // "New seller" = no generation at all in this workspace — counted.
    supabase.from("generations").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
    supabase.from("feature_interest").select("feature_key").eq("user_id", user.id),
    supabase.from("onboarding_survey_responses").select("answer")
      .eq("user_id", user.id).eq("question_key", "sales_channels")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    getBonusConfig(supabase),
    readOffer(supabase, user.id),
    getCampaignStart(supabase),
    loadBanners(supabase, "dashboard"),
    // The switchboard's "Narzędzia" flag: an item an operator took off /tools
    // is not offered here either.
    getToolsLayout(supabase),
  ]);

  /* ── per-item facts ─────────────────────────────────────────────────── */

  const withKey = new Set((keyed.data ?? []) as string[]);
  const engineAvailable = (engineRows.data ?? []).some((p) => withKey.has(p.id));
  // The generator workspace opens on models[0], its first size and "medium".
  const first = modelOptions[0];
  const genModel: GenModel | undefined = first ? {
    id: first.id, name: first.name, badge: first.badge, badgeTone: first.badgeTone,
    description: first.description, pricing: first.pricing,
    resolutions: first.resolutions, ratios: first.ratios, exactRatios: first.exactRatios,
    maxOutputs: 1, supportsRefs: true, qualities: first.qualities, qualityPricing: first.qualityPricing,
  } : undefined;
  const managedUnit = genModel
    ? unitPrice(genModel, genModel.resolutions[0] ?? "1K", "managed", snapQuality(genModel, "medium"))
    : null;
  const managedLive = engineAvailable && managedUnit !== null && managedUnit > 0;
  // Własny prompt opens on ITS first model (customModels), first size, "medium".
  const custom = customModels(usable).map(toClientModel)[0];
  const customModel: GenModel | undefined = custom ? {
    id: custom.id, name: custom.displayName, badge: custom.badge, badgeTone: custom.badgeTone,
    description: custom.description, pricing: custom.pricing,
    resolutions: custom.resolutions, ratios: custom.ratios, exactRatios: custom.exactRatios,
    maxOutputs: custom.maxQuantity, supportsRefs: custom.supportsReferenceImages,
    qualities: custom.qualities, qualityPricing: custom.qualityPricing,
  } : undefined;
  const customUnit = customModel
    ? unitPrice(customModel, customModel.resolutions[0] ?? "1K", "custom", snapQuality(customModel, "medium"))
    : null;

  // Price of ONE click, as each screen shows it: per-image price × results.
  const times = (credits: number | null, n: number) => (credits === null ? null : credits * Math.max(1, n));
  const retouchCredits = retouch
    ? times(retouchPrice(retouch, retouch.workflowEnabled ? retouchWorkflowSize(retouch) : RETOUCH_DEFAULT_RESOLUTION), retouchOutputs)
    : null;
  const fashionSize = fashion ? (fashion.resolutions.includes("2K") ? "2K" : fashion.resolutions[0]) : null;
  const fashionUnit = fashion && fashionSize ? fashionPrice(fashion, fashionSize) : null;
  const fashionOn = new Map(fashionAvail.map(([k, on]) => [k, on]));
  const fashionRuns = new Map(fashionAvail.map(([k, , n]) => [k, n]));
  const isFashionTool = (wf: string) => FASHION_TOOLS.some((f) => f.key === wf);

  /** The switchboard's verdict if it has one; otherwise whether it runs. */
  const status = (gate: ItemStatus | null, runs: boolean): ItemStatus => gate ?? (runs ? "live" : "unavailable");

  function itemState(key: string): ItemState | null {
    if (key.startsWith("cat:")) {
      const cat = CATEGORIES.find((c) => c.key === key.slice(4));
      if (!cat) return null;
      const gates = categoryGates(cat);
      if (!menuVisible(availability, gates, isAdmin)) return null;
      const gate = cat.soon ? "soon" : statusOfBadge(menuBadge(availability, gates));
      // Something in the category must run — a managed preset or a Moda tool.
      const anyTool = managedLive || (Boolean(fashion) && FASHION_TOOLS.some((f) => fashionOn.get(f.key)));
      return { key, href: categoryHref(cat), status: status(gate, anyTool), credits: null };
    }
    const item = catalogItem(key);
    if (!item) return null;
    // The same "may this viewer see it" /tools asks, and its badge: a switched
    // off item is gone for a customer, "Wkrótce"/maintenance stay, badged.
    if (!itemReachable(availability, item, isAdmin)) return null;
    // Taken off /tools by the layout switchboard → not here either.
    if (layout.flags[key]?.tools === false && !isAdmin) return null;
    const gate = statusOfBadge(itemBadge(availability, item));
    const href = item.href;
    if (href === "/retusz") {
      return { key, href, status: status(gate, Boolean(retouch) && retouchConfigured), credits: retouchCredits };
    }
    if (href.startsWith("/k/")) {
      const [, , cat, wf = ""] = href.split("/");
      if (cat === "moda" && isFashionTool(wf)) {
        return {
          key, href, status: status(gate, Boolean(fashion) && Boolean(fashionOn.get(wf))),
          credits: times(fashionUnit, fashionRuns.get(wf) ?? 1),
        };
      }
      // A managed preset (the e-commerce workflows, the Moda street session…).
      const category = findCategory(cat);
      const workflow = category?.workflows.find((w) => w.key === wf);
      const exists = Boolean(workflow) && !workflow?.soon && !category?.soon;
      return { key, href, status: status(gate, exists && managedLive), credits: managedUnit };
    }
    if (href === "/prompts") return { key, href, status: status(gate, managedLive), credits: managedUnit };
    if (href === "/generator") {
      return { key, href, status: status(gate, customUnit !== null && customUnit > 0), credits: customUnit };
    }
    // Image tools and the editor's shortcuts: the catalogue /tools reads.
    const slug = item.slug ?? key;
    const entry = catalogue.find((c) => c.slug === slug);
    // An editor shortcut without a catalogue row is the free, local editor.
    const runs = entry ? entry.available : href.startsWith("/tools/editor");
    return { key, href, status: status(gate, runs), credits: entry ? entry.credits : 0 };
  }

  const items: Record<string, ItemState> = {};
  for (const k of referencedItems()) {
    const s = itemState(k);
    // A customer never sees a switched-off item; an admin sees it, marked.
    if (s && (s.status !== "disabled" || isAdmin)) items[k] = s;
  }
  const uploadTools = resolveUploadTools(items);

  /* ── admin card pictures for the tools on the page ──────────────────── */

  const wanted: Record<string, string> = {};
  for (const k of Object.keys(items)) {
    const slot = adminSlotKey(k);
    if (slot) wanted[k] = slot;
  }
  const slots = await loadSlots(supabase, [...Object.values(wanted), ...banners.map((b) => bannerSlotKey(b.key))]);
  // Only the slots an admin actually filled.
  const toolSlots = Object.fromEntries(Object.entries(wanted).filter(([, slot]) => slots.has(slot)));

  /* ── the seller ─────────────────────────────────────────────────────── */

  // Unknown count (read failed) → treated as "not new": the question is
  // skipped rather than asked of someone who may have generated already.
  const generations = generationCount.error ? 1 : (generationCount.count ?? 1);
  const storedChannel = isSellerChannel(profile.seller_channel) ? profile.seller_channel : null;
  const surveyAnswer = (surveyRow.data?.answer ?? null) as string[] | null;
  const surveyChannel = channelFromSurvey(surveyAnswer);
  // Would the welcome-bonus dialog open on this very visit? The layout creates
  // the offer row in parallel with this read, so on a first visit the row may
  // not exist yet — the same predicate the layout uses answers for it.
  const bonusPending = bonusConfig.active && (offer
    ? toView(offer).status === "ELIGIBLE"
    : Boolean(user.email_confirmed_at) && !(campaignStart && user.created_at && user.created_at < campaignStart));
  const askChannel = shouldAskChannel({
    generations, askedAt: profile.seller_channel_asked_at, channel: storedChannel, surveyChannel, bonusPending,
  });

  const interests = (interestRows.data ?? []).map((r) => r.feature_key).filter(isInterestKey);
  // A module that is live (no badge, reachable) is no longer "coming".
  const soon = INTEREST_KEYS.filter((k) => menuBadge(availability, INTEREST_GATES[k]) !== null
    || !routeReachable(availability, INTEREST_GATES[k], false));

  /* ── the no-credits offer ───────────────────────────────────────────── */

  const plan = planRow.data;
  const pro: ProOffer | null = plan ? {
    id: plan.id,
    name: plan.name,
    priceCents: plan.price_cents,
    credits: plan.monthly_credits + plan.bonus_credits,
    currency: plan.currency,
    payable: paymentsEnabled() && Boolean(plan.stripe_price_id_monthly) && sellable(plan, "monthly")
      && !activeSub.error && (activeSub.data ?? []).length === 0,
  } : null;

  return {
    balance: wallet?.balance ?? 0,
    items,
    uploadTools,
    toolSlots,
    channel: storedChannel ?? surveyChannel,
    askChannel,
    interests,
    soon,
    pro,
    banners,
    slots,
    isAdmin,
  };
}
