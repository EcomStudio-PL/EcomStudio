import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { CATEGORIES } from "@/lib/categories";
import { MEDIA_SLOTS, bannerSlotKey, type SlotDef, type SlotEntity } from "@/lib/media-slots";
import { TOOL_SECTIONS } from "@/lib/tool-cards";
import {
  listBanners, listConfiguredSlots, listLibrary, usageCounts, type SlotRow,
} from "@/lib/services/media-slots";
import { PageHeader } from "@/components/ui/page-header";
import { MediaManager } from "@/components/admin/media-manager";
import { SlotsPanel, type SlotGroupView } from "@/components/admin/media/slots-panel";
import { BannerEditor } from "@/components/admin/media/banner-editor";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * MEDIA — ONE SCREEN FOR EVERY PICTURE IN GROVBASE.
 *
 * Five tabs over ONE library. "Biblioteka" is the pool of files; the other
 * four are places those files can go — the dashboard's category tiles, the
 * tools, the application's own sections, and the banners. Nothing here holds
 * its own private uploader or its own private list of images: a file uploaded
 * from a banner is in the library a second later, and a file in the library can
 * be put in any slot without being copied.
 *
 * WHAT IS NOT HERE: a list of slots typed by hand. The categories come from
 * lib/categories.ts and the tools from FEATURE_REGISTRY — the same registries
 * the product runs on — so this screen cannot drift out of step with what
 * GrovBase actually ships.
 */

const TABS = ["biblioteka", "kategorie", "narzedzia", "sekcje", "bannery"] as const;
type Tab = (typeof TABS)[number];

export default async function AdminMedia({ searchParams }: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as Tab) : "biblioteka";

  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  // ONE read of the library and ONE of the configured slots, shared by every
  // tab. The picker inside each editor works off this same array.
  const [library, configured, banners] = await Promise.all([
    listLibrary(supabase),
    listConfiguredSlots(supabase),
    listBanners(supabase),
  ]);

  const filled = [...configured.values()].filter((r) => r.mediaId && r.enabled).length;

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.marketing")}
        title={t("media.title")}
        sub={t("media.sub")}
      />

      <nav aria-label={t("media.title")}
        className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((key) => (
          <Link key={key} href={`/admin/media?tab=${key}`} scroll={false}
            aria-current={key === tab ? "page" : undefined} data-media-tab={key}
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-[13px] font-semibold transition-colors",
              key === tab ? "bg-raised text-ink" : "text-muted hover:text-ink",
            )}>
            {t(`media.tab.${key}`)}
          </Link>
        ))}
      </nav>

      {tab !== "biblioteka" && (
        <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
          {t("media.slotsIntro", { filled, total: MEDIA_SLOTS.length })}
        </p>
      )}

      {tab === "biblioteka" && <LibraryTab supabase={supabase} library={library} />}

      {tab === "kategorie" && (
        <SlotsPanel library={library} emptyLabel={t("media.noSlots")}
          groups={categoryGroups(configured, t)} />
      )}

      {tab === "narzedzia" && (
        <SlotsPanel library={library} emptyLabel={t("media.noSlots")}
          groups={toolGroups(configured, t)} />
      )}

      {tab === "sekcje" && (
        <SlotsPanel library={library} emptyLabel={t("media.noSlots")}
          groups={sectionGroups(configured, t)} />
      )}

      {tab === "bannery" && (
        <BannerEditor banners={banners} library={library}
          slotRows={Object.fromEntries(banners.map((b) => [
            bannerSlotKey(b.bannerKey), configured.get(bannerSlotKey(b.bannerKey)) ?? null,
          ]))} />
      )}
    </div>
  );
}

/* ── BIBLIOTEKA ──────────────────────────────────────────────────────────── */

/** The existing media manager, now told which files are spoken for. The extra
 *  query is one round trip for the whole page, not one per tile. */
async function LibraryTab({ supabase, library }: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  library: Awaited<ReturnType<typeof listLibrary>>;
}) {
  const { data } = await supabase.from("media_assets").select("*")
    .order("created_at", { ascending: false }).limit(300);
  const assets = (data ?? []).map((a) => ({
    ...a,
    publicUrl: a.storage_path
      ? supabase.storage.from("media").getPublicUrl(a.storage_path).data.publicUrl : null,
  }));
  const counts = await usageCounts(supabase, assets.map((a) => a.id));
  return (
    <MediaManager assets={assets} library={library}
      usage={Object.fromEntries(counts)} />
  );
}

/* ── GROUPING ────────────────────────────────────────────────────────────── */

type T = (key: string, values?: Record<string, string | number>) => string;

/** The slots of one entity, in declaration order, with whatever is configured
 *  merged in. A slot with no row is not missing — it is using its fallback. */
function slotsOf(
  configured: Map<string, SlotRow>, entityType: SlotEntity, entityId: string,
): { def: SlotDef; row: SlotRow | null }[] {
  return MEDIA_SLOTS
    .filter((d) => d.entityType === entityType && d.entityId === entityId)
    .map((def) => ({ def, row: configured.get(def.key) ?? null }));
}

/**
 * KATEGORIE — the six dashboard tiles and their workspaces, each followed by
 * the workflows it offers. One group per thing an operator thinks of as a
 * thing, which is a category, not a slot.
 */
function categoryGroups(configured: Map<string, SlotRow>, t: T): SlotGroupView[] {
  const groups: SlotGroupView[] = [];
  for (const c of CATEGORIES) {
    groups.push({
      id: c.key, name: t(`cats.${c.key}`), sub: `/k/${c.slug}`,
      slots: slotsOf(configured, "category", c.key),
    });
    for (const def of MEDIA_SLOTS.filter((d) => d.entityType === "workflow"
      && d.entityId.startsWith(`${c.key}.`))) {
      const wf = def.entityId.slice(c.key.length + 1);
      groups.push({
        id: def.entityId,
        name: t(`wf.${c.key}.${wf}.name`),
        sub: t(`cats.${c.key}`),
        slots: slotsOf(configured, "workflow", def.entityId),
      });
    }
  }
  return groups;
}

/**
 * NARZĘDZIA — the catalogue's own cards, in the catalogue's own order and
 * under the catalogue's own names. Not a second list: lib/tool-cards.ts is
 * what /tools renders from, and what this screen enumerates.
 */
function toolGroups(configured: Map<string, SlotRow>, t: T): SlotGroupView[] {
  const groups: SlotGroupView[] = [];
  for (const section of TOOL_SECTIONS) {
    for (const card of section.cards) {
      const slots = slotsOf(configured, "tool", card.key);
      // A category entry point has no tool slot of its own; its picture is on
      // the Kategorie tab.
      if (slots.length === 0) continue;
      groups.push({
        id: card.key, name: t(card.titleKey), sub: t(section.titleKey), slots,
      });
    }
  }
  return groups;
}

/** SEKCJE APLIKACJI — the named places that belong to no single tool. */
function sectionGroups(configured: Map<string, SlotRow>, t: T): SlotGroupView[] {
  const ids = [...new Set(MEDIA_SLOTS.filter((d) => d.entityType === "section")
    .map((d) => d.entityId))];
  return ids.map((id) => ({
    id, name: t(`media.section.${id}`),
    slots: slotsOf(configured, "section", id),
  }));
}
