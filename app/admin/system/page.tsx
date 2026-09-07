import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { REGISTRATION_SETTINGS_KEY } from "@/lib/server/registration-config";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SettingsEditor } from "@/components/admin/inline-controls";
import { FlagManager } from "@/components/admin/flag-manager";
import { readSystemHealth } from "@/lib/services/admin-health";
import { HealthGrid } from "@/components/admin/health-grid";

const SECTION_ORDER = ["general", "user_defaults", "generation", "generator_ui", "retouch", "credits", "security", "features", "billing"];

export default async function AdminSystem() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const d24 = new Date(Date.now() - 86400000).toISOString();
  const [{ data }, { data: flags }, health, failed24] = await Promise.all([
    supabase.from("app_settings").select("key, value"),
    supabase.from("feature_flags").select("*").order("flag"),
    readSystemHealth(supabase),
    supabase.from("usage_events").select("id", { count: "exact", head: true })
      .in("status", ["failed", "refunded"]).gte("created_at", d24),
  ]);
  const sections = (data ?? [])
    // The registration row has a real editor of its own, one card below. Here
    // it would arrive as seven raw text inputs holding the words "hidden" /
    // "optional" / "required" — the same setting, spelled worse, and typo-able
    // into a value the forms would silently ignore.
    .filter((s) => s.key !== REGISTRATION_SETTINGS_KEY)
    .sort((a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key))
    .map((s) => ({ key: s.key, value: (s.value ?? {}) as Record<string, unknown> }));
  const isDev = SUPABASE_URL.includes("ezyhwkcrrysanbcbkzsq");

  return (
    <div>
      <PageHeader overline={t("admin.navGroups.system")} title={t("admin.nav.advanced")} sub={t("admin.systemSub")} />

      <Card className="mb-5">
        <CardHeader title={t("health.title")} sub={t("health.verifiedOnly")} />
        <div className="p-5 pt-0">
          {/* Every row here comes from readSystemHealth(), which refuses to
              colour anything it has not actually checked. The row this card
              used to carry — "Vercel · Połączono" in green, with no request
              behind it — is gone; the runtime now reports the environment it
              is genuinely running in, or nothing. */}
          <HealthGrid
            checks={health}
            labels={{
              ok: t("health.connected"),
              fail: t("health.error"),
              unknown: t("health.unverified"),
              never: t("health.neverChecked"),
            }}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-xl bg-raised px-3.5 py-2.5 text-sm">
              <span className="text-muted">{t("health.failed24")}</span>
              <Badge tone={(failed24.count ?? 0) > 0 ? "danger" : "success"}>{failed24.count ?? 0}</Badge>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-raised px-3.5 py-2.5 text-sm">
              <span className="text-muted">{t("admin.sysEnv")}</span>
              <span className="flex items-center gap-2">
                <code className="text-xs">{SUPABASE_URL.replace("https://", "").split(".")[0]}</code>
                <Badge tone={isDev ? "info" : "success"}>{isDev ? "DEV" : "PROD"}</Badge>
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader title={t("flags.title")} sub={t("flags.sub")} />
        <div className="p-5"><FlagManager flags={flags ?? []} /></div>
      </Card>

      {/* Where the registration row went. A whole tile rather than a link in a
          corner: the signup fields are the first thing an operator changes
          here, and the generic editor above no longer offers them. */}
      <Card className="mb-5">
        <Link href="/admin/settings/registration" data-registration-link
          className="flex items-center gap-4 rounded-2xl p-5 transition-colors hover:bg-raised">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t("reg.title")}</span>
            <span className="mt-1 block text-[13px] leading-relaxed text-muted">{t("reg.sub")}</span>
          </span>
          <ChevronRight size={16} aria-hidden className="shrink-0 text-faint" />
        </Link>
      </Card>

      <SettingsEditor sections={sections} />
    </div>
  );
}
