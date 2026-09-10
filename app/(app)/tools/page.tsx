import { redirect } from "next/navigation";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight, Boxes, Contrast, Crop, Gauge, Lightbulb, Mail, Maximize2, Megaphone,
  PencilRuler, Scaling, Scissors, Shirt, ShoppingBag, SlidersHorizontal, Sparkles,
  Square, Stamp, Sun, Video, WandSparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { toolCatalogue, type ToolAvailability } from "@/lib/server/image-tools";
import { getAvailabilityMap, viewerIsAdmin } from "@/lib/server/feature-availability";
import { menuVisible } from "@/lib/features";
import { VIDEO_CREATE_WF } from "@/lib/categories";
import { FeatureGate } from "@/components/feature-gate";
import type { ToolMotif } from "@/components/tools/tool-thumb";
import {
  ToolsCatalogue, type CatalogueCard, type CatalogueSection,
} from "@/components/tools/tools-catalogue";
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

/** A card before the tool catalogue's verdict is attached to it. */
type Card = Omit<CatalogueCard, "state"> & {
  /** The catalogue row that prices it and says whether it can run. Places
   *  (the editor, a category workspace) have none. */
  slug?: ToolSlug | null;
};
type Section = Omit<CatalogueSection, "cards"> & { cards: Card[] };

export default async function ToolsPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
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

  const sections: Section[] = [
    {
      key: "edit", icon: PencilRuler, title: t("hub.sec.edit"), seeAll: "/tools/editor",
      cards: [
        { key: "retouch", href: "/retusz", icon: WandSparkles, motif: "wipe",
          title: t("tools.retouch.name"), body: t("tools.retouch.body") },
        { key: "remove_bg", href: "/tools/editor?tool=remove-background", icon: Scissors, motif: "cutout",
          title: t("tools.remove_bg.name"), body: t("hub.card.remove_bg"), slug: "remove_bg" },
        { key: "white_bg", href: "/tools/editor?tool=white-background", icon: Square, motif: "frame",
          title: t("tools.white_bg.name"), body: t("hub.card.white_bg") },
        { key: "background", href: "/tools/editor?tool=background", icon: Sparkles, motif: "spark",
          title: t("editor.bg.color"), body: t("hub.card.background") },
        { key: "shadow", href: "/tools/editor?tool=shadow", icon: Sun, motif: "shadow",
          title: t("tools.shadow.name"), body: t("hub.card.shadow") },
        { key: "adjust", href: "/tools/editor?tool=adjust", icon: Contrast, motif: "swatch",
          title: t("editor.s.adjust"), body: t("hub.card.adjust") },
      ],
    },
    {
      key: "create", icon: Sparkles, title: t("hub.sec.create"), seeAll: "/prompts",
      cards: [
        { key: "generator", href: "/prompts", icon: Sparkles, motif: "spark",
          title: t("mega.createImage"), body: t("hub.card.generator") },
        { key: "moda", href: "/k/moda", icon: Shirt, motif: "grid",
          title: t("cats.moda"), body: t("cats.modaSub") },
        { key: "ecommerce", href: "/k/ecommerce", icon: ShoppingBag, motif: "cutout",
          title: t("cats.ecommerce"), body: t("cats.ecommerceSub") },
        { key: "social", href: "/k/social", icon: Megaphone, motif: "wipe",
          title: t("cats.social"), body: t("cats.socialSub") },
        { key: "mailing", href: "/k/mailing", icon: Mail, motif: "frame",
          title: t("cats.mailing"), body: t("cats.mailingSub") },
        { key: "inne", href: "/k/inne", icon: Boxes, motif: "swatch",
          title: t("cats.inne"), body: t("cats.inneSub") },
      ],
    },
    {
      key: "prepare", icon: Scaling, title: t("hub.sec.prepare"),
      cards: [
        { key: "resize", href: "/tools/resize", icon: Scaling, motif: "scale",
          title: t("resize.title"), body: t("resize.sub"), slug: "format" },
        { key: "compress", href: "/tools/compress", icon: Gauge, motif: "compress",
          title: t("compress.title"), body: t("compress.sub"), slug: "compress" },
        { key: "upscale", href: "/tools/upscale", icon: Maximize2, motif: "scale",
          title: t("tools.upscale.name"), body: t("tools.upscale.body"), slug: "upscale" },
        { key: "expand", href: "/tools/expand", icon: Crop, motif: "frame",
          title: t("tools.expand.name"), body: t("tools.expand.body"), slug: "expand" },
        { key: "watermark", href: "/tools/watermark", icon: Stamp, motif: "stamp",
          title: t("tools.watermark.name"), body: t("tools.watermark.body"), slug: "watermark" },
        { key: "editor", href: "/tools/editor", icon: SlidersHorizontal, motif: "swatch",
          title: t("nav.editor"), body: t("hub.card.editor") },
      ],
    },
    {
      key: "video", icon: Video, title: t("hub.sec.video"), seeAll: "/wideo",
      // No video backend exists. Every card says so and none of them opens —
      // the architecture is in place, the promise is not faked.
      cards: VIDEO_CREATE_WF.map((w) => ({
        key: w.key, href: "/wideo", icon: w.icon, motif: "video" as ToolMotif,
        title: t(`video.wf.${w.key}.name`), body: t(`video.wf.${w.key}.sub`), soon: true,
      })),
    },
  ];

  // A shortcut into the editor is only as open as the editor itself.
  const stateFor = (slug: ToolSlug | null | undefined, href: string): ToolAvailability | null => {
    if (href.startsWith("/tools/editor") && editor && !editor.available) return editor;
    return slug ? row(slug) : null;
  };

  return (
    <FeatureGate feature="tools">
      <ToolsCatalogue t={t} avail={avail} isAdmin={isAdmin} sections={sections.map((s) => ({
        ...s,
        // A module the switchboard hid for this viewer leaves the catalogue
        // entirely; one that is merely restricted stays, with its badge.
        cards: s.cards
          .filter((c) => menuVisible(avail, c.href, isAdmin))
          .map(({ slug, ...card }) => ({ ...card, state: stateFor(slug, card.href) })),
      }))} />
    </FeatureGate>
  );
}
