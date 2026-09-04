import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { encryptionAvailable } from "@/lib/server/crypto";
import { PageHeader } from "@/components/ui/page-header";
import { EmailSettingsForm, type EmailSettingsView } from "@/components/admin/email-settings-form";

export default async function AdminEmailSettings() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  // Everything but the secret. The ciphertext is selected only to answer
  // "is a password stored?" — it never leaves this function.
  const { data } = await supabase
    .from("email_settings")
    .select("from_name, from_email, reply_to, smtp_host, smtp_port, smtp_user, smtp_encryption, smtp_secret_ciphertext, confirmation_enabled, confirmation_subject, confirmation_body, last_tested_at, last_test_status, last_test_error_safe")
    .eq("id", true)
    .maybeSingle();

  const initial: EmailSettingsView = {
    from_name: data?.from_name ?? "GrovBase",
    from_email: data?.from_email ?? "",
    reply_to: data?.reply_to ?? "",
    smtp_host: data?.smtp_host ?? "",
    smtp_port: data?.smtp_port ?? 587,
    smtp_user: data?.smtp_user ?? "",
    smtp_encryption: (data?.smtp_encryption ?? "auto") as EmailSettingsView["smtp_encryption"],
    has_password: Boolean(data?.smtp_secret_ciphertext),
    confirmation_enabled: data?.confirmation_enabled ?? false,
    confirmation_subject: data?.confirmation_subject ?? "",
    confirmation_body: data?.confirmation_body ?? "",
    last_tested_at: data?.last_tested_at ?? null,
    last_test_status: data?.last_test_status ?? null,
    last_test_error_safe: data?.last_test_error_safe ?? null,
  };

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.system")}
        title={t("launchAdmin.emailTitle")}
        sub={t("launchAdmin.emailSub")}
      />
      <EmailSettingsForm initial={initial} encryptionReady={encryptionAvailable()} />
    </div>
  );
}
