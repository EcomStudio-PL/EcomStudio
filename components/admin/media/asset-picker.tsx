"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { Film, Loader2, Search, Upload, Check } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { saveMediaAssetAction } from "@/app/actions/admin-b2b";
import { deriveMedia } from "@/lib/media-derive";
import type { LibraryItem } from "@/lib/services/media-slots";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

/**
 * CHOOSING A FILE.
 *
 * One picker, used by every slot editor and every banner. It shows the ONE
 * central library — the same `media_assets` rows the public CMS and the media
 * manager use — so a file uploaded here appears there and vice versa. There is
 * no second pool of files anywhere in this feature.
 *
 * "Nie zmuszaj mnie do kopiowania URL": there is no URL field. You pick a
 * file or you upload one, and the slot stores the file's ID — which is also
 * what makes one file usable in ten places without ten copies of it.
 *
 * Two columns on a phone, five on a desktop, and the grid is the whole
 * interface: a filter row, a search box, and tiles big enough to recognise.
 */

type Kind = "image" | "video" | "all";

export function AssetPicker({
  open, onClose, onPick, library, kind = "all", title,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: LibraryItem) => void;
  library: LibraryItem[];
  /** Narrow the library to what this slot can hold. */
  kind?: Kind;
  title: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Kind>(kind);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fresh, setFresh] = useState<LibraryItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [, start] = useTransition();

  // Anything uploaded in this session sits at the front until the page is
  // refreshed — an upload that vanishes until reload feels broken.
  const all = useMemo(() => [...fresh, ...library], [fresh, library]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((a) => {
      if (filter !== "all" && a.kind !== filter) return false;
      if (kind !== "all" && a.kind !== kind) return false;
      if (!a.url) return false;
      if (!q) return true;
      return [a.title, a.alt, a.folder, ...(a.tags ?? [])]
        .filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [all, query, filter, kind]);

  async function upload(files: FileList) {
    setUploading(true);
    const supabase = createClient();
    for (const file of Array.from(files)) {
      // The `media` bucket stops at 50 MB; failing here with a sentence beats
      // failing in storage with a status code.
      if (file.size > 50 * 1024 * 1024) { toast.error(t("media.tooLarge")); continue; }
      const fileKind = file.type.startsWith("video/") ? "video"
        : file.type.startsWith("image/") ? "image" : "file";
      if (fileKind === "file") { toast.error(t("media.unsupported")); continue; }
      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("media").upload(path, file);
      if (error) { toast.error(`${file.name}: ${t("common.error")}`); continue; }
      const res = await saveMediaAssetAction({
        kind: fileKind, storagePath: path, title: file.name,
        mime: file.type, sizeBytes: file.size,
      });
      if (!res.ok || !res.id) { toast.error(t("common.error")); continue; }
      // Dimensions and smaller copies, so a file picked straight after upload
      // is as well prepared as one that has been in the library for a month.
      if (fileKind === "image") await deriveMedia(res.id);
      const url = supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
      setFresh((prev) => [{
        id: res.id!, kind: fileKind, url, posterUrl: null, title: file.name, alt: null,
        folder: null, tags: [], width: null, height: null,
        sizeBytes: file.size, mime: file.type, createdAt: new Date().toISOString(),
      }, ...prev]);
    }
    setUploading(false);
  }

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files);
        }}
        className={cn("rounded-xl", dragging && "ring-2 ring-accent ring-offset-2 ring-offset-[rgb(var(--surface))]")}
      >
        {/* ── SEARCH, FILTER, UPLOAD ──────────────────────────────────── */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input value={query} placeholder={t("media.search")} className="pl-9"
              aria-label={t("media.search")} data-picker-search
              onChange={(e) => setQuery(e.target.value)} />
          </div>
          {/* Only offered when the slot accepts both; a slot that is
              image-only has nothing to filter. */}
          {kind === "all" && (
            <div className="flex rounded-lg bg-sunken/80 p-1">
              {(["all", "image", "video"] as Kind[]).map((k) => (
                <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                  className={cn("rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors",
                    filter === k ? "bg-surface text-accent shadow-e1" : "text-muted hover:text-ink")}>
                  {t(`media.filter.${k}`)}
                </button>
              ))}
            </div>
          )}
          <input ref={fileRef} type="file" multiple className="hidden"
            accept="image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm"
            onChange={(e) => e.target.files && start(() => { void upload(e.target.files!); })} />
          <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Upload size={14} aria-hidden />}
            {uploading ? t("common.loading") : t("media.upload")}
          </Button>
        </div>

        <p className="mb-3 text-[11.5px] text-faint">{t("media.dropHint")}</p>

        {/* ── THE GRID ────────────────────────────────────────────────── */}
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
            {all.length === 0 ? t("media.emptyBody") : t("media.noMatchesBody")}
          </p>
        ) : (
          <ul className="thin-scroll grid max-h-[54vh] grid-cols-2 gap-2.5 overflow-y-auto sm:grid-cols-3 lg:grid-cols-5">
            {items.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => { onPick(a); onClose(); }}
                  data-picker-item={a.id}
                  className="panel group w-full overflow-hidden rounded-xl text-left transition-colors hover:border-[rgb(var(--accent)/0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                  <span className="flex aspect-square items-center justify-center bg-raised/60">
                    {a.kind === "video" && !a.posterUrl ? (
                      <Film aria-hidden className="text-faint" size={24} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.posterUrl ?? a.url ?? ""} alt="" loading="lazy"
                        className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="block p-2">
                    <span className="block truncate text-[11.5px] font-medium">{a.title ?? "—"}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
                      <span className="uppercase">{a.kind}</span>
                      {a.width && a.height && <span className="tabular-nums">{a.width}×{a.height}</span>}
                      {a.sizeBytes != null && <span>{(a.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** The chosen file, shown where a slot editor asks for one. Small on purpose:
 *  the big preview is the slot's own, which shows it in context. */
export function AssetChip({ item, onPick, onClear, label }: {
  item: LibraryItem | null;
  onPick: () => void;
  onClear?: () => void;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-muted">{label}</p>
      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-sunken/40 p-2">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-raised">
          {!item ? (
            <span aria-hidden className="text-[10px] text-faint">—</span>
          ) : item.kind === "video" && !item.posterUrl ? (
            <Film aria-hidden size={16} className="text-faint" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.posterUrl ?? item.url ?? ""} alt="" className="h-full w-full object-cover" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium">
            {item?.title ?? t("media.slotEmpty")}
          </span>
          {item?.width && item.height && (
            <span className="block text-[10.5px] tabular-nums text-faint">{item.width}×{item.height}</span>
          )}
        </span>
        <Button size="sm" variant="secondary" onClick={onPick}>
          {item ? t("media.change") : t("media.choose")}
        </Button>
        {item && onClear && (
          <Button size="sm" variant="ghost" onClick={onClear}>{t("common.remove")}</Button>
        )}
      </div>
    </div>
  );
}

/** A tick used by the position picker and the type switch. */
export function Ticked({ on }: { on: boolean }) {
  return on ? <Check size={13} aria-hidden /> : null;
}
