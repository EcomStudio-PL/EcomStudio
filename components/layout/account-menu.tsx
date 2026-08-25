"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, LifeBuoy, LogOut, Plus, Settings, Shield, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { creditLevel, CREDIT_METER_CLASS, CREDIT_REFERENCE } from "@/lib/credit-level";
import { cn } from "@/lib/utils";
import { Diamond } from "./credits-control";

/**
 * ACCOUNT POPOVER — a 340px panel anchored under the avatar, not a modal.
 *
 * Order matches what people come here for: who am I, what plan am I on, how
 * many credits are left (with a meter), buy more, upgrade, then the settings
 * links, then sign out. The admin entry appears only for admins.
 */
export function AccountMenu({ name, email, credits, plan, isAdmin }: {
  name: string; email?: string; credits: number; plan: string; isAdmin: boolean;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const level = creditLevel(credits);
  const isFree = plan.trim().toLowerCase() === "free";

  useEffect(() => { setOpen(false); }, [pathname]);
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("topnav.account")}
        className={cn(
          "brand-gradient flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shadow-e2 ring-1 transition-all duration-200",
          open ? "ring-2 ring-[rgb(var(--accent)/0.75)]" : "ring-white/15 hover:ring-white/35",
        )}
      >
        {initial}
      </button>

      {open && (
        <div role="menu"
          className="overlay animate-pop absolute right-0 top-full z-50 mt-2 w-[21rem] overflow-hidden rounded-2xl">
          {/* IDENTITY */}
          <div className="flex items-center gap-3 px-4 pb-3 pt-4">
            <span aria-hidden className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-e2">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">{name}</p>
              {email && <p className="mt-0.5 truncate text-xs text-faint">{email}</p>}
            </div>
          </div>

          {/* PLAN + CREDITS */}
          <div className="mx-3 rounded-xl bg-[rgb(var(--ink)/0.05)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="overline text-[9.5px]">{t("account.plan")}</span>
              <span className="rounded-full bg-[rgb(var(--accent)/0.16)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">
                {plan}
              </span>
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="overline text-[9.5px]">{t("account.credits")}</span>
              <span className="metric flex items-center gap-1.5 text-[17px] leading-none text-ink">
                <Diamond size={8} />
                {new Intl.NumberFormat(locale).format(credits)}
              </span>
            </div>
            <span className="mt-2 block h-[4px] w-full overflow-hidden rounded-full bg-[rgb(var(--ink)/0.12)]">
              <span className={cn("block h-full rounded-full transition-[width] duration-300", CREDIT_METER_CLASS[level])}
                style={{ width: `${Math.max(4, Math.min(1, credits / CREDIT_REFERENCE) * 100)}%` }} />
            </span>
            <div className="mt-3 flex items-center gap-2">
              <Link href="/credits" className="cta flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold">
                <Plus size={14} aria-hidden />
                {t("account.topUp")}
              </Link>
              <Link href="/plan"
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[rgb(var(--ink)/0.07)] text-[13px] font-semibold text-muted transition-colors duration-200 hover:bg-[rgb(var(--ink)/0.12)] hover:text-ink">
                <ArrowUpRight size={14} aria-hidden />
                {isFree ? t("account.upgrade") : t("nav.managePlan")}
              </Link>
            </div>
          </div>

          {/* LINKS */}
          <div className="p-1.5 pt-2">
            <Item href="/settings" icon={User} label={t("account.profile")} />
            <Item href="/settings" icon={Settings} label={t("account.settings")} />
            <Item href="/support" icon={LifeBuoy} label={t("account.help")} />
            {isAdmin && <Item href="/admin" icon={Shield} label={t("account.admin")} tone="accent2" />}
          </div>

          <form method="post" action="/auth/sign-out" className="border-t border-line p-1.5">
            <button role="menuitem"
              className="flex min-h-[40px] w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium text-muted transition-colors duration-200 hover:bg-raised hover:text-ink">
              <LogOut size={15} aria-hidden className="text-faint" />
              {t("common.signOut")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Item({ href, icon: Icon, label, tone }: {
  href: string; icon: LucideIcon; label: string; tone?: "accent2";
}) {
  return (
    <Link role="menuitem" href={href}
      className={cn(
        "flex min-h-[40px] items-center gap-2.5 rounded-xl px-3 text-sm font-medium transition-colors duration-200 hover:bg-raised",
        tone === "accent2" ? "text-accent2 hover:bg-accent2-soft" : "text-ink",
      )}>
      <Icon size={15} aria-hidden className={tone === "accent2" ? "" : "text-faint"} />
      {label}
    </Link>
  );
}
