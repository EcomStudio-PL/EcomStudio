"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, CreditCard, Mail, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { saveNotificationPreferencesAction } from "@/app/actions/integrations";
import type { NotificationCategory, NotificationEvent } from "@/lib/server/notify";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/record";

/**
 * THE NOTIFICATION SWITCHBOARD.
 *
 * Ten independent decisions ("tell me about new mail", "tell me about a failed
 * generation"), so each switch saves itself the moment it is flipped: there is
 * no Save button to forget and no screen that quietly disagrees with the
 * database. The row that is saving is the only one that locks, so the rest of
 * the list stays usable — and a refused save flips its switch back rather than
 * leaving the UI claiming a state the database rejected.
 */

export type NotificationPrefRow = {
  type: NotificationEvent;
  category: NotificationCategory;
  /** false for the events no module fires yet. The preference is real and
   *  stays toggleable; the badge is what keeps the screen honest about it. */
  wired: boolean;
  enabled: boolean;
};

/** Event → label key. Written out rather than derived from the event name so
 *  a missing translation is a compile error, not a humanised key on screen. */
const EVENT_LABELS: Record<NotificationEvent, string> = {
  "mail.received": "comm.ev.mailReceived",
  "user.registered": "comm.ev.userRegistered",
  "waitlist.signup": "comm.ev.waitlistSignup",
  "payment.received": "comm.ev.paymentReceived",
  "credits.purchased": "comm.ev.creditsPurchased",
  "subscription.created": "comm.ev.subscriptionCreated",
  "subscription.renewed": "comm.ev.subscriptionRenewed",
  "payment.failed": "comm.ev.paymentFailed",
  "subscription.cancelled": "comm.ev.subscriptionCancelled",
  "system.error": "comm.ev.systemError",
};

const CATEGORY_ICONS: Record<NotificationCategory, LucideIcon> = {
  mail: Mail,
  users: Users,
  sales: CreditCard,
  system: AlertTriangle,
};

type Group = { category: NotificationCategory; rows: NotificationPrefRow[] };

/** Groups in the order the events arrive, which is the seed's sort_order —
 *  the categories that already work first, the ones waiting on billing after. */
function groupByCategory(rows: NotificationPrefRow[]): Group[] {
  const groups: Group[] = [];
  for (const row of rows) {
    const group = groups.find((candidate) => candidate.category === row.category);
    if (group) group.rows.push(row);
    else groups.push({ category: row.category, rows: [row] });
  }
  return groups;
}

export function NotificationPrefs({ rows, telegramConnected }: {
  rows: NotificationPrefRow[];
  telegramConnected: boolean;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<Record<string, boolean>>(
    () => Object.fromEntries(rows.map((row) => [row.type, row.enabled]))
  );
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  async function toggle(type: NotificationEvent, next: boolean) {
    setSaving((prev) => ({ ...prev, [type]: true }));
    setState((prev) => ({ ...prev, [type]: next }));
    // One key per call: the action skips every event the payload omits, so a
    // single flip costs a single UPDATE and cannot overwrite a neighbouring
    // switch that another tab changed in the meantime.
    const res = await saveNotificationPreferencesAction({ [type]: next });
    setSaving((prev) => ({ ...prev, [type]: false }));
    if (res.ok) {
      toast.success(t("comm.saved"));
      return;
    }
    setState((prev) => ({ ...prev, [type]: !next }));
    toast.error(t(res.error === "forbidden" ? "comm.err.forbidden" : "comm.err.generic"));
  }

  return (
    <div className="space-y-4">
      {!telegramConnected && (
        <p className="rounded-2xl border border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.08)] px-4 py-3 text-[13px] leading-relaxed text-warning">
          {t("comm.tgDisabled")}{" "}
          <Link href="/admin/settings/integrations" className="font-semibold underline underline-offset-2 hover:opacity-80">
            {t("comm.integrations")}
          </Link>
        </p>
      )}

      {groupByCategory(rows).map((group) => (
        <Card key={group.category} className="overflow-hidden">
          <CardHeader title={t(`comm.cat.${group.category}`)} icon={CATEGORY_ICONS[group.category]} />
          <ul className="divide-y divide-line border-t border-line">
            {group.rows.map((row) => {
              const label = t(EVENT_LABELS[row.type]);
              return (
                <li key={row.type} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">{label}</span>
                      {!row.wired && <Badge tone="neutral">{t("comm.pending")}</Badge>}
                    </div>
                    {!row.wired && (
                      <p className="mt-1 text-xs leading-relaxed text-muted">{t("comm.pendingHint")}</p>
                    )}
                  </div>
                  <Switch
                    checked={state[row.type] === true}
                    disabled={saving[row.type] === true}
                    label={label}
                    onChange={(next) => void toggle(row.type, next)}
                  />
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
