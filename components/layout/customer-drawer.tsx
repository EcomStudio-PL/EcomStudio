"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight, ChevronDown, ChevronRight, Home, Images, LifeBuoy, Lightbulb,
  LogOut, Plus, Settings, Shield,
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
import { Drawer, IslandClose } from "./drawer";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import { Diamond } from "./credits-control";
import { planTone, PLAN_BADGE, firstName } from "@/lib/plan-tone";
import { useDrawer } from "./shell-context";
import { cn } from "@/lib/utils";

/**
 * MOBILE MENU — a column of cards, not a list of links.
 *
 * TWO CARDS AND THEN TILES. The account and the wallet each get a surface of
 * their own at the top, and every destination below them is its own rounded
 * tile with an icon plate, a label and a chevron. The flat text list this
 * replaced was legible and cheap and read like a table of contents; at phone
 * scale a tile is what says "this is a thing you can press".
 *
 * THE METER SHOWS WHAT IS LEFT. The bar empties as credits are spent and the
 * label says "Pozostało", because that is the question a seller opens this
 * menu with. The COLOUR still comes from how much is gone
 * (`lib/credit-usage.ts`): 10 % left is red whichever way the number is
 * phrased, and the card itself never changes colour — nearly out of credits is
 * not an error state.
 *
 * THE MAIN DESTINATIONS HAVE NO HEADING. They are five tiles under the wallet,
 * always visible; only the three workshops — OBRAZY, NARZĘDZIA, WIDEO — fold,
 * and the one holding the page you are on opens itself.
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

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      label={t("nav.menu")}
      header={(close) => (
        /* The close control lives ABOVE the account card, not inside it: the
           card is the account, and an X in its corner read as "dismiss this
           account". */
        <div className="flex justify-end px-3 pt-[max(0.5rem,calc(env(safe-area-inset-top)+0.25rem))]">
          <IslandClose onClick={close} label={t("common.close")} />
        </div>
      )}
      footer={
        <div className="space-y-2">
          {/* Sign-out is a destination like any other, so it wears the same
              tile. It used to be a small quiet button, which is how it ended
              up looking like a footnote. */}
          <form method="post" action="/auth/sign-out">
            <button className="group flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-[rgb(var(--line)/0.12)] bg-[rgb(var(--ink)/0.04)] px-3 py-2.5 text-left transition-colors duration-200 hover:bg-[rgb(var(--ink)/0.07)]">
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--ink)/0.07)] text-muted transition-colors duration-200 group-hover:text-ink">
                <LogOut size={17} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{t("common.signOut")}</span>
              <ChevronRight size={16} aria-hidden className="shrink-0 text-faint" />
            </button>
          </form>

          {/* One line, two preferences: language on the left, theme on the
              right, both compact enough to leave the row calm. */}
          <div className="flex items-center justify-between gap-2">
            <LocaleSwitcher align="left" side="top" flagsOnly size="md" pill />
            <ThemeToggle size="md" />
          </div>
        </div>
      }
    >
      {/* ── THE ACCOUNT ──────────────────────────────────────────────────── */}
      <Link href="/settings" onClick={closeNav}
        className="group flex items-center gap-3 rounded-2xl border border-[rgb(var(--line)/0.14)] bg-gradient-to-b from-[rgb(var(--ink)/0.075)] to-[rgb(var(--ink)/0.035)] p-3 shadow-e1 transition-colors duration-200 hover:to-[rgb(var(--ink)/0.06)]">
        <span aria-hidden className="relative flex h-12 w-12 shrink-0 items-center justify-center">
          {/* The glow is a blurred copy of the avatar, so it is always the
              brand gradient and never a second colour to keep in step. */}
          <span className="brand-gradient absolute inset-1 rounded-full opacity-40 blur-[9px]" />
          <span className="brand-gradient relative flex h-12 w-12 items-center justify-center rounded-full text-[17px] font-bold text-white ring-2 ring-[rgb(var(--accent)/0.35)]">
            {initial}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px] font-semibold leading-tight text-ink">{who}</span>
          <span className={cn(
            "mt-1.5 inline-flex max-w-full truncate rounded-full px-2 py-[3px] text-[9.5px] font-bold uppercase leading-none tracking-wide",
            PLAN_BADGE[tone],
          )}>
            {plan}
          </span>
        </span>
        <ChevronRight size={18} aria-hidden className="shrink-0 text-faint transition-colors duration-200 group-hover:text-ink" />
      </Link>

      {/* ── THE WALLET ───────────────────────────────────────────────────── */}
      <div className="mt-2.5 overflow-hidden rounded-2xl border border-[rgb(var(--accent)/0.24)] bg-gradient-to-b from-[rgb(var(--accent)/0.10)] to-[rgb(var(--ink)/0.04)] p-3 shadow-e1">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent ring-1 ring-[rgb(var(--accent)/0.35)]">
              <Diamond size={12} />
            </span>
            <span className="truncate text-[14px] font-semibold text-ink">{t("nav.credits")}</span>
          </span>
          <span className="metric inline-flex shrink-0 items-center gap-1.5 text-[19px] leading-none text-accent">
            <Diamond size={10} />
            {num(credits)}
          </span>
        </div>

        {/* NO LIMIT, NO METER. A plan without a monthly grant says so rather
            than showing a bar computed from a number nobody granted. */}
        {usage.remainingPercent === null || usage.total === null ? (
          <p className="mt-3 text-[11.5px] leading-tight text-faint">{t("creditsPanel.noLimit")}</p>
        ) : (
          <>
            <span className="mt-3 block h-2.5 w-full overflow-hidden rounded-full bg-[rgb(var(--ink)/0.13)]">
              <span
                className={cn(
                  "block h-full rounded-full transition-[width,background-color,box-shadow] duration-500 ease-out",
                  USAGE_BAR[usage.band],
                )}
                // The bar draws WHAT IS LEFT, so a full wallet is a full bar.
                // The 3 % floor keeps an empty wallet visible as a line rather
                // than as an empty track that reads as "no data".
                style={{ width: `${Math.max(3, usage.remainingPercent)}%` }}
              />
            </span>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11.5px] leading-none">
              <span className="min-w-0 truncate text-muted">
                {t("creditsPanel.left")}:{" "}
                <span className="metric tabular-nums text-ink">{num(usage.remaining)} / {num(usage.total)}</span>
              </span>
              <span className={cn("shrink-0 font-semibold tabular-nums", USAGE_TEXT[usage.band])}>
                {usage.remainingPercent}%
              </span>
            </div>
          </>
        )}

        {/* Two across only when "Doładuj kredyty" actually fits beside
            "Ulepsz plan" — measured, not guessed. Below that the pair stacks
            rather than truncating the label that spends money. */}
        <div className="mt-3 grid grid-cols-1 gap-2 min-[375px]:grid-cols-2">
          <Link href="/plan" onClick={closeNav}
            className="flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-[rgb(var(--accent)/0.30)] bg-[rgb(var(--accent)/0.10)] px-2 text-[12.5px] font-semibold text-ink transition-colors duration-200 hover:bg-[rgb(var(--accent)/0.16)]">
            <ArrowUpRight size={15} aria-hidden className="shrink-0 text-accent" />
            <span className="truncate">{t("nav.upgrade")}</span>
          </Link>
          <Link href="/credits" onClick={closeNav}
            className="cta flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-[12.5px] font-semibold">
            <Plus size={15} aria-hidden strokeWidth={2.6} className="shrink-0" />
            <span className="truncate">{t("credits.topupTitle")}</span>
          </Link>
        </div>
      </div>

      {/* ── THE PLACES ───────────────────────────────────────────────────── */}
      <div className="mt-3 space-y-1.5">
        <Tile href="/home" label={t("topnav.home")} icon={Home} onNavigate={closeNav} badge={badge("/home")} />
        {show("/library") && (
          <Tile href="/library" label={t("topnav.library")} icon={Images} onNavigate={closeNav} badge={badge("/library")} />
        )}
        {show("/inspirations") && (
          <Tile href="/inspirations" label={t("nav.inspirations")} icon={Lightbulb} onNavigate={closeNav} badge={badge("/inspirations")} />
        )}
        <Tile href="/settings" label={t("nav.settings")} icon={Settings} onNavigate={closeNav} />
        <Tile href="/support" label={t("nav.help")} icon={LifeBuoy} onNavigate={closeNav} />
        {/* ADMIN IS A ROLE CHECK, NOT A STYLE. Hiding this tile is the LAST of
            three gates, not the only one: `/admin` has its own server-side
            redirect for anyone whose profile role is not admin, and every
            admin action is checked again in the database. */}
        {isAdmin && (
          <Tile href="/admin" label={t("nav.admin")} icon={Shield} onNavigate={closeNav}
            rgb="var(--accent2)" tinted />
        )}
      </div>

      {/* ── THE WORKSHOPS ────────────────────────────────────────────────── */}
      {categories.length > 0 && (
        <Section title={t("topnav.image")} hrefs={categories.map((c) => `/k/${c.slug}`)}>
          {categories.map((c) => (
            <Tile key={c.key} href={`/k/${c.slug}`} label={t(`cats.${c.key}`)} icon={c.icon}
              onNavigate={closeNav} rgb={c.accent.rgb}
              badge={badge(`/k/${c.slug}`) ?? (c.soon ? t("common.soon") : null)} />
          ))}
        </Section>
      )}

      {toolEntries.length > 0 && (
        <Section title={t("nav.groups.tools")} hrefs={toolEntries.map((e) => e.href)}>
          {/* The hub is the last of these five entries, so it is not appended a
              second time underneath them. */}
          {toolEntries.map((e) => (
            <Tile key={e.key} href={e.href} label={t(editLabelKey(e))} icon={e.icon}
              onNavigate={closeNav} badge={badge(e.href)} />
          ))}
        </Section>
      )}

      {show("/wideo") && (
        <Section title={t("topnav.video")} hrefs={["/wideo"]}>
          <Tile href="/wideo" label={t("video.title")} icon={VideoIcon} onNavigate={closeNav}
            rgb="var(--violet)" badge={badge("/wideo") ?? t("common.soon")} />
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

/**
 * ONE DESTINATION, ONE TILE — the only row shape this menu has.
 *
 * Icon plate, label, chevron, and a hairline that closes the card. Categories
 * pass their own colour through `rgb` so Moda is still Moda and the admin tile
 * is still staff-coloured, but the geometry never changes: same height, same
 * plate, same chevron, so a list of them reads as a column rather than as a
 * pile of differently-sized things.
 *
 * The ACTIVE tile is tinted, ringed and lit from the left in its own colour,
 * with the icon plate filled. `isNavActive` decides that — the same rule every
 * other menu in the product uses — so at most one tile can ever claim it.
 */
function Tile({ href, label, icon: Icon, onNavigate, badge, rgb = "var(--accent)", tinted = false }: {
  href: string;
  label: string;
  icon: LucideIcon;
  onNavigate?: () => void;
  /** Availability pill ("Wkrótce" / "Prace techniczne") — the link stays live. */
  badge?: string | null;
  /** The tile's accent as a bare `r g b` triplet or a var() reference. */
  rgb?: string;
  /** Carry that accent even when the tile is NOT the current page — how the
   *  staff entrance says it belongs to someone else without a second shape. */
  tinted?: boolean;
}) {
  const pathname = usePathname();
  const active = isNavActive(pathname, href);
  return (
    <Link
      href={href}
      prefetch
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      style={{ ["--tile" as string]: rgb }}
      className={cn(
        "group relative flex min-h-[52px] items-center gap-3 overflow-hidden rounded-2xl border px-3 py-2.5 transition-all duration-200",
        active
          ? "border-[rgb(var(--tile)/0.45)] bg-[rgb(var(--tile)/0.13)] shadow-[0_0_18px_-6px_rgb(var(--tile)/0.55)]"
          : "border-[rgb(var(--line)/0.12)] bg-[rgb(var(--ink)/0.035)] hover:bg-[rgb(var(--ink)/0.065)]",
      )}
    >
      <span aria-hidden className={cn(
        "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-[rgb(var(--tile))] transition-all duration-200",
        active ? "h-7 opacity-100" : "h-3 opacity-0",
      )} />
      <span aria-hidden className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-200",
        active
          ? "bg-[rgb(var(--tile)/0.22)] text-[rgb(var(--tile))] ring-1 ring-[rgb(var(--tile)/0.45)]"
          : tinted
            ? "bg-[rgb(var(--tile)/0.14)] text-[rgb(var(--tile))] ring-1 ring-[rgb(var(--tile)/0.28)]"
            : "bg-[rgb(var(--ink)/0.07)] text-muted group-hover:text-ink",
      )}>
        <Icon size={17} strokeWidth={active ? 2.3 : 2} />
      </span>
      <span className={cn(
        "min-w-0 flex-1 truncate text-[14px]",
        active ? "font-semibold text-ink" : tinted ? "font-semibold text-[rgb(var(--tile))]" : "font-medium text-ink",
      )}>
        {label}
      </span>
      {badge && (
        <span className="shrink-0 rounded-full bg-[rgb(var(--ink)/0.08)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
          {badge}
        </span>
      )}
      <ChevronRight size={16} aria-hidden className={cn(
        "shrink-0 transition-colors duration-200",
        active ? "text-[rgb(var(--tile))]" : "text-faint",
      )} />
    </Link>
  );
}

/**
 * Collapsible group — the three workshops, folded so the whole tree fits.
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
 * Now the section is open when it holds the tile for the current page, decided
 * by `sectionOwnsRoute` — the same function that decides which tile lights up,
 * so the two can never disagree. That is also why this survives a refresh, a
 * direct URL, and back/forward: none of them are remembered state, they are
 * just a pathname, and the pathname is the whole input.
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
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setChoice({ route: pathname, open: !open })}
        aria-expanded={open}
        className={cn(
          "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-2xl border px-3 py-2 transition-colors duration-200",
          open
            ? "border-[rgb(var(--line)/0.16)] bg-[rgb(var(--ink)/0.05)]"
            : "border-[rgb(var(--line)/0.10)] bg-[rgb(var(--ink)/0.025)] hover:bg-[rgb(var(--ink)/0.05)]",
        )}
      >
        <span className="overline truncate text-[10px] tracking-[0.18em] opacity-90">{title}</span>
        <span aria-hidden className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--ink)/0.07)] text-faint transition-transform duration-200",
          open && "rotate-180",
        )}>
          <ChevronDown size={14} />
        </span>
      </button>
      {open && <div className="animate-fade mt-1.5 space-y-1.5">{children}</div>}
    </div>
  );
}
