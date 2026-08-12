"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Film, FileText, Trash2, Copy } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { saveMediaAssetAction, deleteMediaAssetAction } from "@/app/actions/admin-b2b";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal, ConfirmModal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";

export type MediaRow = {
  id: string; kind: string; storage_path: string | null; external_url: string | null;
  poster_url: string | null; alt: string | null; title: string | null; mime: string | null;
  size_bytes: number | null; publicUrl: string | null;
};

export function MediaManager({ assets }: { assets: MediaRow[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [external, setExternal] = useState<{ kind: "video" | "image"; url: string; poster: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<MediaRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: FileList) {
    setUploading(true);
    const supabase = createClient();
    for (const file of Array.from(files)) {
      if (file.size > 50 * 1024 * 1024) { toast.error(t("media.tooLarge")); continue; }
      const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : "file";
      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("media").upload(path, file);
      if (error) { toast.error(`${file.name}: ${t("common.error")}`); continue; }
      await saveMediaAssetAction({
        kind: kind as "image" | "video" | "file", storagePath: path,
        title: file.name, mime: file.type, sizeBytes: file.size,
      });
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
      });
      if (res.ok) { toast.success(t("common.save")); setExternal(null); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  const copy = (url: string) => { navigator.clipboard.writeText(url); toast.success(t("media.copied")); };

  return (
    <div>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <input ref={fileRef} type="file" multiple className="hidden"
          accept="image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm"
          onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
        <Button size="sm" variant="secondary" onClick={() => setExternal({ kind: "video", url: "", poster: "", title: "" })}>
          + {t("media.external")}
        </Button>
        <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? t("common.loading") : `+ ${t("media.upload")}`}
        </Button>
      </div>

      {assets.length === 0 ? (
        <div className="panel rounded-2xl p-10 text-center">
          <p className="text-sm font-semibold">{t("media.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted">{t("media.emptyBody")}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {assets.map((a) => (
            <li key={a.id} className="panel group relative overflow-hidden rounded-2xl">
              <div className="flex aspect-square items-center justify-center bg-raised/60">
                {a.kind === "image" && (a.publicUrl || a.external_url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.publicUrl ?? a.external_url ?? ""} alt={a.alt ?? ""} loading="lazy" className="h-full w-full object-cover" />
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
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge tone={a.kind === "video" ? "indigo" : "neutral"}>{a.kind}</Badge>
                  {a.size_bytes != null && <span className="text-[10px] text-faint">{(a.size_bytes / 1024 / 1024).toFixed(1)} MB</span>}
                  <span className="ml-auto flex gap-0.5">
                    <button type="button" title={t("media.copyUrl")} className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink"
                      onClick={() => copy(a.publicUrl ?? a.external_url ?? "")}><Copy size={13} /></button>
                    <button type="button" title={t("common.delete")} className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-red-500"
                      onClick={() => setDeleting(a)}><Trash2 size={13} /></button>
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!external} onClose={() => setExternal(null)} title={t("media.external")}>
        {external && (
          <div className="space-y-4">
            <div>
              <Label>{t("common.type")}</Label>
              <Select value={external.kind} onChange={(e) => setExternal({ ...external, kind: e.target.value as "video" | "image" })}>
                <option value="video">video</option>
                <option value="image">image</option>
              </Select>
            </div>
            <div>
              <Label>URL (YouTube / Vimeo / mp4 / webm / https)</Label>
              <Input value={external.url} placeholder="https://…" onChange={(e) => setExternal({ ...external, url: e.target.value })} />
            </div>
            <div>
              <Label>{t("media.poster")}</Label>
              <Input value={external.poster} placeholder="https://…" onChange={(e) => setExternal({ ...external, poster: e.target.value })} />
            </div>
            <div>
              <Label>{t("common.name")}</Label>
              <Input value={external.title} onChange={(e) => setExternal({ ...external, title: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setExternal(null)}>{t("common.cancel")}</Button>
              <Button disabled={pending || !/^https:\/\//.test(external.url)} onClick={saveExternal}>{t("common.save")}</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)}
        onConfirm={() => { if (deleting) start(async () => {
          const res = await deleteMediaAssetAction(deleting.id);
          if (res.ok) { setDeleting(null); router.refresh(); } else toast.error(t("common.error"));
        }); }}
        title={t("common.delete")} body={t("common.confirmDelete")} confirmLabel={t("common.delete")} danger pending={pending} />
    </div>
  );
}
