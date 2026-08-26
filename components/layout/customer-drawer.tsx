"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight, ChevronDown, Home, Images, LifeBuoy, Lightbulb, LogOut, Package,
  Plus, Settings, Shield, Wrench,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { CATEGORIES, VIDEO_ICON as VideoIcon } from "@/lib/categories";
import { IMAGE_EDIT, IMAGE_MODES } from "@/lib/topnav";
import { NavLink } from "./nav-link";
import { Drawer, IslandClose, NavGroupLabel } from "./drawer";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import { Diamond } from "./credits-control";
import { planTone, PLAN_BADGE } from "@/lib/plan-tone";
import { useDrawer } from "./shell-context";
import { cn } from "@/lib/utils";

/**
 * MOBILE MENU — the desktop information architecture folded into a drawer.
 *
 * Top of the panel: the flag and the theme switch as bare controls (no
 * "Język / Motyw" label row — the flag and the sun say what they are), then
 * a COMPACT account card, then accordion sections for Obraz, Wideo and the
 * account. Everything below the fold is collapsible so the whole tree fits
 * without a scroll marathon.
 */
export function CustomerDrawer({ name, email, credits, plan, isAdmin }: {
  name: string; email?: string; credits: number; plan: string; isAdmin: boolean;
}) {
  const { t, locale } = useI18n();
  const { open, setOpen } = useDrawer();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const isFree = plan.trim().toLowerCase() === "free";
  const closeNav = () => setOpen(false);

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      label={t("nav.menu")}
      header={(close) => (
        <div className="island rounded-b-3xl px-3 pb-3.5 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))]">
          {/* CONTROLS FIRST — language and theme, icon-only, at the very top. */}
          <div className="relative flex items-center gap-1">
            <LocaleSwitcher align="left" />
            <ThemeToggle />
            <span className="flex-1" />
            <IslandClose onClick={close} label={t("common.close")} />
          </div>

          {/* COMPACT ACCOUNT CARD — identity and the two numbers on one row. */}
          <div className="relative mt-1 flex items-center gap-3 rounded-2xl bg-[rgb(var(--ink)/0.06)] p-2.5">
            <span aria-hidden className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-e2">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold leading-tight">{name}</p>
              {email && <p className="mt-0.5 truncate text-[11px] text-muted">{email}</p>}
            </div>
            <div className="shrink-0 text-right">
              <span className="metric flex items-center justify-end gap-1 text-[15px] leading-none text-accent">
                <Diamond size={8} />
                {new Intl.NumberFormat(locale).format(credits)}
              </span>
              <span className={cn(
                "mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide",
                PLAN_BADGE[planTone(plan)],
              )}>
                {plan}
              </span>
            </div>
          </div>

          <div className="relative mt-2 flex items-center gap-2">
            <Link href="/credits" className="cta flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold">
              <Plus size={15} aria-hidden />
              {t("nav.topUp")}
            </Link>
            <Link href="/plan"
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[rgb(var(--ink)/0.07)] text-[13px] font-semibold text-muted transition-colors duration-200 hover:text-ink">
              <ArrowUpRight size={14} aria-hidden />
              <span className="truncate">{isFree ? t("nav.upgrade") : t("nav.managePlan")}</span>
            </Link>
          </div>
        </div>
      )}
      footer={
        <>
          {isAdmin && (
            <Link href="/admin"
              className="flex min-h-[46px] items-center gap-3 rounded-xl px-3 text-sm font-semibold text-accent2 transition-colors duration-200 hover:bg-accent2-soft">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent2-soft">
                <Shield size={15} />
              </span>
              {t("nav.admin")}
            </Link>
          )}
          <form method="post" action="/auth/sign-out">
            <button className="flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-muted transition-colors duration-200 hover:bg-raised hover:text-ink">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-raised text-muted">
                <LogOut size={15} />
              </span>
              {t("common.signOut")}
            </button>
          </form>
        </>
      }
    >
      <div className="mb-1">
        <NavLink href="/home" label={t("topnav.home")} icon={Home} onNavigate={closeNav} />
        <NavLink href="/library" label={t("topnav.library")} icon={Images} onNavigate={closeNav} />
      </div>

      {/* OBRAZ — categories, then the two generator modes, then the toolbox. */}
      <Section title={t("topnav.image")} defaultOpen>
        {CATEGORIES.map((c) => (
          <Link
            key={c.key}
            href={`/k/${c.slug}`}
            onClick={closeNav}
            className="flex min-h-[46px] items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink transition-colors duration-200 hover:bg-raised"
            style={{ ["--cat" as string]: c.accent.rgb }}
          >
            <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[rgb(var(--cat))]"
              style={{ background: `rgb(${c.accent.rgb} / 0.18)` }}>
              <c.icon size={15} />
            </span>
            <span className="truncate">{t(`cats.${c.key}`)}</span>
            {c.soon && (
              <span className="ml-auto rounded-full bg-raised px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
                {t("common.soon")}
              </span>
            )}
          </Link>
        ))}
        <div className="my-1.5 border-t border-line" />
        {IMAGE_MODES.map((e) => (
          <NavLink key={e.key} href={e.href} label={t(`mega.${e.key}`)} icon={e.icon} onNavigate={closeNav} />
        ))}
      </Section>

      <Section title={t("mega.edit")}>
        {IMAGE_EDIT.filter((e) => !e.soon).map((e) => (
          <NavLink key={e.key} href={e.href} label={t(`tools.${e.key}.name`)} icon={e.icon} onNavigate={closeNav} />
        ))}
        <NavLink href="/tools" label={t("mega.allTools")} icon={Wrench} onNavigate={closeNav} />
      </Section>

      <Section title={t("topnav.video")}>
        <Link href="/wideo" onClick={closeNav}
          className="flex min-h-[46px] items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink transition-colors duration-200 hover:bg-raised">
          <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--violet)/0.18)] text-[rgb(var(--violet))]">
            <VideoIcon size={15} />
          </span>
          <span className="truncate">{t("video.title")}</span>
          <span className="ml-auto rounded-full bg-raised px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
            {t("common.soon")}
          </span>
        </Link>
      </Section>

      <Section title={t("nav.groups.account")}>
        <NavLink href="/products" label={t("nav.products")} icon={Package} onNavigate={closeNav} />
        <NavLink href="/inspirations" label={t("nav.inspirations")} icon={Lightbulb} onNavigate={closeNav} />
        <NavLink href="/settings" label={t("nav.settings")} icon={Settings} onNavigate={closeNav} />
        <NavLink href="/support" label={t("nav.help")} icon={LifeBuoy} onNavigate={closeNav} />
      </Section>
    </Drawer>
  );
}

/** Collapsible drawer group — the whole tree fits without endless scrolling. */
function Section({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 transition-colors duration-200 hover:bg-raised/60"
      >
        <NavGroupLabel>{title}</NavGroupLabel>
        <ChevronDown size={14} aria-hidden
          className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && <div className="animate-fade">{children}</div>}
    </div>
  );
}
