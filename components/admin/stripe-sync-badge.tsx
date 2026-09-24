"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle, RefreshCw, Clock } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { resyncPriceAction } from "@/app/actions/billing-admin";
import type { PriceEntity, PricePeriod } from "@/lib/server/stripe-pricing";

/**
 * IS THIS ROW'S PRICE THE PRICE STRIPE WOULD CHARGE?
 *
 * The admin screen used to show a price and nothing else, which made the two
 * systems look like one. They are not one, they can disagree, and when they do
 * the row stops being sellable — so the screen has to say which state it is in.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT SHOW ─────────────────────────────────────
 *
 * No price id, no product id, no key, no Stripe error body. An admin needs to
 * know whether the entry is safe to sell and how to fix it if not; a Stripe
 * object id on screen is a detail they cannot act on and one more thing to leak
 * into a screenshot in a support thread.
 *
 * 'unknown' is shown as a problem rather than as neutral, because that is what
 * it is: a price nobody has verified against Stripe. It is the state every row
 * had before migration 0117, and `sellable()` refuses to sell it.
 */
export function StripeSyncBadge({ entity, entityId, period = "monthly", status, syncedAt, compact = false }: {
  entity: PriceEntity;
  entityId?: string;
  period?: PricePeriod;
  status: string | null | undefined;
  syncedAt: string | null | undefined;
  compact?: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  const ok = status === "synced";
  const busy = status === "syncing";

  const retry = () => {
    if (!entityId) return;
    start(async () => {
      const res = await resyncPriceAction(entity, entityId, period);
      if (res.ok) { toast.success(t("admin.stripeSynced")); router.refresh(); }
      else toast.error(t("admin.stripeSyncFailed"));
    });
  };

  const when = syncedAt
    ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale === "de" ? "de-DE" : "pl-PL", {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
      }).format(new Date(syncedAt))
    : null;

  if (compact) {
    return (
      <span
        title={ok && when ? `${t("admin.stripeSynced")} · ${when}` : t("admin.stripeSyncProblem")}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
          ok ? "bg-[rgb(var(--success)/0.16)] text-success" : "bg-[rgb(var(--warning)/0.16)] text-warning",
        )}
      >
        {ok ? <CheckCircle2 size={10} aria-hidden /> : <AlertTriangle size={10} aria-hidden />}
        Stripe
      </span>
    );
  }

  return (
    <div className={cn(
      "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[12.5px]",
      ok ? "border-[rgb(var(--success)/0.35)] bg-[rgb(var(--success)/0.08)]"
         : "border-[rgb(var(--warning)/0.4)] bg-[rgb(var(--warning)/0.08)]",
    )}>
      <span className={cn("mt-0.5 shrink-0", ok ? "text-success" : "text-warning")}>
        {ok ? <CheckCircle2 size={15} aria-hidden />
            : busy ? <Clock size={15} aria-hidden />
            : <AlertTriangle size={15} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("font-semibold", ok ? "text-success" : "text-warning")}>
          {ok ? t("admin.stripeSynced") : busy ? t("admin.stripeSyncing") : t("admin.stripeSyncProblem")}
        </p>
        {ok && when && (
          <p className="mt-0.5 text-[11.5px] text-muted">{t("admin.stripeLastSync")}: {when}</p>
        )}
        {!ok && (
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{t("admin.stripeSyncProblemHint")}</p>
        )}
      </div>
      {!ok && entityId && (
        <button
          type="button"
          onClick={retry}
          disabled={pending}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-muted transition-colors hover:text-ink disabled:opacity-70"
        >
          <RefreshCw size={12} aria-hidden className={cn(pending && "animate-spin")} />
          {t("admin.stripeRetry")}
        </button>
      )}
    </div>
  );
}
