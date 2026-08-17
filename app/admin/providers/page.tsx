import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { encryptionAvailable } from "@/lib/server/crypto";
import { PageHeader } from "@/components/ui/page-header";
import { ProviderCard, type ProviderView } from "@/components/admin/provider-card";

export default async function AdminProviders() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const [{ data: providers }, { data: creds }] = await Promise.all([
    supabase.from("ai_providers").select("id, slug, name, active, ai_models(id, active)").order("name"),
    // Only safe, masked metadata is selected — ciphertext never leaves the server.
    supabase.from("ai_provider_credentials")
      .select("provider_id, last_four, updated_at, last_tested_at, last_test_status, last_test_error_safe, base_url, last_image_test_at, last_image_test_status, last_image_test_error_safe"),
  ]);
  const credByProvider = new Map((creds ?? []).map((c) => [c.provider_id, c]));
  const views: ProviderView[] = (providers ?? []).map((p) => {
    const c = credByProvider.get(p.id);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      active: p.active,
      modelsActive: p.ai_models.filter((m) => m.active).length,
      modelsTotal: p.ai_models.length,
      credential: c ? {
        lastFour: c.last_four,
        updatedAt: c.updated_at,
        lastTestedAt: c.last_tested_at,
        lastTestStatus: c.last_test_status,
        lastTestError: c.last_test_error_safe,
        baseUrl: c.base_url,
        lastImageTestAt: c.last_image_test_at,
        lastImageTestStatus: c.last_image_test_status,
        lastImageTestError: c.last_image_test_error_safe,
      } : null,
    };
  });
  const encryptionReady = encryptionAvailable();
  return (
    <div>
      <PageHeader title={t("admin.nav.providers")} sub={t("admin.providersSub")} />
      <div className="grid gap-4 lg:grid-cols-2">
        {views.map((p) => (
          <ProviderCard key={p.id} p={p} encryptionReady={encryptionReady} locale={locale} />
        ))}
      </div>
    </div>
  );
}
