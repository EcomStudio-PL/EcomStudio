"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { loadStripe, type Stripe, type StripeElementsOptions } from "@stripe/stripe-js";
import {
  Elements, PaymentElement, ExpressCheckoutElement, useElements, useStripe,
} from "@stripe/react-stripe-js";
import { ShieldCheck, Lock, ChevronDown, Loader2, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Input, Label } from "@/components/ui/input";
import {
  beginCheckoutAction, saveCheckoutInvoiceAction, type InvoiceDetails,
} from "@/app/actions/checkout";
import {
  startPackageCheckoutAction, startCustomCreditsCheckoutAction, startPlanCheckoutAction,
} from "@/app/actions/billing";
import type { Quote } from "@/lib/server/checkout";

/**
 * /checkout — THE PAYMENT, INSIDE GROVBASE.
 *
 * Two columns on a desktop: what you are paying for on the right, how you are
 * paying on the left. One column on a phone, summary first, because a customer
 * on a small screen wants to confirm WHAT before they think about HOW.
 *
 * ─── WHAT THIS COMPONENT IS NOT ALLOWED TO DO ───────────────────────────────
 *
 * It never computes a total. `quote` arrives priced by the server and is
 * DISPLAYED, not derived — there is no arithmetic in this file beyond dividing
 * by 100 to render złote. If this component could add up an order, the number
 * on the screen and the number on the card could differ, which is the entire
 * failure mode the billing work exists to prevent.
 *
 * It never sees a card number. The Payment Element is a Stripe-hosted iframe;
 * the details go from there to Stripe directly. Nothing in this bundle, and
 * nothing on GrovBase's servers, is ever in a position to read them.
 *
 * It never decides which payment methods exist. `automatic_payment_methods` on
 * the server means STRIPE chooses, per device, country, currency, amount and
 * what is switched on for the account. A hardcoded list here would offer BLIK
 * for a subscription (Stripe does not allow it) and Apple Pay on a Windows
 * desktop, and would need a deploy every time the dashboard changes.
 */

/** Loaded once per page, not per render — `loadStripe` injects a script tag. */
let stripeSingleton: Promise<Stripe | null> | null = null;
function stripeFor(publishableKey: string): Promise<Stripe | null> {
  stripeSingleton ??= loadStripe(publishableKey);
  return stripeSingleton;
}

export type CheckoutViewProps = {
  quote: Quote;
  /** Exactly what the page was opened with, replayed to the server on begin. */
  request: Record<string, unknown>;
  publishableKey: string | null;
  /** Canonical, absolute, grovbase.com — never a deployment hostname. */
  returnUrl: string;
  invoice: InvoiceDetails | null;
  customerEmail: string | null;
  customerName: string | null;
};

export function CheckoutView(props: CheckoutViewProps) {
  // NO PUBLISHABLE KEY → THE OLD ROAD, NOT A CLOSED SHOP.
  //
  // Stripe.js cannot identify the account without it, so the Payment Element
  // cannot mount. That is a deployment-configuration state, not a customer
  // problem, and it must never be the reason somebody cannot buy: this feature
  // REPLACED a working Stripe-hosted checkout, and shipping it without the key
  // would have turned "the payment sheet moved in-house" into "payments are
  // down".
  //
  // So the hosted flow is kept as the fallback. It is the same server actions,
  // the same prices, the same webhook — only the sheet is Stripe's page rather
  // than ours. A preview deployment, or production in the minutes before the
  // key is added, still sells. The embedded sheet takes over by itself the
  // moment NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY exists; nothing else changes.
  if (!props.publishableKey) return <HostedFallback request={props.request} quote={props.quote} />;
  return <Ready {...props} publishableKey={props.publishableKey} />;
}

function HostedFallback({ request, quote }: { request: Record<string, unknown>; quote: Quote }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const go = useCallback(async () => {
    setBusy(true);
    const kind = request.kind;
    const res = kind === "subscription"
      ? await startPlanCheckoutAction(String(request.planId),
          request.period === "annual" ? "annual" : "monthly")
      : kind === "custom_credits"
        ? await startCustomCreditsCheckoutAction(Number(request.credits))
        : await startPackageCheckoutAction(String(request.packageId));

    if (res.ok) { window.location.assign(res.url); return; }
    setBusy(false);
    notify.error(t(
      res.reason === "already_subscribed" ? "packs.alreadySubscribed"
      : res.reason === "invalid_credits" ? "packs.checkoutInvalidCredits"
      : res.reason === "plan_not_purchasable" ? "packs.planNotPurchasable"
      : res.reason === "payments_disabled" || res.reason === "not_mapped"
        ? "packs.checkoutUnavailable"
        : "packs.checkoutFailed",
    ));
  }, [request, t]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
      <OrderSummary quote={quote} className="lg:order-2" />
      <section className="panel rounded-2xl p-5 sm:p-6 lg:order-1">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft/60 text-accent">
            <Lock size={17} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[16px] font-semibold tracking-tight text-ink">
              {t("checkout.hostedTitle")}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t("checkout.hostedBody")}</p>
          </div>
        </div>
        <button
          type="button" onClick={go} disabled={busy}
          className="cta mt-5 h-12 w-full rounded-xl text-sm font-semibold transition-opacity disabled:opacity-70"
        >
          {busy
            ? <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden />{t("packs.redirecting")}</span>
            : t("checkout.hostedCta")}
        </button>
      </section>
    </div>
  );
}

function Ready({
  quote, request, publishableKey, returnUrl, invoice, customerEmail, customerName,
}: CheckoutViewProps & { publishableKey: string }) {
  const { t, locale } = useI18n();
  const { resolvedTheme } = useTheme();

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const started = useRef(false);

  // CREATE THE PAYMENT ONCE PER PAGE. React 18 runs effects twice in
  // development; without this guard that is two PaymentIntents for one visit —
  // harmless (an abandoned intent expires) but noisy on a live account.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    void (async () => {
      const res = await beginCheckoutAction(request);
      if (cancelled) return;
      if (res.ok) {
        setClientSecret(res.clientSecret);
        setReference(res.reference);
      } else {
        setFailure(res.reason);
      }
    })();
    return () => { cancelled = true; };
  }, [request]);

  // The Payment Element is themed from GrovBase's own CSS variables, read off
  // the live document rather than copied as hex. A token that moves in
  // globals.css moves here on the next paint, and the card field never drifts
  // into looking like a third-party widget dropped into the page.
  const appearance = useMemo(() => {
    const read = (name: string, fallback: string) => {
      if (typeof window === "undefined") return fallback;
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return raw ? `rgb(${raw.split("/")[0].trim()})` : fallback;
    };
    return {
      theme: (resolvedTheme === "dark" ? "night" : "stripe") as "night" | "stripe",
      variables: {
        colorPrimary: read("--accent", "#d946ef"),
        colorBackground: read("--sunken", resolvedTheme === "dark" ? "#12101a" : "#ffffff"),
        colorText: read("--ink", resolvedTheme === "dark" ? "#f4f2fa" : "#141019"),
        colorDanger: read("--danger", "#ef4444"),
        fontFamily: "Inter Variable, Inter, system-ui, sans-serif",
        borderRadius: "0.625rem",
        spacingUnit: "4px",
      },
    };
  }, [resolvedTheme]);

  const options: StripeElementsOptions | null = clientSecret
    ? { clientSecret, appearance, locale: (locale as "pl" | "en" | "de") ?? "pl" }
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-5 lg:items-start">
      {/* SUMMARY FIRST IN THE DOM, so a phone shows it first and a screen
          reader reads what is being bought before how to pay. On a desktop it
          is moved to the second column and pinned. */}
      <OrderSummary
        quote={quote}
        className="lg:order-2 lg:sticky lg:top-[5.5rem]"
      />

      <div className="space-y-4 lg:order-1">
        <InvoiceSection
          invoice={invoice}
          customerEmail={customerEmail}
          customerName={customerName}
        />

        <section className="panel rounded-2xl p-4 sm:p-5">
          <header className="mb-3.5 flex items-center justify-between gap-3">
            <h2 className="font-display text-[15px] font-bold uppercase tracking-[0.06em] text-ink">
              {t("checkout.payment")}
            </h2>
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-faint">
              <Lock size={12} aria-hidden />
              {t("checkout.securedBy")}
            </span>
          </header>

          {failure && <Refusal reason={failure} />}

          {!failure && !options && <FormSkeleton label={t("checkout.preparing")} />}

          {!failure && options && (
            <Elements stripe={stripeFor(publishableKey)} options={options}>
              <PaymentPanel
                quote={quote}
                returnUrl={reference ? `${returnUrl}?ref=${reference}` : returnUrl}
                reference={reference}
              />
            </Elements>
          )}
        </section>
      </div>
    </div>
  );
}

/* ── the order, as the server priced it ────────────────────────────────────*/

export function OrderSummary({ quote, className }: { quote: Quote; className?: string }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);

  const money = (cents: number) =>
    new Intl.NumberFormat(locale === "en" ? "en-GB" : locale === "de" ? "de-DE" : "pl-PL", {
      style: "currency", currency: quote.currency, minimumFractionDigits: 2,
    }).format(cents / 100);

  const rows = (
    <>
      <dl className="space-y-2 text-[13px]">
        <Row label={t("checkout.item")} value={quote.title} />
        {quote.recurring && (
          <Row
            label={t("checkout.billing")}
            value={quote.period === "annual" ? t("plans.annual") : t("plans.monthly")}
          />
        )}
        {quote.credits > 0 && (
          <Row
            label={quote.recurring ? t("checkout.creditsPerPeriod") : t("checkout.creditsTotal")}
            value={<span className="tabular-nums">{quote.credits.toLocaleString(locale)}</span>}
          />
        )}
        {quote.bonusCredits > 0 && (
          <Row
            label={t("checkout.bonus")}
            value={
              <span className="rounded-md bg-[rgb(var(--success)/0.16)] px-1.5 py-0.5 font-semibold tabular-nums text-success">
                +{quote.bonusCredits.toLocaleString(locale)}
              </span>
            }
          />
        )}
      </dl>

      <div className="mt-3.5 flex items-baseline justify-between gap-3 border-t border-line pt-3.5">
        <span className="text-[13px] font-semibold text-muted">{t("packs.toPay")}</span>
        <span className="font-display text-[19px] font-semibold tracking-tight tabular-nums text-ink">
          {money(quote.amountCents)}
        </span>
      </div>
      {quote.recurring && (
        <p className="mt-2 text-[11.5px] leading-snug text-faint">
          {quote.period === "annual" ? t("checkout.renewsYearly") : t("checkout.renewsMonthly")}
        </p>
      )}
    </>
  );

  return (
    <aside className={cn("panel rounded-2xl", className)}>
      {/* PHONE: a tappable header that collapses the detail, so the payment
          form is reachable without scrolling past a full order breakdown. The
          total stays visible in the header either way — it is the one number
          that must never be behind a tap. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left lg:hidden"
      >
        <span className="min-w-0">
          <span className="overline block text-faint">{t("checkout.summary")}</span>
          <span className="mt-0.5 block truncate text-[13px] font-semibold text-ink">{quote.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="font-display text-[16px] font-semibold tabular-nums text-ink">
            {money(quote.amountCents)}
          </span>
          <ChevronDown size={15} aria-hidden className={cn("text-faint transition-transform", open && "rotate-180")} />
        </span>
      </button>
      <div className={cn("px-4 pb-4 lg:hidden", !open && "hidden")}>{rows}</div>

      {/* DESKTOP: always open. */}
      <div className="hidden px-5 pb-5 pt-5 lg:block">
        <span className="overline block text-faint">{t("checkout.summary")}</span>
        <div className="mt-3">{rows}</div>
        <ul className="mt-4 space-y-1.5 border-t border-line pt-3.5 text-[11.5px] text-faint">
          <li className="flex items-center gap-1.5">
            <ShieldCheck size={12} aria-hidden className="text-success" />
            {t("checkout.trustSecure")}
          </li>
          {!quote.recurring && (
            <li className="flex items-center gap-1.5">
              <ShieldCheck size={12} aria-hidden className="text-success" />
              {t("packs.noExpiry")}
            </li>
          )}
        </ul>
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

/* ── invoice details ───────────────────────────────────────────────────────*/

/**
 * "I WANT AN INVOICE", AND WHAT THAT HONESTLY MEANS TODAY.
 *
 * The copy here says what the system actually does: the details are stored on
 * the workspace and attached to the Stripe Customer, and Stripe emails a
 * receipt. It does NOT say "Faktura VAT", because GrovBase does not issue a
 * numbered Polish VAT invoice and printing those words next to a checkbox
 * would be a promise the product cannot keep.
 *
 * The fields are the ones `billing_profiles` already has, written back to the
 * same row the Settings screen writes — one store, so an address updated in
 * either place is the address used by both.
 */
function InvoiceSection({ invoice, customerEmail, customerName }: {
  invoice: InvoiceDetails | null;
  customerEmail: string | null;
  customerName: string | null;
}) {
  const { t } = useI18n();
  const [want, setWant] = useState(Boolean(invoice?.company_name || invoice?.vat_id));
  const [form, setForm] = useState<InvoiceDetails>({
    company_name: invoice?.company_name ?? "",
    vat_id: invoice?.vat_id ?? "",
    address_line: invoice?.address_line ?? "",
    postal_code: invoice?.postal_code ?? "",
    city: invoice?.city ?? "",
    country: invoice?.country ?? "PL",
    billing_email: invoice?.billing_email ?? customerEmail ?? "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof InvoiceDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useCallback(async () => {
    setSaving(true);
    const res = await saveCheckoutInvoiceAction(form);
    setSaving(false);
    if (res.ok) notify.success(t("checkout.invoiceSaved"));
    else notify.error(t("common.error"));
  }, [form, t]);

  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <h2 className="font-display text-[15px] font-bold uppercase tracking-[0.06em] text-ink">
        {t("checkout.yourDetails")}
      </h2>

      {/* WHAT WE ALREADY KNOW, shown rather than asked for again. */}
      <div className="mt-3 rounded-xl bg-[rgb(var(--ink)/0.05)] px-3 py-2.5 text-[12.5px]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted">{t("checkout.account")}</span>
          <span className="min-w-0 truncate font-semibold text-ink">{customerEmail ?? "—"}</span>
        </div>
        {customerName && (
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <span className="text-muted">{t("checkout.workspace")}</span>
            <span className="min-w-0 truncate font-semibold text-ink">{customerName}</span>
          </div>
        )}
      </div>

      <label className="mt-3.5 flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={want}
          onChange={(e) => setWant(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-[rgb(var(--accent))]"
        />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-ink">{t("checkout.wantInvoice")}</span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-faint">
            {t("checkout.wantInvoiceHint")}
          </span>
        </span>
      </label>

      {want && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t("company.name")} value={form.company_name ?? ""} onChange={set("company_name")} className="sm:col-span-2" />
          <Field label={t("company.vat")} value={form.vat_id ?? ""} onChange={set("vat_id")} />
          <Field label={t("company.billingEmail")} value={form.billing_email ?? ""} onChange={set("billing_email")} type="email" />
          <Field label={t("company.address")} value={form.address_line ?? ""} onChange={set("address_line")} className="sm:col-span-2" />
          <Field label={t("company.postal")} value={form.postal_code ?? ""} onChange={set("postal_code")} />
          <Field label={t("company.city")} value={form.city ?? ""} onChange={set("city")} />
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line px-4 text-[13.5px] font-semibold text-muted transition-colors hover:text-ink disabled:opacity-70"
            >
              {saving ? t("common.saving") : t("checkout.saveInvoice")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, className, ...rest }: {
  label: string; className?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <Input {...rest} />
    </div>
  );
}

/* ── the payment sheet ─────────────────────────────────────────────────────*/

function PaymentPanel({ quote, returnUrl, reference }: {
  quote: Quote; returnUrl: string; reference: string | null;
}) {
  const { t, locale } = useI18n();
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [wallets, setWallets] = useState(false);
  const [ready, setReady] = useState(false);

  const money = new Intl.NumberFormat(
    locale === "en" ? "en-GB" : locale === "de" ? "de-DE" : "pl-PL",
    { style: "currency", currency: quote.currency, minimumFractionDigits: 2 },
  ).format(quote.amountCents / 100);

  /**
   * Confirm, and go to the screen that asks the SERVER what happened.
   *
   * `redirect: "if_required"` keeps the customer here for cards and wallets and
   * hands them to their bank only for methods that genuinely need it — BLIK and
   * Przelewy24 do, a card usually does not. Either way the journey ends on the
   * same status screen: Stripe's redirect lands on `return_url`, and the
   * no-redirect path navigates there in code.
   *
   * NOTHING IS GRANTED HERE. A `succeeded` PaymentIntent in this callback is
   * not credits in an account — it is a reason to go and ask.
   */
  const confirm = useCallback(async () => {
    if (!stripe || !elements || busy) return;
    setBusy(true);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });
    if (error) {
      setBusy(false);
      // Stripe's own message is customer-facing and localised; a card decline
      // deserves its real reason, not a generic failure.
      notify.error(error.message ?? t("packs.checkoutFailed"));
      return;
    }
    router.push(reference ? `/checkout/status?ref=${reference}` : "/checkout/status");
  }, [stripe, elements, busy, returnUrl, reference, router, t]);

  return (
    <div className="space-y-4">
      {/* WALLETS, only when the device actually has one. The element hides
          itself when it has nothing to show, so the divider below is rendered
          from onReady rather than from a guess about the browser. */}
      <div className={cn(!wallets && "hidden")}>
        <ExpressCheckoutElement
          onReady={(e) => setWallets(Boolean(e.availablePaymentMethods))}
          onConfirm={confirm}
          options={{ buttonHeight: 44 }}
        />
        <div className="relative my-4 text-center">
          <span className="absolute inset-x-0 top-1/2 h-px bg-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.9))]" />
          <span className="relative bg-surface px-3 text-[11.5px] text-faint">{t("checkout.or")}</span>
        </div>
      </div>

      <PaymentElement
        onReady={() => setReady(true)}
        options={{ layout: "tabs" }}
      />

      {!ready && <FormSkeleton label={t("checkout.preparing")} />}

      {/* STICKY ON A PHONE. The form is long once an invoice section is open,
          and a pay button that scrolls away is a button people hunt for.
          `pb-[env(safe-area-inset-bottom)]` keeps it clear of the iOS home
          indicator, which otherwise sits on top of it. */}
      <div className={cn(
        "sticky bottom-0 -mx-4 mt-4 border-t border-line bg-surface/95 px-4 pt-3 backdrop-blur",
        "pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-0 sm:backdrop-blur-none",
      )}>
        <button
          type="button"
          onClick={confirm}
          disabled={!stripe || !ready || busy}
          className="cta h-12 w-full rounded-xl text-sm font-semibold transition-opacity disabled:opacity-70"
        >
          {busy
            ? <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden />{t("checkout.processing")}</span>
            : `${t("checkout.pay")} ${money}`}
        </button>
        <p className="mt-2 text-center text-[11px] leading-snug text-faint">
          {t("checkout.legal")}
        </p>
      </div>
    </div>
  );
}

function FormSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-2.5" role="status" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-11 animate-pulse rounded-xl bg-[rgb(var(--ink)/0.06)]" />
      ))}
    </div>
  );
}

/**
 * Why the till is closed, in the customer's terms.
 *
 * `price_out_of_sync` is the interesting one. It means the catalogue row's
 * displayed price is not provably the amount Stripe would charge, so the sale
 * is refused rather than taken at an amount nobody verified. The customer is
 * told it is temporarily unavailable — which is true — and not given a
 * diagnostic they cannot act on.
 */
function Refusal({ reason }: { reason: string }) {
  const { t } = useI18n();
  const key =
    reason === "already_subscribed" ? "packs.alreadySubscribed"
    : reason === "invalid_credits" ? "packs.checkoutInvalidCredits"
    : reason === "plan_not_purchasable" ? "packs.planNotPurchasable"
    : reason === "price_out_of_sync" || reason === "not_mapped" || reason === "payments_disabled"
      ? "packs.checkoutUnavailable"
      : "packs.checkoutFailed";
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-line bg-sunken px-4 py-3 text-[13px] leading-relaxed text-muted">
      <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0 text-warning" />
      <span>{t(key)}</span>
    </div>
  );
}
