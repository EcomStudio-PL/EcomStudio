"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Box, Check, ImageIcon, Package, Plus, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Chip, ChipRow } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

export type PickableProduct = {
  id: string;
  name: string;
  category?: string | null;
  sku?: string | null;
  /** First reference image, when the product has one. */
  thumbnail?: string | null;
  imageCount?: number;
};

const UNCATEGORISED = "__none__";

/**
 * PRODUCT PICKER — one selector for every place a saved product is chosen.
 *
 * A flat row of product chips stops working somewhere around twenty
 * products, so selection moves into a searchable, category-grouped surface:
 * a centred modal on desktop, a bottom sheet on phones. Search matches name,
 * category and SKU; categories double as a filter track that scrolls inside
 * itself. Choosing a product closes the sheet and hands the id back — the
 * form then shows a compact summary instead of the whole library.
 */
export function ProductPicker({ open, onClose, products, onSelect, selectedId }: {
  open: boolean;
  onClose: () => void;
  products: PickableProduct[];
  onSelect: (product: PickableProduct) => void;
  selectedId?: string;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQ(""); setCategory(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); }, 180);
  }

  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of products) {
      const key = p.category?.trim() || UNCATEGORISED;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [products]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = products.filter((p) => {
      const key = p.category?.trim() || UNCATEGORISED;
      if (category && key !== category) return false;
      if (!needle) return true;
      return [p.name, p.category ?? "", p.sku ?? ""].some((v) => v.toLowerCase().includes(needle));
    });
    const byCategory = new Map<string, PickableProduct[]>();
    for (const p of matched) {
      const key = p.category?.trim() || UNCATEGORISED;
      byCategory.set(key, [...(byCategory.get(key) ?? []), p]);
    }
    return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [products, q, category]);

  if (!open) return null;
  const total = groups.reduce((n, [, items]) => n + items.length, 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true"
      aria-label={t("picker.title")}>
      <div className={cn("absolute inset-0 bg-black/70 backdrop-blur-[2px]", closing ? "animate-fade-out" : "animate-fade")}
        onClick={close} />
      <div className={cn(
        "overlay relative flex w-full flex-col overflow-hidden",
        "max-h-[88dvh] rounded-t-3xl sm:m-4 sm:max-h-[76dvh] sm:max-w-lg sm:rounded-3xl",
        closing ? "animate-fade-out" : "animate-sheet"
      )}>
        {/* Grab handle: reads as a sheet on touch, invisible on desktop. */}
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-[rgb(var(--faint)/0.4)] sm:hidden" />

        <div className="shrink-0 px-4 pb-3 pt-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold tracking-tight">{t("picker.title")}</h2>
              <p className="mt-0.5 text-xs text-muted">{t("picker.sub")}</p>
            </div>
            <button type="button" onClick={close} aria-label={t("common.close")}
              className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink">
              <X size={19} aria-hidden />
            </button>
          </div>

          <div className="relative mt-3">
            <Search aria-hidden size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("picker.search")}
              aria-label={t("picker.search")}
              className={cn(
                "w-full rounded-xl bg-sunken/70 py-3 pl-10 pr-3 text-base sm:text-sm",
                "border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.2))] placeholder:text-faint",
                "focus:border-[rgb(var(--accent)/0.55)] focus:bg-surface focus:outline-none focus:ring-4 focus:ring-[rgb(var(--accent)/0.14)]"
              )}
            />
          </div>

          {categories.length > 1 && (
            <ChipRow className="mt-3 -mx-4 px-4 sm:-mx-5 sm:px-5">
              <Chip active={!category} onClick={() => setCategory(null)} count={products.length}>
                {t("common.all")}
              </Chip>
              {categories.map(([key, count]) => (
                <Chip key={key} active={category === key} count={count}
                  onClick={() => setCategory(category === key ? null : key)}>
                  {key === UNCATEGORISED ? t("picker.uncategorised") : key}
                </Chip>
              ))}
            </ChipRow>
          )}
        </div>

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
          {products.length === 0 ? (
            <div className="px-2 py-10 text-center">
              <span aria-hidden className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-raised text-accent ring-1 ring-[rgb(var(--accent)/0.25)]">
                <Package size={22} />
              </span>
              <p className="font-display text-[15px] font-semibold">{t("picker.emptyTitle")}</p>
              <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted">{t("picker.emptyBody")}</p>
              <Link href="/products/new"
                className="cta mt-5 inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold">
                <Plus size={16} aria-hidden /> {t("products.new")}
              </Link>
            </div>
          ) : total === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-muted">{t("picker.noMatch")}</p>
          ) : (
            <div className="space-y-5 pb-2">
              {groups.map(([key, items]) => (
                <div key={key}>
                  <p className="overline mb-2">{key === UNCATEGORISED ? t("picker.uncategorised") : key}</p>
                  <ul className="space-y-1.5">
                    {items.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => { onSelect(p); close(); }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors duration-150",
                            p.id === selectedId ? "is-selected" : "hover:bg-raised/70"
                          )}
                        >
                          <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-sunken ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]">
                            {p.thumbnail
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                              : <span className="flex h-full items-center justify-center text-faint"><Box size={16} /></span>}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{p.name}</span>
                            <span className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                              <span className="truncate">{p.category?.trim() || t("picker.uncategorised")}</span>
                              {!!p.imageCount && (
                                <span className="inline-flex shrink-0 items-center gap-0.5">
                                  <ImageIcon size={10} aria-hidden />{p.imageCount}
                                </span>
                              )}
                            </span>
                          </span>
                          {p.id === selectedId && (
                            <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                              <Check size={13} strokeWidth={3} />
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The two entry points that replace an ever-growing chip list, plus the
 * compact summary shown once a product is chosen.
 */
export function ProductChoice({ product, onPick, onClear, newLabel }: {
  product?: PickableProduct | null;
  onPick: () => void;
  /** Switch back to entering a brand-new product. */
  onClear: () => void;
  newLabel: string;
}) {
  const { t } = useI18n();
  if (product) {
    return (
      <div className="plate flex items-center gap-3 rounded-xl p-2.5">
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-sunken">
          {product.thumbnail
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={product.thumbnail} alt="" className="h-full w-full object-cover" />
            : <span className="flex h-full items-center justify-center text-faint"><Box size={16} /></span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{product.name}</span>
          <span className="block truncate text-[11px] text-faint">
            {product.category?.trim() || t("picker.uncategorised")}
          </span>
        </span>
        <button type="button" onClick={onPick}
          className="shrink-0 rounded-lg px-3 py-2 text-[13px] font-semibold text-accent transition-colors hover:bg-accent-soft">
          {t("picker.change")}
        </button>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={onClear}
        className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[rgb(var(--accent)/0.14)] px-3 text-[13px] font-semibold text-accent transition-colors hover:bg-[rgb(var(--accent)/0.2)]">
        <Plus size={15} aria-hidden />
        <span className="truncate">{newLabel}</span>
      </button>
      <button type="button" onClick={onPick}
        className="plate flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-muted transition-colors hover:border-[rgb(var(--accent)/0.35)] hover:text-ink">
        <Package size={15} aria-hidden />
        <span className="truncate">{t("picker.choose")}</span>
      </button>
    </div>
  );
}
