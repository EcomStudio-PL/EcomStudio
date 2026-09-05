import Link from "next/link";
import { MailWarning } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { readIntegration, type MailConfig } from "@/lib/server/integrations";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { MailClient } from "@/components/admin/mail-client";

/**
 * POCZTA — the shop's mailbox inside the admin panel.
 *
 * This page renders no mail. Every folder, message and body is fetched by the
 * client through the server actions in app/actions/mail.ts, because a mailbox
 * is live state and an IMAP round trip has no business inside a page render.
 *
 * readIntegration is the only reader used here, and deliberately so: it answers
 * with hasSecret booleans, so no password — encrypted or otherwise — is part of
 * this render or of the payload handed to the browser.
 */
export default async function AdminMail() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  const mail = await readIntegration<MailConfig>(supabase, "mail");
  // The same three things app/actions/mail.ts requires before it opens a
  // connection. Without them every pane would answer with the same error, so
  // the screen says it once instead and points at the fix.
  const configured = mail.config.imap_host.trim() !== ""
    && mail.config.imap_user.trim() !== ""
    && mail.hasSecret.imap_password === true;

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.comm")}
        title={t("comm.mailboxTitle")}
        sub={mail.config.email}
      />

      {configured ? (
        <MailClient address={mail.config.email} />
      ) : (
        <EmptyState
          icon={MailWarning}
          title={t("comm.err.notConfigured")}
          body={t("comm.mailTileSub")}
          action={
            <Link
              href="/admin/settings/integrations"
              className="cta inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold"
            >
              {t("comm.integrations")}
            </Link>
          }
        />
      )}
    </div>
  );
}
