"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Images, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * THE GROVBASE INSPIRATION LIBRARY — picking one instead of uploading one.
 *
 * ─── WHERE THE PICTURES COME FROM ───────────────────────────────────────────
 *
 * `public.inspirations`, the admin-curated gallery that already backs
 * /inspirations and /admin/inspirations. There is NO second store and no new
 * table: an image published there shows up here, and nothing has to be wired
 * again when the team adds more. `after_urls` is an array per row, so one
 * published inspiration can offer several frames — each is selectable on its
 * own, because the seller is choosing a PICTURE, not an article.
 *
 * Read with the browser client under the row's own policy
 * (`status = 'published' or is_admin()`), the same door /inspirations uses.
 * Nothing privileged, nothing new.
 *
 * ─── AND WHAT HAPPENS TO THE ONE THEY PICK ──────────────────────────────────
 *
 * Nothing, here. This component hands back URLs and that is the whole of its
 * job. The caller fetches each one and sends it through the SAME upload the
 * file picker uses, so a library image becomes an ordinary inspiration in the
 * workspace's own storage folder.
 *
 * That is not ceremony — it is the only thing that works. The generate route
 * accepts inspiration paths only when they start with the caller's workspace
 * id (app/api/generate/route.ts), which is what stops one workspace pointing
 * the generator at another's files. A library URL handed straight to the
 * generator would be silently dropped by that filter and the seller would
 * watch a picture they chose have no effect. Copying keeps one inspiration
 * model, one cap, one code path.
 */

export type LibraryImage = {
  /** Row id plus frame index — one row can publish several images. */
  key: string;
  url: string;
  title: string;
  category: string;
};

type Row = {
  id: string;
  title: string;
  category: string;
  after_urls: string[] | null;
};

export function InspirationLibraryModal({ open, onClose, room, onPick }: {
  open: boolean;
  onClose: () => void;
  /** How many more inspirations fit. Selection cannot exceed it. */
  room: number;
  onPick: (urls: string[]) => void;
}) {
  const { t } = useI18n();
  const [images, setImages] = useState<LibraryImage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [cat, setCat] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  // Loaded once, on first open — not on mount. The panel is on a page the
  // seller may never open this from, and the list is not worth a request until
  // it is actually going to be looked at.
  useEffect(() => {
    if (!open || images !== null) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("inspirations")
        .select("id, title, category, after_urls")
        .eq("status", "published")
        .order("featured", { ascending: false })
        .order("sort_order")
        .limit(200);
      if (cancelled) return;
      if (error) { setFailed(true); setImages([]); return; }
      const flat: LibraryImage[] = [];
      for (const row of (data ?? []) as Row[]) {
        (row.after_urls ?? []).forEach((url, i) => {
          if (typeof url === "string" && url) {
            flat.push({ key: `${row.id}:${i}`, url, title: row.title, category: row.category });
          }
        });
      }
      setImages(flat);
    })();
    return () => { cancelled = true; };
  }, [open, images]);

  // Selection is dropped on close: reopening the picker should not resurrect a
  // choice the seller walked away from.
  useEffect(() => { if (!open) { setPicked([]); setCat(null); } }, [open]);

  const categories = useMemo(
    () => [...new Set((images ?? []).map((i) => i.category))].filter(Boolean),
    [images],
  );
  const shown = useMemo(
    () => (images ?? []).filter((i) => !cat || i.category === cat),
    [images, cat],
  );

  const toggle = useCallback((url: string) => {
    setPicked((prev) => {
      if (prev.includes(url)) return prev.filter((u) => u !== url);
      // The cap is the section's, not this modal's — it just refuses to let
      // the seller build a selection that would be trimmed on the way back.
      if (prev.length >= room) return prev;
      return [...prev, url];
    });
  }, [room]);

  const confirm = useCallback(() => {
    if (picked.length === 0) return;
    onPick(picked);
    onClose();
  }, [picked, onPick, onClose]);

  const loading = images === null;
  const empty = !loading && (images ?? []).length === 0;

  return (
    <Modal open={open} onClose={onClose} title={t("genv3.inspLibTitle")} wide>
      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted" role="status">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          {t("common.loading")}
        </div>
      )}

      {empty && (
        /* NOT A DEAD END. The library is admin-curated and may simply not have
           been filled yet; this says so in the product's own voice and points
           at the thing that does work — uploading your own. */
        <EmptyState
          icon={Images}
          title={failed ? t("common.error") : t("genv3.inspLibEmpty")}
          body={failed ? t("genv3.inspLibFailed") : t("genv3.inspLibEmptySub")}
          className="border-0 bg-transparent shadow-none"
        />
      )}

      {!loading && !empty && (
        <>
          {categories.length > 1 && (
            <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 thin-scroll">
              <CatChip on={cat === null} onClick={() => setCat(null)}>{t("genv3.inspLibAll")}</CatChip>
              {categories.map((c) => (
                <CatChip key={c} on={cat === c} onClick={() => setCat(c)}>{c}</CatChip>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 [&>*]:min-w-0">
            {shown.map((img) => {
              const on = picked.includes(img.url);
              // Greyed rather than hidden once the cap is reached: the seller
              // can see what else is there and swap, instead of watching tiles
              // disappear as they choose.
              const blocked = !on && picked.length >= room;
              return (
                <button
                  key={img.key}
                  type="button"
                  aria-pressed={on}
                  disabled={blocked}
                  title={img.title}
                  onClick={() => toggle(img.url)}
                  className={cn(
                    "relative aspect-square overflow-hidden rounded-xl ring-2 transition-all duration-200",
                    on ? "ring-accent" : "ring-transparent hover:ring-[rgb(var(--accent)/0.45)]",
                    blocked && "cursor-not-allowed opacity-40",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.title} loading="lazy" className="h-full w-full object-cover" />
                  {on && (
                    <span aria-hidden className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white shadow-e2">
                      <Check size={12} strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-[12px] text-faint tabular-nums">
              {t("genv3.inspLibPicked", { n: picked.length, max: room })}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
              <Button variant="primary" disabled={picked.length === 0} onClick={confirm}>
                {t("genv3.inspLibAdd")}
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function CatChip({ on, onClick, children }: {
  on: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn(
        "shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-semibold capitalize transition-colors duration-200",
        on ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-ink",
      )}>
      {children}
    </button>
  );
}
