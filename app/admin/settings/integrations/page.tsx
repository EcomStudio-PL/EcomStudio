import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import {
  integrationsEncryptionAvailable, readIntegration,
  type CaptchaConfig, type MailConfig, type TelegramConfig,
} from "@/lib/server/integrations";
import { PageHeader } from "@/components/ui/page-header";
import { IntegrationCards } from "@/components/admin/integration-cards";

/**
 * INTEGRACJE — where the mailbox, the Telegram bot and the signup captcha are
 * connected.
 *
 * readIntegration is the only reader used here on purpose: it answers with
 * hasSecret booleans, so no ciphertext and no plaintext is ever part of this
 * render, let alone of the payload sent to the browser. (The captcha SITE key
 * does pass through — it is public by nature, the registration page renders
 * it for every visitor — but the secret key never does.)
 */
export default async function AdminIntegrations() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  const [mail, telegram, captcha] = await Promise.all([
    readIntegration<MailConfig>(supabase, "mail"),
    readIntegration<TelegramConfig>(supabase, "telegram"),
    readIntegration<CaptchaConfig>(supabase, "captcha"),
  ]);

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.system")}
        title={t("comm.integrations")}
        sub={t("comm.integrationsSub")}
      />
      <IntegrationCards
        mail={mail} telegram={telegram} captcha={captcha}
        encryptionReady={integrationsEncryptionAvailable()}
      />
    </div>
  );
}
