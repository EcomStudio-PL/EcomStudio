"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/provider";
import {
  registerUploadedImage, setPrimaryImageAction, deleteImageAction, moveImageAction,
} from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const BUCKET = "product-images";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif",
};

type Img = { id: string; storage_path: string; is_primary: boolean; sort_order: number; url?: string };

export function ImageManager({ productId, workspaceId, images }: {
  productId: string; workspaceId: string; images: Img[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const supabase = createClient();
    let sortOrder = images.length > 0 ? Math.max(...images.map((i) => i.sort_order)) + 1 : 0;
    let hasPrimary = images.some((i) => i.is_primary);
    let i = 0;
    for (const file of files) {
      i += 1;
      setProgress({ n: i, total: files.length });
      if (!ALLOWED.includes(file.type)) { toast.error(t("products.invalidType")); continue; }
      if (file.size > MAX_BYTES) { toast.error(t("products.tooLarge")); continue; }
      const path = `${workspaceId}/${productId}/${crypto.randomUUID()}.${EXT[file.type]}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type, upsert: false,
      });
      if (error) { toast.error(t("common.error")); continue; }
      const res = await registerUploadedImage({
        productId, storagePath: path, sortOrder: sortOrder++, isPrimary: !hasPrimary,
      });
      if (!res.ok) toast.error(t("common.error"));
      else hasPrimary = true;
    }
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  async function run(p: Promise<{ ok: boolean }>) {
    const res = await p;
    if (!res.ok) toast.error(t("common.error"));
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">{t("products.uploadHint")}</p>
        <input
          ref={fileRef} type="file" accept={ALLOWED.join(",")} multiple hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <Button size="sm" variant="secondary" type="button"
          disabled={!!progress} onClick={() => fileRef.current?.click()}>
          {progress ? t("products.uploading", { n: progress.n, total: progress.total }) : `+ ${t("products.upload")}`}
        </Button>
      </div>
      {images.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          {t("products.noImages")}
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((img, idx) => (
            <li key={img.id} className="group overflow-hidden rounded-xl border border-line bg-raised">
              <div className="relative aspect-square">
                {img.url && (
                  <Image src={img.url} alt="" fill sizes="200px" className="object-cover" />
                )}
                {img.is_primary && (
                  <Badge tone="green" className="absolute left-2 top-2">{t("products.primary")}</Badge>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                <div className="flex gap-0.5">
                  <IconBtn label={t("products.moveUp")} disabled={idx === 0}
                    onClick={() => void run(moveImageAction(productId, img.id, -1))}>←</IconBtn>
                  <IconBtn label={t("products.moveDown")} disabled={idx === images.length - 1}
                    onClick={() => void run(moveImageAction(productId, img.id, 1))}>→</IconBtn>
                </div>
                <div className="flex gap-0.5">
                  {!img.is_primary && (
                    <IconBtn label={t("products.setPrimary")}
                      onClick={() => void run(setPrimaryImageAction(productId, img.id))}>★</IconBtn>
                  )}
                  <IconBtn label={t("products.removeImage")}
                    onClick={() => {
                      if (confirm(t("common.confirmDelete"))) void run(deleteImageAction(productId, img.id));
                    }}>✕</IconBtn>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IconBtn({ children, label, onClick, disabled }: {
  children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-xs text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}
