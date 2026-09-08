"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Images, Menu } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  IMAGE_CREATE, IMAGE_EDIT, IMAGE_MODES, VIDEO_CREATE, VIDEO_EDIT, editLabelKey, type MegaEntry,
} from "@/lib/topnav";
import { allDefaults, menuBadge, menuVisible, type AvailabilityMap, type MenuBadge } from "@/lib/features";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { CommandPalette } from "./command-palette";
import { CreditsControl } from "./credits-control";
import { AccountMenu } from "./account-menu";
import { useDrawer } from "./shell-context";
import { NotificationsBell, type NotificationItem } from "./notifications-bell";

/**
 * MEGA TOPBAR — the customer app's ONLY chrome. Left to right:
 * logo · Obraz ▾ · Wideo ▾ · search … Plany · credits · Biblioteka ·
 * theme · bell · avatar ▾.
 *
 * The plan TIER is still absent from the bar — "Plany" is a destination, not
 * a badge saying which one you are on; that fact lives in the account popover
 * next to the wallet it explains.
 *
 * The mega panel is positioned inside the SAME relative wrapper as its
 * trigger, so it opens flush under the button with no dead pixels for the
 * pointer to fall through: the gap between bar and panel is padding that
 * belongs to the hover target, not empty page. Opening is instant on hover
 * and on click; closing waits 200 ms so the pointer can travel.
 */
export function MegaTopbar({ name, email, credits, plan, isAdmin = false, navAdmin, notifications = [], unread = 0, availability }: {
  name: string; email?: string; credits: number; plan: string; isAdmin?: boolean;
  /** What the MENU should treat as admin. Same as `isAdmin` normally, but an
   *  admin previewing the app as a customer gets `false` here while keeping
   *  the admin affordances (the admin link, the wide palette) intact. */
  navAdmin?: boolean;
  notifications?: NotificationItem[]; unread?: number;
  /** Feature availability from the server layout — filters and badges the
   *  menus. Absent (other shells) means everything active. */
  availability?: AvailabilityMap;
}) {
  const { t } = useI18n();
  const { setOpen: setDrawerOpen } = useDrawer();
  const pathname = usePathname();
  const avail = availability ?? allDefaults();
  const seesRestricted = navAdmin ?? isAdmin;
  const [menu, setMenu] = useState<"image" | "video" | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLElement>(null);

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
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const hoverOpen = (which: "image" | "video") => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setMenu(which);
  };
  const hoverLeave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(close, 200);
  };

  const navBtn = (active: boolean) => cn(
    "inline-flex h-9 items-center gap-1 rounded-xl px-3 text-sm font-semibold transition-colors duration-200",
    active ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:bg-raised hover:text-ink",
  );

  return (
    <header ref={barRef} className="glass sticky top-0 z-40 rounded-none border-x-0 border-t-0 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-[52px] w-full min-w-0 max-w-[var(--content-max)] items-center gap-1 px-2.5 sm:h-[54px] sm:gap-1.5 sm:px-4 lg:px-6 xl:px-8">
        {/* Mobile: hamburger opens the drawer (full hierarchy inside). */}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label={t("nav.menu")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors duration-200 hover:bg-raised hover:text-ink lg:hidden"
        >
          <Menu aria-hidden size={20} />
        </button>

        {/* ONE brand lockup. The wordmark collapses below `sm`; the mark is
            never duplicated at any width. */}
        <Brand href="/home" className="shrink-0" wordmarkClassName="hidden sm:inline-flex" />

        {/* PRIMARY: Obraz / Wideo mega-menus + search. */}
        <nav className="relative ml-2 hidden items-center gap-0.5 lg:flex" aria-label={t("topnav.primary")}>
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
                <ChevronDown size={13} aria-hidden className={cn("transition-transform duration-200", menu === which && "rotate-180")} />
              </button>

              {/* The panel lives inside the trigger's own wrapper: `top-full`
                  plus `pt-2` keeps the bridge hoverable. */}
              {menu === which && (
                <div className="absolute left-0 top-full z-50 pt-2">
                  <MegaPanel which={which} t={t} avail={avail} isAdmin={seesRestricted} />
                </div>
              )}
            </div>
          ))}
          <div className="ml-1.5"><CommandPalette isAdmin={isAdmin} wide /></div>
        </nav>

        <div className="min-w-0 flex-1" />

        {/* RIGHT: plans · credits · library · theme · bell · avatar.
            "Plany" sits immediately LEFT of the wallet, where the answer to
            "I am running out of credits" is one glance away from the number
            that prompted it. The language switch left this bar for the account
            popover — three flags of permanent chrome for a choice made once. */}
        {menuVisible(avail, "/plan", seesRestricted) && (
          <Link href="/plan"
            className={cn(
              "hidden h-9 items-center rounded-xl px-3 text-sm font-semibold transition-colors duration-200 lg:inline-flex",
              pathname.startsWith("/plan") ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:bg-raised hover:text-ink",
            )}>
            {t("nav.plans")}
          </Link>
        )}

        <CreditsControl credits={credits} />

        {menuVisible(avail, "/library", seesRestricted) && (
          <Link href="/library"
            className={cn(
              "hidden h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors duration-200 lg:inline-flex",
              pathname.startsWith("/library") ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:bg-raised hover:text-ink",
            )}>
            <Images size={15} aria-hidden />
            {t("topnav.library")}
            <DynBadge kind={menuBadge(avail, "/library")} t={t} />
          </Link>
        )}

        {/* Mobile search icon — the palette opens as a full overlay. */}
        <div className="lg:hidden"><CommandPalette isAdmin={isAdmin} iconOnly /></div>

        <div className="hidden sm:block"><ThemeToggle /></div>
        <NotificationsBell items={notifications} unread={unread} />

        {/* ONE avatar treatment at every width: the picture and a caret. The
            name was on the bar only past 2xl, so the trigger changed shape
            between laptop and monitor — and the name is the first line inside
            the popover anyway. */}
        <div className="hidden lg:block">
          <AccountMenu name={name} email={email} credits={credits} plan={plan} isAdmin={isAdmin} />
        </div>
        {/* No avatar button on phones: the hamburger on the left and the
            account slot in the bottom navigation already open the same
            drawer, and a third trigger is what pushed this bar past 320px. */}
      </div>
    </header>
  );
}

/** The panel body: TWÓRZ (categories, each in its own accent) and EDYTUJ
 *  (the toolbox), plus a footer of secondary destinations. */
function MegaPanel({ which, t, avail, isAdmin }: {
  which: "image" | "video";
  t: (k: string, v?: Record<string, string | number>) => string;
  avail: AvailabilityMap;
  isAdmin: boolean;
}) {
  // Availability first: a DISABLED (or menu-hidden) module simply is not
  // listed for customers; admins keep every entry, badged.
  const create = (which === "image" ? IMAGE_CREATE : VIDEO_CREATE)
    .filter((e) => menuVisible(avail, e.href, isAdmin));
  // The image list is five entries now, and the last of them IS the hub, so
  // nothing is trimmed and no separate "all tools" link is needed underneath.
  const edit = (which === "image" ? IMAGE_EDIT : VIDEO_EDIT)
    .filter((e) => menuVisible(avail, e.href, isAdmin));
  const modes = IMAGE_MODES.filter((e) => menuVisible(avail, e.href, isAdmin));
  // An entry that is not a category names itself; the categories keep taking
  // their label and one-liner from the category dictionary.
  const label = (e: MegaEntry) =>
    e.labelKey ? t(e.labelKey) : which === "image" ? t(`cats.${e.key}`) : t(`video.wf.${e.key}.name`);
  const sub = (e: MegaEntry) =>
    e.subKey ? t(e.subKey) : which === "image" ? t(`cats.${e.key}Sub`) : t(`video.wf.${e.key}.sub`);

  return (
    <div role="menu" className="overlay animate-pop w-[min(56rem,calc(100vw-3rem))] rounded-2xl p-5 shadow-e4">
      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <section>
          {/* No "TWÓRZ" heading. The column IS the creating half of the panel,
              the tiles say what they make, and a word above them was one more
              line between the pointer and the thing it came for. "EDYTUJ"
              stays: it is what separates the two halves. */}
          <div className="grid grid-cols-2 gap-1">
            {create.map((e) => (
              <MegaLink key={e.key} entry={e} label={label(e)} sub={sub(e)} soonLabel={t("common.soon")}
                dynBadge={dynBadgeLabel(menuBadge(avail, e.href), t)} />
            ))}
          </div>
          {which === "image" && modes.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3.5">
              {modes.map((e) => (
                <Link key={e.key} href={e.href}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold transition-colors duration-200",
                    e.key === "engine" ? "cta" : "snake plate text-ink hover:border-[rgb(var(--accent)/0.4)]",
                  )}>
                  <e.icon size={14} aria-hidden />
                  {e.labelKey ? t(e.labelKey) : t(`mega.${e.key}`)}
                  <DynBadge kind={menuBadge(avail, e.href)} t={t} onCta={e.key === "engine"} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="border-line md:border-l md:pl-6">
          <p className="overline mb-2.5">{t("mega.edit")}</p>
          <div className="grid gap-0.5">
            {edit.map((e) => (
              <MegaLink key={e.key} entry={e}
                label={which === "image" ? t(editLabelKey(e)) : t(`video.wf.${e.key}.name`)}
                soonLabel={t("common.soon")} compact
                dynBadge={dynBadgeLabel(menuBadge(avail, e.href), t)} />
            ))}
            {which === "video" && (
              <p className="mt-3 text-[12px] leading-relaxed text-faint">{t("mega.videoSoon")}</p>
            )}
          </div>
        </section>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
        {menuVisible(avail, which === "image" ? "/inspirations" : "/wideo", isAdmin) ? (
          <Link href={which === "image" ? "/inspirations" : "/wideo"}
            className="text-[12.5px] font-semibold text-muted transition-colors duration-200 hover:text-ink">
            {which === "image" ? t("nav.inspirations") : t("video.title")} →
          </Link>
        ) : <span />}
        {menuVisible(avail, "/products", isAdmin) && (
          <Link href="/products" className="text-[12.5px] font-semibold text-muted transition-colors duration-200 hover:text-ink">
            {t("nav.products")} →
          </Link>
        )}
      </div>
    </div>
  );
}

/** The i18n label for a dynamic availability badge, or null when active. */
function dynBadgeLabel(kind: MenuBadge, t: (k: string) => string): string | null {
  if (kind === "soon") return t("features.badgeSoon");
  if (kind === "maintenance") return t("features.badgeMaintenance");
  if (kind === "disabled") return t("features.badgeDisabled");
  return null;
}

/** The pill for a feature-availability state on a standalone link. Unlike the
 *  static `soon` treatment the link STAYS clickable — the page explains. */
function DynBadge({ kind, t, onCta }: { kind: MenuBadge; t: (k: string) => string; onCta?: boolean }) {
  const label = dynBadgeLabel(kind, t);
  if (!label) return null;
  return (
    <span className={cn(
      "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
      onCta ? "bg-white/20 text-white" : "bg-raised text-faint",
    )}>
      {label}
    </span>
  );
}

/** One mega-menu entry: icon tile in the entry's own accent, label, and a
 *  one-liner. Disabled with a "Wkrótce" badge when there is no backend; a
 *  feature-availability badge (dynBadge) keeps the link alive — the target
 *  page renders the coming-soon / maintenance screen itself. */
function MegaLink({ entry, label, sub, soonLabel, compact, dynBadge }: {
  entry: MegaEntry; label: string; sub?: string; soonLabel: string; compact?: boolean;
  dynBadge?: string | null;
}) {
  const Icon = entry.icon;
  const accented = Boolean(entry.accent) && !entry.soon;
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg transition-transform duration-200",
          compact ? "h-7 w-7" : "h-9 w-9",
          entry.soon
            ? "bg-raised text-faint"
            : accented
              ? "text-[rgb(var(--cat))] group-hover:scale-105"
              : "bg-[linear-gradient(145deg,rgb(var(--accent)/0.22),rgb(var(--violet)/0.10))] text-accent group-hover:scale-105",
        )}
        style={accented ? {
          ["--cat" as string]: entry.accent!.rgb,
          background: `linear-gradient(145deg, rgb(${entry.accent!.rgb} / 0.26), rgb(${entry.accent!.rgb2} / 0.10))`,
        } : undefined}
      >
        <Icon size={compact ? 14 : 16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("flex items-center gap-1.5 truncate font-semibold", compact ? "text-[13px]" : "text-sm")}>
          {label}
          {(dynBadge || entry.soon) && (
            <span className="rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
              {dynBadge ?? soonLabel}
            </span>
          )}
        </span>
        {sub && <span className="mt-0.5 block truncate text-[11px] text-faint">{sub}</span>}
      </span>
    </>
  );
  // A restriction the admin set is not a dead end: the entry stays a link and
  // the destination explains itself. Only a module with no backend AND no
  // registry opinion is drawn as an inert row.
  const inert = entry.soon && !dynBadge;
  const cls = cn(
    "group flex items-center gap-2.5 rounded-xl px-2.5 transition-colors duration-200",
    compact ? "py-1.5" : "py-2",
    // The light thread runs the border of a live entry only. An inert row is
    // not a destination, so lighting it up would be an invitation to click
    // something that does nothing.
    inert ? "cursor-default opacity-60" : "snake hover:bg-[rgb(var(--ink)/0.06)]",
  );
  return inert
    ? <div className={cls} aria-disabled>{body}</div>
    : <Link role="menuitem" href={entry.href} className={cls}>{body}</Link>;
}
