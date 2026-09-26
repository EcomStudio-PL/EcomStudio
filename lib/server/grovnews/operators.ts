import "server-only";
import type { Client } from "@/lib/services/workspace";
import { SITE_URL } from "@/lib/site";
import { readIntegrationSecrets, type MailConfig } from "@/lib/server/integrations";
import { bulkMailer, type BulkMailer, type MailIdentity, type SmtpConfig } from "@/lib/server/mailer";
import { renderCampaign } from "@/lib/server/newsletter/render";
import * as store from "./store";

/**
 * OPERATOR COPIES (0128) — the day's digest, also to the few addresses an
 * admin configured in Automatyzacja (at most five; never customers, never
 * hard-coded).
 *
 * The same transport as the newsletter's own test send (sendTestCampaignAction):
 * the one outbound mailbox every GrovBase message uses (read the way the
 * newsletter worker reads it, which works with the job's token as well as an
 * admin session), renderCampaign, bulkMailer — one connection, a handful of
 * messages. Unlike a test it carries no "[TEST]" marker, because it is the
 * real digest. Suppressed addresses are left out by the database
 * (grovnews_operator_recipients), so nothing goes to an address that asked
 * for nothing.
 *
 * BEST EFFORT, NEVER IN THE WAY: a copy that cannot go out is reported as a
 * count in the run's stats; it never fails the run, never touches the
 * subscribers' campaign, and never retries.
 */

export type OperatorMail = { subject: string; preview: string; html: string };
export type OperatorResult = { sent: number; failed: number } | { skipped: "none" | "unavailable" | "no_mailbox" };

/** Injected by tests; production builds the real mailbox. */
export type OperatorDeps = { mailer?: () => Promise<BulkMailer | null> };

async function mailbox(db: Client): Promise<BulkMailer | null> {
  const { config, secrets } = await readIntegrationSecrets<MailConfig>(db, "mail");
  const password = secrets.smtp_password ?? (config.smtp_same_as_imap ? secrets.imap_password : undefined);
  if (!config.smtp_host.trim() || !config.smtp_user.trim() || !password) return null;
  const smtp: SmtpConfig = {
    host: config.smtp_host, port: config.smtp_port, user: config.smtp_user,
    encryption: config.smtp_encryption === "starttls" ? "tls" : config.smtp_encryption === "ssl" ? "ssl" : "auto",
    password,
  };
  const identity: MailIdentity = { from_name: config.from_name || "GrovBase", from_email: config.email, reply_to: config.email };
  return bulkMailer(smtp, identity, { connections: 1, messagesPerConnection: 5, limit: 5, deltaMs: 60_000 });
}

export async function sendOperatorCopies(db: Client, mail: OperatorMail, deps: OperatorDeps = {}): Promise<OperatorResult> {
  let addresses: string[];
  try {
    addresses = await store.operatorRecipients(db);
  } catch {
    return { skipped: "unavailable" };
  }
  if (addresses.length === 0) return { skipped: "none" };
  let mailer: BulkMailer | null;
  try {
    mailer = await (deps.mailer ?? (() => mailbox(db)))();
  } catch {
    mailer = null;
  }
  if (!mailer) return { skipped: "no_mailbox" };
  let sent = 0;
  let failed = 0;
  try {
    for (const to of addresses.slice(0, 5)) {
      try {
        const rendered = renderCampaign({
          editor: "html", blocks: [], bodyHtml: mail.html, subject: mail.subject, preheader: mail.preview,
          merge: { email: to }, unsubscribeUrl: SITE_URL, locale: "pl",
        });
        const result = await mailer.send({
          to, subject: rendered.subject, text: rendered.text, html: rendered.html, messageId: mailer.newMessageId(),
        });
        if (result.sent) sent += 1; else failed += 1;
      } catch {
        failed += 1;
      }
    }
  } finally {
    mailer.close();
  }
  return { sent, failed };
}
