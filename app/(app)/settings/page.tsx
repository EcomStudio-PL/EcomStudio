import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getProfile, getCurrentWorkspace } from "@/lib/services/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { SettingsForm } from "@/components/settings/settings-form";
import { BillingProfileForm, BrandingForm } from "@/components/settings/company-forms";
import { TrustedDevices, type TrustedDeviceView } from "@/components/settings/trusted-devices";
import { readDeviceHash } from "@/lib/server/login-security";
import { formatWarsaw } from "@/lib/server/event-context";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
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

  // Trusted devices — the sessions that passed the email step-up. RLS scopes
  // the read to this user's own rows; the current device is flagged so the
  // customer knows which one they are looking at.
  const currentHash = await readDeviceHash();
  const { data: deviceRows } = await supabase
    .from("user_trusted_devices")
    .select("id, device_hash, device_label, last_seen_at")
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false });
  const devices: TrustedDeviceView[] = (deviceRows ?? []).map((d) => ({
    id: d.id,
    label: d.device_label || t("loginSec.thisDevice"),
    lastSeen: formatWarsaw(new Date(d.last_seen_at)),
    isCurrent: currentHash !== null && d.device_hash === currentHash,
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader overline={t("nav.groups.account")} title={t("settings.title")} sub={t("settings.sub")} />
      <Card>
        <CardHeader title={t("settings.profile")} sub={workspace ? `${t("settings.workspace")}: ${workspace.name}` : undefined} />
        <div className="p-6">
          <SettingsForm fullName={profile.full_name ?? ""} email={profile.email} />
        </div>
      </Card>
      {workspace && (
        <>
          <Card className="mt-5">
            <CardHeader title={t("company.title")} sub={t("company.sub")} />
            <div className="p-6">
              <BillingProfileForm workspaceId={workspace.id} billing={billing} />
            </div>
          </Card>
          <Card className="mt-5">
            <CardHeader title={t("branding.title")} sub={t("branding.sub")} />
            <div className="p-6">
              <BrandingForm workspaceId={workspace.id} logoUrl={workspace.logo_url ?? null}
                brandColor={workspace.brand_color ?? null} companyName={workspace.company_name ?? null} />
            </div>
          </Card>
        </>
      )}
      <Card className="mt-5">
        <CardHeader title={t("loginSec.devicesTitle")} sub={t("loginSec.devicesSub")} />
        <div className="p-6">
          <TrustedDevices devices={devices} />
        </div>
      </Card>
    </div>
  );
}
