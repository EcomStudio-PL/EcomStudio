"use client";
import { useMemo, useState } from "react";
import { ArrowUp } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { INDUSTRIES, industryKey, type GalleryDef, type HeroTaskKey, type Industry } from "@/lib/seller-home-config";
import { filterGallery } from "@/lib/seller-home-model";
import { BeforeAfter } from "./before-after";
import { chooseTaskAndFocusUpload } from "./task-store";

/**
 * "ZOBACZ, CO ZROBISZ ZE SWOJEGO ZDJĘCIA" — before/after cards with industry
 * pills. Filtering is local (no request, no reload). "Zrób to samo" selects
 * the card's task in the hero, scrolls there and focuses the upload; it never
 * starts anything without a photo.
 */
export function SellerGallery({ items, taskNames }: {
  items: GalleryDef[];
  /** i18n key of each available task's name. */
  taskNames: Partial<Record<HeroTaskKey, string>>;
}) {
  const { t } = useI18n();
  const [industry, setIndustry] = useState<Industry>("all");
  const shown = useMemo(() => filterGallery(items, industry), [items, industry]);
  // Pills only for industries that have a card — a pill leading to nothing
  // would be a dead end.
  const present = useMemo(() => new Set(items.map((i) => i.industry)), [items]);
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="seller-gallery-title" data-seller-gallery>
      <h2 id="seller-gallery-title" className="font-display text-[1.25rem] font-semibold tracking-tight sm:text-[1.5rem]">
        {t("sellerHome.gallery.title")}
      </h2>
      <p className="mt-1 text-[14px] text-muted sm:text-[15px]">{t("sellerHome.gallery.sub")}</p>

      <div role="group" aria-label={t("sellerHome.gallery.filters")} className="rail-x mt-4 flex gap-2 pb-1 sm:flex-wrap">
        {INDUSTRIES.filter((i) => i === "all" || present.has(i)).map((i) => {
          const on = industry === i;
          return (
            <button key={i} type="button" aria-pressed={on} onClick={() => setIndustry(i)} data-industry={i}
              className={cn(
                "h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                on
                  ? "border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.1)] text-accent-strong dark:text-accent"
                  : "border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.5))] bg-[rgb(var(--surface)/0.6)] text-muted hover:text-ink",
              )}>
              {t(industryKey(i))}
            </button>
          );
        })}
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-gallery-count={shown.length}>
        {shown.map((g) => {
          const name = taskNames[g.task] ? t(taskNames[g.task]!) : "";
          return (
            <li key={g.key} data-gallery-item={g.key} data-gallery-industry={g.industry}
              className="animate-fade flex flex-col overflow-hidden rounded-2xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.3))] bg-[rgb(var(--surface))]">
              <BeforeAfter pair={g.media}
                sizes="(max-width: 639px) 92vw, (max-width: 1023px) 46vw, 18rem"
                labels={{
                  before: t("sellerHome.before"), after: t("sellerHome.after"),
                  slider: t("sellerHome.gallery.slider", { name }),
                  emptyBefore: t("sellerHome.slot.before"), emptyAfter: t("sellerHome.slot.after"),
                  hint: t("sellerHome.slot.size", { w: g.media.after.width, h: g.media.after.height }),
                }} />
              <div className="flex flex-1 flex-col items-start gap-2.5 px-3.5 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold leading-snug text-ink">{name}</p>
                  <p className="text-[12.5px] text-muted">{t(industryKey(g.industry))}</p>
                </div>
                <button type="button" onClick={() => chooseTaskAndFocusUpload(g.task)} data-do-same={g.task}
                  className="mt-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[rgb(var(--accent)/0.4)] px-3 text-[13px] font-semibold text-accent-strong transition-colors hover:bg-[rgb(var(--accent)/0.08)] dark:text-accent">
                  <ArrowUp size={14} aria-hidden /> {t("sellerHome.gallery.doSame")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
