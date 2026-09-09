"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ChevronDown, CreditCard, LifeBuoy, LogOut, Plus, Settings, Shield, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { creditLevel, CREDIT_METER_CLASS, CREDIT_REFERENCE } from "@/lib/credit-level";
import { firstName, greetingKey, planTone, PLAN_BADGE } from "@/lib/plan-tone";
import { cn } from "@/lib/utils";
import { setLocaleAction } from "@/app/actions/settings";
import { LOCALES } from "@/lib/i18n/config";
import { Diamond } from "./credits-control";
import { Flag } from "./flag";

/**
 * ACCOUNT POPOVER — a 340px panel anchored under the avatar, not a modal.
 *
 * It opens with a greeting that reads the VIEWER's clock, so an evening
 * session is greeted as one; the name comes from the profile, falling back to
 * the local part of the email rather than to a placeholder. Below it: who you
 * are, which tier you are on (in that tier's own colour), what is left in the
 * wallet with a meter, then buying, then the account links, then sign out.
 * The plan lives here and only here — the top bar shows credits, not tiers.
 */
export function AccountMenu({ name, email, credits, plan, isAdmin, showName }: {
  name: string; email?: string; credits: number; plan: string; isAdmin: boolean;
  /** Wide desktops get the name next to the avatar as a clearer trigger. */
  showName?: boolean;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const who = useMemo(() => firstName(name, email), [name, email]);
  const initial = (who || name || "?").trim().charAt(0).toUpperCase();
  const level = creditLevel(credits);
  const tone = planTone(plan);
  const isFree = tone === "free";

  // Resolved after mount: the server has no business guessing the viewer's
  // local hour, and a greeting rendered from server time would be wrong for
  // half the audience.
  const [hour, setHour] = useState<number | null>(null);
  const [switching, startSwitch] = useTransition();
  useEffect(() => { setHour(new Date().getHours()); }, []);

  /* ── OPENING: hover on a mouse, tap on a finger ──────────────────────
     A CLICK PINS the panel, exactly as `InfoHint` does. Without that, a
     desktop user who hovered the avatar open and then clicked it would
     toggle it shut with the pointer still inside — and it would stay shut
     until they left and came back, which reads as broken.
     `(hover: hover) and (pointer: fine)` is what keeps a phone out of all of
     this: a tap there synthesises `mouseenter`, so hover-to-open on a touch
     screen means the first tap opens and the second tap, the one meant to
     choose something, closes. Touch gets click only. */
  const [pinned, setPinned] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimer = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const close = useCallback(() => { stopTimer(); setOpen(false); setPinned(false); }, []);
  const canHover = () =>
    typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const onEnter = () => { if (!canHover()) return; stopTimer(); setOpen(true); };
  /* The grace period is the whole point: a pointer travelling from the avatar
     to the panel grazes the edges of the hover zone, and a zero-delay close
     would flicker there. The bridge below removes the gap; this covers the
     rest. A pinned panel ignores hover entirely. */
  const onLeave = () => {
    if (!canHover() || pinned) return;
    stopTimer();
    closeTimer.current = setTimeout(() => setOpen(false), 220);
  };
  useEffect(() => stopTimer, []);

  useEffect(() => { close(); }, [pathname, close]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open, close]);

  const greeting = hour === null ? null : t(`greet.${greetingKey(hour)}`, { name: who });

  return (
    <>
      {/* FOCUS VEIL — the page behind goes soft while the panel is open, the
          same idea as the drawer and the command palette, at a lighter dose.
          It is PORTALLED to the body at `z-30` on purpose: the bar itself is
          `sticky z-40`, so the header stays sharp and readable above the veil
          while everything under it blurs, and the panel — `z-50` inside the
          header's own stacking context — is never touched by it.

          It is a SIBLING of the hover zone, never a child. A portal keeps its
          React parentage wherever the DOM node lands, so a veil rendered
          inside the zone would have made the whole viewport part of the zone:
          the pointer could never leave it, and the panel would never close on
          its own. Closing needs nothing extra — the veil is outside `ref`, so
          the outside-mousedown listener above already catches a click on it. */}
      {open && typeof document !== "undefined" && createPortal(
        <div aria-hidden
          className="animate-fade fixed inset-0 z-30 bg-[rgb(var(--scrim)/calc(var(--scrim-alpha)*0.55))] backdrop-blur-[6px]" />,
        document.body,
      )}
      <div ref={ref} className="relative" onMouseEnter={onEnter} onMouseLeave={onLeave}>
        <button
          type="button"
          onClick={() => {
            stopTimer();
            if (open && pinned) close();
            else { setOpen(true); setPinned(true); }
          }}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={t("topnav.account")}
          className={cn(
            "flex items-center gap-2 rounded-full transition-all duration-200",
            showName
              ? cn("py-1 pl-1 pr-2.5 ring-1", open ? "bg-raised ring-[rgb(var(--accent)/0.6)]" : "ring-[rgb(var(--hairline)/var(--hairline-alpha))] hover:bg-raised")
              : "",
          )}
        >
          <span aria-hidden className={cn(
            "brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-e2 ring-1 transition-all duration-200",
            open && !showName ? "ring-2 ring-[rgb(var(--accent)/0.75)]" : "ring-white/15",
          )}>
            {initial}
          </span>
          {showName && (
            <>
              <span className="max-w-[7rem] truncate text-[13px] font-semibold">{who || name}</span>
              <ChevronDown size={13} aria-hidden
                className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
            </>
          )}
        </button>

        {/* THE BRIDGE. The 8px of breathing room under the avatar used to be
            the panel's own `mt-2` — dead space the pointer had to cross with
            the menu already closing under it. Moving the gap into a wrapper's
            padding makes it part of the hover zone, the same fix the mega-menu
            uses for Obrazy / Wideo. */}
        {open && (
          <div className="absolute right-0 top-full z-50 pt-2">
            <div role="menu"
              className="overlay animate-pop w-[21rem] overflow-hidden rounded-2xl">
              {/* GREETING */}
              {greeting && (
                <p className="px-4 pt-4 text-[13px] font-semibold text-muted">
                  <span aria-hidden className="mr-1.5">{hour !== null && greetingKey(hour) === "evening" ? "🌙" : "👋"}</span>
                  {greeting}
                </p>
              )}

              {/* IDENTITY + PLAN */}
              <div className="flex items-center gap-3 px-4 pb-3 pt-3">
                <span aria-hidden className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-e2">
                  {initial}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-tight">{name}</p>
                  {email && <p className="mt-0.5 truncate text-xs text-faint">{email}</p>}
                </div>
                <span className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em]",
                  PLAN_BADGE[tone],
                )}>
                  {plan}
                </span>
              </div>

              {/* CREDITS */}
              <div className="mx-3 rounded-xl bg-[rgb(var(--ink)/0.05)] p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="overline text-[9.5px]">{t("account.credits")}</span>
                  <span className="metric flex items-center gap-1.5 text-[17px] leading-none text-ink">
                    <Diamond size={8} />
                    {new Intl.NumberFormat(locale).format(credits)}
                  </span>
                </div>
                <span className="mt-2 block h-[4px] w-full overflow-hidden rounded-full bg-[rgb(var(--ink)/0.12)]">
                  <span className={cn("block h-full rounded-full transition-[width] duration-300", CREDIT_METER_CLASS[level])}
                    style={{ width: `${Math.max(4, Math.min(1, credits / CREDIT_REFERENCE) * 100)}%` }} />
                </span>
                <div className="mt-3 flex items-center gap-2">
                  <Link href="/credits" className="cta flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold">
                    <Plus size={14} aria-hidden />
                    {t("account.topUp")}
                  </Link>
                  <Link href="/plan"
                    className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[rgb(var(--ink)/0.07)] text-[13px] font-semibold text-muted transition-colors duration-200 hover:bg-[rgb(var(--ink)/0.12)] hover:text-ink">
                    <ArrowUpRight size={14} aria-hidden />
                    {isFree ? t("account.upgrade") : t("nav.managePlan")}
                  </Link>
                </div>
              </div>

              {/* LANGUAGE — three flags, one tap, no nested popover.
                  This used to be its own control on the top bar: permanent chrome
                  for a choice made roughly once, in a bar that had to fit a
                  wallet, a library and a plan link beside it. It belongs with the
                  other account preferences, and it is still one click away. */}
              <div className="mx-3 mt-3 flex items-center gap-2">
                <span className="overline shrink-0 text-[9.5px]">{t("account.language")}</span>
                <div role="group" aria-label={t("settings.language")}
                  className="ml-auto inline-flex items-center gap-0.5 rounded-full bg-[rgb(var(--ink)/0.05)] p-0.5">
                  {LOCALES.map((code) => (
                    <button key={code} type="button" disabled={switching}
                      aria-pressed={code === locale}
                      aria-label={code.toUpperCase()}
                      title={code.toUpperCase()}
                      onClick={() => startSwitch(async () => { await setLocaleAction(code); })}
                      className={cn(
                        "flex h-7 items-center gap-1.5 rounded-full px-2 text-[11px] font-bold uppercase transition-colors duration-200",
                        code === locale ? "bg-surface text-ink shadow-e1" : "text-faint hover:text-ink",
                      )}>
                      <Flag code={code} size={14} />
                      {code}
                    </button>
                  ))}
                </div>
              </div>

              {/* LINKS */}
              <div className="p-1.5 pt-2">
                <Item href="/settings" icon={User} label={t("account.profile")} />
                <Item href="/settings" icon={Settings} label={t("account.settings")} />
                <Item href="/plan" icon={CreditCard} label={t("nav.plan")} />
                <Item href="/support" icon={LifeBuoy} label={t("account.help")} />
                {isAdmin && <Item href="/admin" icon={Shield} label={t("account.admin")} tone="accent2" />}
              </div>

              <form method="post" action="/auth/sign-out" className="border-t border-line p-1.5">
                <button role="menuitem"
                  className="flex min-h-[40px] w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium text-muted transition-colors duration-200 hover:bg-raised hover:text-ink">
                  <LogOut size={15} aria-hidden className="text-faint" />
                  {t("common.signOut")}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Item({ href, icon: Icon, label, tone }: {
  href: string; icon: LucideIcon; label: string; tone?: "accent2";
}) {
  return (
    <Link role="menuitem" href={href}
      className={cn(
        "flex min-h-[40px] items-center gap-2.5 rounded-xl px-3 text-sm font-medium transition-colors duration-200 hover:bg-raised",
        tone === "accent2" ? "text-accent2 hover:bg-accent2-soft" : "text-ink",
      )}>
      <Icon size={15} aria-hidden className={tone === "accent2" ? "" : "text-faint"} />
      {label}
    </Link>
  );
}
