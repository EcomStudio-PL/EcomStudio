"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  cancelPlanChangeAction, confirmPlanChangeAction, planChangeStatusAction, quotePlanChangeAction,
} from "@/app/actions/plan-change";
import type { ChangeQuote } from "@/lib/billing/plan-change";
import { formatMoney } from "./pricing-model";
import type { BillingPeriod, PlanChangeView } from "./pricing-types";

/**
 * SMART SUBSCRIPTION MANAGEMENT — the customer's side (0181).
 *
 * The dialog shows ONLY what the server computed: it asks for a quote, prints
 * every figure of it, and on confirmation lets the server drive Stripe. When
 * the bank wants the customer (3-D Secure) or another payment method, Stripe.js
 * handles exactly that step; then the page waits for the SIGNED WEBHOOK to
 * settle the change ("completed") — a successful card prompt alone is never
 * reported as done.
 */

let stripeSingleton: Promise<Stripe | null> | null = null;
const stripeFor = (key: string) => (stripeSingleton ??= loadStripe(key));

type Phase =
  | { k: "loading" }
  | { k: "refused"; reason: string }
  | { k: "quote"; changeId: string; quote: ChangeQuote; expiresAt: string }
  | { k: "confirming"; quote: ChangeQuote }
  | { k: "payment"; changeId: string; clientSecret: string; quote: ChangeQuote }
  | { k: "waiting"; changeId: string; quote: ChangeQuote }
  | { k: "done"; quote: ChangeQuote }
  | { k: "scheduled"; quote: ChangeQuote; effectiveAt: string }
  | { k: "failed"; reason: string };

export function PlanChangeTrigger({ planId, period, label, className, view }: {
  planId: string; period: BillingPeriod; label: string; className?: string; view: PlanChangeView;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-plan-change={`${planId}:${period}`} onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      {open && <PlanChangeDialog planId={planId} period={period} view={view} onClose={() => setOpen(false)} />}
    </>
  );
}

export function PlanChangeDialog({ planId, period, view, onClose }: {
  planId: string; period: BillingPeriod; view: PlanChangeView; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    let cancelled = false;
    quotePlanChangeAction(planId, period)
      .then((res) => {
        if (cancelled) return;
        setPhase(res.ok
          ? { k: "quote", changeId: res.offer.changeId, quote: res.offer.quote, expiresAt: res.offer.expiresAt }
          : { k: "refused", reason: res.reason });
      })
      .catch(() => { if (!cancelled) setPhase({ k: "refused", reason: "stripe_error" }); });
    return () => { cancelled = true; };
  }, [planId, period]);

  // After payment: wait for the webhook to settle (up to ~2 minutes).
  const waitForSettlement = useCallback(async (changeId: string, quote: ChangeQuote) => {
    setPhase({ k: "waiting", changeId, quote });
    for (let i = 0; i < 60 && alive.current; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const { status } = await planChangeStatusAction(changeId).catch(() => ({ status: null }));
      if (status === "completed") { if (alive.current) { setPhase({ k: "done", quote }); router.refresh(); } return; }
      if (status && ["released", "canceled", "expired", "failed", "manual_review"].includes(status)) {
        if (alive.current) setPhase({ k: "failed", reason: status === "manual_review" ? "manual_review" : "payment_failed" });
        return;
      }
    }
  }, [router]);

  const confirm = useCallback(async () => {
    if (phase.k !== "quote") return;
    const { changeId, quote } = phase;
    setPhase({ k: "confirming", quote });
    const res = await confirmPlanChangeAction(changeId).catch(() => ({ ok: false as const, reason: "stripe_error" as const }));
    if (!res.ok) { setPhase({ k: "refused", reason: res.reason }); return; }
    if (res.state === "scheduled") { setPhase({ k: "scheduled", quote, effectiveAt: res.effectiveAt ?? quote.effectiveAt }); router.refresh(); return; }
    if (res.state === "paid" || res.state === "processing") { await waitForSettlement(changeId, quote); return; }
    if (res.state === "requires_action") {
      if (!view.publishableKey) { setPhase({ k: "failed", reason: "payments_disabled" }); return; }
      const stripe = await stripeFor(view.publishableKey);
      const out = stripe ? await stripe.handleNextAction({ clientSecret: res.clientSecret }) : null;
      if (!out || out.error) {
        // The bank step was refused or abandoned: the change is cancelled and
        // the reserved credits come back (the server voids the invoice).
        await cancelPlanChangeAction(changeId).catch(() => null);
        setPhase({ k: "failed", reason: "payment_failed" });
        return;
      }
      await waitForSettlement(changeId, quote);
      return;
    }
    if ("clientSecret" in res) setPhase({ k: "payment", changeId, clientSecret: res.clientSecret, quote });
  }, [phase, view.publishableKey, waitForSettlement, router]);

  const abandon = useCallback(async () => {
    if (phase.k === "payment") await cancelPlanChangeAction(phase.changeId).catch(() => null);
    onClose();
  }, [phase, onClose]);

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });

  return (
    <Modal open onClose={phase.k === "confirming" || phase.k === "waiting" ? () => undefined : abandon} title={t("pricing.change.title")} wide portal>
      {phase.k === "loading" && (
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" aria-hidden />{t("pricing.change.loading")}</p>
      )}

      {(phase.k === "refused" || phase.k === "failed") && (
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-sm"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            {t(`pricing.change.refuse.${REFUSALS.has(phase.reason) ? phase.reason : "generic"}`)}</p>
          <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>{t("common.close")}</Button></div>
        </div>
      )}

      {(phase.k === "quote" || phase.k === "confirming") && (
        <div className="space-y-5">
          <Summary quote={phase.quote} date={date} />
          {phase.k === "quote" && (
            <p className="text-xs text-muted">{t("pricing.change.validUntil", { time: new Date(phase.expiresAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })}</p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onClose} disabled={phase.k === "confirming"}>{t("common.cancel")}</Button>
            <Button onClick={confirm} disabled={phase.k === "confirming"} data-plan-change-confirm="">
              {phase.k === "confirming" && <Loader2 size={15} className="mr-1.5 animate-spin" aria-hidden />}
              {phase.quote.timing === "period_end" ? t("pricing.change.confirmScheduled")
                : t("pricing.change.confirmPay", { amount: formatMoney(phase.quote.amountDueCents, phase.quote.currency, 2) })}
            </Button>
          </div>
        </div>
      )}

      {phase.k === "payment" && view.publishableKey && (
        <PaymentStep publishableKey={view.publishableKey} clientSecret={phase.clientSecret} quote={phase.quote}
          onPaid={() => void waitForSettlement(phase.changeId, phase.quote)} onCancel={abandon} />
      )}

      {phase.k === "waiting" && (
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" aria-hidden />{t("pricing.change.waiting")}</p>
      )}

      {phase.k === "done" && (
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-sm"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
            {t("pricing.change.done", { plan: phase.quote.to.name, credits: phase.quote.newCreditsNow })}</p>
          <div className="flex justify-end"><Button onClick={onClose}>{t("common.close")}</Button></div>
        </div>
      )}

      {phase.k === "scheduled" && (
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-sm"><CalendarClock size={16} className="mt-0.5 shrink-0 text-accent2" aria-hidden />
            {t("pricing.change.scheduledDone", { plan: phase.quote.to.name, date: date(phase.effectiveAt) })}</p>
          <div className="flex justify-end"><Button onClick={onClose}>{t("common.close")}</Button></div>
        </div>
      )}
    </Modal>
  );
}

const REFUSALS = new Set([
  "disabled", "payments_disabled", "no_subscription", "subscription_not_active", "cancel_scheduled", "change_in_progress",
  "inflight_usage", "unknown_plan", "not_on_sale", "same_plan", "too_close_to_renewal", "period_ended", "manual_review",
  "quote_expired", "quote_changed", "stripe_error", "payment_failed", "already_paid", "not_authorized", "not_found",
]);

/** Every figure of the quote, as the server computed it. */
function Summary({ quote: q, date }: { quote: ChangeQuote; date: (iso: string) => string }) {
  const { t } = useI18n();
  const money = (c: number) => formatMoney(c, q.currency, 2);
  const per = (p: BillingPeriod) => t(p === "annual" ? "pricing.change.perYear" : "pricing.change.perMonth");
  const pct = Math.round(q.timeLeftShare * 100);
  const rows: [string, string, string?][] = [
    [t("pricing.change.from"), `${q.from.name} · ${t(`pricing.change.period.${q.from.period}`)}`],
    [t("pricing.change.to"), `${q.to.name} · ${t(`pricing.change.period.${q.to.period}`)}`],
    [t("pricing.change.when"), q.timing === "immediate" ? t("pricing.change.now") : t("pricing.change.atDate", { date: date(q.effectiveAt) })],
    [t("pricing.change.listPrice"), `${money(q.listPriceCents)} ${per(q.to.period)}`],
  ];
  if (q.deductionCents > 0 || q.oldPool === "closed") {
    rows.push(
      [t("pricing.change.timeValue"), money(q.timeValueCents), t("pricing.change.timeValueHint", { pct, basis: money(q.basisCents) })],
      [t("pricing.change.creditValue"), money(q.creditValueCents), t("pricing.change.creditValueHint", { n: q.unusedCredits })],
      [t("pricing.change.deduction"), `− ${money(q.deductionCents)}`, t("pricing.change.deductionHint")],
    );
  }
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line rounded-xl border border-line text-sm">
        {rows.map(([label, value, hint]) => (
          <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5">
            <dt className="text-muted">{label}{hint && <span className="block text-xs text-faint">{hint}</span>}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-3">
          <dt className="font-semibold">{q.timing === "immediate" ? t("pricing.change.dueNow") : t("pricing.change.dueLater", { date: date(q.effectiveAt) })}</dt>
          <dd data-plan-change-due className="font-display text-lg font-semibold tabular-nums">{money(q.amountDueCents)}</dd>
        </div>
      </dl>
      <ul className="space-y-1.5 text-[13px] leading-relaxed text-muted">
        <li>• {q.timing === "period_end"
          ? t(q.to.period === "annual" ? "pricing.change.creditsAnnualLater" : "pricing.change.creditsMonthlyLater", { n: q.newCreditsNow, date: date(q.effectiveAt) })
          : q.to.period === "annual"
          ? t("pricing.change.creditsAnnual", { n: q.newCreditsNow })
          : t("pricing.change.creditsMonthly", { n: q.newCreditsNow })}</li>
        <li>• {q.oldPool === "closed" ? t("pricing.change.oldClosed", { n: q.closedCredits })
          : q.oldPool === "kept_until_expiry" ? t("pricing.change.oldKept")
          : t("pricing.change.oldContinues", { date: date(q.effectiveAt) })}</li>
        <li>• {t("pricing.change.otherPools")}</li>
        {q.kind === "downgrade" && q.timing === "immediate" && <li>• {t("pricing.change.noRefund")}</li>}
        <li>• {t("pricing.change.oneSubscription")}</li>
      </ul>
    </div>
  );
}

function PaymentStep({ publishableKey, clientSecret, quote, onPaid, onCancel }: {
  publishableKey: string; clientSecret: string; quote: ChangeQuote; onPaid: () => void; onCancel: () => void;
}) {
  const { locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const options = useMemo(() => ({
    clientSecret,
    locale: (["pl", "en", "de"].includes(locale) ? locale : "pl") as "pl" | "en" | "de",
    appearance: { theme: resolvedTheme === "dark" ? "night" as const : "stripe" as const },
  }), [clientSecret, locale, resolvedTheme]);
  return (
    <Elements stripe={stripeFor(publishableKey)} options={options}>
      <PaymentForm quote={quote} onPaid={onPaid} onCancel={onCancel} />
    </Elements>
  );
}

function PaymentForm({ quote, onPaid, onCancel }: { quote: ChangeQuote; onPaid: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pay = async () => {
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);
    const { error: e } = await stripe.confirmPayment({
      elements, redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}/plan` },
    });
    if (e) { setBusy(false); setError(e.message ?? t("pricing.change.refuse.payment_failed")); return; }
    onPaid();
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("pricing.change.paymentNeeded")}</p>
      <PaymentElement />
      {error && <p className={cn("text-sm text-danger")}>{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>{t("pricing.change.cancelChange")}</Button>
        <Button onClick={pay} disabled={busy || !stripe}>
          {busy && <Loader2 size={15} className="mr-1.5 animate-spin" aria-hidden />}
          {t("pricing.change.confirmPay", { amount: formatMoney(quote.amountDueCents, quote.currency, 2) })}
        </Button>
      </div>
    </div>
  );
}

/** A change already under way: what, when, and a way to cancel it. */
export function PendingPlanChange({ view, planName }: { view: PlanChangeView; planName: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const p = view.pending;
  if (!p) return null;
  const when = p.effectiveAt ? new Date(p.effectiveAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) : "";
  const cancel = async () => {
    setBusy(true);
    const res = await cancelPlanChangeAction(p.id).catch(() => ({ ok: false }));
    setBusy(false);
    if (res.ok) router.refresh(); else setError(true);
  };
  return (
    <div data-plan-change-pending={p.status} className="mx-auto mb-6 flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
      <span className="flex items-center gap-2"><CalendarClock size={16} className="shrink-0 text-accent2" aria-hidden />
        {p.status === "scheduled"
          ? t("pricing.change.pendingScheduled", { plan: planName, date: when })
          : t("pricing.change.pendingPayment", { plan: planName })}
      </span>
      <span className="flex items-center gap-3">
        {error && <span className="text-xs text-danger">{t("pricing.change.refuse.generic")}</span>}
        <Button variant="ghost" onClick={cancel} disabled={busy}>{t("pricing.change.cancelChange")}</Button>
      </span>
    </div>
  );
}
