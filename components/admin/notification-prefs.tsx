"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CreditCard, History, Mail, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  saveNotificationPreferencesAction, testRegistrationEventAction, testWaitlistEventAction,
  type NotificationTestResult,
} from "@/app/actions/integrations";
import type { AdminEmailReadiness } from "@/lib/server/integrations";
import type { NotificationCategory, NotificationChannel, NotificationEvent } from "@/lib/server/notify";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/record";
import { integrationErrorKey } from "@/components/admin/integration-cards";

/**
 * THE NOTIFICATION SWITCHBOARD.
 *
 * Twenty independent decisions now — ten events times two destinations ("tell
 * me about new mail on Telegram", "keep a registration in the inbox") — so each
 * switch still saves itself the moment it is flipped: there is no Save button to
 * forget and no screen that quietly disagrees with the database. The switch that
 * is saving is the only one that locks, so its neighbour and the rest of the
 * list stay usable, and a refused save flips back rather than leaving the UI
 * claiming a state the database rejected.
 *
 * A switch is only half the truth, though: an event can be switched on for a
 * channel that cannot deliver anything. The two banners say so, the channel's
 * own status line turns amber, and the delivery log at the bottom is where the
 * admin sees what actually left the building.
 */

export type NotificationPrefRow = {
  type: NotificationEvent;
  category: NotificationCategory;
  /** false for the events no module fires yet. The preference is real and
   *  stays toggleable; the badge is what keeps the screen honest about it. */
  wired: boolean;
  telegram: boolean;
  adminEmail: boolean;
};

/** One row of the delivery log, read and formatted server-side: the queue's own
 *  columns, plus the timestamp already rendered in Europe/Warsaw. */
export type NotificationLogRow = {
  id: string;
  /** The stored event_type. Translated when the catalogue knows it. */
  type: string;
  channel: string;
  status: string;
  at: string;
  /** last_error_safe as stored — a stable code or an already-scrubbed sentence. */
  error: string | null;
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

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  telegram: "comm.chTelegram",
  admin_email: "comm.chAdminEmail",
};

const STATUS_LABELS: Record<string, string> = {
  sent: "comm.st.sent",
  failed: "comm.st.failed",
  pending: "comm.st.pending",
  skipped: "comm.st.skipped",
};

const STATUS_TONES: Record<string, "green" | "red" | "amber" | "neutral"> = {
  sent: "green",
  failed: "red",
  // Skipped is closed, not queued: the row will never be retried, which is a
  // different thing to know than "still waiting".
  skipped: "amber",
  pending: "neutral",
};

/**
 * The codes the queue, the dispatcher and the pipeline tests answer with, each
 * mapped to the one sentence that says what to do next. Anything this table
 * does not know is handed to the integrations' own vocabulary, which ends at
 * comm.err.generic — so no code ever reaches a screen raw.
 */
const PIPELINE_ERROR_KEYS: Record<string, string> = {
  no_channel: "comm.testNoChannel",
  admin_email_not_configured: "comm.err.adminEmailMissing",
  smtp_not_configured: "comm.err.mailNotConfigured",
  telegram_not_configured: "comm.tgDisabled",
};

export function pipelineErrorKey(code: string | undefined): string {
  if (!code) return "comm.err.generic";
  return PIPELINE_ERROR_KEYS[code] ?? integrationErrorKey(code, "generic");
}

/**
 * The one place a pipeline test's answer becomes toasts.
 *
 * Three buttons on two screens ask the same question — did the event reach its
 * channels? — so the Poczta card borrows this rather than growing a second
 * vocabulary of its own. Only the channels that did NOT arrive are reported
 * individually; when every one of them sent, one line is the whole story.
 */
export function reportNotificationTest(res: NotificationTestResult, t: (key: string) => string): void {
  if (!res.ok) {
    toast.error(t(pipelineErrorKey(res.error)));
    return;
  }
  const stuck = res.outcomes.filter((outcome) => outcome.status !== "sent");
  if (stuck.length === 0) {
    toast.success(t("comm.testQueued"));
    return;
  }
  for (const outcome of stuck) {
    // A code names the fix; a status without one at least names the state, and
    // the delivery log below carries whatever the server actually said.
    const detail = outcome.error
      ? t(pipelineErrorKey(outcome.error))
      : t(STATUS_LABELS[outcome.status] ?? "comm.st.pending");
    toast.error(`${t(CHANNEL_LABELS[outcome.channel])}: ${detail}`);
  }
}

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

/** Which switch is being saved, and which test is running. The key carries the
 *  channel so flipping Telegram never locks the e-mail switch beside it. */
type SwitchKey = `${string}:${"telegram" | "adminEmail"}`;
type Running = "registration" | "waitlist" | null;

export function NotificationPrefs({ rows, telegramConnected, adminEmail, log }: {
  rows: NotificationPrefRow[];
  telegramConnected: boolean;
  /** Whether the e-mail channel can deliver, and if not, which half is missing. */
  adminEmail: AdminEmailReadiness;
  log: NotificationLogRow[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, setState] = useState(
    () => Object.fromEntries(rows.map((row) => [row.type, { telegram: row.telegram, adminEmail: row.adminEmail }]))
  );
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState<Running>(null);

  const adminEmailReady = adminEmail === "ready";

  async function toggle(type: NotificationEvent, channel: "telegram" | "adminEmail", next: boolean) {
    const key: SwitchKey = `${type}:${channel}`;
    setSaving((prev) => ({ ...prev, [key]: true }));
    setState((prev) => ({ ...prev, [type]: { ...prev[type], [channel]: next } }));
    // One event and one channel per call: the action skips every key the
    // payload omits, so a single flip costs a single UPDATE and cannot
    // overwrite a neighbouring switch that another tab changed in the meantime.
    const res = await saveNotificationPreferencesAction({ [type]: { [channel]: next } });
    setSaving((prev) => ({ ...prev, [key]: false }));
    if (res.ok) {
      toast.success(t("comm.saved"));
      return;
    }
    setState((prev) => ({ ...prev, [type]: { ...prev[type], [channel]: !next } }));
    toast.error(t(res.error === "forbidden" ? "comm.err.forbidden" : "comm.err.generic"));
  }

  async function runTest(which: Exclude<Running, null>) {
    setRunning(which);
    const res = which === "registration" ? await testRegistrationEventAction() : await testWaitlistEventAction();
    setRunning(null);
    reportNotificationTest(res, t);
    // The test wrote outbox rows; the log below is rendered on the server.
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* "Connected" here means the same thing it means on the integrations
          tile — a test that actually posted to the channel. */}
      {!telegramConnected && (
        <Banner>
          {t("comm.tgDisabled")}{" "}
          <IntegrationsLink label={t("comm.integrations")} />
        </Banner>
      )}
      {/* The e-mail equivalent, and it names WHICH half is missing: an
          unconfigured mailbox and a mailbox with nobody to write to are two
          different fixes, in two different fields. */}
      {!adminEmailReady && (
        <Banner>
          {t(adminEmail === "no_recipient" ? "comm.err.adminEmailMissing" : "comm.err.mailNotConfigured")}{" "}
          <IntegrationsLink label={t("comm.integrations")} />
        </Banner>
      )}

      {groupByCategory(rows).map((group) => (
        <Card key={group.category} className="overflow-hidden">
          <CardHeader title={t(`comm.cat.${group.category}`)} icon={CATEGORY_ICONS[group.category]} />
          <ul className="divide-y divide-line border-t border-line">
            {group.rows.map((row) => {
              const label = t(EVENT_LABELS[row.type]);
              return (
                <li key={row.type} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-6 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">{label}</span>
                      {!row.wired && <Badge tone="neutral">{t("comm.pending")}</Badge>}
                    </div>
                    {!row.wired && (
                      <p className="mt-1 text-xs leading-relaxed text-muted">{t("comm.pendingHint")}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:shrink-0">
                    <ChannelSwitch
                      name={t("comm.chTelegram")} event={label}
                      checked={state[row.type]?.telegram === true}
                      saving={saving[`${row.type}:telegram`] === true}
                      deliverable={telegramConnected} warning={t("comm.tgDisabled")}
                      onChange={(next) => void toggle(row.type, "telegram", next)}
                    />
                    <ChannelSwitch
                      name={t("comm.chAdminEmail")} event={label}
                      checked={state[row.type]?.adminEmail === true}
                      saving={saving[`${row.type}:adminEmail`] === true}
                      deliverable={adminEmailReady}
                      warning={t(adminEmail === "no_recipient" ? "comm.err.adminEmailMissing" : "comm.err.mailNotConfigured")}
                      onChange={(next) => void toggle(row.type, "adminEmail", next)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}

      <DeliveryLog
        log={log}
        running={running}
        onTest={(which) => void runTest(which)}
      />
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.08)] px-4 py-3 text-[13px] leading-relaxed text-warning">
      {children}
    </p>
  );
}

function IntegrationsLink({ label }: { label: string }) {
  return (
    <Link href="/admin/settings/integrations" className="font-semibold underline underline-offset-2 hover:opacity-80">
      {label}
    </Link>
  );
}

/**
 * One destination for one event: what it is called, whether it is on, and
 * whether it could deliver if it fired right now. A switch that is on but
 * cannot deliver reads amber rather than accent — the banner above explains it
 * once, and this keeps the promise honest row by row.
 */
function ChannelSwitch({ name, event, checked, saving, deliverable, warning, onChange }: {
  name: string;
  /** The event's label, used only to give the switch a full spoken name. */
  event: string;
  checked: boolean;
  saving: boolean;
  deliverable: boolean;
  warning: string;
  onChange: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const blocked = checked && !deliverable;
  return (
    <div className="flex min-w-[10.5rem] flex-1 items-center justify-between gap-3 sm:flex-none sm:justify-start">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium leading-tight">{name}</p>
        <p
          className={cn(
            "mt-1 flex items-center gap-1.5 text-[11px] leading-tight",
            blocked ? "text-warning" : checked ? "text-accent" : "text-faint"
          )}
          title={blocked ? warning : undefined}
        >
          <span aria-hidden className="dot bg-current" />
          {checked ? t("comm.chActive") : t("comm.chOff")}
        </p>
      </div>
      <Switch checked={checked} disabled={saving} label={`${event} — ${name}`} onChange={onChange} />
    </div>
  );
}

/**
 * HISTORIA WYSYŁEK — the twenty most recent rows of the outbox.
 *
 * It answers the question the switches cannot: a notification that was enqueued
 * and never delivered leaves a row here saying which channel and why, where a
 * screen full of "Aktywne" would keep insisting everything is fine. The two
 * test buttons sit in this header because what they produce is a row in this
 * very list.
 */
function DeliveryLog({ log, running, onTest }: {
  log: NotificationLogRow[];
  running: Running;
  onTest: (which: Exclude<Running, null>) => void;
}) {
  const { t } = useI18n();
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={t("comm.log")} sub={t("comm.logSub")} icon={History}
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={running !== null} onClick={() => onTest("registration")}>
              {running === "registration" ? "…" : t("comm.testRegistration")}
            </Button>
            <Button size="sm" variant="secondary" disabled={running !== null} onClick={() => onTest("waitlist")}>
              {running === "waitlist" ? "…" : t("comm.testWaitlist")}
            </Button>
          </div>
        }
      />
      {log.length === 0 ? (
        <p className="border-t border-line px-4 py-10 text-center text-sm text-muted sm:px-5">{t("comm.logEmpty")}</p>
      ) : (
        // Wide content scrolls inside its own container: the four columns stay
        // side by side on a phone instead of pushing the page sideways.
        <div className="thin-scroll overflow-x-auto border-t border-line">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-faint">
                <th className="px-4 py-2.5 font-semibold sm:px-5">{t("comm.logEvent")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("comm.logChannel")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("comm.logStatus")}</th>
                <th className="px-4 py-2.5 font-semibold sm:px-5">{t("comm.logTime")}</th>
              </tr>
            </thead>
            <tbody>
              {log.map((row) => (
                <tr key={row.id} className="border-t border-line align-top">
                  <td className="px-4 py-3 font-medium sm:px-5">{eventLabel(row.type, t)}</td>
                  <td className="px-4 py-3 text-muted">{channelLabel(row.channel, t)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONES[row.status] ?? "neutral"}>
                      {t(STATUS_LABELS[row.status] ?? "comm.st.pending")}
                    </Badge>
                    <LogError error={row.error} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted sm:px-5">{row.at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The queue stores an event_type, not a translation key. A catalogue event is
 *  translated; anything else — a row from a build this one no longer knows — is
 *  shown as the stored value rather than as a humanised guess. */
function eventLabel(type: string, t: (key: string) => string): string {
  const key = EVENT_LABELS[type as NotificationEvent];
  return key ? t(key) : type;
}

function channelLabel(channel: string, t: (key: string) => string): string {
  const key = CHANNEL_LABELS[channel as NotificationChannel];
  return key ? t(key) : channel;
}

/** The detail under a failed row, quietly: a stable code becomes its sentence,
 *  an already-scrubbed server message is shown as it was stored. */
function LogError({ error }: { error: string | null }) {
  const { t } = useI18n();
  const raw = error?.trim();
  if (!raw) return null;
  const looksLikeCode = /^[a-z][a-z0-9_]{2,40}$/.test(raw);
  const text = looksLikeCode ? t(pipelineErrorKey(raw)) : raw;
  // Clamped, with the whole sentence on the title: a mail server's answer can
  // run to two hundred characters and must not turn one row into a paragraph.
  return <p className="mt-1.5 line-clamp-2 max-w-[26rem] text-[11px] leading-relaxed text-faint" title={text}>{text}</p>;
}
