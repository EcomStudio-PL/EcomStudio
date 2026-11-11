"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Images, Menu } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  ALL_TOOLS_ENTRY, VIDEO_CREATE, VIDEO_EDIT, entryGate, imageMenuRows, type MegaEntry,
} from "@/lib/topnav";
import {
  allDefaults, menuBadge, menuVisible, type AvailabilityMap, type FeatureKey, type MenuBadge,
} from "@/lib/features";
import { isNavActive } from "@/lib/nav-active";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { CommandPalette } from "./command-palette";
import { CreditsControl } from "./credits-control";
import { AccountMenu } from "./account-menu";
import { MenuVeil } from "./menu-veil";
import { useDrawer } from "./shell-context";
import { NotificationsBell } from "./notifications-bell";
import type { BellPayload } from "@/lib/notifications/catalog";
import { AuthLink } from "@/components/auth/auth-link";
import { useOptionalAuthDialog } from "@/components/auth/auth-dialog-context";

/**
 * MEGA TOPBAR — the customer app's ONLY chrome. Left to right:
 * logo · Obrazy ▾ · Wideo ▾ · search … Plany · credits · Biblioteka ·
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
export function MegaTopbar({ name, email, credits, plan, isAdmin = false, navAdmin, bell, availability, menuItems, popularTools, searchTags, guest = false, signupOpen = true, menu: hasMenu = true, brandHref = "/home" }: {
  name: string; email?: string; credits: number; plan: string; isAdmin?: boolean;
  /**
   * NOBODY IS SIGNED IN.
   *
   * The product homepage shows the whole catalogue to visitors, and it wears
   * THIS bar rather than a second one built for the occasion — one header, two
   * states, so the thing a stranger evaluates is the thing they would use.
   *
   * What changes is only the right-hand cluster: a wallet, a bell and an
   * avatar are three statements about an account that does not exist. They are
   * replaced by the two doors in. The menus, the search and "Plany" are
   * identical, because they are identical facts about the product.
   */
  guest?: boolean;
  /** A visitor's primary door promises free credits only while signup is
   *  open; shut, it is the plain "Załóż konto" and the dialog explains. */
  signupOpen?: boolean;
  /**
   * Whether the hamburger is rendered. It opens the customer drawer, which
   * lives in the (app) layout; a surface without that drawer must not show a
   * control that would silently do nothing (useDrawer's default setter is a
   * no-op outside DrawerProvider).
   */
  menu?: boolean;
  /** Where the logo goes. The app sends you to your dashboard; the public
   *  product page sends you to the top of itself. */
  brandHref?: string;
  /** What the MENU should treat as admin. Same as `isAdmin` normally, but an
   *  admin previewing the app as a customer gets `false` here while keeping
   *  the admin affordances (the admin link, the wide palette) intact. */
  navAdmin?: boolean;
  /** The bell's server copy (app layout). Absent → the bell asks once. */
  bell?: BellPayload;
  /** Feature availability from the server layout — filters and badges the
   *  menus. Absent (other shells) means everything active. */
  availability?: AvailabilityMap;
  /** The catalogue items the menu lists (lib/tool-layout.ts `menuItemKeys`):
   *  the tool column and the generator button. Absent = the shipped menu. */
  menuItems?: readonly string[];
  /** The weekly tool-usage ranking, handed straight to the search overlay so
   *  pressing the magnifier fetches nothing. See lib/server/tool-popularity.ts. */
  popularTools?: readonly FeatureKey[];
  /** Admin search tags for the global search (metadata only). */
  searchTags?: Readonly<Record<string, readonly string[]>>;
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

  // THE VIDEO MENU EXISTS WHILE THE SWITCHBOARD SHOWS IT. At launch every
  // video tool is switched off, so a customer has no "Wideo" at all; the
  // moment an admin opens it again (Admin → Narzędzia, the `video` switch) it
  // comes back on its own — no code decides "never". Admins keep it, badged.
  const triggers: readonly ("image" | "video")[] = menuVisible(avail, "/wideo", seesRestricted) ? ["image", "video"] : ["image"];

  const navBtn = (active: boolean) => cn(
    "inline-flex h-9 items-center gap-1 rounded-xl px-3 text-sm font-semibold transition-colors duration-200",
    active ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:bg-raised hover:text-ink",
  );

  return (
    <header ref={barRef} className="glass sticky top-0 z-40 rounded-none border-x-0 border-t-0 pt-[env(safe-area-inset-top)]">
      {/* The same focus veil the account popover uses: an open mega-menu is a
          menu like any other, and the page under it goes soft for as long as
          it is open — not only while the pointer happens to be on the trigger.
          Rendered HERE, outside the per-trigger hover wrappers below, because
          a portal keeps its React parentage: inside one of them it would make
          the whole viewport part of that trigger's hover zone. */}
      <MenuVeil open={menu !== null} />
      {/* THE BAR IS TALLER WHERE THERE IS ROOM FOR IT TO BE.
          52/54px is a phone's budget: a fixed bar there is space taken from
          the work. A desktop has no such pressure, and at 54px the row read as
          packed — 36px controls with 9px of air above and below them, which is
          a toolbar rather than a product's own chrome. 64px gives every
          control 14px of clearance on each side without touching a single
          font size, icon or width: the height and the padding are doing the
          work, and `items-center` puts everything on the same middle line.
          `--header-h` follows in globals.css, so the search overlay, the sheet
          cap and the viewport-locked generator keep measuring the real bar. */}
      <div className="mx-auto flex h-[52px] w-full min-w-0 max-w-[var(--content-max)] items-center gap-1 px-2.5 sm:h-[54px] sm:gap-1.5 sm:px-4 lg:h-16 lg:gap-2 lg:px-6 xl:px-8">
        {/* Mobile: hamburger opens the drawer (full hierarchy inside). Not
            rendered where there is no drawer to open — see `menu`. */}
        {hasMenu && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={t("nav.menu")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors duration-200 hover:bg-raised hover:text-ink lg:hidden"
          >
            <Menu aria-hidden size={20} />
          </button>
        )}

        {/* THE FULL LOCKUP ON A PHONE, not just the symbol.
            The wordmark used to collapse below `sm`, so every phone showed a
            bare mark and the product never said its own name on the surface a
            seller looks at most.

            It is smaller there because the room is real and measured: this row
            holds the hamburger, the credits, the search and the bell, and the
            only flexible thing in it is the spacer between the brand and the
            credits — 66px of give at 360px and 26px at 320px. A 30px lockup is
            138px wide against a 39px mark, so it needs 99px it simply does not
            have. At 22px it is 101px wide and fits from 360 up; below that the
            mark stands in, which is what `wordmarkClassName` has always done.
            Width is overridden alongside height because the box is
            `object-contain` and would otherwise keep reserving the wide one. */}
        <Brand
          href={brandHref}
          className="shrink-0"
          wordmarkClassName="hidden min-[360px]:inline-flex"
          markClassName="min-[360px]:hidden"
          imgClassName="!h-[22px] !w-[101px] sm:!h-[30px] sm:!w-[138px]"
        />

        {/* PRIMARY: Obraz / Wideo mega-menus + search. */}
        {/* THE TRIGGERS ARE AS TALL AS THE BAR, the buttons inside them are
            not. `top-full` on the panel measures from its wrapper, so while
            the wrapper was button-height the panel opened from the button's
            own bottom edge — 9px inside the old bar, and 14px inside the
            taller one, which put the top of the panel over the header it
            belongs to. Stretching the wrapper (not the button) to the row's
            height makes `top-full` mean "under the bar", and it widens the
            hover bridge to the whole strip between the two at the same time. */}
        <nav className="relative ml-2 hidden items-center gap-0.5 self-stretch lg:flex" aria-label={t("topnav.primary")}>
          {triggers.map((which) => (
            <div key={which} onMouseEnter={() => hoverOpen(which)} onMouseLeave={hoverLeave}
              className="relative flex h-full items-center">
              <button
                type="button"
                aria-expanded={menu === which}
                aria-haspopup="menu"
                onClick={() => setMenu(menu === which ? null : which)}
                className={navBtn(menu === which)}
              >
                {t(`topnav.${which}`)}
                {/* An admin sees the video menu while customers do not —
                    and is told so, so the two are never confused. */}
                {which === "video" && seesRestricted && !menuVisible(avail, "/wideo", false) && (
                  <span className="rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">{t("mega.hidden")}</span>
                )}
                <ChevronDown size={13} aria-hidden className={cn("transition-transform duration-200", menu === which && "rotate-180")} />
              </button>

              {/* The panel lives inside the trigger's own wrapper: `top-full`
                  plus `pt-2` keeps the bridge hoverable. */}
              {menu === which && (
                <div className="absolute left-0 top-full z-50 pt-2">
                  <MegaPanel which={which} t={t} avail={avail} isAdmin={seesRestricted} onNavigate={close} guest={guest} menuItems={menuItems} />
                </div>
              )}
            </div>
          ))}
          <div className="ml-1.5"><CommandPalette isAdmin={isAdmin} navAdmin={seesRestricted} availability={avail} popular={popularTools} searchTags={searchTags} localOnly={guest} wide /></div>
        </nav>

        <div className="min-w-0 flex-1" />

        {/* RIGHT: plans · credits · library · theme · bell · avatar.
            "Plany" sits immediately LEFT of the wallet, where the answer to
            "I am running out of credits" is one glance away from the number
            that prompted it. The language switch left this bar for the account
            popover — three flags of permanent chrome for a choice made once. */}
        {menuVisible(avail, "/plan", seesRestricted) && (
          // A visitor goes to the PUBLIC cennik; /plan sits behind the login.
          <Link href={guest ? "/plany" : "/plan"}
            className={cn(
              "hidden h-9 items-center rounded-xl px-3 text-sm font-semibold transition-colors duration-200 lg:inline-flex",
              // Segment-aware, so a future /plans or /planner cannot light
              // "Plany" — `startsWith` had no boundary. Same rule as the menus.
              isNavActive(pathname, "/plan") || isNavActive(pathname, "/plany")
                ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:bg-raised hover:text-ink",
            )}>
            {t("nav.plans")}
          </Link>
        )}

        {!guest && <CreditsControl credits={credits} />}

        {!guest && menuVisible(avail, "/library", seesRestricted) && (
          <Link href="/library"
            className={cn(
              "hidden h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors duration-200 lg:inline-flex",
              isNavActive(pathname, "/library") ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:bg-raised hover:text-ink",
            )}>
            <Images size={15} aria-hidden />
            {t("topnav.library")}
            <DynBadge kind={menuBadge(avail, "/library")} t={t} />
          </Link>
        )}

        {/* Mobile search icon — the palette opens as a full overlay. */}
        <div className="lg:hidden"><CommandPalette isAdmin={isAdmin} navAdmin={seesRestricted} availability={avail} popular={popularTools} searchTags={searchTags} localOnly={guest} iconOnly /></div>

        <div className="hidden sm:block"><ThemeToggle /></div>

        {guest ? (
          /* THE TWO DOORS IN.
             "Zaloguj się" is quiet and "Załóż konto" carries the CTA, because
             a stranger reading this page is far more likely to be new than
             returning — and the returning half knows where their own login is.
             Below `sm` only the primary survives: at 320px the pair costs the
             whole flexible gap this row has. */
          <>
            {/* Outlined, then filled (Public Tools V1): the quiet door is still
                a button, not a stray word in the bar. The long promise on the
                primary only where the row has room for it — a phone keeps the
                short label, so the bar never wraps. A shut registration is the
                dialog's to explain (its pre-launch notice). */}
            <AuthLink mode="login"
              className="hidden h-9 items-center rounded-xl border border-line px-3 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-raised sm:inline-flex">
              {t("auth.signIn")}
            </AuthLink>
            <AuthLink mode="register"
              className="cta inline-flex h-9 shrink-0 items-center rounded-xl px-3.5 text-[13px] font-semibold sm:text-sm">
              <span className="xl:hidden">{t("auth.signUp")}</span>
              <span className="hidden xl:inline">{t(signupOpen ? "auth.signUpFree" : "auth.signUp")}</span>
            </AuthLink>
          </>
        ) : (
          <>
            <NotificationsBell initial={bell} />
            {/* ONE avatar treatment at every width: the picture and a caret.
                The name was on the bar only past 2xl, so the trigger changed
                shape between laptop and monitor — and the name is the first
                line inside the popover anyway. */}
            <div className="hidden lg:block">
              <AccountMenu name={name} email={email} credits={credits} plan={plan} isAdmin={isAdmin}
                // GrovNews is listed for staff only at launch; the module and
                // its own entitlement check are unchanged.
                grovnews={seesRestricted && menuVisible(avail, "/grovnews", seesRestricted)} />
            </div>
          </>
        )}
        {/* No avatar button on phones: the hamburger on the left and the
            account slot in the bottom navigation already open the same
            drawer, and a third trigger is what pushed this bar past 320px. */}
      </div>
    </header>
  );
}

/**
 * The panel body. „Obrazy” is a COMPACT LIST: one row per tool switched into
 * the menu (lib/topnav.ts `imageMenuEntries`, ordered by MENU_ORDER in
 * lib/tool-layout.ts) — icon, name, one line of what it does — and exactly one
 * link under it, „Wszystkie narzędzia”. No categories, no second column, no
 * promo: the panel is as wide as its words. „Wideo” keeps its two columns
 * (it is only drawn while the switchboard shows it — see `triggers`).
 */
function MegaPanel({ which, t, avail, isAdmin, onNavigate, guest = false, menuItems }: {
  which: "image" | "video";
  /** The items the list shows — see MegaTopbar. */
  menuItems?: readonly string[];
  t: (k: string, v?: Record<string, string | number>) => string;
  avail: AvailabilityMap;
  isAdmin: boolean;
  /** Close the panel once one of its links is followed. The bar also closes
   *  it when the path changes, but a link can keep the path (a ?tryb= mode of
   *  the generator, a section of /tools) and the panel must not stay open over
   *  the screen it just opened. */
  onNavigate: () => void;
  /** The signed-out bar (the public Home). Every entry here is a tool behind
   *  sign-in, so a visitor's press opens the existing sign-in dialog IN PLACE,
   *  with the tool as `next` — the same thing every card on the Home does
   *  (components/home/gate.tsx) — instead of following the link into the
   *  middleware's bounce, which would land them on whatever "/" is today and
   *  lose the page they were exploring. The server still refuses the route to
   *  a visitor either way; this only decides where they are asked. */
  guest?: boolean;
}) {
  const auth = useOptionalAuthDialog();
  const shell = (body: ReactNode, wide: boolean) => (
    <div role="menu"
      onClick={(e) => { if (e.target instanceof Element && e.target.closest("a[href]")) onNavigate(); }}
      // CAPTURE, so it runs before next/link's own handler starts a navigation
      // (Link honours `defaultPrevented`). A modified click — new tab, new
      // window — is the browser's business and is left alone.
      onClickCapture={(e) => {
        if (!guest || !auth || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
        const href = a?.getAttribute("href");
        if (!href || !href.startsWith("/")) return;
        e.preventDefault();
        onNavigate();
        auth.open("login", href);
      }}
      className={cn(
        "overlay animate-pop rounded-2xl shadow-e4",
        wide ? "w-[min(56rem,calc(100vw-3rem))] p-5" : "w-[min(23rem,calc(100vw-2rem))] p-2",
      )}>
      {body}
    </div>
  );

  if (which === "image") {
    const rows = imageMenuRows(avail, isAdmin, menuItems);
    const hub = menuVisible(avail, ALL_TOOLS_ENTRY.href, isAdmin);
    return shell(
      <>
        <div className="grid gap-0.5">
          {rows.map(({ entry, badge }) => (
            <MegaLink key={entry.key} entry={entry} label={t(entry.labelKey ?? entry.key)} sub={entry.subKey ? t(entry.subKey) : undefined}
              soonLabel={t("common.soon")} dynBadge={badge === "hidden" ? t("mega.hidden") : dynBadgeLabel(badge, t)} oneLine />
          ))}
        </div>
        {hub && (
          <div className={cn(rows.length > 0 && "mt-1.5 border-t border-line pt-1.5")}>
            <Link role="menuitem" href={ALL_TOOLS_ENTRY.href}
              className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl px-2.5 text-[13px] font-semibold text-muted transition-colors duration-200 hover:bg-[rgb(var(--accent)/0.09)] hover:text-ink">
              {t(ALL_TOOLS_ENTRY.labelKey!)}
              <span aria-hidden>→</span>
            </Link>
          </div>
        )}
      </>,
      false,
    );
  }

  const create = VIDEO_CREATE.filter((e) => menuVisible(avail, entryGate(e), isAdmin));
  const edit = VIDEO_EDIT.filter((e) => menuVisible(avail, e.href, isAdmin));
  return shell(
    <>
      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <section>
          <div className="grid grid-cols-2 gap-1">
            {create.map((e) => (
              <MegaLink key={e.key} entry={e} label={t(`video.wf.${e.key}.name`)} sub={t(`video.wf.${e.key}.sub`)} soonLabel={t("common.soon")}
                dynBadge={dynBadgeLabel(menuBadge(avail, entryGate(e)), t)} />
            ))}
          </div>
        </section>
        <section className="border-line md:border-l md:pl-6">
          <p className="overline mb-2.5">{t("mega.edit")}</p>
          <div className="grid gap-0.5">
            {edit.map((e) => (
              <MegaLink key={e.key} entry={e} label={t(`video.wf.${e.key}.name`)} sub={t(`video.wf.${e.key}.sub`)}
                soonLabel={t("common.soon")} dynBadge={dynBadgeLabel(menuBadge(avail, entryGate(e)), t)} />
            ))}
            <p className="mt-3 text-[12px] leading-relaxed text-faint">{t("mega.videoSoon")}</p>
          </div>
        </section>
      </div>
      {menuVisible(avail, "/wideo", isAdmin) && (
        <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
          <Link href="/wideo" className="text-[12.5px] font-semibold text-muted transition-colors duration-200 hover:text-ink">
            {t("video.title")} →
          </Link>
        </div>
      )}
    </>,
    true,
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
function MegaLink({ entry, label, sub, soonLabel, compact, dynBadge, oneLine }: {
  entry: MegaEntry; label: string; sub?: string; soonLabel: string; compact?: boolean;
  dynBadge?: string | null;
  /** The one-liner stays ONE line (the compact „Obrazy” list). */
  oneLine?: boolean;
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
        {/* The one-liner WRAPS to a second line instead of truncating: at this
            column width "Zdjęcia modeli, przedmiotów i s…" stops describing
            the tile it belongs to. Two lines is the cap — past that it is not
            a one-liner any more. */}
        {sub && <span className={cn("mt-0.5 text-[11px] leading-snug text-faint", oneLine ? "block truncate" : "line-clamp-2")}>{sub}</span>}
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
    //
    // The hovered background is a BRAND tint rather than a neutral ink wash:
    // on a near-black panel, `--ink` at 6% is a grey square that reads as a
    // rendering artefact next to a magenta outline. The two now belong to the
    // same effect.
    inert ? "cursor-default opacity-60" : "snake hover:bg-[rgb(var(--accent)/0.09)]",
  );
  // A category opens a SECTION of /tools, which scrolls itself into view
  // (components/tools/tools-deep-link.tsx). Letting the router also reset the
  // page to its top first made a change of section jump up, then glide down.
  return inert
    ? <div className={cls} aria-disabled>{body}</div>
    : <Link role="menuitem" href={entry.href} scroll={entry.match ? false : undefined} className={cls}>{body}</Link>;
}
