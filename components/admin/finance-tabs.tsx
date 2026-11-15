"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Landmark, ShieldCheck, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * FINANSE — two tabs, each a real route (like Komunikacja): the period
 * analytics (0176) and the API Reserve Center (0180), which complements it.
 */
const TABS: readonly { href: string; key: string; icon: LucideIcon }[] = [
  { href: "/admin/finance", key: "overview", icon: Landmark },
  { href: "/admin/finance/rezerwy", key: "reserves", icon: ShieldCheck },
];

export function FinanceTabs() {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav aria-label={t("admin.nav.financeView")}
      className="-mx-1 mb-6 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map((tab) => {
        const active = tab.href === "/admin/finance" ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link key={tab.key} href={tab.href} aria-current={active ? "page" : undefined}
            className={cn("inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold transition-colors",
              active ? "bg-accent2-soft text-accent2 ring-1 ring-[rgb(var(--accent2)/0.30)]" : "text-muted hover:bg-raised hover:text-ink")}>
            <tab.icon size={15} aria-hidden />
            {t(`admin.reserves.tab.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
