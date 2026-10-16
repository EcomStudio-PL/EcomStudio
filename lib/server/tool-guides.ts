import "server-only";
import type { Client } from "@/lib/services/workspace";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { lookup } from "@/lib/i18n/t";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import { loadSlots, type ResolvedSlot, type SlotMap } from "@/lib/server/media-slots";
import { getAvailabilityMap } from "@/lib/server/feature-availability";
import { toolCatalogue } from "@/lib/server/image-tools";
import { retouchModel } from "@/lib/server/retouch";
import { engineToolConfigured } from "@/lib/server/engine/tool-run";
import { readThumbnailState } from "@/lib/server/thumbnail/settings";
import { fashionModel, fashionToolAvailable } from "@/lib/server/fashion";
import { publishedGuide, type PublishedGuide } from "@/lib/server/tool-guides-published";

export { TOOL_GUIDES_TAG } from "@/lib/server/tool-guides-published";
import {
  DEFAULT_STEP_ARTS, guideSlotKey, isGuideArt, photoSlugOf,
  type GuideContent, type GuideImage, type GuideToolKey, type LocaleText, type ResolvedGuide,
} from "@/lib/tool-guides";
import { STARTER_FALLBACK_SLOTS, guideImageKeys } from "@/lib/tool-guide-slots";

/**
 * TOOL GUIDES, SERVER SIDE — what a customer's screen is sent, and whether the
 * tool is live for them. Presentation only: no model, provider, price or
 * credit is read or touched here beyond the availability checks every tool
 * page already makes.
 */

type Dict = Record<string, unknown>;
const SHIPPED: Record<Locale, Dict> = { pl: pl as Dict, en: en as Dict, de: de as Dict };

/* ── THE SHIPPED DEFAULT ───────────────────────────────────────────────── */

function shipped(locale: Locale, key: string): string {
  const v = lookup(SHIPPED[locale], key) ?? lookup(SHIPPED.pl, key);
  return typeof v === "string" ? v : "";
}

function perLocale(key: string): LocaleText {
  return Object.fromEntries(LOCALES.map((l) => [l, shipped(l, key)])) as LocaleText;
}

/** The tutorial and starter copy a tool ships with, in every language, from
 *  `toolGuideDefaults.<tool>` — what the admin form starts from and what a
 *  customer sees until an admin saves something else. */
export function defaultGuideContent(tool: GuideToolKey): GuideContent {
  const base = `toolGuideDefaults.${tool}`;
  return {
    tutorial: {
      title: perLocale(`${base}.tutorial.title`),
      body: perLocale(`${base}.tutorial.body`),
      steps: DEFAULT_STEP_ARTS[tool].map((art, i) => ({
        title: perLocale(`${base}.tutorial.steps.s${i + 1}.title`),
        body: perLocale(`${base}.tutorial.steps.s${i + 1}.body`),
        art,
      })),
    },
    starter: {
      title: perLocale(`${base}.starter.title`),
      body: perLocale(`${base}.starter.body`),
    },
  };
}

/* ── RESOLVING ONE TOOL'S GUIDE FOR ONE LANGUAGE ───────────────────────── */

/** The admin's text in this language, else their Polish, else the shipped
 *  text in this language. */
function pick(saved: LocaleText | undefined, fallback: LocaleText, locale: Locale): string {
  return saved?.[locale]?.trim() || saved?.pl?.trim() || fallback[locale] || fallback.pl || "";
}

function imageOf(slot: ResolvedSlot | undefined, locale: Locale): GuideImage | null {
  if (!slot || slot.mediaType !== "image" || !slot.desktop) return null;
  const variants = Object.entries(slot.variants ?? {})
    .map(([w, url]) => [Number(w), url] as const)
    .filter(([w, url]) => Number.isFinite(w) && w > 0 && typeof url === "string")
    .sort((a, b) => a[0] - b[0]);
  return {
    url: slot.desktop,
    srcSet: variants.length ? variants.map(([w, url]) => `${url} ${w}w`).join(", ") : undefined,
    width: slot.desktopWidth,
    height: slot.desktopHeight,
    alt: slot.altI18n?.[locale] ?? slot.alt ?? "",
  };
}

/**
 * The guide as the customer's screen receives it: one language, pictures as
 * public URLs, a part that is switched off is null. No row means the shipped
 * default with both parts on.
 */
export function resolveGuide(tool: GuideToolKey, locale: Locale, saved: PublishedGuide | null, slots: SlotMap): ResolvedGuide {
  const def = defaultGuideContent(tool);
  const tutorialOn = saved ? saved.tutorialEnabled : true;
  const starterOn = saved ? saved.starterEnabled : true;
  const tut = saved?.tutorial ?? null;
  const steps = tut && Array.isArray(tut.steps) && tut.steps.length > 0 ? tut.steps : null;
  const starterImage = imageOf(slots.get(guideSlotKey(tool, "starter", 1)), locale)
    ?? STARTER_FALLBACK_SLOTS[tool].map((k) => imageOf(slots.get(k), locale)).find(Boolean) ?? null;

  return {
    tool,
    version: saved?.version ?? 1,
    tutorial: tutorialOn ? {
      title: pick(tut?.title, def.tutorial.title, locale),
      // Once the admin wrote the tutorial, an intro they left empty stays
      // empty — the shipped one would not describe their steps.
      body: pick(tut?.body, tut ? {} : def.tutorial.body, locale),
      steps: (steps ?? def.tutorial.steps).map((s, i) => {
        // The admin's steps are their own: their copy falls back to their
        // Polish, never to the shipped step that happened to sit at the same
        // position (they may have reordered or rewritten them). Only a title
        // can never be blank — the shipped one stands in as a last resort.
        const shippedStep = def.tutorial.steps[Math.min(i, def.tutorial.steps.length - 1)];
        const fallback = steps ? { title: {}, body: {} } : shippedStep;
        return {
          title: pick(s.title, fallback.title, locale) || pick(undefined, shippedStep.title, locale),
          body: pick(s.body, fallback.body, locale),
          art: isGuideArt(s.art) ? s.art : shippedStep.art,
          image: imageOf(slots.get(guideSlotKey(tool, "tutorial", i + 1)), locale),
        };
      }),
    } : null,
    starter: starterOn ? {
      title: pick(saved?.starter?.title, def.starter.title, locale),
      body: pick(saved?.starter?.body, saved?.starter ? {} : def.starter.body, locale),
      image: starterImage,
    } : null,
  };
}

/** One tool's guide for one language: the published row and its pictures. */
export async function loadGuide(supabase: Client, tool: GuideToolKey, locale: Locale): Promise<ResolvedGuide> {
  const [saved, slots] = await Promise.all([publishedGuide(tool), loadSlots(supabase, guideImageKeys(tool))]);
  return resolveGuide(tool, locale, saved, slots);
}

/* ── IS THE TOOL LIVE FOR THIS VIEWER? ─────────────────────────────────── */

/**
 * ACTIVE in the availability switchboard AND able to run — the same checks
 * the tool's own page makes, so a tool that shows "Wkrótce", maintenance or
 * "niedostępne" never opens a tutorial by itself or shows example effects.
 * Any failure reads as "not live": the cautious answer.
 */
export async function toolIsLive(supabase: Client, tool: GuideToolKey, opts: { admin: boolean }): Promise<boolean> {
  try {
    const availability = await getAvailabilityMap(supabase);
    if (availability[tool]?.status !== "ACTIVE") return false;
    switch (tool) {
      case "prompts": {
        // The managed generator needs a planner engine with a stored key —
        // exactly the page's own `engineAvailable`.
        const [{ data: planners }, { data: withKey }] = await Promise.all([
          supabase.from("ai_providers").select("id").eq("active", true).in("slug", ["openai", "google"]),
          supabase.rpc("providers_with_credentials"),
        ]);
        const keyed = new Set((withKey ?? []) as string[]);
        return (planners ?? []).some((p) => keyed.has(p.id));
      }
      case "generator":
        // The gallery is only mounted when a usable model exists.
        return true;
      case "retouch": {
        const [model, configured] = await Promise.all([retouchModel(supabase), engineToolConfigured(supabase, "retouch", false)]);
        return Boolean(model) && configured;
      }
      case "ecommerce_thumbnail":
        return (await readThumbnailState(supabase)).ready;
      case "resize":
      case "compress":
        // Local tools: nothing to be unavailable.
        return true;
      case "tool_remove_bg":
      case "tool_white_bg":
      case "tool_ai_background":
      case "tool_ai_shadow": {
        const entry = (await toolCatalogue(supabase, { admin: opts.admin })).find((c) => c.slug === photoSlugOf(tool));
        return Boolean(entry?.available);
      }
      default: {
        // Moda.
        const [model, configured] = await Promise.all([fashionModel(supabase), fashionToolAvailable(supabase, tool)]);
        return Boolean(model) && configured;
      }
    }
  } catch {
    return false;
  }
}
