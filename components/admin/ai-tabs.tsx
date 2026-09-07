"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cpu, Wrench, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * AI I GENEROWANIE — two destinations, not six.
 *
 * The panel used to carry Generacje, Modele AI, Dostawcy AI, AI Engine,
 * Silnik ujęć, Szablony promptów and Image Tools as separate entries for what
 * are really two jobs: configuring what a tool does, and managing what it runs
 * on and what that costs.
 */

type Tab = { href: string; key: string; icon: LucideIcon };

export const AI_TABS: readonly Tab[] = [
  { href: "/admin/ai", key: "tools", icon: Wrench },
  { href: "/admin/ai/modele", key: "models", icon: Cpu },
] as const;

export function AiTabs() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav
      aria-label={t("aicc.moduleTitle")}
      className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {AI_TABS.map((tab) => {
        // The models screen owns one route; everything else under /admin/ai is
        // a tool workspace, which belongs to the tools tab.
        const onModels = pathname.startsWith("/admin/ai/modele");
        const active = tab.href === "/admin/ai/modele" ? onModels : !onModels;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5",
              "text-[13px] font-semibold transition-colors",
              active
                ? "bg-accent2-soft text-accent2 ring-1 ring-[rgb(var(--accent2)/0.30)]"
                : "text-muted hover:bg-raised hover:text-ink",
            )}
          >
            <tab.icon size={15} aria-hidden />
            {t(`aicc.tab.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
