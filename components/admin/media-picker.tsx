"use client";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Film, ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { saveMediaAssetAction } from "@/app/actions/admin-b2b";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

type Kind = "image" | "video" | "any";

const MAX_BYTES = 25 * 1024 * 1024;

const ACCEPT: Record<Kind, string> = {
  image: "image/png,image/jpeg,image/webp,image/avif,image/gif",
  video: "video/mp4,video/webm",
  any: "image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm",
};

/** Decides the preview shape only — an external URL never has to match it. */
const VIDEO_URL = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

type LibraryItem = {
  id: string; url: string; kind: string;
  title: string | null; alt: string | null; poster: string | null;
};

/**
 * ONE MEDIA FIELD for the whole admin: preview, library, upload, paste-a-URL.
 * The library and the uploader both speak the `media` bucket and
 * `media_assets`, so anything uploaded from a field immediately shows up in
 * /admin/media — there is no second, field-local pool of files.
 */
export function MediaPicker({ value, onChange, kind = "image", label, alt, onAltChange }: {
  value: string;
  onChange: (url: string) => void;
  kind?: Kind;
  label: string;
  alt?: string;
  onAltChange?: (alt: string) => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [browsing, setBrowsing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const urlId = useId();
  const altId = useId();

  const isVideo = kind === "video" || (kind === "any" && VIDEO_URL.test(value));

  useEffect(() => {
    if (!browsing) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("media_assets").select("*")
        .order("created_at", { ascending: false }).limit(200);
      if (cancelled) return;
      if (error) {
        toast.error(t("common.error"));
        setItems([]);
      } else {
        setItems((data ?? [])
          .filter((row) => kind === "any" || row.kind === kind)
          .map((row) => {
            const url = row.storage_path
              ? supabase.storage.from("media").getPublicUrl(row.storage_path).data.publicUrl
              : row.external_url;
            // A row with neither a stored file nor an external URL points at
            // nothing and would render a broken tile.
            return url
              ? { id: row.id, url, kind: row.kind, title: row.title, alt: row.alt, poster: row.poster_url }
              : null;
          })
          .filter((row): row is LibraryItem => row !== null));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [browsing, kind, t]);

  async function upload(file: File) {
    // The shared media.tooLarge string names 50 MB; this picker stops at 25.
    if (file.size > MAX_BYTES) { toast.error(t("cms.fileTooLarge")); return; }
    setUploading(true);
    const supabase = createClient();
    const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabase.storage.from("media").upload(path, file);
    if (error) {
      toast.error(t("common.error"));
      setUploading(false);
      return;
    }
    // "any" is a field-side filter, not a storable kind — sniff the real one
    // so the asset lands in the right bucket of the library.
    const sniffed = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : "file";
    const res = await saveMediaAssetAction({
      kind: kind === "any" ? sniffed : kind, storagePath: path,
      title: file.name, mime: file.type, sizeBytes: file.size,
    });
    // The file is uploaded and reachable either way; only the library row is
    // missing, so the field still gets its URL.
    if (!res.ok) toast.error(t("common.error"));
    onChange(supabase.storage.from("media").getPublicUrl(path).data.publicUrl);
    setUploading(false);
  }

  function pick(item: LibraryItem) {
    onChange(item.url);
    // The asset's own alt is better than an empty field, but never overwrites
    // wording the admin already typed here.
    if (onAltChange && item.alt && !alt) onAltChange(item.alt);
    setBrowsing(false);
  }

  return (
    <div>
      <Label>{label}</Label>

      <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-xl bg-raised/60 ring-1 ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))]">
        {value && !isVideo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={alt ?? ""} loading="lazy" className="h-full w-full object-contain" />
        ) : value && isVideo ? (
          <Film aria-hidden className="text-faint" size={28} />
        ) : (
          <ImagePlus aria-hidden className="text-faint" size={28} />
        )}
      </div>

      <input ref={fileRef} type="file" className="hidden" accept={ACCEPT[kind]}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }} />

      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => setBrowsing(true)}>
          {t("cms.pickFromLibrary")}
        </Button>
        <Button type="button" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading
            ? <Loader2 size={15} aria-hidden className="animate-spin" />
            : <Upload size={15} aria-hidden />}
          {uploading ? t("common.loading") : t("cms.uploadNew")}
        </Button>
        {value && (
          <Button type="button" variant="ghost" onClick={() => onChange("")}>
            <Trash2 size={15} aria-hidden />
            {t("cms.removeMedia")}
          </Button>
        )}
      </div>

      <div className="mt-3">
        <Label htmlFor={urlId}>{t("cms.mediaUrl")}</Label>
        <Input id={urlId} value={value} placeholder="https://…" inputMode="url"
          autoComplete="off" spellCheck={false} className="text-xs"
          onChange={(e) => onChange(e.target.value)} />
      </div>

      {onAltChange && (
        <div className="mt-3">
          <Label htmlFor={altId}>{t("cms.label.alt")}</Label>
          <Input id={altId} value={alt ?? ""} onChange={(e) => onAltChange(e.target.value)} />
        </div>
      )}

      {/* Escape must close the LIBRARY, not the section editor behind it —
          both listen on window, so the inner one stops the event here. */}
      <div onKeyDown={(e) => {
        if (e.key !== "Escape" || !browsing) return;
        // Both dialogs listen on window; stopping the native event here means
        // only the library closes and the half-edited section survives.
        e.stopPropagation();
        setBrowsing(false);
      }}>
      <Modal open={browsing} onClose={() => setBrowsing(false)} title={t("cms.pickFromLibrary")} wide>
        {loading ? (
          <p className="py-10 text-center text-sm text-muted">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">{t("cms.libraryEmpty")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => pick(item)}
                  className="panel w-full overflow-hidden rounded-xl text-left transition-colors hover:border-[rgb(var(--accent)/0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                  <span className="flex aspect-square items-center justify-center bg-raised/60">
                    {item.kind === "video" && !item.poster ? (
                      <Film aria-hidden className="text-faint" size={24} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.poster ?? item.url} alt={item.alt ?? ""} loading="lazy"
                        className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="block truncate p-2 text-[11px] font-medium">{item.title ?? item.url}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 flex justify-end">
          <Button type="button" variant="ghost" onClick={() => setBrowsing(false)}>{t("common.close")}</Button>
        </div>
      </Modal>
      </div>
    </div>
  );
}
