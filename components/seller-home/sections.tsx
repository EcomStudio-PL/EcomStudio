import Link from "next/link";
import { ArrowRight, Lock, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlotMedia } from "@/components/media/slot-media";
import { formatCount, formatMoney } from "@/components/plan/pricing-model";
import { PRICE_ANCHORS, type HeroTaskKey } from "@/lib/seller-home-config";
import { anchorCents, taskByKey, type ResolvedTask } from "@/lib/seller-home-model";
import type { RecentCard, ToolCardState } from "@/lib/server/seller-home";
import type { SlotMap } from "@/lib/server/media-slots";
import { EmptySlot, MediaSlot } from "./media-slot";

type T = (key: string, vars?: Record<string, string | number>) => string;

const dateFmt = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short" });

/* ── "Ostatnie projekty" ──────────────────────────────────────────────────*/

/**
 * A compact strip — small enough that the hero's upload still sits in the
 * first screen on a desktop. "Powtórz z nowym produktem" opens the SAME tool,
 * empty: nothing of the old job (photo, prompt, settings) is carried over.
 */
export function RecentProjects({ items, t }: { items: RecentCard[]; t: T }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="seller-recent-title" data-seller-recent>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="seller-recent-title" className="font-display text-[1.125rem] font-semibold tracking-tight sm:text-[1.25rem]">
          {t("sellerHome.recent.title")}
        </h2>
        <Link href="/library" className="text-[13px] font-medium text-muted transition-colors hover:text-ink">
          {t("sellerHome.recent.all")}
        </Link>
      </div>
      <ul className="rail-x-sm mt-3 sm:grid sm:grid-cols-3 sm:gap-3 lg:grid-cols-6" data-recent-count={items.length}>
        {items.map((r) => (
          <li key={r.id} data-recent-item
            className="flex w-[42vw] max-w-[11rem] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.3))] bg-[rgb(var(--surface))] sm:w-auto sm:max-w-none">
            <div className="relative aspect-[4/3] bg-[rgb(var(--ink)/0.04)]">
              {/* Small derivative from the Library's projection; plain <img>
                  because these are signed storage URLs. */}
              <img src={r.thumbUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-2.5">
              <p className="truncate text-[12.5px] font-semibold text-ink">{t(r.labelKey)}</p>
              <p className="text-[11.5px] text-muted">{dateFmt.format(new Date(r.createdAt))}</p>
              <Link href={r.href} data-repeat={r.href}
                className="mt-auto inline-flex items-start gap-1 text-[12px] font-semibold leading-snug text-accent-strong hover:underline dark:text-accent">
                <RotateCcw size={12} aria-hidden className="mt-[3px] shrink-0" /> <span>{t("sellerHome.recent.repeat")}</span>
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── price anchor ─────────────────────────────────────────────────────────*/

/**
 * One quiet horizontal bar: what a designer charges vs. what GrovBase costs
 * on the PRO plan — credits per image (the tool's own price) × the price of a
 * credit on PRO (the plan row). Nothing is typed in: a missing input hides
 * the line instead of showing a guess.
 */
export function PriceAnchor({ tasks, centsPerCredit, currency, t }: {
  tasks: ResolvedTask[]; centsPerCredit: number | null; currency: string; t: T;
}) {
  const lines = PRICE_ANCHORS.flatMap((a) => {
    const task = taskByKey(tasks, a.task as HeroTaskKey);
    const ours = anchorCents(a.images, task?.credits ?? null, centsPerCredit);
    if (ours === null) return [];
    return [{ key: a.key, text: t(a.labelKey, { designer: formatMoney(a.designerCents, currency), ours: formatMoney(ours, currency) }) }];
  });
  if (lines.length === 0) return null;
  return (
    <section aria-label={t("sellerHome.anchor.label")} data-seller-anchor
      className="flex flex-col gap-3 rounded-2xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.3))] bg-[rgb(var(--surface)/0.6)] px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
      <ul className="flex flex-col gap-1.5 lg:flex-row lg:gap-6">
        {lines.map((l, i) => (
          <li key={l.key} data-anchor={l.key} className={cn("text-[14px] text-ink/90", i > 0 && "lg:border-l lg:border-[rgb(var(--hairline)/var(--hairline-alpha))] lg:pl-6")}>
            {l.text}
          </li>
        ))}
      </ul>
      <Link href="/plan" className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-muted transition-colors hover:text-ink" data-anchor-plans>
        {t("sellerHome.anchor.plans")} <ArrowRight size={13} aria-hidden />
      </Link>
    </section>
  );
}

/* ── all tools ────────────────────────────────────────────────────────────*/

/**
 * ONE grid, grouped. A customer sees only what runs right now (an item that is
 * switched off, "Wkrótce" or without a working engine is left out — never
 * shown as live); an admin also sees the rest, marked. Prices are each tool's
 * own. "Użyj" opens the tool's existing route — Retusz included, as a plain
 * link and nothing more.
 */
export function AllTools({ groups, slots, t }: {
  groups: { key: string; titleKey: string; tools: ToolCardState[] }[];
  slots: SlotMap;
  t: T;
}) {
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="seller-tools-title" data-seller-tools>
      <h2 id="seller-tools-title" className="font-display text-[1.25rem] font-semibold tracking-tight sm:text-[1.5rem]">
        {t("sellerHome.tools.title")}
      </h2>
      <div className="mt-4 space-y-6">
        {groups.map((g) => (
          <div key={g.key} data-tool-group={g.key}>
            <h3 className="overline mb-2.5">{t(g.titleKey)}</h3>
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {g.tools.map((tool) => {
                const name = t(tool.nameKey);
                const empty = (
                  <div className="relative aspect-[4/3]">
                    <EmptySlot label={t("sellerHome.slot.tool", { name })} hint={t("sellerHome.slot.size", { w: 1200, h: 900 })} />
                  </div>
                );
                return (
                  <li key={tool.key} data-tool={tool.key} data-admin-only={tool.adminOnly || undefined}>
                    <Link href={tool.href}
                      className={cn(
                        "panel panel-interactive group flex h-full flex-col overflow-hidden rounded-2xl",
                        tool.adminOnly && "opacity-70",
                      )}>
                      {tool.mediaSrc
                        ? <MediaSlot ratio="4/3" media={{ configKey: tool.mediaKey, src: tool.mediaSrc, width: 1200, height: 900 }}
                            label={name} hint="" sizes="(max-width: 767px) 46vw, (max-width: 1023px) 30vw, 17rem" />
                        : tool.slotKey
                          ? <SlotMedia slot={tool.slotKey} slots={slots} ratio="4/3" whole
                              sizes="(max-width: 767px) 46vw, (max-width: 1023px) 30vw, 17rem" fallback={empty} />
                          : empty}
                      <div className="flex flex-1 flex-col gap-1 p-3">
                        <p className="text-[14.5px] font-semibold leading-tight text-ink">{name}</p>
                        <p className="line-clamp-2 text-[12.5px] leading-snug text-muted">{t(tool.descKey)}</p>
                        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                          <span className="text-[12px] font-semibold tabular-nums text-accent-strong dark:text-accent">
                            {tool.adminOnly
                              ? <span className="inline-flex items-center gap-1 text-muted"><Lock size={11} aria-hidden />{t("sellerHome.tools.adminOnly")}</span>
                              : costText(t, tool.credits)}
                          </span>
                          <span className="inline-flex h-7 items-center gap-1 rounded-lg bg-[rgb(var(--accent)/0.1)] px-2.5 text-[12px] font-semibold text-accent-strong transition-colors group-hover:bg-[rgb(var(--accent)/0.16)] dark:text-accent">
                            {t("sellerHome.tools.use")}
                          </span>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function costText(t: T, credits: number | null): string {
  if (credits === null) return "";
  if (credits === 0) return t("sellerHome.cost.free");
  return t("sellerHome.cost.perImage", { n: formatCount(credits) });
}
