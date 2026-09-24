import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { toolCatalogue, type ToolAvailability } from "@/lib/server/image-tools";
import { getAvailabilityMap, viewerIsAdmin } from "@/lib/server/feature-availability";
import { CATEGORY_PARAM } from "@/lib/categories";
import { ACTIVE_STATE, featureForHref } from "@/lib/features";
import { hubSectionsFor, type HubCardDef } from "@/lib/tool-cards";
import { bannerSlotKey, toolSlotKey, workflowSlotKey } from "@/lib/media-slots";
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
 * THE CATEGORIES ARE SECTIONS HERE. Moda, E-commerce, Social Media and the rest
 * used to be pages of their own; each is now a section of this one, holding
 * the workflows it offers, and `?category=<slug>` opens it (see
 * components/tools/tools-deep-link.tsx). The menu's category links point here,
 * and the old /k/<slug> pages forward here.
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

  const [catalogue, avail, isAdmin] = await Promise.all([
    toolCatalogue(supabase),
    getAvailabilityMap(supabase),
    viewerIsAdmin(supabase),
  ]);
  const row = (slug: ToolSlug): ToolAvailability | null =>
    catalogue.find((c) => c.slug === slug) ?? null;
  const editor = row("editor");

  // A card's picture: a catalogue tool's own slot, or — for a category's
  // workflow — the slot it has always had, under its unchanged key.
  const slotKeyOf = (c: HubCardDef): string =>
    c.workflow ? workflowSlotKey(c.workflow.category, c.workflow.key) : toolSlotKey(c.key);

  // Availability first: a section whose category is switched off for this
  // viewer is not drawn, and neither is a card whose own switch is. What is
  // merely restricted stays, with its badge.
  const visible = hubSectionsFor(avail, isAdmin, wanted);

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
          active: s.key === wanted,
          note: s.category ? noteFor(s.gates) : null,
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
        <ToolsDeepLink sections={visible.map((s) => s.key)} />
      </Suspense>
    </FeatureGate>
  );
}
