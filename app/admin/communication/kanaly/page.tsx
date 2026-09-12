import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { encryptionAvailable } from "@/lib/server/crypto";
import {
  integrationsEncryptionAvailable, readIntegration,
  type CaptchaConfig, type MailConfig, type TelegramConfig,
} from "@/lib/server/integrations";
import { SectionHeader } from "@/components/ui/section-header";
import { IntegrationCards } from "@/components/admin/integration-cards";
import { EmailSettingsForm, type EmailSettingsView } from "@/components/admin/email-settings-form";

/**
 * KANAŁY — the wires. The mailbox, the Telegram bot and the signup captcha are
 * connected here, and the sender identity every outgoing message carries is set
 * here too.
 *
 * ONE PLACE TO TYPE AN SMTP HOST.
 *
 * There used to be two: this module's mailbox card and a separate "E-mail"
 * screen, each with its own host, port, encryption, user and password. They
 * wrote to different tables, they disagreed the moment one of them was edited,
 * and an operator had no way of telling which one the mail actually left
 * through. The transport now belongs to the mailbox card alone; the form below
 * keeps only what is genuinely its own — who the mail says it is from — and
 * shows the server settings read-only, with a pointer at the card that owns
 * them.
 *
 * NOTHING ON THIS SCREEN HAS WORDS IN IT. The waitlist confirmation used to be
 * edited here as three loose fields beside the SMTP host, which is why it was
 * the one message with no preview, no draft and no version. It is a template
 * now (waitlist.confirmation:email) and lives in Komunikacja → Szablony with
 * every other message; Kanały is channels and credentials.
 *
 * readIntegration is the only reader used for the integrations on purpose: it
 * answers with hasSecret booleans, so no ciphertext and no plaintext is part of
 * this render, let alone of the payload sent to the browser. (The captcha SITE
 * key does pass through — it is public by nature, the registration page renders
 * it for every visitor — but the secret key never does.)
 */
export default async function CommunicationChannels() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  const [mail, telegram, captcha, emailRow] = await Promise.all([
    readIntegration<MailConfig>(supabase, "mail"),
    readIntegration<TelegramConfig>(supabase, "telegram"),
    readIntegration<CaptchaConfig>(supabase, "captcha"),
    // Everything but the secret. The ciphertext is selected only to answer
    // "is a password stored?" — it never leaves this function.
    supabase
      .from("email_settings")
      .select("from_name, from_email, reply_to, smtp_host, smtp_port, smtp_user, smtp_encryption, smtp_secret_ciphertext, last_tested_at, last_test_status, last_test_error_safe")
      .eq("id", true)
      .maybeSingle(),
  ]);

  const data = emailRow.data;
  const initial: EmailSettingsView = {
    from_name: data?.from_name ?? "GrovBase",
    from_email: data?.from_email ?? "",
    reply_to: data?.reply_to ?? "",
    smtp_host: data?.smtp_host ?? "",
    smtp_port: data?.smtp_port ?? 587,
    smtp_user: data?.smtp_user ?? "",
    smtp_encryption: (data?.smtp_encryption ?? "auto") as EmailSettingsView["smtp_encryption"],
    has_password: Boolean(data?.smtp_secret_ciphertext),
    last_tested_at: data?.last_tested_at ?? null,
    last_test_status: data?.last_test_status ?? null,
    last_test_error_safe: data?.last_test_error_safe ?? null,
  };

  return (
    <div className="space-y-8">
      <div>
        <SectionHeader className="mb-4" title={t("comm.integrations")} sub={t("comm.integrationsSub")} />
        <IntegrationCards
          mail={mail} telegram={telegram} captcha={captcha}
          encryptionReady={integrationsEncryptionAvailable()}
        />
      </div>

      <div>
        <SectionHeader className="mb-4" title={t("launchAdmin.emailTitle")} sub={t("launchAdmin.emailSub")} />
        <EmailSettingsForm
          initial={initial}
          encryptionReady={encryptionAvailable()}
          transportOwnedByMailbox
        />
      </div>
    </div>
  );
}
