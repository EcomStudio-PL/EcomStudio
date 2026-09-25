"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight, ChevronLeft, ChevronRight, Images, LifeBuoy, LogOut, Newspaper, Plus, Settings, Shield,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  allDefaults, menuBadge, menuVisible,
  type AvailabilityMap, type MenuBadge, type MenuGate,
} from "@/lib/features";
import { isNavActive } from "@/lib/nav-active";
import { creditUsage, USAGE_BAR, USAGE_TEXT } from "@/lib/credit-usage";
import { Drawer } from "./drawer";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import { Diamond } from "./credits-control";
import { planTone, PLAN_BADGE, firstName, type PlanTone } from "@/lib/plan-tone";
import { useDrawer } from "./shell-context";
import { cn } from "@/lib/utils";

/**
 * MOBILE MENU — a column of cards, not a list of links.
 *
 * TWO CARDS AND THEN TILES. The account card and the way back share the
 * pinned top row; the wallet is the first thing in the list under it, and
 * every destination below that is its own rounded tile with an icon plate and
 * a label. The flat text list this replaced was legible and cheap and read
 * like a table of contents; at phone scale a tile is what says "this is a
 * thing you can press".
 *
 * THE METER SHOWS WHAT IS LEFT. The bar empties as credits are spent and the
 * label says "Pozostało", because that is the question a seller opens this
 * menu with. The COLOUR still comes from how much is gone
 * (`lib/credit-usage.ts`): 10 % left is red whichever way the number is
 * phrased, and the card itself never changes colour — nearly out of credits is
 * not an error state.
 *
 * DIRECT ROWS AND NOTHING ELSE. Under the wallet: Biblioteka, GrovNews, Pomoc,
 * Ustawienia and — for staff only — Panel admina, each its own directly
 * pressable tile. GrovNews is listed for everyone the switchboard shows it
 * to; whether its content opens is the module's own server-side entitlement
 * check, never this menu.
 * The menu used to fold these into a "GŁÓWNE" group and carry three more
 * groups (OBRAZY, NARZĘDZIA, WIDEO); the tools, categories and video live on
 * the Narzędzia tab, the bottom bar and the search, so the drawer no longer
 * repeats them. The account card on top and the sign-out / language / theme
 * row pinned at the bottom are unchanged.
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
  const show = (gate: MenuGate) => menuVisible(avail, gate, seesRestricted);
  const badge = (gate: MenuGate) => badgeLabel(menuBadge(avail, gate), t);
  const who = firstName(name, email) || name;
  const initial = (who || "?").trim().charAt(0).toUpperCase();
  const tone = planTone(plan);
  const closeNav = () => setOpen(false);
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  // Both numbers come from the account: the wallet row and the plan row. There
  // is no reference constant here and nothing is assumed about the tier.
  const usage = creditUsage(credits, creditsTotal);

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      label={t("nav.menu")}
      header={(close) => (
        /**
         * THE ACCOUNT AND THE WAY OUT, ON ONE LINE.
         *
         * The close control used to sit on a line of its own above the card:
         * 44px of button plus its padding, spent on one X, at the top of a
         * panel where vertical space is the scarce thing. Sharing the row
         * costs nothing — the button simply stretches to the card's height —
         * and the menu now starts roughly a row and a half higher.
         *
         * 88 / 2 / 10. The card takes what is left after the gap and the
         * button, so the split holds at every width without being restated;
         * `min-w` only stops the button collapsing below a thumb at 320px.
         * `items-stretch` is what makes the two exactly the same height.
         */
        <div className="flex items-stretch gap-[2%] px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <AccountCard who={who} initial={initial} plan={plan} tone={tone} onNavigate={closeNav} />
          {/* An arrow, not an X: this panel slides in from the left edge, so
              the gesture it undoes is "go back", not "dismiss". */}
          <button
            type="button"
            onClick={close}
            aria-label={t("common.close")}
            className="flex w-[10%] min-w-[34px] shrink-0 items-center justify-center rounded-2xl border border-[rgb(var(--line)/0.14)] bg-[rgb(var(--ink)/0.045)] text-muted transition-colors duration-200 hover:bg-[rgb(var(--ink)/0.08)] hover:text-ink active:bg-[rgb(var(--ink)/0.11)]"
          >
            <ChevronLeft size={20} aria-hidden />
          </button>
        </div>
      )}
      footer={
        /* ONE LINE, THREE CONTROLS. Leaving, language and theme are the three
           things you touch on the way out, and they were three stacked rows
           eating the bottom of the menu. The language trigger is the current
           flag and nothing else — a word there ("Polski", or even "PL") made
           the quietest control in the row the widest. */
        <div className="flex items-center gap-1.5">
          <form method="post" action="/auth/sign-out" className="min-w-0 flex-1">
            <button className="group flex h-11 w-full items-center gap-1.5 rounded-2xl border border-[rgb(var(--line)/0.14)] bg-[rgb(var(--ink)/0.04)] px-2 text-left transition-colors duration-200 hover:bg-[rgb(var(--ink)/0.07)]">
              <LogOut size={16} aria-hidden className="shrink-0 text-muted transition-colors duration-200 group-hover:text-ink" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{t("common.signOut")}</span>
            </button>
          </form>
          <LocaleSwitcher align="left" side="top" flagsOnly size="md" />
          <ThemeToggle size="md" />
        </div>
      }
    >
      {/* ── THE WALLET ───────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-[rgb(var(--accent)/0.24)] bg-gradient-to-b from-[rgb(var(--accent)/0.10)] to-[rgb(var(--ink)/0.04)] p-3 shadow-e1">
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

      {/* ── DIRECT ROWS ──────────────────────────────────────────────────── */}
      <div className="mt-3 space-y-1">
        {show("/library") && (
          <Tile href="/library" label={t("topnav.library")} icon={Images} onNavigate={closeNav} badge={badge("/library")} />
        )}
        {show("/grovnews") && (
          <Tile href="/grovnews" label={t("grovnews.title")} icon={Newspaper} onNavigate={closeNav} badge={badge("/grovnews")} />
        )}
        <Tile href="/support" label={t("nav.help")} icon={LifeBuoy} onNavigate={closeNav} />
        <Tile href="/settings" label={t("nav.settings")} icon={Settings} onNavigate={closeNav} />
        {/* ADMIN IS A ROLE CHECK, NOT A STYLE. Hiding this tile is the LAST of
            three gates, not the only one: `/admin` has its own server-side
            redirect for anyone whose profile role is not admin, and every
            admin action is checked again in the database. */}
        {isAdmin && (
          <Tile href="/admin" label={t("nav.admin")} icon={Shield} onNavigate={closeNav}
            rgb="var(--accent2)" tinted />
        )}
      </div>
    </Drawer>
  );
}

/**
 * WHO IS SIGNED IN — avatar with a soft brand glow, the name, the plan badge
 * under it, and a chevron, because the whole card is a link to the account
 * screen. It takes whatever width the row leaves it (88 %, next to the 2 % gap
 * and the 10 % back button) and sets the height both of them share.
 */
function AccountCard({ who, initial, plan, tone, onNavigate }: {
  who: string;
  initial: string;
  plan: string;
  tone: PlanTone;
  onNavigate: () => void;
}) {
  return (
    <Link href="/settings" onClick={onNavigate}
      className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-[rgb(var(--line)/0.14)] bg-gradient-to-b from-[rgb(var(--ink)/0.075)] to-[rgb(var(--ink)/0.035)] p-3 shadow-e1 transition-colors duration-200 hover:to-[rgb(var(--ink)/0.06)]">
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
function Tile({ href, match, scroll, label, icon: Icon, onNavigate, badge, rgb = "var(--accent)", tinted = false }: {
  href: string;
  /** The path whose screens make this tile the current one, when `href` is a
   *  view rather than a path — a category's tile opens a section of /tools but
   *  is "here" on the screens of its own workflows. */
  match?: string;
  /** `false` for a link into a section that scrolls itself into view, so the
   *  router does not first reset the page to its top. */
  scroll?: boolean;
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
  const active = isNavActive(pathname, match ?? href);
  return (
    <Link
      href={href}
      prefetch
      scroll={scroll}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      style={{ ["--tile" as string]: rgb }}
      className={cn(
        "group relative flex min-h-[44px] items-center gap-2.5 overflow-hidden rounded-xl border px-2.5 py-1.5 transition-all duration-200",
        active
          ? "border-[rgb(var(--tile)/0.38)] bg-[rgb(var(--tile)/0.12)]"
          : "border-transparent bg-[rgb(var(--ink)/0.03)] hover:bg-[rgb(var(--ink)/0.06)]",
      )}
    >
      <span aria-hidden className={cn(
        "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-[rgb(var(--tile))] transition-all duration-200",
        active ? "h-5 opacity-100" : "h-2 opacity-0",
      )} />
      <span aria-hidden className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
        active
          ? "bg-[rgb(var(--tile)/0.20)] text-[rgb(var(--tile))]"
          : tinted
            ? "bg-[rgb(var(--tile)/0.13)] text-[rgb(var(--tile))]"
            : "bg-[rgb(var(--ink)/0.06)] text-muted group-hover:text-ink",
      )}>
        <Icon size={16} strokeWidth={active ? 2.3 : 2} />
      </span>
      <span className={cn(
        "min-w-0 flex-1 truncate text-[13px]",
        active ? "font-semibold text-ink" : tinted ? "font-semibold text-[rgb(var(--tile))]" : "font-medium text-ink",
      )}>
        {label}
      </span>
      {badge && (
        <span className="shrink-0 rounded-full bg-[rgb(var(--ink)/0.08)] px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-faint">
          {badge}
        </span>
      )}
    </Link>
  );
}
