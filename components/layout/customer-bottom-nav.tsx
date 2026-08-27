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
 * BOTTOM NAVIGATION — the phone's primary navigation.
 *
 * Height comes from `--bottom-nav-h` and the gap from `--bottom-nav-gap`, the
 * same tokens the page uses to reserve room underneath its content. Deriving
 * both from one number is what stops the bar from sitting on top of the last
 * card, which no amount of hand-tuned padding ever quite fixed.
 *
 * Four destinations plus the account, which opens the drawer rather than a
 * fifth page.
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

  const slotClass = "group flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-[3px] rounded-xl px-0.5 text-[10px] font-semibold transition-colors duration-200";

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label={t("topnav.primary")}
    >
      <div
        className="dock mx-[var(--page-x)] flex items-stretch rounded-2xl px-1"
        style={{ height: "var(--bottom-nav-h)", marginBottom: "var(--bottom-nav-gap)" }}
      >
        {SLOTS.map((s) => {
          const active = isActive(s);
          const Icon = s.icon;
          return (
            <Link
              key={s.key}
              href={s.href}
              prefetch
              aria-current={active ? "page" : undefined}
              className={cn(slotClass, active ? "text-accent" : "text-faint")}
            >
              <span aria-hidden className={cn(
                "flex h-7 w-11 items-center justify-center rounded-lg transition-all duration-200",
                active
                  ? "bg-[rgb(var(--accent)/0.15)] shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.32)]"
                  : "group-active:bg-[rgb(var(--faint)/0.12)]",
              )}>
                <Icon size={18} strokeWidth={active ? 2.4 : 1.9} />
              </span>
              {/* The label never truncates: five short words at 10px fit the
                  narrowest phone we support. */}
              <span className="w-full text-center leading-none">{t(`mobilenav.${s.key}`)}</span>
            </Link>
          );
        })}

        {/* ACCOUNT — opens the drawer, so the menu is one thumb-reach away. */}
        <button type="button" onClick={() => setOpen(true)} className={cn(slotClass, "text-faint")}>
          <span aria-hidden className="flex h-7 w-11 items-center justify-center">
            <span className="brand-gradient flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-1 ring-white/20">
              {initial}
            </span>
          </span>
          <span className="w-full text-center leading-none">{t("mobilenav.account")}</span>
        </button>
      </div>
    </nav>
  );
}
