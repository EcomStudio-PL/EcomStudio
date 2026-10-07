"use client";
import { useRef } from "react";
import Link from "next/link";
import { Coins, Crown } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Modal } from "@/components/ui/modal";
import { formatCount, formatMoney, planCheckoutHref } from "@/components/plan/pricing-model";
import { useDialogFocus } from "./dialog-focus";

/** What the dialog shows of the PRO plan — read from subscription_plans. */
export type ProOfferView = {
  id: string;
  name: string;
  priceCents: number;
  credits: number;
  currency: string;
  /** Checkout can sell it right now. Otherwise the button opens /plan. */
  payable: boolean;
};

/**
 * NOT ENOUGH CREDITS FOR ONE IMAGE — shown by /home only, before anything is
 * started. Presentation only: the plan's name, price and credits are the
 * subscription_plans row, the buttons go to the EXISTING checkout intent
 * (/checkout?kind=subscription…) or to /plan for a one-off top-up. Nothing
 * here charges, grants or prices anything; the tools' own refusal of a short
 * balance is untouched.
 */
export function NoCreditsModal({ open, onClose, balance, perImage, pro }: {
  open: boolean;
  onClose: () => void;
  balance: number;
  perImage: number | null;
  pro: ProOfferView | null;
}) {
  const { t } = useI18n();
  const body = useRef<HTMLDivElement>(null);
  useDialogFocus(open, body);
  const proHref = pro?.payable ? planCheckoutHref(pro.id, "monthly") : "/plan";
  return (
    <Modal open={open} onClose={onClose} title={t("sellerHome.noCredits.title")} portal wide>
      <div ref={body}>
      <p className="text-[14px] leading-relaxed text-muted" data-no-credits>
        {t("sellerHome.noCredits.body", { balance: formatCount(balance), per: formatCount(perImage ?? 0) })}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {pro && (
          <Link href={proHref} onClick={onClose} data-no-credits-pro
            className="group flex flex-col rounded-2xl border-2 border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.07)] p-4 transition-colors hover:bg-[rgb(var(--accent)/0.11)]">
            <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-accent-strong dark:text-accent">
              <Crown size={14} aria-hidden /> {pro.name}
            </span>
            <span className="metric mt-2 text-[1.625rem] leading-none text-ink">
              {formatMoney(pro.priceCents, pro.currency)}
              <span className="ml-1 text-[13px] font-medium text-muted">{t("sellerHome.noCredits.perMonth")}</span>
            </span>
            <span className="mt-1.5 text-[13px] text-muted">{t("sellerHome.noCredits.proCredits", { n: formatCount(pro.credits) })}</span>
            <span className="cta mt-4 inline-flex h-11 items-center justify-center rounded-xl text-[14px] font-semibold [--accent:var(--accent-strong)]">
              {t("sellerHome.noCredits.proCta")}
            </span>
          </Link>
        )}
        <Link href="/plan" onClick={onClose} data-no-credits-topup
          className="flex flex-col rounded-2xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.6))] bg-[rgb(var(--surface)/0.6)] p-4 transition-colors hover:bg-raised">
          <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-muted">
            <Coins size={14} aria-hidden /> {t("sellerHome.noCredits.topupTitle")}
          </span>
          <span className="mt-2 text-[14px] leading-snug text-ink/90">{t("sellerHome.noCredits.topupBody")}</span>
          <span className="mt-auto inline-flex h-11 items-center justify-center rounded-xl border border-line-strong pt-0 text-[14px] font-semibold text-ink transition-colors hover:bg-surface">
            {t("sellerHome.noCredits.topupCta")}
          </span>
        </Link>
      </div>
      </div>
    </Modal>
  );
}
