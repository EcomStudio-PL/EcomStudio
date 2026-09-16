"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight, ChevronDown, Home, Images, LifeBuoy, Lightbulb, LogOut,
  Plus, Settings, Shield,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { CATEGORIES, VIDEO_ICON as VideoIcon } from "@/lib/categories";
import { IMAGE_EDIT, IMAGE_MODES, editLabelKey } from "@/lib/topnav";
import {
  allDefaults, menuBadge, menuVisible,
  type AvailabilityMap, type MenuBadge,
} from "@/lib/features";
import { isNavActive, sectionOwnsRoute } from "@/lib/nav-active";
import { NavLink } from "./nav-link";
import { Drawer, IslandClose, NavGroupLabel } from "./drawer";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import { Diamond } from "./credits-control";
import { planTone, PLAN_BADGE, firstName } from "@/lib/plan-tone";
import { useDrawer } from "./shell-context";
import { cn } from "@/lib/utils";

/**
 * MOBILE MENU — the desktop information architecture folded into a drawer.
 *
 * The panel is three fixed zones: controls and identity pinned at the top,
 * a navigation tree that scrolls on its own, and sign-out pinned at the
 * bottom so it stays reachable on the shortest phone. Groups are labelled —
 * GŁÓWNE, OBRAZ, GENEROWANIE, EDYTUJ, KONTO — because a flat list of twenty
 * links is not navigation, it is an index.
 */
export function CustomerDrawer({ name, email, credits, plan, isAdmin, navAdmin, availability }: {
  name: string; email?: string; credits: number; plan: string; isAdmin: boolean;
  /** What the MENU should treat as admin — `isAdmin` unless this admin asked
   *  to preview the app as a customer. The admin LINK still follows the real
   *  role, so the preview is never a trap. */
  navAdmin?: boolean;
  availability?: AvailabilityMap;
}) {
  const { t, locale } = useI18n();
  const { open, setOpen } = useDrawer();
  const avail = availability ?? allDefaults();
  const seesRestricted = navAdmin ?? isAdmin;
  const show = (href: string) => menuVisible(avail, href, seesRestricted);
  const badge = (href: string) => badgeLabel(menuBadge(avail, href), t);
  const who = firstName(name, email) || name;
  const initial = (who || "?").trim().charAt(0).toUpperCase();
  const tone = planTone(plan);
  const isFree = tone === "free";
  const closeNav = () => setOpen(false);

  /**
   * EACH SECTION'S ROWS, RESOLVED ONCE.
   *
   * The same array both renders the rows and tells the section which routes it
   * owns, so a heading can never auto-expand onto rows that are not there —
   * and a row can never appear in a section that does not know about it.
   */
  const categories = CATEGORIES.filter((c) => show(`/k/${c.slug}`));
  // THE HUB BELONGS TO EDYTUJ, ONCE. `IMAGE_MODES` also carries "Wszystkie
  // narzędzia", which the desktop mega panel deliberately shows in both of its
  // columns. A drawer is a single list, so the same thing appearing twice is
  // not emphasis — it is two rows that both light up on /tools, which is the
  // duplicate-highlight this change exists to remove. Filtering by href rather
  // than by name keeps that true if either list changes.
  const editEntries = IMAGE_EDIT.filter((e) => !e.soon && show(e.href));
  const createEntries = IMAGE_MODES.filter(
    (e) => show(e.href) && !editEntries.some((x) => x.href === e.href),
  );

  const mainHrefs = ["/home", ...(show("/library") ? ["/library"] : [])];
  const accountHrefs = [...(show("/inspirations") ? ["/inspirations"] : []), "/settings", "/support"];

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      label={t("nav.menu")}
      header={(close) => (
        <div className="px-3 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))]">
          {/* CONTROLS FIRST — language and theme as bare icons. The words
              "Język" and "Motyw" earn nothing next to a flag and a sun. */}
          <div className="flex items-center gap-1">
            <LocaleSwitcher align="left" />
            <ThemeToggle />
            <span className="flex-1" />
            <IslandClose onClick={close} label={t("common.close")} />
          </div>

          {/* ACCOUNT CARD — identity on the left, the two numbers that decide
              what you can do next on the right. */}
          <div className="mt-1 rounded-2xl bg-[rgb(var(--ink)/0.055)] p-3">
            <div className="flex items-center gap-3">
              <span aria-hidden className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[15px] font-bold text-white shadow-e2">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold leading-tight">{who}</p>
                {email && <p className="mt-0.5 truncate text-[11.5px] leading-tight text-muted">{email}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="metric flex items-center gap-1 text-[16px] leading-none text-accent">
                  <Diamond size={8} />
                  {new Intl.NumberFormat(locale).format(credits)}
                </span>
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase leading-none tracking-wide",
                  PLAN_BADGE[tone],
                )}>
                  {plan}
                </span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Link href="/credits" onClick={closeNav}
                className="cta flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold">
                <Plus size={15} aria-hidden />
                {t("nav.topUp")}
              </Link>
              <Link href="/plan" onClick={closeNav}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[rgb(var(--ink)/0.07)] text-[13px] font-semibold text-muted transition-colors duration-200 hover:text-ink">
                <ArrowUpRight size={14} aria-hidden />
                <span className="truncate">{isFree ? t("nav.upgrade") : t("nav.managePlan")}</span>
              </Link>
            </div>
          </div>
        </div>
      )}
      footer={
        <form method="post" action="/auth/sign-out">
          <button className="flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-muted transition-colors duration-200 hover:bg-raised hover:text-ink">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-raised text-muted">
              <LogOut size={15} />
            </span>
            {t("common.signOut")}
          </button>
        </form>
      }
    >
      {/* Every group below is drawn from the availability map: entries the
          customer may not see are filtered out, and a group left with nothing
          in it drops its heading too — an empty "WIDEO" is worse than none. */}
      <Section title={t("nav.groups.main")} defaultOpen hrefs={mainHrefs}>
        <NavLink href="/home" label={t("topnav.home")} icon={Home} onNavigate={closeNav}
          badge={badge("/home")} />
        {show("/library") && (
          <NavLink href="/library" label={t("topnav.library")} icon={Images} onNavigate={closeNav}
            badge={badge("/library")} />
        )}
      </Section>

      {/* OBRAZ — the six category workspaces, each its own switchable module
          in its own colour. */}
      {categories.length > 0 && (
        <Section title={t("topnav.image")} defaultOpen hrefs={categories.map((c) => `/k/${c.slug}`)}>
          {categories.map((c) => (
            <CategoryRow key={c.key} c={c} t={t} onNavigate={closeNav} dynBadge={badge(`/k/${c.slug}`)} />
          ))}
        </Section>
      )}

      {createEntries.length > 0 && (
        <Section title={t("nav.groups.create")} hrefs={createEntries.map((e) => e.href)}>
          {createEntries.map((e) => (
            <NavLink key={e.key} href={e.href} label={t(`mega.${e.key}`)} icon={e.icon} onNavigate={closeNav}
              badge={badge(e.href)} />
          ))}
        </Section>
      )}

      {editEntries.length > 0 && (
        <Section title={t("mega.edit")} hrefs={editEntries.map((e) => e.href)}>
          {/* The hub is the last of these five entries, so it is not appended a
              second time underneath them. */}
          {editEntries.map((e) => (
            <NavLink key={e.key} href={e.href} label={t(editLabelKey(e))} icon={e.icon} onNavigate={closeNav}
              badge={badge(e.href)} />
          ))}
        </Section>
      )}

      {show("/wideo") && (
        <Section title={t("topnav.video")} hrefs={["/wideo"]}>
          <SoonRow href="/wideo" label={t("video.title")} onNavigate={closeNav}
            icon={<VideoIcon size={15} />} soonLabel={badge("/wideo") ?? t("common.soon")} rgb="var(--violet)" />
        </Section>
      )}

      <Section title={t("nav.groups.account")} defaultOpen hrefs={accountHrefs}>
        {show("/inspirations") && (
          <NavLink href="/inspirations" label={t("nav.inspirations")} icon={Lightbulb} onNavigate={closeNav}
            badge={badge("/inspirations")} />
        )}
        <NavLink href="/settings" label={t("nav.settings")} icon={Settings} onNavigate={closeNav} />
        <NavLink href="/support" label={t("nav.help")} icon={LifeBuoy} onNavigate={closeNav} />
        {isAdmin && (
          <Link href="/admin" onClick={closeNav}
            className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-semibold text-accent2 transition-colors duration-200 hover:bg-accent2-soft">
            <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent2-soft">
              <Shield size={15} />
            </span>
            {t("nav.admin")}
          </Link>
        )}
      </Section>
    </Drawer>
  );
}

/** The i18n label for a feature-availability badge, null when active. */
function badgeLabel(kind: MenuBadge, t: (k: string) => string): string | null {
  if (kind === "soon") return t("features.badgeSoon");
  if (kind === "maintenance") return t("features.badgeMaintenance");
  if (kind === "disabled") return t("features.badgeDisabled");
  return null;
}

/** A category row in the category's own colour, with an honest badge when
 *  the engine does not support it yet — or when the generator module itself
 *  is restricted (dynBadge). */
function CategoryRow({ c, t, onNavigate, dynBadge }: {
  c: (typeof CATEGORIES)[number];
  t: (k: string) => string;
  onNavigate: () => void;
  dynBadge?: string | null;
}) {
  const pathname = usePathname();
  // The same rule as every other row, rather than a second opinion: a bare
  // `startsWith` here would light the category up alongside any deeper menu
  // entry that ever lands under `/k/<slug>/`.
  const active = isNavActive(pathname, `/k/${c.slug}`);
  return (
    <Link
      href={`/k/${c.slug}`}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-200",
        active ? "bg-[rgb(var(--cat)/0.12)] font-semibold text-ink" : "font-medium text-ink hover:bg-[rgb(var(--ink)/0.05)]",
      )}
      style={{ ["--cat" as string]: c.accent.rgb }}
    >
      <span aria-hidden className={cn(
        "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-[rgb(var(--cat))] transition-all duration-200",
        active ? "h-6 opacity-100" : "h-2 opacity-0",
      )} />
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[rgb(var(--cat))]"
        style={{ background: `rgb(${c.accent.rgb} / 0.16)` }}>
        <c.icon size={15} />
      </span>
      <span className="min-w-0 flex-1 truncate">{t(`cats.${c.key}`)}</span>
      {(dynBadge || c.soon) && (
        <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
          {dynBadge ?? t("common.soon")}
        </span>
      )}
    </Link>
  );
}

/** A destination that exists but cannot generate yet — a real link to a page
 *  that explains itself, never a dead entry. */
function SoonRow({ href, label, icon, soonLabel, rgb, onNavigate }: {
  href: string; label: string; icon: React.ReactNode; soonLabel: string;
  rgb: string; onNavigate: () => void;
}) {
  return (
    <Link href={href} onClick={onNavigate}
      className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink transition-colors duration-200 hover:bg-[rgb(var(--ink)/0.05)]">
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `rgb(${rgb} / 0.16)`, color: `rgb(${rgb})` }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
        {soonLabel}
      </span>
    </Link>
  );
}

/**
 * Collapsible drawer group — the whole tree fits without endless scrolling.
 *
 * THE ROUTE DECIDES WHETHER THIS IS OPEN, not a remembered click.
 *
 * It used to be `useState(defaultOpen)`, where `defaultOpen` is a literal
 * written per section. EDYTUJ has none, so it started shut — and because the
 * drawer unmounts its contents when it closes (`drawer.tsx`, `if (!open)
 * return null`), that literal was re-applied EVERY time the menu was opened.
 * A seller on Retusz zdjęć opened the menu and found the section containing
 * the page they were looking at collapsed, every single time, with the
 * highlight hidden inside it.
 *
 * Now the section is open when it holds the row for the current page, decided
 * by `sectionOwnsRoute` — the same function that decides which row lights up,
 * so the two can never disagree. That is also why this survives a refresh, a
 * direct URL, and back/forward: none of them are remembered state, they are
 * just a pathname, and the pathname is the whole input.
 *
 * A visitor can still fold a section away, and that click is remembered — but
 * only for the page they were on when they made it. Navigate, and the route
 * takes over again. Storing the route alongside the choice is what makes it
 * expire on its own, with no effect to run and nothing to reset.
 */
function Section({ title, defaultOpen = false, hrefs = [], children }: {
  title: string;
  defaultOpen?: boolean;
  /** The destinations this section renders — its claim on the current route. */
  hrefs?: readonly string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [choice, setChoice] = useState<{ route: string; open: boolean } | null>(null);
  const open = choice?.route === pathname
    ? choice.open
    : sectionOwnsRoute(pathname, hrefs) || defaultOpen;
  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setChoice({ route: pathname, open: !open })}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 transition-colors duration-200 hover:bg-raised/60"
      >
        <NavGroupLabel>{title}</NavGroupLabel>
        <ChevronDown size={14} aria-hidden
          className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && <div className="animate-fade">{children}</div>}
    </div>
  );
}
