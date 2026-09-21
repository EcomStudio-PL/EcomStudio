"use client";
import { CheckCircle2, Info } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * WHAT COMING BACK FROM STRIPE SAYS — AND WHAT IT CAREFULLY DOES NOT SAY.
 *
 * `?checkout=success` means the customer finished paying on Stripe's page. It
 * does NOT mean the credits have landed, and this banner must never claim they
 * have: the ledger moves when the signed webhook arrives, which is usually a
 * second later and occasionally a minute later. Saying "credits added" here
 * would be a promise made by a query parameter — and a query parameter is
 * something anyone can type.
 *
 * So the copy is "thank you, the credits appear once Stripe confirms", and the
 * balance above it is whatever the ledger actually holds. A customer who
 * refreshes sees the real number, not an optimistic one.
 */
export function CheckoutNotice({ status }: { status: "success" | "cancelled" }) {
  const { t } = useI18n();
  const ok = status === "success";
  const Icon = ok ? CheckCircle2 : Info;
  return (
    <div data-checkout-notice={status} className={cn(
      "mb-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px] leading-relaxed",
      ok
        ? "border-[rgb(var(--success)/0.4)] bg-[rgb(var(--success)/0.1)] text-success"
        : "border-line bg-sunken text-muted",
    )}>
      <Icon size={16} aria-hidden className="mt-0.5 shrink-0" />
      <p>{t(ok ? "packs.checkoutSuccess" : "packs.checkoutCancelled")}</p>
    </div>
  );
}
