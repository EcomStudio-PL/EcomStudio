"use client";
import { useI18n } from "@/lib/i18n/provider";
import { signOut } from "@/app/actions/auth";
import { ThemeToggle } from "./theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { Brand } from "./brand";

export function Topbar({ name, credits }: { name: string; credits: number }) {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur lg:px-8">
      <div className="lg:hidden"><Brand href="/dashboard" /></div>
      <div className="hidden lg:block" />
      <div className="flex items-center gap-2">
        <span className="hidden rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent sm:inline-flex">
          ◎ {credits}
        </span>
        <LocaleSwitcher />
        <ThemeToggle />
        <div className="ml-1 hidden items-center gap-2 sm:flex">
          <span className="max-w-32 truncate text-sm text-muted">{name}</span>
        </div>
        <form action={signOut}>
          <button className="h-8 rounded-lg px-2 text-xs text-muted hover:bg-raised hover:text-ink">
            {t("common.signOut")}
          </button>
        </form>
      </div>
    </header>
  );
}
