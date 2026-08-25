"use client";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Download, Loader2, Maximize2, SquareDashedMousePointer, Wrench, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import Link from "next/link";

export type LibraryCard = {
  id: string;
  product: string | null;
  created: string;
  assets: { id: string; path: string; url: string | null }[];
};

/**
 * LIBRARY GRID — the asset-manager view from the UX spec: responsive grid,
 * hover preview, multi-select with bulk download as ZIP. Selection is a
 * mode: enter it with "Zaznacz", tap tiles, download the set as one archive.
 * Opening a single asset offers the contextual actions (preview, download,
 * edit in the toolbox) instead of a bare new-tab jump.
 */
export function LibraryGrid({ cards, locale }: { cards: LibraryCard[]; locale: string }) {
  const { t } = useI18n();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  const [preview, setPreview] = useState<{ url: string; path: string; product: string | null } | null>(null);

  const fmt = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);

  function toggle(path: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else if (next.size < 60) next.add(path);
      return next;
    });
  }

  async function downloadZip() {
    if (picked.size === 0 || zipping) return;
    setZipping(true);
    try {
      const res = await fetch("/api/library/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [...picked] }),
      });
      if (!res.ok) { toast.error(t("common.error")); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ecomstudio-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      setSelecting(false);
      setPicked(new Set());
    } catch { toast.error(t("common.error")); }
    finally { setZipping(false); }
  }

  return (
    <div className="min-w-0">
      {/* Selection toolbar. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => { setSelecting(!selecting); setPicked(new Set()); }}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold transition-colors",
            selecting ? "bg-[rgb(var(--accent)/0.16)] text-ink ring-1 ring-[rgb(var(--accent)/0.4)]" : "plate text-muted hover:text-ink",
          )}
        >
          <SquareDashedMousePointer size={14} aria-hidden />
          {selecting ? t("library.selectOff") : t("library.selectOn")}
        </button>
        {selecting && (
          <button
            type="button"
            disabled={picked.size === 0 || zipping}
            onClick={downloadZip}
            className={cn("cta inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[13px] font-semibold",
              (picked.size === 0 || zipping) && "cursor-not-allowed opacity-50")}
          >
            {zipping ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />}
            {t("library.zip", { n: picked.size })}
          </button>
        )}
      </div>

      <div className="stagger grid gap-3.5 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 xl:gap-4">
        {cards.map((g) => (
          <Card key={g.id} className="group overflow-hidden">
            {g.assets.length > 0 && (
              <div className={`grid gap-0.5 ${g.assets.length > 1 ? "grid-cols-2" : ""}`}>
                {g.assets.slice(0, 4).map((a) => {
                  const isPicked = picked.has(a.path);
                  return a.url ? (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => selecting ? toggle(a.path) : setPreview({ url: a.url!, path: a.path, product: g.product })}
                      className="group/tile relative block overflow-hidden bg-raised text-left"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt="" loading="lazy"
                        className={cn("aspect-square w-full object-cover transition-transform duration-500",
                          !selecting && "group-hover/tile:scale-[1.05]", isPicked && "scale-[0.94] rounded-lg")} />
                      {selecting ? (
                        <span aria-hidden className={cn(
                          "absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full ring-2 transition-colors",
                          isPicked ? "bg-accent text-white ring-accent" : "bg-black/40 text-white/70 ring-white/50",
                        )}>
                          {isPicked && <Check size={13} strokeWidth={3} />}
                        </span>
                      ) : (
                        <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-[rgb(var(--scrim)/0.55)] opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover/tile:opacity-100">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/30">
                            <Maximize2 size={15} />
                          </span>
                        </span>
                      )}
                    </button>
                  ) : null;
                })}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight">{g.product ?? "—"}</p>
                <p className="caption mt-0.5">{fmt.format(new Date(g.created))}</p>
              </div>
              <Badge tone={g.assets.length > 0 ? "green" : "neutral"}>{g.assets.length}</Badge>
            </div>
          </Card>
        ))}
      </div>

      {/* PREVIEW — contextual actions on one asset: download, open in the
          toolbox (create vs edit stay separate flows, per the spec). */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="scrim animate-fade absolute inset-0 backdrop-blur-[3px]" onClick={() => setPreview(null)} />
          <div className="animate-sheet relative max-h-[90dvh] w-full max-w-3xl overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt={preview.product ?? ""} className="max-h-[76dvh] w-full bg-sunken object-contain" />
            <div className="glass flex flex-wrap items-center justify-between gap-2 rounded-b-2xl px-4 py-3">
              <p className="min-w-0 truncate text-sm font-semibold">{preview.product ?? "—"}</p>
              <div className="flex items-center gap-2">
                <a href={preview.url} download target="_blank" rel="noreferrer noopener"
                  className="cta inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold">
                  <Download size={14} aria-hidden />
                  {t("common.download")}
                </a>
                <Link href="/tools"
                  className="plate inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold text-ink hover:border-[rgb(var(--accent)/0.4)]">
                  <Wrench size={14} aria-hidden />
                  {t("library.editAsset")}
                </Link>
                <button type="button" onClick={() => setPreview(null)} aria-label={t("common.close")}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
                  <X size={15} aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
