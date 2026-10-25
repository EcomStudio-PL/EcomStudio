"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Bell, CalendarClock, Coins, CreditCard, Gift, Image as ImageIcon, Megaphone, MessageCircle, Pin,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/actions/notifications";
import { applyBell, bellSeeded, refreshBell, useBell } from "@/lib/notifications/bell-store";
import {
  presentNotification, type BellNotification, type BellPayload, type NotificationIcon,
} from "@/lib/notifications/catalog";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

const ICONS: Record<NotificationIcon, LucideIcon> = {
  megaphone: Megaphone, card: CreditCard, calendar: CalendarClock, coins: Coins,
  message: MessageCircle, gift: Gift, image: ImageIcon, alert: AlertTriangle, bell: Bell,
};

type Tab = "important" | "activity";

const markRead = (id: string) => (s: BellPayload): BellPayload => {
  const now = new Date().toISOString();
  const hit = s.important.find((n) => n.id === id && !n.read_at);
  return {
    ...s,
    important: s.important.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)),
    activity: s.activity.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)),
    unread: hit ? Math.max(0, s.unread - 1) : s.unread,
  };
};

const markAll = (s: BellPayload): BellPayload => {
  const now = new Date().toISOString();
  return {
    ...s,
    important: s.important.map((n) => (n.read_at ? n : { ...n, read_at: now })),
    activity: s.activity.map((n) => (n.read_at ? n : { ...n, read_at: now })),
    unread: 0,
  };
};

/**
 * THE BELL (Powiadomienia V2). Two tabs: „Ważne” — what needs the customer
 * (admin messages, payments, balance corrections, support replies) and the
 * ONLY thing the badge counts — and „Aktywność”, the routine record of
 * generations, which never lights the badge. Opening the bell no longer
 * marks everything read: a row is read when it is opened, or when the
 * customer says "mark all".
 *
 * `initial` is the app layout's server copy; a page with its own shell
 * passes none and the bell asks once.
 */
export function NotificationsBell({ initial }: { initial?: BellPayload }) {
  const { t, locale } = useI18n();
  const bell = useBell(initial);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("important");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initial && !bellSeeded()) void refreshBell();
  }, [initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open]);

  const anyUnread = bell.unread > 0 || bell.activity.some((n) => !n.read_at);
  const list = tab === "important" ? bell.important : bell.activity;
  const badge = bell.unread > 9 ? "9+" : String(bell.unread);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });

  function toggle() {
    const next = !open;
    setOpen(next);
    // Fresh on open, without waiting for the next tick.
    if (next) void refreshBell();
  }

  function opened(n: BellNotification) {
    setOpen(false);
    if (n.read_at) return;
    applyBell(markRead(n.id), markNotificationReadAction(n.id).then((r) => {
      if (!r) notify.error(t("notif.v2.markFailed"));
      return r;
    }));
  }

  function readAll() {
    applyBell(markAll, markAllNotificationsReadAction().then((r) => {
      if (!r) notify.error(t("notif.v2.markFailed"));
      return r;
    }));
  }

  return (
    <div ref={ref} className="relative" data-notifications-bell>
      <button type="button" onClick={toggle}
        aria-label={bell.unread > 0 ? `${t("notif.title")} (${bell.unread})` : t("notif.title")}
        aria-expanded={open} aria-haspopup="dialog"
        className="relative flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink lg:h-9 lg:w-9">
        <Bell size={17} aria-hidden />
        {bell.unread > 0 && (
          <span data-bell-badge
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent2 px-1 text-[9px] font-bold text-[rgb(var(--bg))]">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label={t("notif.title")}
          className="overlay animate-pop absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl p-1.5">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 pb-2 pt-1.5">
            <p className="overline">{t("notif.title")}</p>
            <button type="button" onClick={readAll} disabled={!anyUnread} data-bell-read-all
              className="text-[11.5px] font-semibold text-accent transition-opacity hover:underline disabled:cursor-default disabled:opacity-40 disabled:no-underline">
              {t("notif.v2.markAll")}
            </button>
          </div>
          <div role="tablist" aria-label={t("notif.title")} className="flex gap-1 px-1.5 pt-2">
            {(["important", "activity"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} data-bell-tab={k}
                onClick={() => setTab(k)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold transition-colors",
                  tab === k ? "bg-raised text-ink" : "text-muted hover:text-ink",
                )}>
                {t(k === "important" ? "notif.v2.tabImportant" : "notif.v2.tabActivity")}
                {k === "important" && bell.unread > 0 && (
                  <span className="rounded-full bg-accent2 px-1.5 text-[10px] font-bold leading-4 text-[rgb(var(--bg))]">{badge}</span>
                )}
              </button>
            ))}
          </div>
          {list.length === 0 ? (
            <p className="px-3 py-7 text-center text-sm text-muted" data-bell-empty={tab}>
              {t(tab === "important" ? "notif.v2.emptyImportant" : "notif.v2.emptyActivity")}
            </p>
          ) : (
            <ul role="tabpanel" className="mt-1 max-h-[min(24rem,70vh)] overflow-y-auto overscroll-contain">
              {list.map((n) => (
                <li key={n.id}>
                  <NotificationRow n={n} t={t} locale={locale} date={fmt.format(new Date(n.created_at))} onOpen={() => opened(n)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** One row of the bell — also the admin's preview of an announcement. */
export function NotificationRow({ n, t, locale, date, onOpen }: {
  n: BellNotification; t: ReturnType<typeof useI18n>["t"]; locale: string; date: string; onOpen?: () => void;
}) {
  const p = presentNotification(n, t, locale);
  const Icon = ICONS[p.icon];
  const unread = !n.read_at;
  const bonus = n.type === "bonus";
  const body = (
    <>
      <span aria-hidden className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
        n.pinned || bonus ? "bg-[rgb(var(--accent)/0.16)] text-accent" : "bg-raised text-muted",
      )}>
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn("min-w-0 flex-1 truncate text-[13px]", unread ? "font-semibold" : "font-medium")}>{p.title}</span>
          {n.pinned && <Pin size={11} aria-label={t("notif.v2.pinned")} className="shrink-0 text-accent" />}
          {bonus && (
            <span className="shrink-0 rounded-full bg-[rgb(var(--accent)/0.2)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
              {t("bonus.badge")}
            </span>
          )}
          {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent2" aria-label={t("notif.v2.unreadDot")} />}
        </span>
        {p.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{p.body}</span>}
        {p.cta && <span className="mt-1 inline-block text-[11.5px] font-semibold text-accent">{p.cta} →</span>}
        <span className="mt-0.5 block text-[10px] text-faint">{date}</span>
      </span>
    </>
  );
  const cls = cn(
    "flex w-full gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-raised",
    unread && "bg-accent-soft/40",
  );
  if (!onOpen) {
    // The admin's preview: what the customer will see, inert.
    return <div className={cls} data-notification-preview>{body}</div>;
  }
  if (p.link?.external) {
    return <a href={p.link.href} target="_blank" rel="noopener noreferrer" onClick={onOpen} className={cls} data-notification={n.type}>{body}</a>;
  }
  if (p.link) {
    return <Link href={p.link.href} onClick={onOpen} className={cls} data-notification={n.type}>{body}</Link>;
  }
  return <button type="button" onClick={onOpen} className={cls} data-notification={n.type}>{body}</button>;
}
