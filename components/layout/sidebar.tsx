"use client";
import Link from "next/link";
import { Shield } from "lucide-react";
import { CLIENT_NAV, CLIENT_BOTTOM } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { Brand } from "./brand";
import { NavLink } from "./nav-link";
import { useDrawer } from "./shell-context";
import { BottomNav } from "./bottom-nav";
import { DrawerIdentity, NavGroupLabel } from "./drawer";

/** Customer sidebar (desktop): a persistent rail with the identity block on
 *  top, grouped navigation below and admin access pinned to the bottom.
 *  Same information architecture as the mobile drawer. Deliberately contains
 *  NO admin entries in the main nav; /admin stays server-guarded anyway. */
export function Sidebar({ name, email, credits, plan, isAdmin }: {
  name: string; email?: string; credits: number; plan: string; isAdmin: boolean;
}) {
  const { t } = useI18n();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <aside className="relative hidden w-[264px] shrink-0 flex-col border-r border-line bg-sidebar/80 px-3 py-5 backdrop-blur-xl lg:flex">
      {/* The rail catches the ambient key light along its inner edge. */}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-[rgb(var(--accent)/0.28)] to-transparent" />
      <div className="px-3 pb-5"><Brand href="/dashboard" /></div>

      <ProfileCard name={name} email={email} credits={credits} plan={plan} initial={initial} />

      <nav className="thin-scroll mt-4 flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {CLIENT_NAV.map((g) => (
          <div key={g.key} className="mb-3">
            <NavGroupLabel>{t(`nav.groups.${g.key}`)}</NavGroupLabel>
            {g.items.map((i) => (
              <NavLink key={i.href} href={i.href} label={t(`nav.${i.key}`)} icon={i.icon} />
            ))}
          </div>
        ))}
      </nav>

      {isAdmin && (
        <Link href="/admin"
          className="plate mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-[rgb(var(--accent2)/0.4)] hover:text-ink">
          <Shield size={15} className="text-accent2" aria-hidden />
          {t("nav.admin")}
        </Link>
      )}
    </aside>
  );
}

/** Identity + wallet block. Same component and shape as the drawer header,
 *  so the rail and the mobile menu are visibly one system. */
export function ProfileCard({ name, email, credits, plan, initial }: {
  name: string; email?: string; credits: number; plan: string; initial: string;
}) {
  const { t } = useI18n();
  return (
    <div className="px-3">
      <DrawerIdentity
        initial={initial}
        name={name}
        email={email}
        facts={[
          { label: t("nav.credits"), value: `◆ ${new Intl.NumberFormat("pl-PL").format(credits)}`, href: "/credits" },
          { label: t("nav.plan"), value: plan, href: "/plan", tone: "accent2" },
        ]}
      />
    </div>
  );
}

/**
 * Bottom navigation (mobile). Delegates to the shared dock so the customer
 * app and the admin panel cannot drift apart.
 */
export function MobileNav() {
  const { t } = useI18n();
  const { setOpen } = useDrawer();
  return (
    <BottomNav
      items={CLIENT_BOTTOM}
      labelFor={(i) => t(`nav.${i.shortKey ?? i.key}`)}
      moreLabel={t("nav.more")}
      onMore={() => setOpen(true)}
      exactRoots={["/dashboard"]}
    />
  );
}
