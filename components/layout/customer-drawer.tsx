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
import { IMAGE_EDIT, editLabelKey } from "@/lib/topnav";
import {
  allDefaults, menuBadge, menuVisible,
  type AvailabilityMap, type MenuBadge,
} from "@/lib/features";
import { isNavActive, sectionOwnsRoute } from "@/lib/nav-active";
import { creditUsage, USAGE_BAR, USAGE_TEXT } from "@/lib/credit-usage";
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
 * The panel is three fixed zones: ONE account card pinned at the top, a
 * navigation tree that scrolls on its own, and a single bar of controls pinned
 * at the bottom so sign-out, language and theme stay reachable on the shortest
 * phone.
 *
 * THE TOP IS ONE CARD, NOT FOUR THINGS IN A ROW. It used to be a strip of
 * controls, then a card whose right-hand corner carried the balance and the
 * plan badge stacked on top of each other, with the buttons below — four
 * unrelated boxes that happened to be adjacent. Identity (avatar, name, plan)
 * and the wallet (balance, meter, the two ways to get more) are now one
 * surface, in that order, because that is one subject: this account.
 *
 * THE METER IS THE POINT OF THE CARD. It is the only place in the product that
 * answers "how much of my package is left" against the plan's REAL allowance,
 * and its colour walks green → yellow → orange → red as the package empties
 * (`lib/credit-usage.ts`). The card itself never changes colour: a seller at
 * 95 % is nearly out of credits, not in an error state.
 *
 * GROUPS ARE LABELLED — GŁÓWNE, OBRAZY, NARZĘDZIA, WIDEO — because a flat list
 * of twenty links is not navigation, it is an index. They all start collapsed
 * except the one holding the page you are on, which opens itself.
 */
export function CustomerDrawer({ name, email, credits, creditsTotal, plan, isAdmin, navAdmin, availability }: {
  name: string; email?: string; credits: number;
  /** The plan's monthly grant — `subscription_plans.monthly_credits` — which
   *  the meter measures the balance against. Null when the plan has none. */
  creditsTotal?: number | null;
  plan: string; isAdmin: boolean;
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
  const closeNav = () => setOpen(false);
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  // Both numbers come from the account: the wallet row and the plan row. There
  // is no reference constant here and nothing is assumed about the tier.
  const usage = creditUsage(credits, creditsTotal);

  /**
   * EACH SECTION'S ROWS, RESOLVED ONCE.
   *
   * The same array both renders the rows and tells the section which routes it
   * owns, so a heading can never auto-expand onto rows that are not there —
   * and a row can never appear in a section that does not know about it.
   */
  const categories = CATEGORIES.filter((c) => show(`/k/${c.slug}`));
  /**
   * NARZĘDZIA — the section formerly called EDYTUJ, with the same five rows.
   *
   * The name changed because the column stopped being only about editing when
   * the hub moved into it: "Wszystkie narzędzia" is not an edit, it is the
   * toolbox. The desktop mega panel keeps EDYTUJ as a COLUMN heading opposite
   * TWÓRZ, where the contrast is the whole point; the drawer has no such pair.
   */
  const toolEntries = IMAGE_EDIT.filter((e) => !e.soon && show(e.href));

  /**
   * GŁÓWNE holds the places that are not a workshop: the dashboard, the things
   * you have made, and account business. "Tworzenie" is gone as a section —
   * every way of making an image is either a category above or the Generuj
   * button in the bottom bar, and a heading whose only job was to duplicate
   * those was a third route to the same two places.
   */
  const mainHrefs = [
    "/home",
    ...(show("/library") ? ["/library"] : []),
    ...(show("/inspirations") ? ["/inspirations"] : []),
    "/support",
    "/settings",
    // The admin row follows the REAL role, and the section must know about it
    // or the heading would not open on the route it contains.
    ...(isAdmin ? ["/admin"] : []),
  ];

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      label={t("nav.menu")}
      header={(close) => (
        <div className="px-3 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))]">
          <div className="rounded-2xl border border-line bg-[rgb(var(--ink)/0.045)] p-2.5 shadow-e1">
            {/* WHO — avatar, name, plan. The close control sits in the card's
                own corner rather than floating over the panel. */}
            <div className="flex items-start gap-3">
              <span aria-hidden className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[15px] font-bold text-white shadow-e2">
                {initial}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="truncate text-[15px] font-semibold leading-tight">{who}</p>
                <span className={cn(
                  "mt-1.5 inline-flex max-w-full truncate rounded-full px-2 py-[3px] text-[9.5px] font-bold uppercase leading-none tracking-wide",
                  PLAN_BADGE[tone],
                )}>
                  {plan}
                </span>
              </div>
              <IslandClose onClick={close} label={t("common.close")} />
            </div>

            {/* THE WALLET — one name for it everywhere: "Kredyty". */}
            <div className="mt-2.5 rounded-xl bg-[rgb(var(--ink)/0.05)] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Diamond size={9} />
                  </span>
                  <span className="truncate text-[12.5px] font-semibold text-muted">{t("nav.credits")}</span>
                </span>
                <span className="metric inline-flex shrink-0 items-center gap-1.5 text-[16px] leading-none text-accent">
                  <Diamond size={8} />
                  {num(credits)}
                </span>
              </div>

              {/* NO LIMIT, NO METER. A plan without a monthly grant says so
                  rather than showing a bar computed from a number nobody
                  granted. */}
              {usage.percent === null || usage.total === null ? (
                <p className="mt-2 text-[11px] leading-tight text-faint">{t("creditsPanel.noLimit")}</p>
              ) : (
                <>
                  <span className="mt-2.5 block h-2 w-full overflow-hidden rounded-full bg-[rgb(var(--ink)/0.12)]">
                    <span
                      className={cn(
                        "block h-full rounded-full transition-[width,background-color,box-shadow] duration-500 ease-out",
                        USAGE_BAR[usage.band],
                      )}
                      // A 3% floor so "nothing used yet" is still a visible bar
                      // rather than an empty track that reads as "no data".
                      style={{ width: `${Math.max(3, usage.percent)}%` }}
                    />
                  </span>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] leading-none">
                    <span className="min-w-0 truncate text-muted">
                      {t("creditsPanel.used")}:{" "}
                      <span className={cn("font-semibold tabular-nums", USAGE_TEXT[usage.band])}>
                        {usage.percent}%
                      </span>
                    </span>
                    <span className="metric shrink-0 tabular-nums text-faint">
                      {num(usage.used)} / {num(usage.total)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* TWO WAYS FORWARD, both to pages that exist: the pricing board
                and the wallet. Upgrading is the quieter of the two — most
                sellers who open this menu want credits, not a new plan. */}
            <div className="mt-2.5 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              <Link href="/plan" onClick={closeNav}
                className="flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-line bg-[rgb(var(--ink)/0.05)] px-2 text-[12.5px] font-semibold text-ink transition-colors duration-200 hover:bg-raised">
                <ArrowUpRight size={14} aria-hidden className="shrink-0" />
                <span className="truncate">{t("nav.upgrade")}</span>
              </Link>
              <Link href="/credits" onClick={closeNav}
                className="cta flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-[12.5px] font-semibold">
                <Plus size={14} aria-hidden strokeWidth={2.6} className="shrink-0" />
                <span className="truncate">{t("credits.topupTitle")}</span>
              </Link>
            </div>
          </div>
        </div>
      )}
      footer={
        /* ONE BAR, THREE CONTROLS, ONE HEIGHT. Language and theme used to sit
           at the very top of the drawer, above the account card, which put two
           preferences in the most valuable space in the menu. They belong with
           sign-out: things you touch on your way out. */
        <div className="flex items-center gap-2">
          <form method="post" action="/auth/sign-out" className="min-w-0 flex-1">
            <button className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-[rgb(var(--ink)/0.04)] px-2.5 text-[12.5px] font-semibold text-muted transition-colors duration-200 hover:bg-raised hover:text-ink">
              <LogOut size={15} aria-hidden className="shrink-0" />
              <span className="truncate">{t("common.signOut")}</span>
            </button>
          </form>
          {/* Flags only, opening upwards — there is nothing below this bar. */}
          <LocaleSwitcher align="left" side="top" flagsOnly size="md" />
          <ThemeToggle size="md" />
        </div>
      }
    >
      {/* Every group below is drawn from the availability map: entries the
          customer may not see are filtered out, and a group left with nothing
          in it drops its heading too — an empty "WIDEO" is worse than none. */}
      <Section title={t("nav.groups.main")} hrefs={mainHrefs}>
        <NavLink href="/home" label={t("topnav.home")} icon={Home} onNavigate={closeNav}
          badge={badge("/home")} />
        {show("/library") && (
          <NavLink href="/library" label={t("topnav.library")} icon={Images} onNavigate={closeNav}
            badge={badge("/library")} />
        )}
        {show("/inspirations") && (
          <NavLink href="/inspirations" label={t("nav.inspirations")} icon={Lightbulb} onNavigate={closeNav}
            badge={badge("/inspirations")} />
        )}
        <NavLink href="/support" label={t("nav.help")} icon={LifeBuoy} onNavigate={closeNav} />
        <NavLink href="/settings" label={t("nav.settings")} icon={Settings} onNavigate={closeNav} />
        {/* ADMIN IS A ROLE CHECK, NOT A STYLE. Hiding this row is the LAST of
            three gates, not the only one: `/admin` has its own server-side
            redirect for anyone whose profile role is not admin, and every
            admin action is checked again in the database. */}
        {isAdmin && <AdminRow label={t("nav.admin")} onNavigate={closeNav} />}
      </Section>

      {/* OBRAZY — the six category workspaces, each its own switchable module
          in its own colour. */}
      {categories.length > 0 && (
        <Section title={t("topnav.image")} hrefs={categories.map((c) => `/k/${c.slug}`)}>
          {categories.map((c) => (
            <CategoryRow key={c.key} c={c} t={t} onNavigate={closeNav} dynBadge={badge(`/k/${c.slug}`)} />
          ))}
        </Section>
      )}

      {toolEntries.length > 0 && (
        <Section title={t("nav.groups.tools")} hrefs={toolEntries.map((e) => e.href)}>
          {/* The hub is the last of these five entries, so it is not appended a
              second time underneath them. */}
          {toolEntries.map((e) => (
            <NavLink key={e.key} href={e.href} label={t(editLabelKey(e))} icon={e.icon} onNavigate={closeNav}
              badge={badge(e.href)} />
          ))}
        </Section>
      )}

      {show("/wideo") && (
        <Section title={t("topnav.video")} hrefs={["/wideo"]}>
          <SoonRow href="/wideo" label={t("video.title")} onNavigate={closeNav}
            icon={<VideoIcon size={16} />} soonLabel={badge("/wideo") ?? t("common.soon")} rgb="var(--violet)" />
        </Section>
      )}
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

/** Staff-only entry into the admin panel. Same geometry as every other row —
 *  only the colour says it belongs to someone else. */
function AdminRow({ label, onNavigate }: { label: string; onNavigate: () => void }) {
  return (
    <Link href="/admin" onClick={onNavigate}
      className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-accent2 transition-colors duration-200 hover:bg-accent2-soft">
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent2-soft">
        <Shield size={16} />
      </span>
      <span className="truncate">{label}</span>
    </Link>
  );
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
        "group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors duration-200",
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
        <c.icon size={16} />
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

/**
 * A destination that exists but cannot generate yet — a real link to a page
 * that explains itself, never a dead entry.
 *
 * IT STILL SAYS "YOU ARE HERE". This row used to be the one row in the menu
 * that could not: a seller standing on /wideo saw the WIDEO section open with
 * nothing highlighted inside it, which reads as a section that opened by
 * mistake. "Not finished" and "not where you are" are different facts, and the
 * badge already carries the first one.
 */
function SoonRow({ href, label, icon, soonLabel, rgb, onNavigate }: {
  href: string; label: string; icon: React.ReactNode; soonLabel: string;
  rgb: string; onNavigate: () => void;
}) {
  const pathname = usePathname();
  const active = isNavActive(pathname, href);
  return (
    <Link href={href} onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors duration-200",
        active ? "bg-[rgb(var(--soon)/0.12)] font-semibold text-ink" : "font-medium text-ink hover:bg-[rgb(var(--ink)/0.05)]",
      )}
      style={{ ["--soon" as string]: rgb }}
    >
      <span aria-hidden className={cn(
        "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-[rgb(var(--soon))] transition-all duration-200",
        active ? "h-6 opacity-100" : "h-2 opacity-0",
      )} />
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
 * NOTHING ELSE OPENS ON ITS OWN. `defaultOpen` is gone: a section that is not
 * where you are is closed, whichever section it is. Three headings used to
 * carry it, which meant a drawer opened on a tool route showed its own
 * section expanded plus three others, and the seller had to read past a dozen
 * rows that had nothing to do with where they were.
 *
 * A visitor can still fold a section away, and that click is remembered — but
 * only for the page they were on when they made it. Navigate, and the route
 * takes over again. Storing the route alongside the choice is what makes it
 * expire on its own, with no effect to run and nothing to reset.
 */
function Section({ title, hrefs = [], children }: {
  title: string;
  /** The destinations this section renders — its claim on the current route. */
  hrefs?: readonly string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [choice, setChoice] = useState<{ route: string; open: boolean } | null>(null);
  const open = choice?.route === pathname ? choice.open : sectionOwnsRoute(pathname, hrefs);
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
