"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { creditLevel } from "@/lib/credit-level";
import { cn } from "@/lib/utils";

/**
 * CREDITS — ONE control, not three chips: a diamond, the balance and a "+"
 * that buys more, sharing a single tile, a single border and a single hover
 * state. The tone follows the balance (green → orange → red) so an empty
 * wallet is visible before the user hits a wall.
 *
 * SHAPE: `rounded-xl`, the same corner every other control in this bar wears —
 * the search field, "Plany", "Biblioteka", the theme toggle. It used to be a
 * full pill, which made the one element carrying a NUMBER the one element that
 * did not look like it belonged to the bar.
 *
 * NO DIVIDER: the balance and "Doładuj" were two links with a hairline between
 * them, and that hairline read as a rendering glitch rather than as structure.
 * Both halves went to the same place — `/credits` — so they are now literally
 * one link, and the hierarchy is carried by type size instead: the balance in
 * the display face, the invitation to top up a step smaller beside it.
 */
export function CreditsControl({ credits, compact = false }: { credits: number; compact?: boolean }) {
  const { t, locale } = useI18n();
  const level = creditLevel(credits);
  const tone = {
    ok: "border-[rgb(var(--success)/0.4)] bg-[rgb(var(--success)/0.12)] text-success",
    low: "border-[rgb(var(--warning)/0.45)] bg-[rgb(var(--warning)/0.14)] text-warning",
    critical: "border-[rgb(var(--danger)/0.45)] bg-[rgb(var(--danger)/0.14)] text-danger",
    empty: "border-[rgb(var(--danger)/0.55)] bg-[rgb(var(--danger)/0.18)] text-danger",
  }[level];
  const title = level === "critical" || level === "empty" ? t("creditsPanel.low") : t("nav.credits");

  return (
    <Link
      href="/credits"
      title={title}
      aria-label={`${title}: ${credits} — ${t("creditsPanel.buy")}`}
      className={cn(
        "inline-flex shrink-0 items-center rounded-xl border transition-colors duration-200 hover:bg-current/10",
        compact ? "h-8 gap-1.5 px-2" : "h-9 gap-2 px-2.5",
        tone,
      )}
    >
      <Diamond />
      {/* ONE BASELINE for the two pieces of text. They are four points apart
          in size and set in different faces — the balance in the display
          face, the invitation in the UI face — so centring their line boxes
          left "Doładuj" visibly riding above the number. Baselines are what
          the eye actually reads a row of type against; the icons stay centred
          on the tile because they have no baseline worth aligning to. */}
      <span className={cn("inline-flex items-baseline", compact ? "gap-1.5" : "gap-2")}>
        <span className={cn("metric leading-none tabular-nums", compact ? "text-[13px]" : "text-[14.5px]")}>
          {new Intl.NumberFormat(locale).format(credits)}
        </span>
        {/* "Doładuj" in words, not just a plus. The + alone made buying
            credits a guess; on a narrow bar the word hides and the icon
            carries it, so nothing is lost and nothing overflows. */}
        {!compact && (
          <span className="hidden text-[11.5px] font-semibold leading-none opacity-80 xl:inline">
            {t("creditsPanel.topUpShort")}
          </span>
        )}
      </span>
      <Plus size={12} aria-hidden strokeWidth={2.8} className="shrink-0 opacity-80" />
    </Link>
  );
}

/** The credit glyph — a diamond, matching the in-app cost badges. */
export function Diamond({ size = 9 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rotate-45 rounded-[2px] bg-current"
      style={{ width: size, height: size }}
    />
  );
}
