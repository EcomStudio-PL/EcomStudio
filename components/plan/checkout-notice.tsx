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
/**
 * THE REFUSALS, AND WHY THEY ARRIVE HERE AT ALL.
 *
 * /checkout prices an order before it renders anything. When the answer is no
 * — a withdrawn pack, a plan already subscribed to, a price that has not proved
 * it reached Stripe — it bounces back to /plan with the reason rather than
 * showing a payment form for something that cannot be sold.
 *
 * That bounce MUST be explained. Sending someone back to the pricing page with
 * no message is indistinguishable from a click that did nothing, and the next
 * thing they do is click again.
 *
 * `price_out_of_sync` deliberately reads as "temporarily unavailable". It means
 * the displayed price is not provably what Stripe would charge, which is a real
 * outage of that one item — and not something a customer can do anything about.
 */
const REFUSAL_COPY: Record<string, string> = {
  already_subscribed: "packs.alreadySubscribed",
  plan_not_purchasable: "packs.planNotPurchasable",
  invalid_credits: "packs.checkoutInvalidCredits",
  price_out_of_sync: "packs.checkoutUnavailable",
  not_mapped: "packs.checkoutUnavailable",
  payments_disabled: "packs.checkoutUnavailable",
  unknown_package: "packs.checkoutFailed",
  unknown_plan: "packs.checkoutFailed",
  no_server_key: "packs.checkoutUnavailable",
};

export type CheckoutStatus = "success" | "cancelled" | keyof typeof REFUSAL_COPY;

export function CheckoutNotice({ status }: { status: string }) {
  const { t } = useI18n();
  const ok = status === "success";
  const refusal = REFUSAL_COPY[status];
  const Icon = ok ? CheckCircle2 : Info;
  if (!ok && status !== "cancelled" && !refusal) return null;
  return (
    <div data-checkout-notice={status} className={cn(
      "mb-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px] leading-relaxed",
      ok
        ? "border-[rgb(var(--success)/0.4)] bg-[rgb(var(--success)/0.1)] text-success"
        : "border-line bg-sunken text-muted",
    )}>
      <Icon size={16} aria-hidden className="mt-0.5 shrink-0" />
      <p>{t(ok ? "packs.checkoutSuccess" : refusal ?? "packs.checkoutCancelled")}</p>
    </div>
  );
}
