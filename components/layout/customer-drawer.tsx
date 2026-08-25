"use client";
import Link from "next/link";
import {
  ArrowUpRight, Home, Images, LifeBuoy, Lightbulb, LogOut, Package, Plus,
  Settings, Shield, Wrench,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { IMAGE_CREATE, IMAGE_EDIT, IMAGE_MODES, VIDEO_ICON } from "@/lib/topnav";
import { NavLink } from "./nav-link";
import { Drawer, IslandClose, NavGroupLabel } from "./drawer";
import { AccountIsland } from "./account-island";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import { useDrawer } from "./shell-context";

/** THE mobile menu — the same information architecture as the desktop top
 *  bar, folded into a drawer: TWÓRZ (image categories + the two generator
 *  modes), EDYTUJ (the toolbox), WIDEO (honest "wkrótce"), then Biblioteka
 *  and account. Closes via X, overlay tap, Escape and navigation. */
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
        <AccountIsland
          initial={initial}
          name={name}
          email={email}
          close={<IslandClose onClick={close} label={t("common.close")} />}
          facts={[
            { label: t("nav.credits"), value: `◆ ${new Intl.NumberFormat(locale).format(credits)}` },
            { label: t("nav.plan"), value: plan, tone: "accent2" },
          ]}
          primaryAction={{ href: "/credits", label: t("nav.topUp"), icon: Plus }}
          secondaryActions={[
            { href: "/plan", label: isFree ? t("nav.upgrade") : t("nav.managePlan"), icon: ArrowUpRight },
            { href: "/support", label: t("nav.help"), icon: LifeBuoy },
          ]}
        />
      )}
      footer={
        <>
          {/* Language + theme stay reachable on phones without a topbar slot. */}
          <div className="mb-1 flex items-center justify-between rounded-xl bg-raised/60 px-3 py-1.5">
            <span className="text-xs font-semibold text-muted">{t("settings.language")} / {t("settings.theme")}</span>
            <span className="flex items-center gap-1"><LocaleSwitcher /><ThemeToggle /></span>
          </div>
          {isAdmin && (
            <Link href="/admin"
              className="flex min-h-[46px] items-center gap-3 rounded-xl px-3 text-sm font-semibold text-accent2 transition-colors hover:bg-accent2-soft">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent2-soft">
                <Shield size={15} />
              </span>
              {t("nav.admin")}
            </Link>
          )}
          <form method="post" action="/auth/sign-out">
            <button className="flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
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

      <div className="mb-1">
        <NavGroupLabel>{t("mega.create")}</NavGroupLabel>
        {IMAGE_MODES.map((e) => (
          <NavLink key={e.key} href={e.href} label={t(`mega.${e.key}`)} icon={e.icon} onNavigate={closeNav} />
        ))}
        {IMAGE_CREATE.filter((e) => !e.soon).map((e) => (
          <NavLink key={e.key} href={e.href} label={t(`cats.${e.key}`)} icon={e.icon} onNavigate={closeNav} />
        ))}
      </div>

      <div className="mb-1">
        <NavGroupLabel>{t("mega.edit")}</NavGroupLabel>
        {IMAGE_EDIT.slice(0, 4).map((e) => (
          <NavLink key={e.key} href={e.href} label={t(`tools.${e.key}.name`)} icon={e.icon} onNavigate={closeNav} />
        ))}
        <NavLink href="/tools" label={t("mega.allTools")} icon={Wrench} onNavigate={closeNav} />
      </div>

      <div className="mb-1">
        <NavGroupLabel>{t("topnav.video")}</NavGroupLabel>
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 opacity-60" aria-disabled>
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-raised text-faint">
            <VIDEO_ICON size={15} />
          </span>
          <span className="text-sm font-medium text-muted">{t("topnav.video")}</span>
          <span className="ml-auto rounded-full bg-raised px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
            {t("common.soon")}
          </span>
        </div>
      </div>

      <div className="mb-1">
        <NavGroupLabel>{t("nav.groups.account")}</NavGroupLabel>
        <NavLink href="/products" label={t("nav.products")} icon={Package} onNavigate={closeNav} />
        <NavLink href="/inspirations" label={t("nav.inspirations")} icon={Lightbulb} onNavigate={closeNav} />
        <NavLink href="/settings" label={t("nav.settings")} icon={Settings} onNavigate={closeNav} />
      </div>
    </Drawer>
  );
}
