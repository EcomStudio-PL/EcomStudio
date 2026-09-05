import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { formatWarsaw } from "@/lib/server/event-context";
import {
  adminEmailReadiness, readIntegration, type MailConfig, type TelegramConfig,
} from "@/lib/server/integrations";
import { NOTIFICATION_EVENTS } from "@/lib/server/notify";
import { PageHeader } from "@/components/ui/page-header";
import {
  NotificationPrefs, type NotificationLogRow, type NotificationPrefRow,
} from "@/components/admin/notification-prefs";

/**
 * POWIADOMIENIA — the switchboard that decides which events reach Telegram and
 * which reach the admin's inbox, and the log of what actually went out.
 *
 * The catalogue comes from NOTIFICATION_EVENTS rather than from the table: it
 * owns the order, the category and the `wired` flag, and it renders even on a
 * database that has not been seeded yet — every switch simply reads as off.
 * The table contributes exactly one thing, which of those switches are on now.
 *
 * readIntegration is used for both integrations on purpose: it answers with
 * hasSecret booleans, so neither the bot token nor the mail password takes any
 * part in this render — only the question they decide, "could this channel
 * deliver anything at all?".
 */

/** Enough history to see the last hour of a busy queue, short enough to stay a
 *  card rather than a page. */
const LOG_LIMIT = 20;

export default async function AdminNotifications() {
  const supabase = await createClient();

  const [{ dict }, prefs, telegram, mail, outbox] = await Promise.all([
    getDictionary(),
    supabase.from("notification_preferences").select("event_type, telegram_enabled, admin_email_enabled"),
    readIntegration<TelegramConfig>(supabase, "telegram"),
    readIntegration<MailConfig>(supabase, "mail"),
    // Admin-only under RLS since 0052, so this is a plain read: newest first,
    // and the payload is deliberately not selected — the log says whether a
    // notification went out, not what a customer typed into a signup form.
    supabase
      .from("notification_outbox")
      .select("id, event_type, channel, status, last_error_safe, created_at, sent_at")
      .order("created_at", { ascending: false })
      .limit(LOG_LIMIT),
  ]);
  const t = makeT(dict);

  // A missing row means "never switched on", which is also the seed's default —
  // so an unseeded table degrades to twenty off switches instead of an error
  // page.
  const stored = new Map((prefs.data ?? []).map((row) => [row.event_type, row]));
  const rows: NotificationPrefRow[] = NOTIFICATION_EVENTS.map((event) => ({
    type: event.type,
    category: event.category,
    wired: event.wired,
    telegram: stored.get(event.type)?.telegram_enabled === true,
    adminEmail: stored.get(event.type)?.admin_email_enabled === true,
  }));

  const log: NotificationLogRow[] = (outbox.data ?? []).map((row) => ({
    id: row.id,
    type: row.event_type,
    channel: row.channel,
    status: row.status,
    // The moment that matters is when the message left; a row that has not gone
    // anywhere yet is stamped with the moment it was queued. Warsaw either way,
    // because the operator reading this is not in UTC.
    at: formatWarsaw(new Date(row.sent_at ?? row.created_at)),
    error: row.last_error_safe,
  }));

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.comm")}
        title={t("comm.notifications")}
        sub={t("comm.notifSub")}
      />
      <NotificationPrefs
        rows={rows}
        telegramConnected={telegram.status === "connected"}
        adminEmail={adminEmailReadiness(mail.config, mail.hasSecret.smtp_password === true)}
        log={log}
      />
    </div>
  );
}
