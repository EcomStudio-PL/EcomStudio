"use client";
import Link from "next/link";
import { LogOut, Shield } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { signOut } from "@/app/actions/auth";
import { CLIENT_NAV } from "@/lib/navigation";
import { NavLink } from "./nav-link";
import { Drawer, DrawerIdentity, NavGroupLabel } from "./drawer";
import { useDrawer } from "./shell-context";

/** THE mobile menu for the customer app — the single navigation hub opened
 *  by the hamburger, the avatar and the bottom-bar "More" button alike.
 *  Structure: identity → navigation → account actions, on one surface. */
export function CustomerDrawer({ name, email, credits, plan, isAdmin }: {
  name: string; email?: string; credits: number; plan: string; isAdmin: boolean;
}) {
  const { t } = useI18n();
  const { open, setOpen } = useDrawer();
  const initial = (name || "?").trim().charAt(0).toUpperCase();

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      label={t("nav.menu")}
      header={
        <DrawerIdentity
          initial={initial}
          name={name}
          email={email}
          facts={[
            { label: t("nav.credits"), value: `◆ ${new Intl.NumberFormat("pl-PL").format(credits)}`, href: "/credits" },
            { label: t("nav.plan"), value: plan, href: "/plan", tone: "accent2" },
          ]}
        />
      }
      footer={
        <>
          {isAdmin && (
            <Link href="/admin"
              className="flex min-h-[46px] items-center gap-3 rounded-xl px-3 text-sm font-semibold text-accent2 transition-colors hover:bg-accent2-soft">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent2-soft">
                <Shield size={15} />
              </span>
              {t("nav.admin")}
            </Link>
          )}
          <form action={signOut}>
            <button className="flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg text-faint">
                <LogOut size={15} />
              </span>
              {t("common.signOut")}
            </button>
          </form>
        </>
      }
    >
      {CLIENT_NAV.map((g) => (
        <div key={g.key} className="mb-1">
          <NavGroupLabel>{t(`nav.groups.${g.key}`)}</NavGroupLabel>
          {g.items.map((i) => (
            <NavLink key={i.href} href={i.href} label={t(`nav.${i.key}`)} icon={i.icon} onNavigate={() => setOpen(false)} />
          ))}
        </div>
      ))}
    </Drawer>
  );
}
