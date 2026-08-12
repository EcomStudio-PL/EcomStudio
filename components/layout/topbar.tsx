"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";
import { signOut } from "@/app/actions/auth";
import { ThemeToggle } from "./theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { Brand } from "./brand";
import { CommandPalette } from "./command-palette";

export function Topbar({ name, credits, workspace, isAdmin = false }: {
  name: string; credits: number; workspace?: string; isAdmin?: boolean;
}) {
  const { t } = useI18n();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between gap-3 rounded-none border-x-0 border-t-0 px-4 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <div className="lg:hidden"><Brand href="/dashboard" markOnly /></div>
        {workspace && (
          <span className="hidden truncate rounded-lg bg-raised px-3 py-1.5 text-xs font-medium text-muted lg:inline-flex">
            ▣ {workspace}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <CommandPalette isAdmin={isAdmin} />
        <Link href="/credits"
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent-soft px-3.5 text-xs font-semibold text-accent transition-opacity hover:opacity-85">
          <span aria-hidden>◆</span>
          {new Intl.NumberFormat("pl-PL").format(credits)}
          <span className="hidden sm:inline">{t("nav.credits")}</span>
        </Link>
        <LocaleSwitcher />
        <ThemeToggle />
        <div className="ml-1 hidden items-center gap-2 sm:flex">
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-xs font-semibold">
            {initial}
          </span>
          <span className="max-w-32 truncate text-sm text-muted">{name}</span>
        </div>
        <form action={signOut}>
          <button className="h-9 rounded-lg px-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink">
            {t("common.signOut")}
          </button>
        </form>
      </div>
    </header>
  );
}
