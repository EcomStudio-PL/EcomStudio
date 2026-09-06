import Link from "next/link";
import { notFound } from "next/navigation";
import { Hourglass, Wrench, ShieldAlert, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAvailabilityMap, isAdminUser } from "@/lib/server/feature-availability";
import { ACTIVE_STATE, type FeatureKey, type FeatureState } from "@/lib/features";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";

/**
 * FEATURE GATE — the route-level enforcement of feature availability (C10:
 * a direct URL is exactly as protected as the menu).
 *
 * A server component wrapper: pages render their content as children and the
 * gate decides what actually reaches the browser.
 *   ACTIVE       → children
 *   COMING_SOON  → the "wkrótce" screen (customers)
 *   MAINTENANCE  → the "prace techniczne" screen (customers)
 *   DISABLED     → notFound() — the module does not exist for customers
 *   admin        → children + a preview strip; the role comes from the
 *                  profiles row (C9), never from a query param.
 */
export async function FeatureGate({ feature, children }: {
  feature: FeatureKey;
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const [map, admin] = await Promise.all([getAvailabilityMap(supabase), isAdminUser(supabase)]);
  const state = map[feature] ?? ACTIVE_STATE;

  if (state.status === "ACTIVE") return <>{children}</>;
  if (admin) {
    return (
      <>
        <AdminPreviewStrip state={state} />
        {children}
      </>
    );
  }
  if (state.status === "DISABLED") notFound();
  return <FeatureBlockedScreen state={state} />;
}

/** The customer-facing screen for COMING_SOON and MAINTENANCE. */
async function FeatureBlockedScreen({ state }: { state: FeatureState }) {
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const coming = state.status === "COMING_SOON";
  const Icon = coming ? Hourglass : Wrench;
  const title = state.customTitle ?? t(coming ? "features.comingTitle" : "features.maintenanceTitle");
  const message = state.customMessage ?? t(coming ? "features.comingBody" : "features.maintenanceBody");
  const reopens = state.reopensAt
    ? new Date(state.reopensAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface p-8 text-center shadow-e2">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28"
          style={{ background: "radial-gradient(20rem 8rem at 50% -35%, rgb(var(--accent) / 0.16), transparent 70%)" }} />
        <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgb(var(--accent)/0.14)] text-accent">
          <Icon size={26} aria-hidden />
        </span>
        <span className="relative mt-4 inline-block rounded-full bg-raised px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-faint">
          {t(coming ? "features.badgeSoon" : "features.badgeMaintenance")}
        </span>
        <h1 className="relative mt-3 font-display text-xl font-semibold tracking-tight">{title}</h1>
        <p className="relative mt-2 text-sm leading-relaxed text-muted">{message}</p>
        {reopens && (
          <p className="relative mt-3 text-[13px] font-semibold text-ink">
            {t("features.reopens", { date: reopens })}
          </p>
        )}
        <Link href="/home"
          className="cta relative mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold">
          <ArrowLeft size={15} aria-hidden />
          {t("features.backHome")}
        </Link>
      </div>
    </div>
  );
}

/** What an admin sees on a restricted module: the page itself, plus an honest
 *  strip saying what customers get instead — with the switch one click away. */
async function AdminPreviewStrip({ state }: { state: FeatureState }) {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const statusLabel = t(
    state.status === "COMING_SOON" ? "features.badgeSoon"
      : state.status === "MAINTENANCE" ? "features.badgeMaintenance"
        : "features.badgeDisabled",
  );
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-[rgb(var(--warning)/0.12)] px-3.5 py-2.5 text-[13px] font-medium text-warning">
      <span className="flex items-center gap-2">
        <ShieldAlert size={15} aria-hidden className="shrink-0" />
        {t("features.adminPreview", { status: statusLabel })}
      </span>
      <Link href="/admin/settings/features" className="font-semibold underline underline-offset-2 hover:opacity-80">
        {t("features.manage")}
      </Link>
    </div>
  );
}
