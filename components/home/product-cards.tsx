import { ArrowRight } from "lucide-react";
import type { HomeCard } from "@/lib/home-sections";
import type { SlotMap } from "@/lib/server/media-slots";
import type { AuthMode } from "@/lib/auth-routes";
import { CardArt } from "./card-art";
import { Gate } from "./gate";
import { cn } from "@/lib/utils";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * THE CARDS THE HOME IS MADE OF.
 *
 * One rule for all of them: a card whose module is not running is drawn,
 * badged and NOT clickable. Not a dead link, not a link into a "coming soon"
 * page nobody asked for — an inert tile that says what it will be. That is the
 * same treatment the mega-menu gives an unfinished module, and the reason this
 * page can show the whole product without promising any of it.
 *
 * An open card is a `Gate`: a plain link for a customer, and for a visitor the
 * SAME link that opens the existing sign-in dialog instead of bouncing off the
 * protected route.
 */

export function Badge({ kind, t }: { kind: NonNullable<HomeCard["badge"]>; t: T }) {
  const label = kind === "soon" ? t("features.badgeSoon")
    : kind === "maintenance" ? t("features.badgeMaintenance")
    : t("features.badgeDisabled");
  return (
    <span className="shrink-0 rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
      {label}
    </span>
  );
}

/** A card body inside the right wrapper: a Gate when it opens, an inert span
 *  when it does not. */
function Card({ card, signedIn, t, className, children }: {
  card: HomeCard; signedIn: boolean; t: T; className: string; children: React.ReactNode;
}) {
  const inert = card.badge !== null;
  const cls = cn("group block min-w-0", className,
    inert ? "cursor-default" : "transition-transform duration-200 hover:-translate-y-0.5");
  if (inert) {
    return <span className={cls} aria-disabled title={card.subKey ? t(card.subKey) : undefined}>{children}</span>;
  }
  return (
    <Gate href={card.href} signedIn={signedIn} className={cls} ariaLabel={t(card.titleKey)}>
      {children}
    </Gate>
  );
}

/**
 * THE TOP RAIL TILE — the tool's 5:4 picture with the name under it in small caps.
 * On a phone the rail is a carousel (`rail-x-sm`), so the tile has a width of
 * its own there; from `sm` up it is a grid cell.
 */
export function RailTile({ card, signedIn, slots, t, priority }: {
  card: HomeCard; signedIn: boolean; slots: SlotMap; t: T; priority?: boolean;
}) {
  return (
    <Card card={card} signedIn={signedIn} t={t} className="w-[56vw] max-w-[16rem] sm:w-auto sm:max-w-none">
      <span className="relative block rounded-xl transition-shadow duration-200 group-hover:shadow-[0_10px_28px_-14px_rgb(var(--accent)/0.55)]">
        <CardArt art={card.art} icon={card.icon} slot={card.slot} slots={slots}
          dimmed={card.badge !== null} priority={priority} video={card.video}
          sizes="(max-width: 639px) 56vw, (max-width: 1023px) 32vw, 17vw" />
      </span>
      <span className="mt-2 flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[10.5px] font-bold uppercase leading-tight tracking-[0.07em] text-ink sm:text-[11px]">
          {t(card.titleKey)}
        </span>
        {card.badge && <Badge kind={card.badge} t={t} />}
      </span>
    </Card>
  );
}

/**
 * THE EFFECT CARD — the tool's 5:4 picture and a name. The one-liner lives in
 * the title attribute: at this density a second line of prose turns a
 * catalogue into a document.
 */
export function EffectCard({ card, signedIn, slots, t, sizes }: {
  card: HomeCard; signedIn: boolean; slots: SlotMap; t: T; sizes: string;
}) {
  // The slide width in the phone carousel; from `sm` up the grid decides.
  return (
    <Card card={card} signedIn={signedIn} t={t} className="w-[46vw] max-w-[13rem] sm:w-auto sm:max-w-none">
      <CardArt art={card.art} icon={card.icon} slot={card.slot} slots={slots}
        dimmed={card.badge !== null} video={card.video} sizes={sizes} />
      <span className="mt-2 flex min-w-0 items-center gap-1.5 px-0.5">
        <span className="truncate text-[12px] font-semibold leading-tight text-ink">{t(card.titleKey)}</span>
        {card.badge && <Badge kind={card.badge} t={t} />}
      </span>
    </Card>
  );
}

/**
 * THE PRIMARY PILL — "Wypróbuj za darmo", the reference layout's pink button
 * on the right of a section heading. For a visitor it opens the SAME dialog on
 * its registration side; for a customer it is the route itself.
 */
export function TryPill({ href, signedIn, label, mode = "register", className }: {
  href: string; signedIn: boolean; label: string; mode?: AuthMode; className?: string;
}) {
  return (
    <Gate href={href} signedIn={signedIn} mode={mode}
      className={cn("cta inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold sm:h-9 sm:px-4 sm:text-[12.5px]", className)}>
      {label}
    </Gate>
  );
}

/**
 * A SECTION HEADING — title in caps, one line of purpose, and the section's
 * own button on the right. The button is omitted for a section whose every
 * card is inert: a prominent link into a door that is shut is the single most
 * annoying thing a catalogue can do.
 */
export function SectionHead({ id, title, sub, action }: {
  id?: string;
  title: string;
  sub: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 sm:mb-3.5">
      <div className="min-w-0">
        <h2 id={id} className="truncate font-display text-[14px] font-bold uppercase tracking-[0.05em] text-ink sm:text-[16px]">
          {title}
        </h2>
        <p className="mt-0.5 text-[11.5px] leading-snug text-faint sm:text-[12.5px]">{sub}</p>
      </div>
      {action}
    </div>
  );
}

/** A quieter "see all" for a section whose destination is not a sign-up. */
export function SeeAll({ href, signedIn, label }: { href: string; signedIn: boolean; label: string }) {
  return (
    <Gate href={href} signedIn={signedIn}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] font-semibold text-muted transition-colors duration-200 hover:text-ink">
      {label}
      <ArrowRight size={12} aria-hidden />
    </Gate>
  );
}

/**
 * A QUICK CHIP under the upload box: icon, name, and — when its module is not
 * running — the badge, drawn and not pressable like every other inert thing.
 */
export function Chip({ card, signedIn, t }: { card: HomeCard; signedIn: boolean; t: T }) {
  const inert = card.badge !== null;
  const inner = (
    <>
      <card.icon size={14} aria-hidden className={inert ? "text-faint" : "text-accent"} />
      <span className="whitespace-nowrap">{t(card.titleKey)}</span>
      {card.badge && <Badge kind={card.badge} t={t} />}
    </>
  );
  const cls = cn(
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-[rgb(var(--surface)/0.6)] px-3 text-[12.5px] font-semibold",
    inert ? "cursor-default text-faint" : "text-ink transition-colors duration-200 hover:border-[rgb(var(--accent)/0.45)] hover:bg-[rgb(var(--accent)/0.07)]",
  );
  return inert
    ? <span className={cls} aria-disabled title={card.subKey ? t(card.subKey) : undefined}>{inner}</span>
    : <Gate href={card.href} signedIn={signedIn} className={cls}>{inner}</Gate>;
}
