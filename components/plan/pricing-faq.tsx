"use client";
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { FAQ } from "./pricing-config";

/**
 * FAQ — an accordion, one answer open at a time.
 *
 * Every answer is written from what the product actually does today (the
 * webhook, the Stripe account, the ledger); none invents a legal, refund or
 * payment-method rule. The premiere question exists only while the premiere
 * runs. `open` can be set from outside, so "Jak zmienić plan?" on a card lands
 * on the right answer already expanded.
 */
export function PricingFaq({ premiere, open, onOpen }: {
  premiere: boolean;
  open: string | null;
  onOpen: (key: string | null) => void;
}) {
  const { t } = useI18n();
  const base = useId();
  const items = FAQ.filter((f) => f.when !== "premiere" || premiere);

  return (
    <div>
      <p className="text-center text-[12px] font-bold uppercase tracking-[0.16em] text-faint">{t("pricing.faq.overline")}</p>
      <h2 className="sr-only">{t("pricing.faq.title")}</h2>
      <div className="mt-4 divide-y divide-line overflow-hidden rounded-[24px] border border-line bg-surface">
        {items.map((item) => {
          const expanded = open === item.key;
          const button = `${base}-${item.key}-q`;
          const panel = `${base}-${item.key}-a`;
          return (
            <div key={item.key} data-faq={item.key}>
              <h3>
                <button type="button" id={button} aria-expanded={expanded} aria-controls={panel}
                  onClick={() => onOpen(expanded ? null : item.key)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-semibold text-ink transition-colors hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--accent))] sm:px-6">
                  <span>{t(`pricing.faq.${item.key}.q`)}</span>
                  <ChevronDown size={18} aria-hidden
                    className={cn("shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none", expanded && "rotate-180")} />
                </button>
              </h3>
              <div id={panel} role="region" aria-labelledby={button} hidden={!expanded}
                className="px-5 pb-5 text-[14.5px] leading-relaxed text-muted sm:px-6">
                {t(`pricing.faq.${item.key}.a`)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
