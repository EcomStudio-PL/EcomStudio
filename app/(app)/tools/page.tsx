import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { toolCatalogue, type ToolAvailability } from "@/lib/server/image-tools";
import { getAvailabilityMap, viewerIsAdmin } from "@/lib/server/feature-availability";
import { CATEGORIES, CATEGORY_PARAM } from "@/lib/categories";
import { ACTIVE_STATE, featureForHref } from "@/lib/features";
import type { HubCardDef, HubSectionDef } from "@/lib/tool-cards";
import { hubSectionsFor, sectionKeyFor } from "@/lib/tool-layout";
import { getToolsLayout } from "@/lib/server/tool-layout";
import { bannerSlotKey, categorySlotKey, toolSlotKey, workflowSlotKey } from "@/lib/media-slots";
import { loadSlots, loadBanners } from "@/lib/server/media-slots";
import { DashboardBanner } from "@/components/dashboard/banner";
import { FeatureGate } from "@/components/feature-gate";
import { ToolsCatalogue } from "@/components/tools/tools-catalogue";
import { ToolsDeepLink } from "@/components/tools/tools-deep-link";
import type { ToolSlug } from "@/lib/images/tools";

export const dynamic = "force-dynamic";

/**
 * WSZYSTKIE NARZĘDZIA — every tool GrovBase has, in one place.
 *
 * Sections of wide thumbnail cards, each headed by its name and a link into
 * the screen that holds the rest. No page title, no hero, no prose: what a
 * seller came for is the catalogue, so the catalogue starts in the fold and
 * as much of it as possible is visible without scrolling.
 *
 * WHAT IS LISTED, WHERE AND IN WHAT ORDER is the catalogue layout
 * (lib/tool-layout.ts — the shipped default, or what an admin arranged in
 * "Narzędzia i silniki → Układ dla klientów"). Sections are keyed by the
 * category slug where they are a category's, so `?category=<slug>` still opens
 * them (see components/tools/tools-deep-link.tsx); a category that is no
 * longer a section of its own (Matching) opens the section that holds it.
 *
 * Everything listed is a real destination. A module the availability
 * switchboard has taken down is either hidden or carries its own badge — the
 * page never offers a card that opens onto nothing, and it never invents a
 * tool to fill a row. A category section answers to the category's own switch
 * as well: a category switched off does not come back because it now lives on
 * a page that is switched on.
 */

export default async function ToolsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const wanted = typeof query[CATEGORY_PARAM] === "string" ? query[CATEGORY_PARAM] : null;

  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");

  const [catalogue, avail, isAdmin, layout] = await Promise.all([
    toolCatalogue(supabase),
    getAvailabilityMap(supabase),
    viewerIsAdmin(supabase),
    getToolsLayout(supabase),
  ]);
  const row = (slug: ToolSlug): ToolAvailability | null =>
    catalogue.find((c) => c.slug === slug) ?? null;
  const editor = row("editor");

  // A card's picture: a catalogue tool's own slot, or — for a category's
  // workflow — the slot it has always had, under its unchanged key; a
  // category that is one card (Matching) wears the category's own card slot.
  const slotKeyOf = (c: HubCardDef): string =>
    c.workflow ? workflowSlotKey(c.workflow.category, c.workflow.key)
      : CATEGORIES.some((k) => k.key === c.key) ? categorySlotKey(c.key)
        : toolSlotKey(c.key);

  // The layout first (which sections, which items, in what order, which are
  // switched off /tools), then the status: a card whose module is switched
  // off for this viewer is not drawn. What is merely restricted stays, with
  // its badge.
  const visible = hubSectionsFor(avail, isAdmin, layout);
  const active = sectionKeyFor(wanted, visible);
  // Old category links that no longer name a section of their own land where
  // that category's tool now lives.
  const aliases = Object.fromEntries(CATEGORIES
    .map((c) => [c.slug, sectionKeyFor(c.slug, visible)] as const)
    .filter((e): e is readonly [string, string] => e[1] !== null && e[1] !== e[0]));

  // The catalogue's own cards and any live banner, in ONE resolve for the
  // whole page — not one per card.
  const banners = await loadBanners(supabase, "tools");
  const slots = await loadSlots(supabase, [
    ...visible.flatMap((s) => s.cards.map(slotKeyOf)),
    ...banners.map((b) => bannerSlotKey(b.key)),
  ]);

  // What an operator wrote on a restricted category's switch. The category's
  // old page showed it on its "Wkrótce" / maintenance screen; that page now
  // forwards here, so the words travel with it — and only when there are any.
  const noteFor = (gates: readonly string[] | undefined): string | null => {
    const key = gates ? featureForHref(gates[gates.length - 1]) : null;
    const state = key ? avail[key] ?? ACTIVE_STATE : null;
    if (!state || (state.status !== "COMING_SOON" && state.status !== "MAINTENANCE")) return null;
    const reopens = state.reopensAt
      ? t(state.status === "COMING_SOON" ? "features.reopens" : "features.backAt", {
          date: new Date(state.reopensAt).toLocaleString(locale, {
            dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw",
          }),
        })
      : null;
    const parts = [state.customTitle, state.customMessage, reopens].filter((p): p is string => Boolean(p));
    return parts.length > 0 ? parts.join(" · ") : null;
  };

  // Only when the category's switch governs every card of the section: one
  // that also holds tools of their own (E-commerce) must not wear a
  // "Wkrótce" note above cards that are live.
  const categoryNote = (s: HubSectionDef): string | null => {
    const gate = s.gates?.[0];
    if (!s.category || !gate || !s.cards.every((c) => c.gates?.includes(gate))) return null;
    return noteFor(s.gates);
  };

  // A shortcut into the editor is only as open as the editor itself.
  const stateFor = (slug: ToolSlug | undefined, href: string): ToolAvailability | null => {
    if (href.startsWith("/tools/editor") && editor && !editor.available) return editor;
    return slug ? row(slug) : null;
  };

  return (
    <FeatureGate feature="tools">
      {/* A campaign above the catalogue, when an admin scheduled one. Nothing
          is reserved for it otherwise. */}
      <div className="mb-5 empty:hidden">
        <DashboardBanner banners={banners} slots={slots} locale={locale} />
      </div>
      <ToolsCatalogue t={t} avail={avail} isAdmin={isAdmin} slots={slots}
        sections={visible.map((s) => ({
          key: s.key, icon: s.icon, title: t(s.titleKey), seeAll: s.seeAll,
          active: s.key === active,
          note: categoryNote(s),
          cards: s.cards.map((c) => ({
            key: c.key, href: c.href, icon: c.icon, motif: c.motif,
            title: t(c.titleKey), body: t(c.bodyKey), soon: c.soon,
            slotKey: slotKeyOf(c),
            gates: c.gates,
            state: stateFor(c.slug, c.href),
          })),
        }))} />
      {/* Reads the same `?category=` on the client, to bring the section into
          view; Suspense because it reads search params. */}
      <Suspense fallback={null}>
        <ToolsDeepLink sections={visible.map((s) => s.key)} aliases={aliases} />
      </Suspense>
    </FeatureGate>
  );
}
