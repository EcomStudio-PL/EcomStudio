"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { AlertTriangle, Film, FileText, Trash2, Copy, Pencil, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { saveMediaAssetAction, deleteMediaAssetAction } from "@/app/actions/admin-b2b";
import { deriveMedia } from "@/lib/media-derive";
import { mediaUsageAction, replaceMediaAction, type UsageReport } from "@/app/actions/media-slots";
import { slotDef } from "@/lib/media-slots";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { AssetPicker } from "@/components/admin/media/asset-picker";
import type { LibraryItem } from "@/lib/services/media-slots";

/**
 * THE MEDIA LIBRARY.
 *
 * One pool of files for the whole admin: what is uploaded from a CMS field
 * appears here, and what is here can be picked from any field. There is no
 * second, page-local store of images anywhere in this feature.
 *
 * Four things this screen is responsible for beyond holding files:
 *
 *   SEARCHABLE — by name, by alt text, by tag. A library of two hundred
 *   images that can only be scrolled is a library nobody uses.
 *   FOLDERS AND TAGS — labels, not paths. The storage layout stays flat, so
 *   moving a picture between folders never changes the URL a page points at.
 *   ALT TEXT — editable here and warned about below, because an image with no
 *   alt is a page a screen reader cannot read.
 *   SMALLER COPIES — generated right after an upload, so every page that uses
 *   the picture serves a phone a phone-sized file.
 */

export type MediaRow = {
  id: string; kind: string; storage_path: string | null; external_url: string | null;
  poster_url: string | null; alt: string | null; title: string | null; mime: string | null;
  size_bytes: number | null; publicUrl: string | null;
  folder: string | null; tags: string[] | null;
  width: number | null; height: number | null;
};

type Editing = {
  id: string; title: string; alt: string; folder: string; tags: string;
};

/** What the delete dialog knows while it is open: the file, and — once the
 *  server has answered — every place that would lose it. */
type Deleting = { asset: MediaRow; usage: UsageReport | null };

export function MediaManager({ assets, usage, library }: {
  assets: MediaRow[];
  /** media id → how many slots point at it. Shown on the tile so an operator
   *  can see what is in use before opening anything. */
  usage?: Record<string, number>;
  /** The same rows in picker shape, for "replace everywhere". */
  library?: LibraryItem[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("");
  const [kind, setKind] = useState("");
  const [external, setExternal] = useState<{ kind: "video" | "image"; url: string; poster: string; title: string } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [replacing, setReplacing] = useState<MediaRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const folders = useMemo(
    () => [...new Set(assets.map((a) => a.folder).filter((f): f is string => !!f))].sort(),
    [assets],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (folder && a.folder !== folder) return false;
      if (kind && a.kind !== kind) return false;
      if (!q) return true;
      const haystack = [a.title, a.alt, a.folder, a.storage_path, ...(a.tags ?? [])]
        .filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [assets, query, folder, kind]);

  const missingAlt = assets.filter((a) => a.kind === "image" && !a.alt?.trim()).length;

  async function uploadFiles(files: FileList) {
    setUploading(true);
    const supabase = createClient();
    for (const file of Array.from(files)) {
      if (file.size > 50 * 1024 * 1024) { toast.error(t("media.tooLarge")); continue; }
      const fileKind = file.type.startsWith("video/") ? "video"
        : file.type.startsWith("image/") ? "image" : "file";
      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("media").upload(path, file);
      if (error) { toast.error(`${file.name}: ${t("common.error")}`); continue; }
      const res = await saveMediaAssetAction({
        kind: fileKind as "image" | "video" | "file", storagePath: path,
        title: file.name, mime: file.type, sizeBytes: file.size,
        folder: folder || null,
      });
      // The dimensions and the smaller copies. Best effort and deliberately
      // not awaited for its result beyond logging — an image without
      // derivatives still renders, it just renders the original.
      if (res.ok && res.id && fileKind === "image") await deriveMedia(res.id);
    }
    setUploading(false);
    router.refresh();
  }

  function saveExternal() {
    if (!external) return;
    start(async () => {
      const res = await saveMediaAssetAction({
        kind: external.kind, externalUrl: external.url.trim(),
        posterUrl: external.poster.trim() || null, title: external.title.trim() || undefined,
        folder: folder || null,
      });
      if (res.ok) { toast.success(t("common.saved")); setExternal(null); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  function saveDetails() {
    if (!editing) return;
    const asset = assets.find((a) => a.id === editing.id);
    if (!asset) return;
    start(async () => {
      const res = await saveMediaAssetAction({
        id: editing.id,
        kind: asset.kind as "image" | "video" | "file",
        storagePath: asset.storage_path,
        externalUrl: asset.external_url,
        posterUrl: asset.poster_url,
        title: editing.title.trim() || undefined,
        alt: editing.alt.trim(),
        mime: asset.mime ?? undefined,
        sizeBytes: asset.size_bytes ?? undefined,
        folder: editing.folder.trim() || null,
        tags: editing.tags.split(",").map((s) => s.trim()).filter(Boolean),
      });
      if (res.ok) { toast.success(t("common.saved")); setEditing(null); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  const copy = (url: string) => { navigator.clipboard.writeText(url); toast.success(t("media.copied")); };

  /**
   * DELETING SAFELY. The dialog opens before the answer arrives and then
   * fills in: every place this file is used, named. A file used nowhere is a
   * plain confirm; a file used in six places offers to replace it in all six
   * instead — which is what somebody swapping a picture actually wanted.
   */
  function askDelete(asset: MediaRow) {
    setDeleting({ asset, usage: null });
    start(async () => {
      const res = await mediaUsageAction(asset.id);
      setDeleting((cur) => cur && cur.asset.id === asset.id
        ? { ...cur, usage: res.ok ? res.data ?? [] : [] }
        : cur);
    });
  }

  function confirmDelete() {
    const asset = deleting?.asset;
    if (!asset) return;
    start(async () => {
      const res = await deleteMediaAssetAction(asset.id);
      if (res.ok) { setDeleting(null); router.refresh(); } else toast.error(t("common.error"));
    });
  }

  /** Point every reference at a different file, then let the operator delete
   *  the old one from a library where nothing uses it any more. */
  function replaceEverywhere(withItem: LibraryItem) {
    const from = replacing;
    if (!from) return;
    start(async () => {
      const res = await replaceMediaAction(from.id, withItem.id);
      if (!res.ok) { toast.error(t(`media.err.${res.error}`)); return; }
      toast.success(t("media.replaced", { n: res.data?.replaced ?? 0 }));
      setReplacing(null);
      setDeleting(null);
      router.refresh();
    });
  }

  return (
    <div data-media-manager>
      {/* ── SEARCH AND FILTERS ─────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search aria-hidden size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={query} placeholder={t("media.search")} className="pl-9"
            aria-label={t("media.search")} data-media-search
            onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select value={folder} aria-label={t("media.folder")} className="w-auto"
          onChange={(e) => setFolder(e.target.value)}>
          <option value="">{t("media.allFolders")}</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </Select>
        <Select value={kind} aria-label={t("common.type")} className="w-auto"
          onChange={(e) => setKind(e.target.value)}>
          <option value="">{t("media.allKinds")}</option>
          <option value="image">image</option>
          <option value="video">video</option>
          <option value="file">file</option>
        </Select>
        <span className="flex-1" />
        <input ref={fileRef} type="file" multiple className="hidden"
          accept="image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm"
          onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
        <Button size="sm" variant="secondary"
          onClick={() => setExternal({ kind: "video", url: "", poster: "", title: "" })}>
          + {t("media.external")}
        </Button>
        <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? t("common.loading") : `+ ${t("media.upload")}`}
        </Button>
      </div>

      {/* An image with no alt text is a page a screen reader cannot read, and
          the CMS is where somebody can still fix it. */}
      {missingAlt > 0 && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-[rgb(var(--caution)/0.4)] bg-[rgb(var(--caution)/0.08)] px-3.5 py-3">
          <AlertTriangle aria-hidden size={15} className="shrink-0 text-muted" />
          <p className="text-[12.5px] text-muted">{t("media.missingAlt", { n: missingAlt })}</p>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="panel rounded-2xl p-10 text-center">
          <p className="text-sm font-semibold">
            {assets.length === 0 ? t("media.emptyTitle") : t("media.noMatches")}
          </p>
          <p className="mt-1 text-sm text-muted">
            {assets.length === 0 ? t("media.emptyBody") : t("media.noMatchesBody")}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {visible.map((a) => (
            <li key={a.id} className="panel group relative overflow-hidden rounded-2xl" data-media-item>
              <div className="flex aspect-square items-center justify-center bg-raised/60">
                {a.kind === "image" && (a.publicUrl || a.external_url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.publicUrl ?? a.external_url ?? ""} alt={a.alt ?? ""} loading="lazy"
                    className="h-full w-full object-cover" />
                ) : a.kind === "video" && a.poster_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.poster_url} alt={a.alt ?? ""} loading="lazy" className="h-full w-full object-cover" />
                ) : a.kind === "video" ? (
                  <Film aria-hidden className="text-faint" size={28} />
                ) : (
                  <FileText aria-hidden className="text-faint" size={28} />
                )}
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-medium">{a.title ?? a.storage_path ?? a.external_url}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={a.kind === "video" ? "info" : "neutral"}>{a.kind}</Badge>
                  {a.width && a.height && (
                    <span className="text-[10px] tabular-nums text-faint">{a.width}×{a.height}</span>
                  )}
                  {a.size_bytes != null && (
                    <span className="text-[10px] text-faint">{(a.size_bytes / 1024 / 1024).toFixed(1)} MB</span>
                  )}
                  {a.kind === "image" && !a.alt?.trim() && (
                    <span className="text-[10px] font-semibold text-[rgb(var(--caution))]">ALT</span>
                  )}
                </div>
                {/* "Używany w: 4 miejscach" — the difference between deleting
                    confidently and deleting blind. */}
                {usage && (usage[a.id] ?? 0) > 0 && (
                  <p className="mt-1 text-[10.5px] font-medium text-accent" data-media-usage={usage[a.id]}>
                    {t("media.usedIn", { n: usage[a.id] })}
                  </p>
                )}
                {a.folder && <p className="mt-1 truncate text-[10.5px] text-faint">📁 {a.folder}</p>}
                <div className="mt-1.5 flex gap-0.5">
                  <IconBtn title={t("common.edit")}
                    onClick={() => setEditing({
                      id: a.id, title: a.title ?? "", alt: a.alt ?? "",
                      folder: a.folder ?? "", tags: (a.tags ?? []).join(", "),
                    })}>
                    <Pencil size={13} />
                  </IconBtn>
                  <IconBtn title={t("media.copyUrl")}
                    onClick={() => copy(a.publicUrl ?? a.external_url ?? "")}>
                    <Copy size={13} />
                  </IconBtn>
                  <span className="flex-1" />
                  <IconBtn title={t("common.delete")} danger onClick={() => askDelete(a)}>
                    <Trash2 size={13} />
                  </IconBtn>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── DETAILS ────────────────────────────────────────────────────── */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={t("media.details")}>
        {editing && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="m-title">{t("common.name")}</Label>
              <Input id="m-title" value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="m-alt">{t("cms.label.alt")}</Label>
              <Textarea id="m-alt" rows={2} value={editing.alt}
                onChange={(e) => setEditing({ ...editing, alt: e.target.value })} />
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t("media.altHint")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="m-folder">{t("media.folder")}</Label>
                <Input id="m-folder" value={editing.folder} list="media-folders"
                  onChange={(e) => setEditing({ ...editing, folder: e.target.value })} />
                <datalist id="media-folders">
                  {folders.map((f) => <option key={f} value={f} />)}
                </datalist>
              </div>
              <div>
                <Label htmlFor="m-tags">{t("media.tags")}</Label>
                <Input id="m-tags" value={editing.tags} placeholder="hero, moda, 2026"
                  onChange={(e) => setEditing({ ...editing, tags: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
              <Button disabled={pending} onClick={saveDetails}>{t("common.save")}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!external} onClose={() => setExternal(null)} title={t("media.external")}>
        {external && (
          <div className="space-y-4">
            <div>
              <Label>{t("common.type")}</Label>
              <Select value={external.kind}
                onChange={(e) => setExternal({ ...external, kind: e.target.value as "video" | "image" })}>
                <option value="video">video</option>
                <option value="image">image</option>
              </Select>
            </div>
            <div>
              <Label>URL (YouTube / Vimeo / mp4 / webm / https)</Label>
              <Input value={external.url} placeholder="https://…"
                onChange={(e) => setExternal({ ...external, url: e.target.value })} />
            </div>
            <div>
              <Label>{t("media.poster")}</Label>
              <Input value={external.poster} placeholder="https://…"
                onChange={(e) => setExternal({ ...external, poster: e.target.value })} />
            </div>
            <div>
              <Label>{t("common.name")}</Label>
              <Input value={external.title}
                onChange={(e) => setExternal({ ...external, title: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setExternal(null)}>{t("common.cancel")}</Button>
              <Button disabled={pending || !/^https:\/\//.test(external.url)} onClick={saveExternal}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── DELETE, WITH THE CONSEQUENCES ON SCREEN ────────────────────── */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={t("common.delete")}>
        {deleting && (
          <div className="space-y-4">
            {deleting.usage === null ? (
              <p className="text-sm text-muted">{t("common.loading")}</p>
            ) : deleting.usage.length === 0 ? (
              <p className="text-sm text-muted">{t("media.deleteBody")}</p>
            ) : (
              <>
                <p className="text-sm font-semibold">
                  {t("media.usedInPlaces", { n: deleting.usage.length })}
                </p>
                <ul className="thin-scroll max-h-52 space-y-1 overflow-y-auto rounded-xl border border-line bg-sunken/40 p-3">
                  {deleting.usage.map((u) => {
                    // A slot key is an identifier; the name beside it is what
                    // an operator recognises.
                    const def = u.kind === "slot" ? slotDef(u.key) : undefined;
                    return (
                      <li key={`${u.kind}:${u.key}:${u.label}`} className="text-[12.5px]">
                        <span className="text-faint">{t(`media.usage.${u.kind}`)} · </span>
                        {def ? t(def.labelKey, def.labelVars) : u.key}
                        <span className="text-faint"> · {u.label}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[12.5px] leading-relaxed text-muted">
                  {t("media.deleteUsedBody")}
                </p>
              </>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
              {library && deleting.usage !== null && deleting.usage.length > 0 && (
                <Button variant="secondary" onClick={() => setReplacing(deleting.asset)}>
                  {t("media.replaceEverywhere")}
                </Button>
              )}
              <Button variant="danger" disabled={pending || deleting.usage === null}
                onClick={confirmDelete} data-media-delete-confirm>
                {deleting.usage && deleting.usage.length > 0
                  ? t("media.deleteAnyway") : t("common.delete")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {library && (
        <AssetPicker open={!!replacing} onClose={() => setReplacing(null)}
          title={t("media.replaceEverywhere")}
          // The file being replaced is not a candidate to replace itself.
          library={library.filter((a) => a.id !== replacing?.id)}
          kind={replacing?.kind === "video" ? "video" : "image"}
          onPick={replaceEverywhere} />
      )}
    </div>
  );
}

function IconBtn({ children, onClick, title, danger }: {
  children: React.ReactNode; onClick: () => void; title: string; danger?: boolean;
}) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className={`rounded-md p-1.5 text-muted transition-colors hover:bg-raised ${
        danger ? "hover:text-danger" : "hover:text-ink"}`}>
      {children}
    </button>
  );
}
