"use client";
import { useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { openBillingPortalAction } from "@/app/actions/billing";

/**
 * STRIPE'S OWN BILLING SCREEN.
 *
 * Cards, invoices, and cancelling a subscription happen there, so GrovBase
 * never stores a card number, never renders a cancellation flow and never has
 * to keep an invoice list in step with Stripe's.
 *
 * THE CUSTOMER ID IS NEVER A PARAMETER. The action resolves it from the
 * session's workspace through a server-owned table; a portal session opened
 * for an id sent by the browser would be a session into somebody else's
 * billing history.
 *
 * A workspace that has never paid has no Stripe customer and nothing to
 * manage — the action answers `no_customer` and this says so, rather than
 * creating an empty customer just to have a page to open.
 */
export function BillingPortalButton() {
  const { t } = useI18n();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      data-billing-portal
      disabled={pending}
      onClick={() => start(async () => {
        // A SERVER ACTION CAN THROW, and the money path now deliberately does
        // — a failed customer lookup raises rather than pretending there is no
        // customer. Without this catch the rejection is unhandled and the
        // button simply does nothing, which is the one outcome a person cannot
        // act on.
        let res;
        try {
          res = await openBillingPortalAction();
        } catch {
          toast.error(t("packs.checkoutFailed"));
          return;
        }
        if (res.ok) { window.location.assign(res.url); return; }
        toast.error(t(
          res.reason === "no_customer" ? "packs.portalNoCustomer" : "packs.checkoutFailed",
        ));
      })}
      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-line px-4 text-[13.5px] font-semibold text-muted transition-colors hover:text-ink disabled:opacity-70"
    >
      {pending ? t("packs.redirecting") : t("packs.manageBilling")}
      <ExternalLink size={14} aria-hidden />
    </button>
  );
}
