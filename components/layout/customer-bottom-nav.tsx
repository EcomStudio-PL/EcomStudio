"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Images, Package, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useDrawer } from "./shell-context";
import { cn } from "@/lib/utils";

type Slot = { key: string; href: string; icon: LucideIcon; exact?: boolean };

const SLOTS: readonly Slot[] = [
  { key: "home", href: "/home", icon: Home, exact: true },
  { key: "generate", href: "/prompts", icon: Sparkles },
  { key: "library", href: "/library", icon: Images },
  { key: "products", href: "/products", icon: Package },
] as const;

/**
 * BOTTOM NAVIGATION — the phone's primary navigation, back where it belongs.
 *
 * Four destinations plus the account, which opens the drawer rather than a
 * fifth page. The bar respects the home-indicator inset, and the layout
 * reserves `--dock-h` beneath the page so nothing hides behind it.
 */
export function CustomerBottomNav({ name }: { name: string }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { setOpen } = useDrawer();
  const initial = (name || "?").trim().charAt(0).toUpperCase();

  const isActive = (s: Slot) => {
    if (s.exact) return pathname === s.href;
    if (s.key === "generate") return pathname.startsWith("/prompts") || pathname.startsWith("/generator") || pathname.startsWith("/k/");
    return pathname.startsWith(s.href);
  };

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden"
      aria-label={t("topnav.primary")}>
      <div className="dock flex items-stretch gap-0.5 rounded-2xl p-1">
        {SLOTS.map((s) => {
          const active = isActive(s);
          const Icon = s.icon;
          return (
            <Link
              key={s.key}
              href={s.href}
              prefetch
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex min-w-0 flex-1 basis-0 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-semibold transition-colors duration-200",
                active ? "text-accent" : "text-faint",
              )}
            >
              <span aria-hidden className={cn(
                "flex h-7 w-full max-w-[3.25rem] items-center justify-center rounded-xl transition-all duration-200",
                active
                  ? "bg-[rgb(var(--accent)/0.16)] shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.35)]"
                  : "group-active:bg-[rgb(var(--faint)/0.12)]",
              )}>
                <Icon size={18} strokeWidth={active ? 2.4 : 2} />
              </span>
              <span className="w-full truncate text-center leading-tight">{t(`mobilenav.${s.key}`)}</span>
            </Link>
          );
        })}

        {/* ACCOUNT — opens the drawer, so the menu is one thumb-reach away. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex min-w-0 flex-1 basis-0 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-semibold text-faint transition-colors duration-200"
        >
          <span aria-hidden className="flex h-7 w-full max-w-[3.25rem] items-center justify-center">
            <span className="brand-gradient flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-1 ring-white/20">
              {initial}
            </span>
          </span>
          <span className="w-full truncate text-center leading-tight">{t("mobilenav.account")}</span>
        </button>
      </div>
    </nav>
  );
}
