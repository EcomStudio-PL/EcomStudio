"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Boxes, ChevronDown, LayoutDashboard, Layers, Send, Sparkles,
  Users, Workflow, UserX,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * THE NEWSLETTER'S OWN NAVIGATION — nine places, two shapes.
 *
 * On a desktop all nine fit in one scrollable row, the same shape the CMS uses
 * (components/admin/cms/cms-nav.tsx), so the two modules feel like one panel.
 *
 * ON A PHONE THEY DO NOT FIT, and pretending otherwise is how a row of tabs
 * becomes a row of truncated words nobody can read. Four stay visible —
 * Pulpit, Kontakty, Kampanie, Analityka, which is where an operator actually
 * goes — and the remaining five live behind "Więcej". The "Więcej" button
 * itself wears the selected state when the current page is one of those five,
 * so an operator sitting on Szablony can still see where they are.
 */

type Tab = {
  href: string;
  key: string;
  icon: typeof LayoutDashboard;
  /** Only the dashboard matches on equality; the rest own their subtree. */
  exact?: boolean;
  /** Stays visible on a phone. The other five go behind "Więcej". */
  primary?: boolean;
};

const TABS: readonly Tab[] = [
  { href: "/admin/newsletter", key: "dashboard", icon: LayoutDashboard, exact: true, primary: true },
  { href: "/admin/newsletter/kontakty", key: "contacts", icon: Users, primary: true },
  { href: "/admin/newsletter/grupy", key: "groups", icon: Layers },
  { href: "/admin/newsletter/kampanie", key: "campaigns", icon: Send, primary: true },
  { href: "/admin/newsletter/automatyzacje", key: "automations", icon: Workflow },
  { href: "/admin/newsletter/szablony", key: "templates", icon: Boxes },
  { href: "/admin/newsletter/ai", key: "ai", icon: Sparkles },
  { href: "/admin/newsletter/analityka", key: "analytics", icon: BarChart3, primary: true },
  { href: "/admin/newsletter/wypisani", key: "suppressions", icon: UserX },
];

const isOn = (pathname: string, href: string, exact?: boolean) =>
  exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

export function NewsletterNav() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  /* THE SELECTED TAB HAS TO BE ON SCREEN.
     A row that scrolls can open scrolled past the tab the operator is on —
     land on Analityka from a link and the bar shows Pulpit with nothing
     selected, which reads as a broken page. `nearest` rather than `center` so
     a tab that is already visible does not jerk the row sideways for nothing;
     `inline` only, so this never scrolls the PAGE to reach the bar. */
  useEffect(() => {
    const el = activeRef.current;
    if (!el || !scrollerRef.current) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
  }, [pathname]);

  const overflow = TABS.filter((tab) => !tab.primary);
  const overflowActive = overflow.some((tab) => isOn(pathname, tab.href, tab.exact));

  const tabClass = (on: boolean) => cn(
    "inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition-colors duration-150",
    on ? "is-selected" : "border-line text-muted hover:bg-raised hover:text-ink",
  );

  return (
    <nav aria-label={t("newsletter.title")} data-newsletter-nav className="mb-4">
      {/* ── PHONE AND TABLET ─────────────────────────────────────────────────
          A SCROLLING ROW, NOT FOUR EQUAL COLUMNS.

          This used to be `flex-1` on each of the four primary tabs plus a
          "Więcej" button. On a 390px phone that is roughly 70px per tab, and
          after a 14px icon and its gap the label had about 45px — so "Pulpit"
          rendered as "Pul...", "Kontakty" as "Ko...". Four truncated words are
          not a navigation bar; `truncate` was hiding a layout that did not fit
          rather than making one that does.

          Now the tabs keep their natural width (`shrink-0`, no truncate) and
          the row scrolls. The scrollbar is hidden by `thin-scroll`, the active
          tab is scrolled into view below so a deep link never opens with the
          current tab off-screen, and the row is the only thing that scrolls
          sideways — the page itself does not, because the overflow is bounded
          by this element rather than by the body.

          "Więcej" sits OUTSIDE the scroller on purpose: it is not one of the
          nine destinations, it is the way to the other five, and a button that
          scrolls away is a button an operator cannot find. */}
      <div className="relative flex items-center gap-1 lg:hidden">
        <div ref={scrollerRef}
          className="thin-scroll -mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto scroll-smooth px-1 py-0.5">
          {TABS.filter((tab) => tab.primary).map((tab) => {
            const on = isOn(pathname, tab.href, tab.exact);
            return (
              <Link key={tab.href} href={tab.href} data-newsletter-tab={tab.key}
                ref={on ? activeRef : undefined}
                aria-current={on ? "page" : undefined}
                className={cn(tabClass(on), "whitespace-nowrap")}>
                <tab.icon size={14} aria-hidden className="shrink-0" />
                {t(`newsletter.nav.${tab.key}`)}
              </Link>
            );
          })}
        </div>

        <button type="button" onClick={() => setOpen((v) => !v)}
          aria-expanded={open} data-newsletter-more
          className={cn(tabClass(overflowActive), "shrink-0")}>
          {t("newsletter.nav.more")}
          <ChevronDown size={14} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <>
            {/* Tapping anywhere else closes it — a menu with no way out on a
                phone is a menu you have to reload the page to escape. */}
            <button type="button" aria-hidden tabIndex={-1} onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default" />
            <div data-newsletter-overflow
              className="panel absolute right-0 top-full z-50 mt-1.5 w-56 rounded-2xl p-1.5 shadow-e2">
              {overflow.map((tab) => {
                const on = isOn(pathname, tab.href, tab.exact);
                return (
                  <Link key={tab.href} href={tab.href} data-newsletter-tab={tab.key}
                    onClick={() => setOpen(false)}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors",
                      on ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-ink",
                    )}>
                    <tab.icon size={15} aria-hidden />
                    {t(`newsletter.nav.${tab.key}`)}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── DESKTOP ──────────────────────────────────────────────────────── */}
      <div className="thin-scroll -mx-1 hidden gap-1 overflow-x-auto px-1 pb-1 lg:flex">
        {TABS.map((tab) => {
          const on = isOn(pathname, tab.href, tab.exact);
          return (
            <Link key={tab.href} href={tab.href} data-newsletter-tab-desktop={tab.key}
              aria-current={on ? "page" : undefined} className={tabClass(on)}>
              <tab.icon size={14} aria-hidden />
              {t(`newsletter.nav.${tab.key}`)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
