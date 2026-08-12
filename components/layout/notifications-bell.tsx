"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bell } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { markNotificationsReadAction } from "@/app/actions/notifications";
import { cn } from "@/lib/utils";

export type NotificationItem = {
  id: string; type: string; title: string; body: string | null;
  href: string | null; read_at: string | null; created_at: string;
};

/** Topbar bell: unread badge + near-opaque dropdown. Opening marks all as
 *  read. Titles use i18n keys when known (notif.<type>), else raw title. */
export function NotificationsBell({ items, unread }: { items: NotificationItem[]; unread: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

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

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) start(() => { void markNotificationsReadAction(); });
  }

  const label = (n: NotificationItem) => {
    const translated = t(`notif.${n.type}`);
    return translated === `notif.${n.type}` ? n.title : translated;
  };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={toggle} aria-label={t("notif.title")} aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink">
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent2 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="overlay animate-pop absolute right-0 top-11 z-50 w-80 rounded-2xl p-1.5">
          <p className="border-b border-line px-3 pb-2 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
            {t("notif.title")}
          </p>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">{t("notif.empty")}</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link href={n.href ?? "#"} onClick={() => setOpen(false)}
                    className={cn("block rounded-xl px-3 py-2.5 transition-colors hover:bg-raised", !n.read_at && "bg-accent-soft/40")}>
                    <p className="text-sm font-medium">{label(n)}</p>
                    {n.body && <p className="truncate text-xs text-muted">{n.body}</p>}
                    <p className="mt-0.5 text-[10px] text-faint">{new Date(n.created_at).toLocaleString("pl-PL")}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
