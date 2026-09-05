import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import {
  integrationsEncryptionAvailable, readIntegration,
  type MailConfig, type TelegramConfig,
} from "@/lib/server/integrations";
import { PageHeader } from "@/components/ui/page-header";
import { IntegrationCards } from "@/components/admin/integration-cards";

/**
 * INTEGRACJE — where the mailbox and the Telegram bot are connected.
 *
 * readIntegration is the only reader used here on purpose: it answers with
 * hasSecret booleans, so no ciphertext and no plaintext is ever part of this
 * render, let alone of the payload sent to the browser.
 */
export default async function AdminIntegrations() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  const [mail, telegram] = await Promise.all([
    readIntegration<MailConfig>(supabase, "mail"),
    readIntegration<TelegramConfig>(supabase, "telegram"),
  ]);

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.system")}
        title={t("comm.integrations")}
        sub={t("comm.integrationsSub")}
      />
      <IntegrationCards mail={mail} telegram={telegram} encryptionReady={integrationsEncryptionAvailable()} />
    </div>
  );
}
