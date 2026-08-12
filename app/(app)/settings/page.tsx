import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getProfile, getCurrentWorkspace } from "@/lib/services/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { SettingsForm } from "@/components/settings/settings-form";
import { BillingProfileForm, BrandingForm } from "@/components/settings/company-forms";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [profile, workspace] = await Promise.all([
    getProfile(supabase, user.id),
    getCurrentWorkspace(supabase, user.id),
  ]);
  if (!profile) return null;
  const { data: billing } = workspace
    ? await supabase.from("billing_profiles").select("*").eq("workspace_id", workspace.id).maybeSingle()
    : { data: null };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("settings.title")} sub={t("settings.sub")} />
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
    </div>
  );
}
