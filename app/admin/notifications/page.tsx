import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { readIntegration, type TelegramConfig } from "@/lib/server/integrations";
import { NOTIFICATION_EVENTS } from "@/lib/server/notify";
import { PageHeader } from "@/components/ui/page-header";
import { NotificationPrefs, type NotificationPrefRow } from "@/components/admin/notification-prefs";

/**
 * POWIADOMIENIA — the switchboard that decides which events reach Telegram.
 *
 * The catalogue comes from NOTIFICATION_EVENTS rather than from the table: it
 * owns the order, the category and the `wired` flag, and it renders even on a
 * database that has not been seeded yet — every switch simply reads as off.
 * The table contributes exactly one thing, which of those events are on now.
 *
 * readIntegration is used for Telegram on purpose: it answers with hasSecret
 * booleans, so the bot token takes no part in this render.
 */

export default async function AdminNotifications() {
  const supabase = await createClient();

  const [{ dict }, prefs, telegram] = await Promise.all([
    getDictionary(),
    supabase.from("notification_preferences").select("event_type, telegram_enabled"),
    readIntegration<TelegramConfig>(supabase, "telegram"),
  ]);
  const t = makeT(dict);

  // A missing row means "never switched on", which is also the seed's default —
  // so an unseeded table degrades to ten off switches instead of an error page.
  const enabled = new Map((prefs.data ?? []).map((row) => [row.event_type, row.telegram_enabled === true]));
  const rows: NotificationPrefRow[] = NOTIFICATION_EVENTS.map((event) => ({
    type: event.type,
    category: event.category,
    wired: event.wired,
    enabled: enabled.get(event.type) === true,
  }));

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.comm")}
        title={t("comm.notifications")}
        sub={t("comm.notifSub")}
      />
      {/* "Connected" here means the same thing it means on the integrations
          tile — a test that actually posted to the channel. */}
      <NotificationPrefs rows={rows} telegramConnected={telegram.status === "connected"} />
    </div>
  );
}
