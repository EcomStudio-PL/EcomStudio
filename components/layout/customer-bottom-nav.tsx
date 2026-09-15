"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { allDefaults, menuBadge, menuVisible, type AvailabilityMap } from "@/lib/features";
import { DOCK_SLOTS, dockSlotActive } from "@/lib/bottom-nav";
import { cn } from "@/lib/utils";

/**
 * BOTTOM NAVIGATION — the phone's primary navigation.
 *
 * Height comes from `--bottom-nav-h` and the gap from `--bottom-nav-gap`, the
 * same tokens the page uses to reserve room underneath its content. Deriving
 * both from one number is what stops the bar from sitting on top of the last
 * card, which no amount of hand-tuned padding ever quite fixed.
 *
 * THE CENTRE BUTTON RISES OUT OF THE BAR WITHOUT CHANGING ITS HEIGHT.
 *
 * GENERUJ is the reason the product exists, and the design lifts it proud of
 * the dock. The obvious way to build that — a taller slot — would make the
 * bar's real height stop matching `--bottom-nav-h`, and every page's bottom
 * padding is derived from that token, so the last element of every screen
 * would end up underneath it.
 *
 * So the circle is taken OUT of the flow instead: the slot reserves exactly the
 * same 28px icon box as its neighbours, and the button is positioned against
 * it, overhanging the bar's top edge. The bar measures 62px whatever the
 * circle does. The overhang is ~11px and the page already reserves 20px of air
 * above the dock (`--page-bottom` = dock + 1.25rem + safe area), so it rises
 * into empty space and covers nothing.
 */
export function CustomerBottomNav({ availability, isAdmin = false }: {
  availability?: AvailabilityMap;
  isAdmin?: boolean;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const avail = availability ?? allDefaults();
  // A DISABLED module leaves the dock (its URL 404s anyway); a restricted one
  // keeps its slot with a small warning dot — the page itself explains.
  const slots = DOCK_SLOTS.filter((s) => menuVisible(avail, s.href, isAdmin));

  // The label steps down a pixel below 360. Five slots on a 320px screen leave
  // 52px each, and at 10px German "Generieren" and "Werkzeuge" wrap onto a
  // second line — which a bar with a FIXED height cannot absorb, so the dock
  // would grow past the `--bottom-nav-h` every page reserves room for. Measured
  // in all three languages at 320 / 360 / 390; one pixel is the whole fix.
  const slotClass = "group flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-[3px] whitespace-nowrap rounded-xl px-0.5 text-[9px] font-semibold transition-colors duration-200 min-[360px]:text-[10px]";

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label={t("topnav.primary")}
    >
      <div
        className="dock mx-[var(--page-x)] flex items-stretch rounded-2xl px-1"
        style={{ height: "var(--bottom-nav-h)", marginBottom: "var(--bottom-nav-gap)" }}
      >
        {slots.map((s) => {
          const active = dockSlotActive(s, pathname);
          const Icon = s.icon;
          const restricted = menuBadge(avail, s.href) !== null;
          return (
            <Link
              key={s.key}
              href={s.href}
              prefetch
              aria-current={active ? "page" : undefined}
              className={cn(slotClass, s.primary ? "text-ink" : active ? "text-accent" : "text-faint")}
            >
              <span aria-hidden className={cn(
                "relative flex h-7 w-11 items-center justify-center rounded-lg transition-all duration-200",
                !s.primary && (active
                  ? "bg-[rgb(var(--accent)/0.15)] shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.32)]"
                  : "group-active:bg-[rgb(var(--faint)/0.12)]"),
              )}>
                {s.primary ? (
                  // THE ONE CTA. Brand gradient, a fine light edge and a soft
                  // bloom of its own colour underneath — lit rather than
                  // outlined, which is the difference between premium and
                  // novelty. `absolute` is what keeps it out of the bar's
                  // height; see the note at the top of this file.
                  <span className={cn(
                    "brand-gradient absolute -bottom-0.5 flex h-[50px] w-[50px] items-center justify-center rounded-full text-white transition-transform duration-200",
                    "shadow-[0_8px_22px_-6px_rgb(var(--accent)/0.9)] ring-1 ring-white/25 group-active:scale-95",
                    active && "ring-2 ring-white/45",
                  )}>
                    <Icon size={22} strokeWidth={2.1} />
                  </span>
                ) : (
                  <Icon size={18} strokeWidth={active ? 2.4 : 1.9} />
                )}
                {restricted && (
                  <span className="absolute right-1 top-0.5 h-1.5 w-1.5 rounded-full bg-warning" />
                )}
              </span>
              {/* One line, always — never truncated, never wrapped. See the
                  note on `slotClass` for why that is a fixed-height problem
                  rather than a typographic preference. */}
              <span className="w-full text-center leading-none">{t(`mobilenav.${s.key}`)}</span>
              {/* The CTA says which screen you are on with a rule under its
                  name — the circle cannot, because its fill never changes. */}
              {s.primary && (
                <span aria-hidden className={cn(
                  "h-[2px] w-5 rounded-full transition-colors duration-200",
                  active ? "bg-accent" : "bg-transparent",
                )} />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
