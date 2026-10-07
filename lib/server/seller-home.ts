import "server-only";
import { getCurrentWorkspace, getProfile, type Client } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { getAvailabilityMap, viewerIsAdmin } from "@/lib/server/feature-availability";
import { toolCatalogue } from "@/lib/server/image-tools";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { fashionModel, fashionPrice, fashionToolAvailable } from "@/lib/server/fashion";
import { engineOutputsPerRun, engineToolConfigured } from "@/lib/server/engine/tool-run";
import { RETOUCH_DEFAULT_RESOLUTION, retouchModel, retouchPrice, retouchWorkflowSize } from "@/lib/server/retouch";
import { listGalleryItems, type GalleryItem } from "@/lib/server/gallery";
import { loadBanners, loadSlots, type LiveBanner, type SlotMap } from "@/lib/server/media-slots";
import { bannerSlotKey, toolSlotKey, workflowSlotKey } from "@/lib/media-slots";
import { getBonusConfig, getCampaignStart, readOffer, toView } from "@/lib/server/welcome-bonus";
import { paymentsEnabled } from "@/lib/stripe/config";
import { sellable } from "@/lib/server/stripe-pricing";
import { getToolsLayout } from "@/lib/server/tool-layout";
import { customModels, getUsableModels, toClientModel } from "@/lib/ai/router";
import { menuBadge, menuVisible, routeReachable } from "@/lib/features";
import { catalogItem } from "@/lib/tool-cards";
import { itemBadge, itemReachable } from "@/lib/tool-layout";
import { CATEGORIES, categoryGates, categoryHref, findCategory } from "@/lib/categories";
import { FASHION_TOOLS } from "@/lib/fashion-tools";
import { snapQuality, unitPrice, type GenModel } from "@/components/genv3/types";
import { planPerCreditCents } from "@/components/plan/pricing-model";
import {
  ANCHOR_PLAN_SLUG, HERO_TASKS, INTEREST_GATES, INTEREST_KEYS, RECENT_MAX, TOOL_GROUPS,
  isInterestKey, isSellerChannel, type InterestKey, type MediaSrc, type SellerChannel,
} from "@/lib/seller-home-config";
import {
  channelFromSurvey, recentCards, recentRoute, resolveHeroTasks, shouldAskChannel,
  type ItemState, type ResolvedTask,
} from "@/lib/seller-home-model";

/**
 * THE SIGNED-IN START (/home) — every fact the page shows, in one batch.
 *
 * Nothing here decides a price or an availability of its own: each tool is
 * asked through the SAME helper its own screen uses —
 *   managed presets / Grovshot / Własny prompt → conceptModelOptions + unitPrice
 *     (the generator workspace's default model, size and quality)
 *   image tools (Białe tło, Tło AI, Cień AI, …) → toolCatalogue()
 *   Retusz → retouchModel + retouchPrice at its default size (read only —
 *     nothing of Retusz runs from here)
 *   Moda tools → fashionModel + fashionToolAvailable
 * and every item first passes the switchboard (itemReachable + its badge), so a
 * module an operator switched off or marked "Wkrótce" is never offered as
 * live here.
 *
 * Reads only. The page that renders this writes nothing; the two writes /home
 * can make (seller channel, "Powiadom mnie") are server actions in
 * app/actions/seller-home.ts.
 */

export type ToolCardState = ItemState & {
  nameKey: string;
  descKey: string;
  /** Picture from config, else an admin-filled media slot of the same tool. */
  media: MediaSrc;
  slotKey: string | null;
  /** Listed to an admin although customers do not see it. */
  adminOnly: boolean;
};

export type RecentCard = {
  id: string;
  thumbUrl: string;
  createdAt: string;
  href: string;
  labelKey: string;
  /** "Powtórz z nowym produktem" only when that tool runs right now. */
  repeat: boolean;
};

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
  tasks: ResolvedTask[];
  tools: { key: string; titleKey: string; tools: ToolCardState[] }[];
  recent: RecentCard[];
  generations: number;
  channel: SellerChannel | null;
  askChannel: boolean;
  interests: InterestKey[];
  /** "Nadchodzi" chips: only modules that are not live yet. */
  soon: InterestKey[];
  /** Grosze per credit on the anchor plan; null when the row is missing. */
  centsPerCredit: number | null;
  currency: string;
  pro: ProOffer | null;
  banners: LiveBanner[];
  slots: SlotMap;
  isAdmin: boolean;
  bonusPending: boolean;
};

const PRESS_SHOTS_DEFAULT = 5;

function emptyData(): SellerHomeData {
  return {
    balance: 0, tasks: resolveHeroTasks({}), tools: [], recent: [], generations: 0, channel: null,
    askChannel: false, interests: [], soon: [], centsPerCredit: null, currency: "PLN", pro: null,
    banners: [], slots: new Map(), isAdmin: false, bonusPending: false,
  };
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
    retouch, retouchConfigured, retouchOutputs, fashion, fashionAvail, planRow, activeSub, gallery,
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
      .eq("slug", ANCHOR_PLAN_SLUG).eq("active", true).maybeSingle(),
    // The same "already subscribed" read /plan makes.
    supabase.from("subscriptions").select("id").eq("workspace_id", workspace.id).eq("status", "active").limit(1),
    // The Library's own projection (thumb derivatives, prompt-safe columns).
    listGalleryItems(supabase, workspace.id, { limit: 24, assetType: "image" }),
    // "New seller" = no generation at all in this workspace — counted, not
    // inferred from a page of thumbnails.
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
    // is not offered in the tools grid here either.
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

  const ecommerce = findCategory("ecommerce");
  const shotsOf = (wf: string) => ecommerce?.workflows.find((w) => w.key === wf)?.shots ?? PRESS_SHOTS_DEFAULT;

  function itemState(key: string): ItemState | null {
    if (key.startsWith("cat:")) {
      const cat = CATEGORIES.find((c) => c.key === key.slice(4));
      if (!cat) return null;
      const gates = categoryGates(cat);
      const open = menuVisible(availability, gates, isAdmin) && !cat.soon
        && menuBadge(availability, gates) === null;
      const anyTool = cat.key === "moda"
        ? Boolean(fashion) && FASHION_TOOLS.some((f) => fashionOn.get(f.key))
        : true;
      return { key, href: categoryHref(cat), available: open && anyTool, credits: null, shots: null };
    }
    const item = catalogItem(key);
    if (!item) return null;
    // The same "may this viewer see it" /tools asks (itemReachable), plus no
    // badge: a "Wkrótce" or maintenance item is never offered as live here.
    const open = itemReachable(availability, item, isAdmin) && itemBadge(availability, item) === null;
    const href = item.href;
    if (href === "/retusz") {
      return { key, href, available: open && Boolean(retouch) && retouchConfigured, credits: retouchCredits, shots: 1 };
    }
    if (href.startsWith("/k/moda/")) {
      const wf = href.slice("/k/moda/".length);
      return {
        key, href, available: open && Boolean(fashion) && Boolean(fashionOn.get(wf)),
        credits: times(fashionUnit, fashionRuns.get(wf) ?? 1), shots: null,
      };
    }
    if (href.startsWith("/k/")) {
      const wf = href.split("/")[3] ?? "";
      return { key, href, available: open && managedLive, credits: managedUnit, shots: shotsOf(wf) };
    }
    if (href === "/prompts") {
      return { key, href, available: open && managedLive, credits: managedUnit, shots: PRESS_SHOTS_DEFAULT };
    }
    if (href === "/generator") {
      return { key, href, available: open && customUnit !== null && customUnit > 0, credits: customUnit, shots: 1 };
    }
    // Image tools and the editor's shortcuts: the catalogue /tools reads.
    const slug = item.slug ?? key;
    const entry = catalogue.find((c) => c.slug === slug);
    return { key, href, available: open && Boolean(entry?.available), credits: entry ? entry.credits : null, shots: null };
  }

  const keys = new Set<string>();
  for (const t of HERO_TASKS) {
    t.items.forEach((k) => keys.add(k));
    t.replaceWith?.items.forEach((k) => keys.add(k));
  }
  for (const g of TOOL_GROUPS) g.tools.forEach((t) => keys.add(t.item));
  const states: Record<string, ItemState> = {};
  for (const k of keys) {
    const s = itemState(k);
    if (s) states[k] = s;
  }
  const tasks = resolveHeroTasks(states);

  /** Can "Powtórz" open its tool live right now? The item's own state where
   *  the page already knows it, else the route's switch (open, no badge). */
  const repeatable = (href: string): boolean => {
    const known = Object.values(states).find((st) => st.href === href);
    if (known) return known.available;
    return routeReachable(availability, href, false) && menuBadge(availability, href) === null;
  };

  /* ── the tools grid ─────────────────────────────────────────────────── */

  const slotKeyFor = (k: string): string | null => {
    if (k.startsWith("cat:")) return null;
    const [cat, wf] = k.split(".");
    if (wf && findCategory(cat)) return workflowSlotKey(cat, wf);
    return toolSlotKey(k);
  };
  const tools = TOOL_GROUPS.map((g) => ({
    key: g.key,
    titleKey: g.titleKey,
    tools: g.tools.flatMap((t): ToolCardState[] => {
      const s = states[t.item];
      if (!s) return [];
      // Taken off /tools by the layout switchboard → not here either.
      if (!t.item.startsWith("cat:") && layout.flags[t.item]?.tools === false) return [];
      // A customer sees only what runs; an admin sees the rest, marked.
      if (!s.available && !isAdmin) return [];
      return [{
        ...s, nameKey: t.nameKey, descKey: t.descKey,
        media: t.media, slotKey: slotKeyFor(t.item),
        adminOnly: !s.available,
      }];
    }),
  })).filter((g) => g.tools.length > 0);

  /* ── the seller ─────────────────────────────────────────────────────── */

  const items: GalleryItem[] = gallery.items;
  const recent: RecentCard[] = recentCards(items, RECENT_MAX).map((i) => {
    const route = recentRoute(i);
    return {
      id: i.generationId, thumbUrl: i.thumbUrl, createdAt: i.createdAt, href: route.href, labelKey: route.labelKey,
      repeat: repeatable(route.href),
    };
  });
  // Unknown count (read failed) → treated as "not new": the question is
  // skipped rather than asked of someone who may have generated already.
  const counted = generationCount.error ? null : generationCount.count;
  const generations = counted ?? Math.max(items.length, 1);

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
  // A module that is live (no badge at all) is no longer "coming".
  const soon = INTEREST_KEYS.filter((k) => menuBadge(availability, INTEREST_GATES[k]) !== null);

  /* ── money ──────────────────────────────────────────────────────────── */

  const plan = planRow.data;
  const centsPerCredit = plan
    ? planPerCreditCents({
        priceCents: plan.price_cents, annualPriceCents: 0,
        monthlyCredits: plan.monthly_credits, bonusCredits: plan.bonus_credits,
      }, "monthly")
    : null;
  const pro: ProOffer | null = plan ? {
    id: plan.id,
    name: plan.name,
    priceCents: plan.price_cents,
    credits: plan.monthly_credits + (plan.bonus_credits),
    currency: plan.currency,
    payable: paymentsEnabled() && Boolean(plan.stripe_price_id_monthly) && sellable(plan, "monthly")
      && !activeSub.error && (activeSub.data ?? []).length === 0,
  } : null;

  const slotKeys = [
    ...tools.flatMap((g) => g.tools.map((t) => t.slotKey).filter((k): k is string => Boolean(k))),
    ...banners.map((b) => bannerSlotKey(b.key)),
  ];
  const slots = await loadSlots(supabase, slotKeys);

  return {
    balance: wallet?.balance ?? 0,
    tasks,
    tools,
    recent,
    generations,
    channel: storedChannel ?? surveyChannel,
    askChannel,
    interests,
    soon,
    centsPerCredit,
    currency: plan?.currency ?? "PLN",
    pro,
    banners,
    slots,
    isAdmin,
    bonusPending,
  };
}
