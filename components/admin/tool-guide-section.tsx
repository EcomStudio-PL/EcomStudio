import { BookOpen } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import type { Client } from "@/lib/services/workspace";
import { listLibrary, type LibraryItem } from "@/lib/services/media-slots";
import { readGuideRow, readGuideSlots } from "@/lib/services/tool-guides";
import { defaultGuideContent } from "@/lib/server/tool-guides";
import { loadSlots } from "@/lib/server/media-slots";
import {
  GUIDE_MAX_STEPS, guideSlotKey, normalizeGuideContent,
  type GuideImage, type GuideToolKey,
} from "@/lib/tool-guides";
import { STARTER_FALLBACK_SLOTS } from "@/lib/tool-guide-slots";
import { ToolGuideEditor } from "./tool-guide-editor";

/**
 * "SAMOUCZEK I GALERIA STARTOWA" on a tool's Podstawowe tab.
 *
 * The server half: every read the editor needs, made once here with the
 * admin's own client (RLS decides), and handed down as plain data. The editor
 * itself never reads the database — it only calls saveToolGuideAction.
 *
 * Presentation only, like the feature it edits: nothing read or written here
 * reaches a model, a provider, a price or the ledger.
 */
export async function ToolGuideSection({ tool, supabase }: { tool: GuideToolKey; supabase: Client }) {
  const stepKeys = Array.from({ length: GUIDE_MAX_STEPS }, (_, i) => guideSlotKey(tool, "tutorial", i + 1));
  const starterKey = guideSlotKey(tool, "starter", 1);

  const [{ dict }, row, slots, library, fallbackSlots] = await Promise.all([
    getDictionary(),
    readGuideRow(supabase, tool),
    readGuideSlots(supabase, [...stepKeys, starterKey]),
    listLibrary(supabase, { kind: "image", limit: 300 }),
    // The starter's catalogue fallback, read through the SAME resolver the
    // customer's screen uses — so the preview shows the picture a customer
    // would really get when no starter image is chosen, not a guess at it.
    loadSlots(supabase, STARTER_FALLBACK_SLOTS[tool]),
  ]);
  const t = makeT(dict);

  const header = <CardHeader icon={BookOpen} title={t("aicc.guide.title")} sub={t("aicc.guide.sub")} />;

  // Code ahead of migration 0142: say so instead of offering a form whose
  // every save would fail. Customers meanwhile get the shipped guides.
  if (row === "unavailable") {
    return (
      <Card className="p-5" data-tool-guide-admin="unavailable">
        {header}
        <p className="mt-4 rounded-xl bg-raised px-4 py-3 text-[13px] text-muted">{t("aicc.guide.migrationPending")}</p>
      </Card>
    );
  }

  // The pictures could not be read: a form showing "no picture" would remove
  // the real ones on the next save. Say so instead.
  if (slots === null) {
    return (
      <Card className="p-5" data-tool-guide-admin="error">
        {header}
        <p className="mt-4 rounded-xl bg-raised px-4 py-3 text-[13px] text-muted">{t("aicc.guide.loadFailed")}</p>
      </Card>
    );
  }

  const defaults = defaultGuideContent(tool);
  // The stored copy passed the same validator on its way in (and the
  // database's own check); running it again only turns `Json` into the
  // typed shape. A row that somehow fails it is edited from the shipped copy
  // rather than half-loaded.
  const stored = row?.content != null ? normalizeGuideContent(row.content) : null;
  const content = stored?.ok ? stored.content : null;

  const stepImages = stepKeys.map((k) => slots.get(k)?.mediaId ?? null);
  const starterImage = slots.get(starterKey)?.mediaId ?? null;

  // A picture chosen long ago can be older than the newest 300 the picker
  // lists. Fetch exactly those, so the editor can still show its thumbnail
  // and the preview the real file instead of falling back to a drawing.
  const listed = new Set(library.map((a) => a.id));
  const missing = [...new Set([...stepImages, starterImage])]
    .filter((id): id is string => id !== null && !listed.has(id));
  const extra = missing.length > 0 ? await assetsById(supabase, missing) : [];

  return (
    <Card className="p-5" data-tool-guide-admin={tool}>
      {header}
      <div className="pt-4">
        <ToolGuideEditor
          tool={tool}
          defaults={defaults}
          initial={{
            tutorialEnabled: row ? row.tutorial_enabled : true,
            starterEnabled: row ? row.starter_enabled : true,
            content,
            stepImages,
            starterImage,
            base: row?.updated_at ?? null,
            imageBases: Object.fromEntries([...stepKeys, starterKey].map((k) => [k, slots.get(k)?.updatedAt ?? null])),
            version: row?.tutorial_version ?? 1,
          }}
          library={[...library, ...extra]}
          catalogueImage={firstImage(STARTER_FALLBACK_SLOTS[tool], fallbackSlots)}
        />
      </div>
    </Card>
  );
}

/** The first catalogue slot that resolves to an image — the order
 *  resolveGuide (lib/server/tool-guides.ts) tries them in. */
function firstImage(keys: readonly string[], slots: Awaited<ReturnType<typeof loadSlots>>): GuideImage | null {
  for (const key of keys) {
    const slot = slots.get(key);
    if (!slot || slot.mediaType !== "image" || !slot.desktop) continue;
    return { url: slot.desktop, width: slot.desktopWidth, height: slot.desktopHeight, alt: slot.alt ?? "" };
  }
  return null;
}

/** A handful of library rows by id, in the picker's own shape (listLibrary's
 *  columns and URL rule). Admin-only by RLS, like the library itself. */
async function assetsById(supabase: Client, ids: string[]): Promise<LibraryItem[]> {
  const { data } = await supabase.from("media_assets")
    .select("id, kind, storage_path, external_url, poster_url, title, alt, folder, tags, width, height, size_bytes, mime, created_at")
    .in("id", ids);
  return (data ?? []).map((a) => ({
    id: a.id,
    kind: a.kind,
    url: a.storage_path ? supabase.storage.from("media").getPublicUrl(a.storage_path).data.publicUrl : a.external_url,
    posterUrl: a.poster_url,
    title: a.title,
    alt: a.alt,
    folder: a.folder,
    tags: a.tags ?? [],
    width: a.width,
    height: a.height,
    sizeBytes: a.size_bytes,
    mime: a.mime,
    createdAt: a.created_at,
  }));
}
