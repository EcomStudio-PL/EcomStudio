import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { toolCatalogue, type ToolAvailability } from "@/lib/server/image-tools";
import { getAvailabilityMap, viewerIsAdmin } from "@/lib/server/feature-availability";
import { menuVisible } from "@/lib/features";
import { TOOL_SECTIONS } from "@/lib/tool-cards";
import { bannerSlotKey, toolSlotKey } from "@/lib/media-slots";
import { loadSlots, loadBanners } from "@/lib/server/media-slots";
import { DashboardBanner } from "@/components/dashboard/banner";
import { FeatureGate } from "@/components/feature-gate";
import { ToolsCatalogue } from "@/components/tools/tools-catalogue";
import type { ToolSlug } from "@/lib/images/tools";

export const dynamic = "force-dynamic";

/**
 * WSZYSTKIE NARZĘDZIA — the catalogue.
 *
 * Sections of wide thumbnail cards, each headed by its name and a link into
 * the screen that holds the rest. No page title, no hero, no prose: what a
 * seller came for is the catalogue, so the catalogue starts in the fold and
 * as much of it as possible is visible without scrolling.
 *
 * Everything listed is a real destination. A module the availability
 * switchboard has taken down is either hidden or carries its own badge — the
 * page never offers a card that opens onto nothing, and it never invents a
 * tool to fill a row.
 */

export default async function ToolsPage() {
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

  // The catalogue's own cards and any live banner, in ONE resolve for the
  // whole page — not one per card.
  const banners = await loadBanners(supabase, "tools");
  const slots = await loadSlots(supabase, [
    ...TOOL_SECTIONS.flatMap((s) =>
      s.cards.filter((c) => !c.category).map((c) => toolSlotKey(c.key))),
    ...banners.map((b) => bannerSlotKey(b.key)),
  ]);

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
        sections={TOOL_SECTIONS.map((s) => ({
          key: s.key, icon: s.icon, title: t(s.titleKey), seeAll: s.seeAll,
          // A module the switchboard hid for this viewer leaves the catalogue
          // entirely; one that is merely restricted stays, with its badge.
          cards: s.cards
            .filter((c) => menuVisible(avail, c.href, isAdmin))
            .map((c) => ({
              key: c.key, href: c.href, icon: c.icon, motif: c.motif,
              title: t(c.titleKey), body: t(c.bodyKey), soon: c.soon,
              // A category entry point shows the category's own picture, set
              // on the Kategorie tab; it has no second slot of its own.
              slotKey: c.category ? null : toolSlotKey(c.key),
              state: stateFor(c.slug, c.href),
            })),
        }))} />
    </FeatureGate>
  );
}
