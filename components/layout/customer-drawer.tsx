"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { planTone, PLAN_BADGE, firstName } from "@/lib/plan-tone";
import { useDrawer } from "./shell-context";
import { cn } from "@/lib/utils";

/**
 * MOBILE MENU — the desktop information architecture folded into a drawer.
 *
 * The panel is three fixed zones: controls and identity pinned at the top,
 * a navigation tree that scrolls on its own, and sign-out pinned at the
 * bottom so it stays reachable on the shortest phone. Groups are labelled —
 * GŁÓWNE, OBRAZ, GENEROWANIE, EDYTUJ, KONTO — because a flat list of twenty
 * links is not navigation, it is an index.
 */
export function CustomerDrawer({ name, email, credits, plan, isAdmin }: {
  name: string; email?: string; credits: number; plan: string; isAdmin: boolean;
}) {
  const { t, locale } = useI18n();
  const { open, setOpen } = useDrawer();
  const who = firstName(name, email) || name;
  const initial = (who || "?").trim().charAt(0).toUpperCase();
  const tone = planTone(plan);
  const isFree = tone === "free";
  const closeNav = () => setOpen(false);

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      label={t("nav.menu")}
      header={(close) => (
        <div className="px-3 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))]">
          {/* CONTROLS FIRST — language and theme as bare icons. The words
              "Język" and "Motyw" earn nothing next to a flag and a sun. */}
          <div className="flex items-center gap-1">
            <LocaleSwitcher align="left" />
            <ThemeToggle />
            <span className="flex-1" />
            <IslandClose onClick={close} label={t("common.close")} />
          </div>

          {/* ACCOUNT CARD — identity on the left, the two numbers that decide
              what you can do next on the right. */}
          <div className="mt-1 rounded-2xl bg-[rgb(var(--ink)/0.055)] p-3">
            <div className="flex items-center gap-3">
              <span aria-hidden className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[15px] font-bold text-white shadow-e2">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold leading-tight">{who}</p>
                {email && <p className="mt-0.5 truncate text-[11.5px] leading-tight text-muted">{email}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="metric flex items-center gap-1 text-[16px] leading-none text-accent">
                  <Diamond size={8} />
                  {new Intl.NumberFormat(locale).format(credits)}
                </span>
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase leading-none tracking-wide",
                  PLAN_BADGE[tone],
                )}>
                  {plan}
                </span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Link href="/credits" onClick={closeNav}
                className="cta flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold">
                <Plus size={15} aria-hidden />
                {t("nav.topUp")}
              </Link>
              <Link href="/plan" onClick={closeNav}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[rgb(var(--ink)/0.07)] text-[13px] font-semibold text-muted transition-colors duration-200 hover:text-ink">
                <ArrowUpRight size={14} aria-hidden />
                <span className="truncate">{isFree ? t("nav.upgrade") : t("nav.managePlan")}</span>
              </Link>
            </div>
          </div>
        </div>
      )}
      footer={
        <form method="post" action="/auth/sign-out">
          <button className="flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-muted transition-colors duration-200 hover:bg-raised hover:text-ink">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-raised text-muted">
              <LogOut size={15} />
            </span>
            {t("common.signOut")}
          </button>
        </form>
      }
    >
      <Section title={t("nav.groups.main")} defaultOpen>
        <NavLink href="/home" label={t("topnav.home")} icon={Home} onNavigate={closeNav} />
        <NavLink href="/library" label={t("topnav.library")} icon={Images} onNavigate={closeNav} />
      </Section>

      {/* OBRAZ — the six category workspaces, each in its own colour. */}
      <Section title={t("topnav.image")} defaultOpen>
        {CATEGORIES.map((c) => <CategoryRow key={c.key} c={c} t={t} onNavigate={closeNav} />)}
      </Section>

      <Section title={t("nav.groups.create")}>
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
        <SoonRow href="/wideo" label={t("video.title")} onNavigate={closeNav}
          icon={<VideoIcon size={15} />} soonLabel={t("common.soon")} rgb="var(--violet)" />
      </Section>

      <Section title={t("nav.groups.account")} defaultOpen>
        <NavLink href="/products" label={t("nav.products")} icon={Package} onNavigate={closeNav} />
        <NavLink href="/inspirations" label={t("nav.inspirations")} icon={Lightbulb} onNavigate={closeNav} />
        <NavLink href="/settings" label={t("nav.settings")} icon={Settings} onNavigate={closeNav} />
        <NavLink href="/support" label={t("nav.help")} icon={LifeBuoy} onNavigate={closeNav} />
        {isAdmin && (
          <Link href="/admin" onClick={closeNav}
            className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-semibold text-accent2 transition-colors duration-200 hover:bg-accent2-soft">
            <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent2-soft">
              <Shield size={15} />
            </span>
            {t("nav.admin")}
          </Link>
        )}
      </Section>
    </Drawer>
  );
}

/** A category row in the category's own colour, with an honest badge when
 *  the engine does not support it yet. */
function CategoryRow({ c, t, onNavigate }: {
  c: (typeof CATEGORIES)[number];
  t: (k: string) => string;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const active = pathname.startsWith(`/k/${c.slug}`);
  return (
    <Link
      href={`/k/${c.slug}`}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-200",
        active ? "bg-[rgb(var(--cat)/0.12)] font-semibold text-ink" : "font-medium text-ink hover:bg-[rgb(var(--ink)/0.05)]",
      )}
      style={{ ["--cat" as string]: c.accent.rgb }}
    >
      <span aria-hidden className={cn(
        "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-[rgb(var(--cat))] transition-all duration-200",
        active ? "h-6 opacity-100" : "h-2 opacity-0",
      )} />
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[rgb(var(--cat))]"
        style={{ background: `rgb(${c.accent.rgb} / 0.16)` }}>
        <c.icon size={15} />
      </span>
      <span className="min-w-0 flex-1 truncate">{t(`cats.${c.key}`)}</span>
      {c.soon && (
        <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
          {t("common.soon")}
        </span>
      )}
    </Link>
  );
}

/** A destination that exists but cannot generate yet — a real link to a page
 *  that explains itself, never a dead entry. */
function SoonRow({ href, label, icon, soonLabel, rgb, onNavigate }: {
  href: string; label: string; icon: React.ReactNode; soonLabel: string;
  rgb: string; onNavigate: () => void;
}) {
  return (
    <Link href={href} onClick={onNavigate}
      className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink transition-colors duration-200 hover:bg-[rgb(var(--ink)/0.05)]">
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `rgb(${rgb} / 0.16)`, color: `rgb(${rgb})` }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
        {soonLabel}
      </span>
    </Link>
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
        className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 transition-colors duration-200 hover:bg-raised/60"
      >
        <NavGroupLabel>{title}</NavGroupLabel>
        <ChevronDown size={14} aria-hidden
          className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && <div className="animate-fade">{children}</div>}
    </div>
  );
}
