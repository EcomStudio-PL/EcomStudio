import { ArrowRight } from "lucide-react";
import type { HomeCard } from "@/lib/home-sections";
import type { SlotMap } from "@/lib/server/media-slots";
import { workflowSlotKey, toolSlotKey, categorySlotKey } from "@/lib/media-slots";
import { CardArt } from "./card-art";
import { Gate } from "./gate";
import { cn } from "@/lib/utils";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * THE CARDS THE PRODUCT HOMEPAGE IS MADE OF.
 *
 * Three shapes, one rule: a card whose module is not running is drawn, badged
 * and NOT clickable. Not a dead link, not a link into a "coming soon" page
 * nobody asked for — an inert tile that says what it will be. That is the same
 * treatment the mega-menu gives an unfinished module, and the reason this page
 * can show the whole product without promising any of it.
 */

/** Which media slot, if any, an admin can dress this card with. Derived from
 *  the card's own key so the homepage asks for keys lib/media-slots.ts
 *  declares rather than spelling them out and drifting. */
function slotFor(card: HomeCard): string | undefined {
  const [head, tail] = card.key.split(".");
  if (tail) return workflowSlotKey(head, tail);
  // A bare key is either a tool-catalogue card or a category.
  if (card.href.startsWith("/k/")) return categorySlotKey(head);
  return toolSlotKey(head);
}

function Badge({ kind, t }: { kind: NonNullable<HomeCard["badge"]>; t: T }) {
  const label = kind === "soon" ? t("features.badgeSoon")
    : kind === "maintenance" ? t("features.badgeMaintenance")
    : t("features.badgeDisabled");
  return (
    <span className="rounded-full bg-[rgb(var(--bg)/0.72)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint backdrop-blur-sm">
      {label}
    </span>
  );
}

/**
 * THE DISCOVERY RAIL TILE — the wide cards under the header.
 *
 * Picture first, name underneath in small caps. On a phone the rail scrolls
 * horizontally (`rail-x` already handles the snap points and hides the
 * scrollbar); from `sm` up it becomes a grid, because a row that must be
 * dragged on a 1440px monitor is a row half the audience never finishes.
 */
export function RailTile({ card, signedIn, slots, t, priority }: {
  card: HomeCard; signedIn: boolean; slots: SlotMap; t: T; priority?: boolean;
}) {
  const inert = card.badge !== null;
  const body = (
    <>
      <CardArt art={card.art} icon={card.icon} slot={slotFor(card)} slots={slots}
        ratio="4/5" dimmed={inert} priority={priority}
        sizes="(max-width: 640px) 42vw, (max-width: 1024px) 22vw, 15vw" />
      <span className="mt-2 flex items-center gap-1.5">
        <span className="truncate text-[10.5px] font-bold uppercase leading-tight tracking-[0.07em] text-ink">
          {t(card.titleKey)}
        </span>
        {card.badge && <Badge kind={card.badge} t={t} />}
      </span>
    </>
  );
  const cls = cn(
    "group block w-[42vw] min-w-[9.5rem] max-w-[13rem] sm:w-auto sm:max-w-none",
    inert ? "cursor-default" : "transition-transform duration-200 hover:-translate-y-0.5",
  );
  if (inert) return <span className={cls} aria-disabled>{body}</span>;
  return <Gate href={card.href} signedIn={signedIn} className={cls} ariaLabel={t(card.titleKey)}>{body}</Gate>;
}

/**
 * THE EFFECT / SECTION CARD — a picture, a name, and nothing else the eye has
 * to parse. The one-liner lives in the title attribute rather than under the
 * name: at this density a second line of prose turns a catalogue into a
 * document.
 */
export function EffectCard({ card, signedIn, slots, t, video = false }: {
  card: HomeCard; signedIn: boolean; slots: SlotMap; t: T; video?: boolean;
}) {
  const inert = card.badge !== null;
  const body = (
    <>
      <CardArt art={card.art} icon={card.icon} slot={slotFor(card)} slots={slots}
        ratio="4/5" dimmed={inert} video={video}
        sizes="(max-width: 640px) 45vw, (max-width: 1024px) 24vw, 13vw" />
      <span className="mt-2 flex items-center gap-1.5 px-0.5">
        <span className="truncate text-[12px] font-semibold leading-tight text-ink">{t(card.titleKey)}</span>
        {card.badge && <Badge kind={card.badge} t={t} />}
      </span>
    </>
  );
  const cls = cn(
    "group block w-[45vw] min-w-[8.5rem] max-w-[12rem] sm:w-auto sm:max-w-none",
    inert ? "cursor-default" : "transition-transform duration-200 hover:-translate-y-0.5",
  );
  if (inert) {
    return <span className={cls} aria-disabled title={card.subKey ? t(card.subKey) : undefined}>{body}</span>;
  }
  return (
    <Gate href={card.href} signedIn={signedIn} className={cls} ariaLabel={t(card.titleKey)}>
      {body}
    </Gate>
  );
}

/**
 * A SECTION HEADING — overline, title, one line of purpose, and the link to
 * the whole thing on the right.
 *
 * The "see all" link is NOT rendered for a section whose every card is inert.
 * A prominent link into a door that is shut is the single most annoying thing
 * a catalogue page can do.
 */
export function SectionHead({ title, sub, seeAll, signedIn, t, soon }: {
  title: string; sub: string; seeAll: string | null; signedIn: boolean; t: T; soon: boolean;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate font-display text-[13px] font-bold uppercase tracking-[0.06em] text-ink sm:text-[15px]">
          {title}
        </h2>
        <p className="mt-0.5 truncate text-[11.5px] leading-snug text-faint sm:text-[12.5px]">{sub}</p>
      </div>
      {seeAll && !soon && (
        <Gate href={seeAll} signedIn={signedIn}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 text-[12px] font-semibold text-muted transition-colors duration-200 hover:border-[rgb(var(--accent)/0.45)] hover:text-ink">
          {t("home2.tryFree")}
          <ArrowRight size={12} aria-hidden />
        </Gate>
      )}
    </div>
  );
}

/**
 * THE CARD ROW.
 *
 * Phone: a horizontal rail, because eight cards stacked two-per-row is four
 * screens of scrolling for one section and the page has six of them.
 * Tablet and up: a grid that fills the width, six across at desktop and eight
 * on a wide monitor — the density the reference layout has, rather than four
 * enormous tiles.
 */
export function CardRow({ cards, signedIn, slots, t, video = false }: {
  cards: readonly HomeCard[]; signedIn: boolean; slots: SlotMap; t: T; video?: boolean;
}) {
  return (
    <>
      <div className="rail-x sm:hidden">
        {cards.map((c) => (
          <EffectCard key={c.key} card={c} signedIn={signedIn} slots={slots} t={t} video={video} />
        ))}
      </div>
      <div className="hidden gap-2.5 sm:grid sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
        {cards.map((c) => (
          <EffectCard key={c.key} card={c} signedIn={signedIn} slots={slots} t={t} video={video} />
        ))}
      </div>
    </>
  );
}
