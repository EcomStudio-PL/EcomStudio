"use client";
import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { FaqRichText } from "@/components/faq/faq-rich";
import type { FaqPublicItem } from "@/lib/faq";

/**
 * FAQ — an accordion, one answer open at a time.
 *
 * The questions are the FAQ base's (FAQ V1, lib/server/faq.ts): those marked
 * for /plany, in the visitor's language, the premiere one only while the
 * premiere runs — decided on the server, so a hidden or unfinished answer is
 * never in this page. `open` can be set from outside, so "Jak zmienić plan?"
 * on a card lands on the right answer already expanded.
 */
export function PricingFaq({ items, open, onOpen }: {
  items: readonly Pick<FaqPublicItem, "slug" | "q" | "a">[];
  open: string | null;
  onOpen: (slug: string | null) => void;
}) {
  const { t } = useI18n();
  const base = useId();
  if (items.length === 0) return null;

  return (
    <div>
      <p className="text-center text-[12px] font-bold uppercase tracking-[0.16em] text-muted">{t("pricing.faq.overline")}</p>
      <h2 className="sr-only">{t("pricing.faq.title")}</h2>
      <div className="mt-4 divide-y divide-line overflow-hidden rounded-[24px] border border-line bg-surface" data-faq-shared="plany">
        {items.map((item) => {
          const expanded = open === item.slug;
          const button = `${base}-${item.slug}-q`;
          const panel = `${base}-${item.slug}-a`;
          return (
            // A stable anchor per question (/plany#faq-<slug>); the page opens
            // the one asked for, old #faq-<key> anchors included.
            <div key={item.slug} data-faq={item.slug} id={`faq-${item.slug}`} className="scroll-mt-[calc(var(--header-h)+24px)]">
              <h3>
                <button type="button" id={button} aria-expanded={expanded} aria-controls={panel}
                  onClick={() => onOpen(expanded ? null : item.slug)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-semibold text-ink transition-colors hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--accent))] sm:px-6">
                  <span>{item.q}</span>
                  <ChevronDown size={18} aria-hidden
                    className={cn("shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none", expanded && "rotate-180")} />
                </button>
              </h3>
              <div id={panel} role="region" aria-labelledby={button} hidden={!expanded}
                className="space-y-3 px-5 pb-5 text-[14.5px] leading-relaxed text-muted sm:px-6">
                <FaqRichText rich={item.a} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
