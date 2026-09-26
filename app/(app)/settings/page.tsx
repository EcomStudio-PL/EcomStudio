import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getProfile, getCurrentWorkspace } from "@/lib/services/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { ProfileForm, PreferencesForm } from "@/components/settings/settings-form";
import { BillingProfileForm, BrandingForm } from "@/components/settings/company-forms";
import { TrustedDevices, type TrustedDeviceView } from "@/components/settings/trusted-devices";
import { PasswordReset } from "@/components/settings/password-reset";
import { PlanCard } from "@/components/settings/plan-card";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { LIVE_PLAN_STATUSES, parseSettingsTab, planSummary } from "@/components/settings/tabs";
import { readDeviceHash } from "@/lib/server/login-security";
import { formatWarsaw } from "@/lib/server/event-context";
import { getAvailabilityMap } from "@/lib/server/feature-availability";
import { ensureLaunchBonus } from "@/lib/server/grovnews-billing";
import { defaultStateFor } from "@/lib/features";
import { parseGrovNewsState } from "@/lib/grovnews-billing";
import { GrovNewsBillingCard } from "@/components/grovnews/billing-card";

/**
 * USTAWIENIA KONTA — one page, four tabs: Profil, Konto i bezpieczeństwo,
 * Subskrypcje, Preferencje. (/profile redirects to ?tab=profile.)
 *
 * Everything is read once, here, and every panel is rendered; the tab strip
 * only chooses which one is visible, so switching tabs never refetches.
 * `?tab=` picks the first tab (whitelisted), `#grovnews` opens Subskrypcje.
 */
export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initialTab = parseSettingsTab((await searchParams).tab);
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [profile, workspace] = await Promise.all([
    getProfile(supabase, user.id),
    getCurrentWorkspace(supabase, user.id),
  ]);
  if (!profile) redirect("/login");
  const { data: billing } = workspace
    ? await supabase.from("billing_profiles").select("*").eq("workspace_id", workspace.id).maybeSingle()
    : { data: null };

  // Trusted devices — the sessions that passed the email step-up. Filtered to
  // THIS user explicitly: the RLS policy also lets an admin read every row,
  // and an admin's own settings must list only the admin's own devices. The
  // current device is flagged so the customer knows which one they are
  // looking at.
  const currentHash = await readDeviceHash();
  const { data: deviceRows } = await supabase
    .from("user_trusted_devices")
    .select("id, device_hash, device_label, last_seen_at")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false });
  // GROVNEWS — shown while the module is live, or whenever there is a paid
  // subscription to manage. A due launch claim lands first (no-op after that).
  await ensureLaunchBonus(supabase);
  const [{ data: gnRaw }, availability, { data: planRow }, { data: freePlan }] = await Promise.all([
    supabase.rpc("grovnews_my_state"), getAvailabilityMap(supabase),
    // PLAN GROVBASE — the workspace's live subscription, if any. Newest first,
    // so a replaced row can never outrank the one Stripe bills today.
    workspace
      ? supabase.from("subscriptions")
        .select("status, current_period_end, cancel_at_period_end, stripe_customer_id, provider_subscription_id, subscription_plans(name, slug)")
        .eq("workspace_id", workspace.id).in("status", [...LIVE_PLAN_STATUSES])
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("subscription_plans").select("name").eq("slug", "free").maybeSingle(),
  ]);
  const grovnews = parseGrovNewsState(gnRaw);
  const grovnewsLive = (availability.grovnews ?? defaultStateFor("grovnews")).status === "ACTIVE";
  const showGrovNews = grovnews !== null && (grovnewsLive || grovnews.paid !== null);
  const plan = planSummary(planRow, freePlan?.name ?? null);

  const devices: TrustedDeviceView[] = (deviceRows ?? []).map((d) => ({
    id: d.id,
    label: d.device_label || t("loginSec.thisDevice"),
    lastSeen: formatWarsaw(new Date(d.last_seen_at)),
    isCurrent: currentHash !== null && d.device_hash === currentHash,
  }));

  const profilePanel = (
    <>
      <Card>
        <CardHeader title={t("settings.profile")} sub={workspace ? `${t("settings.workspace")}: ${workspace.name}` : undefined} />
        <div className="p-6">
          <ProfileForm fullName={profile.full_name ?? ""} email={profile.email} />
        </div>
      </Card>
      {workspace && (
        <Card>
          <CardHeader title={t("branding.title")} sub={t("branding.sub")} />
          <div className="p-6">
            <BrandingForm workspaceId={workspace.id} logoUrl={workspace.logo_url ?? null}
              brandColor={workspace.brand_color ?? null} companyName={workspace.company_name ?? null} />
          </div>
        </Card>
      )}
    </>
  );

  const accountPanel = (
    <>
      <Card>
        <CardHeader title={t("settings.password.title")} sub={t("settings.password.sub")} />
        <div className="p-6">
          <PasswordReset email={user.email ?? profile.email} />
        </div>
      </Card>
      <Card>
        <CardHeader title={t("loginSec.devicesTitle")} sub={t("loginSec.devicesSub")} />
        <div className="p-6">
          <TrustedDevices devices={devices} />
        </div>
      </Card>
    </>
  );

  const subscriptionsPanel = (
    <>
      <Card>
        <CardHeader title={t("settings.plan.title")} sub={t("settings.plan.sub")} />
        <div className="p-6">
          <PlanCard plan={plan} t={t} locale={locale} />
        </div>
      </Card>
      {showGrovNews && grovnews && (
        <Card id="grovnews" className="scroll-mt-24">
          <CardHeader title="GrovNews" sub={t("grovnews.billing.sub")} />
          <div className="p-6">
            <GrovNewsBillingCard state={grovnews} onSale={grovnewsLive} />
          </div>
        </Card>
      )}
      {workspace && (
        <Card>
          <CardHeader title={t("company.title")} sub={t("company.sub")} />
          <div className="p-6">
            <BillingProfileForm workspaceId={workspace.id} billing={billing} />
          </div>
        </Card>
      )}
    </>
  );

  const preferencesPanel = (
    <Card>
      <CardHeader title={t("settings.preferences.title")} sub={t("settings.preferences.sub")} />
      <div className="p-6">
        <PreferencesForm />
      </div>
    </Card>
  );

  return (
    <div className="mx-auto min-w-0 max-w-2xl">
      <PageHeader overline={t("nav.groups.account")} title={t("settings.title")} sub={t("settings.sub")} />
      <SettingsTabs initialTab={initialTab} panels={{
        profile: profilePanel,
        account: accountPanel,
        subscriptions: subscriptionsPanel,
        preferences: preferencesPanel,
      }} />
    </div>
  );
}
