"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown, Coins, Images, LogOut, Menu, Plus, Rocket, Settings, Shield,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { creditLevel } from "@/lib/credit-level";
import {
  IMAGE_CREATE, IMAGE_EDIT, IMAGE_MODES, VIDEO_CREATE, VIDEO_EDIT, type MegaEntry,
} from "@/lib/topnav";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { CommandPalette } from "./command-palette";
import { useDrawer } from "./shell-context";
import { NotificationsBell, type NotificationItem } from "./notifications-bell";

/**
 * MEGA TOPBAR — the customer app's ONLY chrome (the UX spec removes the
 * permanent left sidebar entirely). Left to right:
 * logo · Image ▾ · Video ▾ · search … plan · credits · Biblioteka · language
 * · theme · bell · avatar ▾.
 *
 * Mega-menus open on hover on pointer devices AND on click (tablets have no
 * hover), close on Escape, on outside click and on navigation. The avatar
 * menu carries the account actions — including the admin panel, role-gated.
 */
export function MegaTopbar({ name, credits, plan, isAdmin = false, notifications = [], unread = 0 }: {
  name: string; credits: number; plan: string; isAdmin?: boolean;
  notifications?: NotificationItem[]; unread?: number;
}) {
  const { t, locale } = useI18n();
  const { setOpen: setDrawerOpen } = useDrawer();
  const pathname = usePathname();
  const [menu, setMenu] = useState<"image" | "video" | "avatar" | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLElement>(null);
  const initial = (name || "?").trim().charAt(0).toUpperCase();

  const close = useCallback(() => setMenu(null), []);
  useEffect(() => { close(); }, [pathname, close]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [menu, close]);

  /** Hover intent: opening is instant, leaving waits a beat so the pointer
   *  can travel from trigger to panel without the menu vanishing. */
  const hoverOpen = (which: "image" | "video") => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setMenu(which);
  };
  const hoverLeave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenu(null), 180);
  };

  const level = creditLevel(credits);
  const pillTone = {
    ok: "bg-[rgb(var(--success)/0.14)] text-success ring-1 ring-[rgb(var(--success)/0.35)]",
    low: "bg-[rgb(var(--warning)/0.15)] text-warning ring-1 ring-[rgb(var(--warning)/0.4)]",
    critical: "bg-[rgb(var(--danger)/0.15)] text-danger ring-1 ring-[rgb(var(--danger)/0.4)]",
    empty: "bg-[rgb(var(--danger)/0.18)] text-danger ring-1 ring-[rgb(var(--danger)/0.5)]",
  }[level];
  const pillTitle = level === "critical" || level === "empty" ? t("creditsPanel.low") : t("nav.credits");

  const navBtn = (active: boolean) => cn(
    "inline-flex h-9 items-center gap-1 rounded-xl px-3 text-sm font-semibold transition-colors",
    active ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:bg-raised hover:text-ink",
  );

  return (
    <header ref={barRef} className="glass sticky top-0 z-40 rounded-none border-x-0 border-t-0 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-[54px] w-full max-w-[var(--content-max)] items-center gap-1.5 px-3 sm:px-4 lg:px-6 xl:px-7">
        {/* Mobile: hamburger opens the drawer (full new hierarchy inside). */}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label={t("nav.menu")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink lg:hidden"
        >
          <Menu aria-hidden size={20} />
        </button>

        <div className="shrink-0"><Brand href="/home" markOnly /></div>
        <div className="hidden shrink-0 xl:block"><Brand href="/home" /></div>

        {/* PRIMARY: Image / Video mega-menus + search. Desktop only — mobile
            gets the same tree inside the drawer. */}
        <nav className="ml-1 hidden items-center gap-0.5 lg:flex" aria-label={t("topnav.primary")}>
          {(["image", "video"] as const).map((which) => (
            <div key={which} onMouseEnter={() => hoverOpen(which)} onMouseLeave={hoverLeave} className="relative">
              <button
                type="button"
                aria-expanded={menu === which}
                aria-haspopup="menu"
                onClick={() => setMenu(menu === which ? null : which)}
                className={navBtn(menu === which)}
              >
                {t(`topnav.${which}`)}
                <ChevronDown size={13} aria-hidden className={cn("transition-transform", menu === which && "rotate-180")} />
              </button>
            </div>
          ))}
          <div className="ml-1"><CommandPalette isAdmin={isAdmin} wide /></div>
        </nav>

        <div className="min-w-0 flex-1" />

        {/* RIGHT: plan · credits · library · locale · theme · bell · avatar */}
        <Link href="/plan"
          className="plate hidden h-9 items-center rounded-xl px-3 text-xs font-bold uppercase tracking-[0.08em] text-muted transition-colors hover:border-[rgb(var(--accent)/0.4)] hover:text-ink md:inline-flex">
          {plan}
        </Link>

        <div className={cn("inline-flex h-9 shrink-0 items-center rounded-full", pillTone)} title={pillTitle}>
          <Link href="/credits" aria-label={pillTitle}
            className="inline-flex h-full items-center gap-1.5 rounded-l-full pl-2.5 pr-2 text-[13px] font-bold">
            <span aria-hidden className="h-2 w-2 rounded-full bg-current" />
            <span className="tabular-nums">{new Intl.NumberFormat(locale).format(credits)}</span>
          </Link>
          <Link href="/credits" aria-label={t("creditsPanel.buy")} title={t("creditsPanel.buy")}
            className="hidden h-full w-7 items-center justify-center rounded-r-full border-l border-current/25 transition-colors hover:bg-current/10 sm:flex">
            <Plus size={13} aria-hidden strokeWidth={2.6} />
          </Link>
        </div>

        <Link href="/library"
          className={cn(
            "hidden h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors lg:inline-flex",
            pathname.startsWith("/library") ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:bg-raised hover:text-ink",
          )}>
          <Images size={15} aria-hidden />
          {t("topnav.library")}
        </Link>

        {/* Mobile search icon — the palette opens as a full overlay. */}
        <div className="lg:hidden"><CommandPalette isAdmin={isAdmin} iconOnly /></div>

        <div className="hidden sm:block"><LocaleSwitcher /></div>
        <div className="hidden sm:block"><ThemeToggle /></div>
        <NotificationsBell items={notifications} unread={unread} />

        {/* AVATAR — desktop dropdown; on mobile it opens the drawer. */}
        <div className="relative hidden lg:block">
          <button
            type="button"
            onClick={() => setMenu(menu === "avatar" ? null : "avatar")}
            aria-expanded={menu === "avatar"}
            aria-haspopup="menu"
            aria-label={t("nav.menu")}
            className="brand-gradient flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shadow-e2 ring-1 ring-white/15 transition-shadow hover:ring-white/30"
          >
            {initial}
          </button>
          {menu === "avatar" && (
            <div role="menu" className="overlay animate-pop absolute right-0 top-full z-50 mt-2 w-60 rounded-2xl p-1.5">
              <p className="truncate px-3 pb-1 pt-2 text-[13px] font-semibold">{name}</p>
              <p className="overline px-3 pb-2">{plan} · {new Intl.NumberFormat(locale).format(credits)} {t("creditsPanel.unit")}</p>
              <AvatarItem href="/credits" icon={Coins} label={t("creditsPanel.buy")} />
              <AvatarItem href="/plan" icon={Rocket} label={t("nav.plan")} />
              <AvatarItem href="/settings" icon={Settings} label={t("nav.settings")} />
              {isAdmin && <AvatarItem href="/admin" icon={Shield} label={t("nav.admin")} tone="accent2" />}
              <form method="post" action="/auth/sign-out" className="mt-1 border-t border-line pt-1">
                <button role="menuitem"
                  className="flex min-h-[40px] w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
                  <LogOut size={15} aria-hidden className="text-faint" />
                  {t("common.signOut")}
                </button>
              </form>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label={t("nav.menu")}
          className="brand-gradient flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shadow-e2 ring-1 ring-white/15 lg:hidden"
        >
          {initial}
        </button>
      </div>

      {/* MEGA PANEL — full-width sheet under the bar, two zones per spec:
          TWÓRZ (categories) and EDYTUJ (toolbox on an existing asset). */}
      {(menu === "image" || menu === "video") && (
        <div
          onMouseEnter={() => hoverOpen(menu)}
          onMouseLeave={hoverLeave}
          className="absolute inset-x-0 top-full hidden justify-center px-4 pb-4 lg:flex"
        >
          <div role="menu" className="overlay animate-pop w-full max-w-4xl rounded-2xl p-5 shadow-e4">
            {menu === "image" ? (
              <div className="grid gap-6 md:grid-cols-[1.35fr_1fr]">
                <section>
                  <p className="overline mb-3">{t("mega.create")}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {IMAGE_CREATE.map((e) => (
                      <MegaLink key={e.key} entry={e} label={t(`cats.${e.key}`)} sub={t(`cats.${e.key}Sub`)} soonLabel={t("common.soon")} />
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3.5">
                    {IMAGE_MODES.map((e) => (
                      <Link key={e.key} href={e.href}
                        className={cn(
                          "inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold transition-colors",
                          e.key === "engine"
                            ? "cta"
                            : "plate text-ink hover:border-[rgb(var(--accent)/0.4)]",
                        )}>
                        <e.icon size={14} aria-hidden />
                        {t(`mega.${e.key}`)}
                      </Link>
                    ))}
                  </div>
                </section>
                <section className="border-line md:border-l md:pl-6">
                  <p className="overline mb-3">{t("mega.edit")}</p>
                  <div className="grid gap-1">
                    {IMAGE_EDIT.slice(0, 6).map((e) => (
                      <MegaLink key={e.key} entry={e} label={t(`tools.${e.key}.name`)} soonLabel={t("common.soon")} compact />
                    ))}
                    <Link href="/tools" className="mt-1 inline-flex items-center gap-1 px-2.5 text-[12.5px] font-semibold text-accent hover:opacity-75">
                      {t("mega.allTools")} →
                    </Link>
                  </div>
                </section>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-[1.35fr_1fr]">
                <section>
                  <p className="overline mb-3">{t("mega.create")}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {VIDEO_CREATE.map((e) => (
                      <MegaLink key={e.key} entry={e} label={t(`vids.${e.key}`)} soonLabel={t("common.soon")} />
                    ))}
                  </div>
                </section>
                <section className="border-line md:border-l md:pl-6">
                  <p className="overline mb-3">{t("mega.edit")}</p>
                  <div className="grid gap-1">
                    {VIDEO_EDIT.map((e) => (
                      <MegaLink key={e.key} entry={e} label={t(`vids.${e.key}`)} soonLabel={t("common.soon")} compact />
                    ))}
                  </div>
                  <p className="mt-4 text-[12px] leading-relaxed text-faint">{t("mega.videoSoon")}</p>
                </section>
              </div>
            )}
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
              <Link href="/inspirations" className="text-[12.5px] font-semibold text-muted transition-colors hover:text-ink">
                {t("nav.inspirations")} →
              </Link>
              <Link href="/products" className="text-[12.5px] font-semibold text-muted transition-colors hover:text-ink">
                {t("nav.products")} →
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function AvatarItem({ href, icon: Icon, label, tone }: {
  href: string; icon: typeof Coins; label: string; tone?: "accent2";
}) {
  return (
    <Link role="menuitem" href={href}
      className={cn(
        "flex min-h-[40px] items-center gap-2.5 rounded-xl px-3 text-sm font-medium transition-colors hover:bg-raised",
        tone === "accent2" ? "text-accent2 hover:bg-accent2-soft" : "text-ink",
      )}>
      <Icon size={15} aria-hidden className={tone === "accent2" ? "" : "text-faint"} />
      {label}
    </Link>
  );
}

/** One mega-menu entry: icon tile, label, optional one-liner; disabled +
 *  "Wkrótce" badge when the feature has no backend yet. */
function MegaLink({ entry, label, sub, soonLabel, compact }: {
  entry: MegaEntry; label: string; sub?: string; soonLabel: string; compact?: boolean;
}) {
  const Icon = entry.icon;
  const body = (
    <>
      <span aria-hidden className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        compact ? "h-7 w-7" : "h-9 w-9",
        entry.soon ? "bg-raised text-faint" : "bg-[linear-gradient(145deg,rgb(var(--accent)/0.22),rgb(var(--violet)/0.10))] text-accent",
      )}>
        <Icon size={compact ? 14 : 16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("flex items-center gap-1.5 truncate font-semibold", compact ? "text-[13px]" : "text-sm")}>
          {label}
          {entry.soon && (
            <span className="rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
              {soonLabel}
            </span>
          )}
        </span>
        {sub && !entry.soon && <span className="mt-0.5 block truncate text-[11px] text-faint">{sub}</span>}
      </span>
    </>
  );
  const cls = cn(
    "flex items-center gap-2.5 rounded-xl px-2.5 transition-colors",
    compact ? "py-1.5" : "py-2",
    entry.soon ? "cursor-default opacity-60" : "hover:bg-[rgb(var(--accent)/0.08)]",
  );
  return entry.soon
    ? <div className={cls} aria-disabled>{body}</div>
    : <Link role="menuitem" href={entry.href} className={cls}>{body}</Link>;
}
