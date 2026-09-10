import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Lightbulb, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ToolThumb, type ToolMotif } from "@/components/tools/tool-thumb";
import { menuBadge, type AvailabilityMap } from "@/lib/features";
import { cn } from "@/lib/utils";

/**
 * WSZYSTKIE NARZĘDZIA — the catalogue's presentation.
 *
 * Sections of wide thumbnail cards, each headed by its name and a link into
 * the screen that holds the rest. No page title, no hero, no prose: what a
 * seller came for is the catalogue, so the catalogue starts in the fold and as
 * much of it as possible is visible without scrolling.
 *
 * Data assembly — which tools exist, what they cost, whether they can run —
 * belongs to the page. This file only knows how to draw what it is handed,
 * which is what lets the layout be rendered and measured without a database.
 */

export type CatalogueCard = {
  key: string;
  href: string;
  icon: LucideIcon;
  motif: ToolMotif;
  title: string;
  body: string;
  /** A module with no backend yet: shown, badged, never clickable. */
  soon?: boolean;
  /** The tool catalogue's verdict: null when this card is a place rather than
   *  a priced operation. */
  state?: { available: boolean; credits: number; reason: string | null } | null;
};

export type CatalogueSection = {
  key: string;
  icon: LucideIcon;
  title: string;
  /** Where "Zobacz wszystkie" goes. Omitted when the section already shows
   *  everything it has — a link back to the same six cards does nothing. */
  seeAll?: string;
  cards: CatalogueCard[];
};

type T = (key: string, vars?: Record<string, string | number>) => string;

export function ToolsCatalogue({ sections, avail, isAdmin, t }: {
  sections: CatalogueSection[];
  avail: AvailabilityMap;
  isAdmin: boolean;
  t: T;
}) {
  return (
    <div className="space-y-6">
      {sections.map((s) => {
        if (s.cards.length === 0) return null;
        return (
          <section key={s.key} data-tools-section={s.key}>
            <SectionHead icon={s.icon} title={s.title} seeAll={s.seeAll} t={t} />
            <div className="stagger grid grid-cols-2 gap-2.5 [&>*]:min-w-0 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {s.cards.map((c) => (
                <ToolCard key={c.key} card={c} avail={avail} isAdmin={isAdmin} t={t} />
              ))}
            </div>
          </section>
        );
      })}

      {/* The last row of the catalogue is the one thing it cannot contain: the
          tool that is not here yet. It opens the real support desk. */}
      <section
        data-tools-request
        className="glass flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
        <span aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.16)] text-accent">
          <Lightbulb size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold tracking-tight">{t("hub.request.title")}</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("hub.request.body")}</p>
        </div>
        <Link href="/support" data-tools-request-cta
          className="cta inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-[13.5px] font-semibold">
          <Sparkles size={15} aria-hidden />
          {t("hub.request.cta")}
        </Link>
      </section>
    </div>
  );
}

/** Section name on the left, the way into the rest on the right. */
function SectionHead({ icon: Icon, title, seeAll, t }: {
  icon: LucideIcon; title: string; seeAll?: string; t: T;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h2 className="flex min-w-0 items-center gap-2 font-display text-[13.5px] font-semibold tracking-tight sm:text-[16px]">
        <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[rgb(var(--accent)/0.16)] text-accent">
          <Icon size={14} />
        </span>
        <span className="truncate">{title}</span>
      </h2>
      {seeAll && (
        <Link href={seeAll} data-tools-seeall
          className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-muted transition-colors hover:text-accent">
          {t("common.seeAll")}
          <ArrowRight size={13} aria-hidden />
        </Link>
      )}
    </div>
  );
}

/**
 * One catalogue card: the preview, then the name, then one line about it.
 * Compact on purpose — six fit a desktop row, two a phone.
 */
function ToolCard({ card, avail, isAdmin, t }: {
  card: CatalogueCard; avail: AvailabilityMap; isAdmin: boolean; t: T;
}) {
  // Three things can close a card: the module switchboard, the tool catalogue
  // (no provider / maintenance), or the module having no backend at all.
  // Admins keep every card open — they are the ones who switch modules back on.
  const moduleBadge = isAdmin ? null : menuBadge(avail, card.href);
  const blocked = Boolean(card.soon)
    || moduleBadge === "disabled" || moduleBadge === "soon" || moduleBadge === "maintenance"
    || (card.state ? !card.state.available : false);

  const badge = card.soon || moduleBadge === "soon"
    ? <Badge tone="accent">{t("features.badgeSoon")}</Badge>
    : moduleBadge === "maintenance"
      ? <Badge tone="accent">{t("features.badgeMaintenance")}</Badge>
      : moduleBadge === "disabled"
        ? <Badge tone="neutral">{t("features.badgeDisabled")}</Badge>
        : card.state && !card.state.available && card.state.reason
          ? <Badge tone="accent">{t(`tools.state.${card.state.reason}`)}</Badge>
          : card.state && card.state.credits > 0
            ? <Badge tone="neutral">{t("tools.creditsTotal", { n: card.state.credits })}</Badge>
            : null;

  const body = (
    <>
      {/* The badge rides the THUMBNAIL, not the caption. Beside the title it
          ate the width on a phone and truncated every name to "Wideo pr…";
          here it is visible at a glance and the caption keeps its two lines. */}
      <span className="relative block">
        <ToolThumb motif={card.motif} icon={card.icon} dimmed={blocked} />
        {badge && <span className="absolute right-1.5 top-1.5">{badge}</span>}
      </span>
      {/* A fixed caption height keeps a row of cards level whether the
          description runs to one line or three. */}
      <div className="mt-2 min-h-[46px] px-0.5">
        <p className="line-clamp-1 text-[12.5px] font-semibold tracking-tight">{card.title}</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-[1.35] text-muted">{card.body}</p>
      </div>
    </>
  );

  const shell = "group flex flex-col rounded-2xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.8))] bg-[rgb(var(--surface)/0.55)] p-1.5 pb-2.5 transition-colors";

  return blocked ? (
    <div className={cn(shell, "cursor-default")} data-tool-card={card.key} data-blocked="true">{body}</div>
  ) : (
    <Link href={card.href} data-tool-card={card.key}
      className={cn(shell, "hover:border-[rgb(var(--accent)/0.4)] hover:bg-[rgb(var(--surface)/0.8)]")}>
      {body}
    </Link>
  );
}
