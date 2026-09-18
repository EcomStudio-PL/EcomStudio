"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Filter, Layers, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { Audience, AudienceBreakdown } from "@/lib/newsletter";
import { audiencePreviewAction } from "@/app/actions/newsletter";
import { Chip, ChipRow } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * KROK 1 — WHO IS THIS GOING TO, AND WHAT THAT REALLY COMES TO.
 *
 * THE BREAKDOWN IS THE POINT OF THIS SCREEN, not the checkboxes. "Wyślij do:
 * Klienci premium" tells an operator nothing about how many messages they are
 * about to pay for and who will silently not receive one. §22 asks for the
 * seven numbers, and they are shown in the order the database applies them so
 * that SUBTRACTING THEM ON SCREEN GIVES THE FINAL FIGURE:
 *
 *     po deduplikacji − wykluczeni − zablokowani − wypisani − bez zgody
 *       = otrzyma wiadomość
 *
 * A breakdown whose rows do not add up is worse than no breakdown at all: it
 * teaches an operator to distrust the confirm screen, and then to send twice.
 *
 * EVERY NUMBER IS A REAL COUNT, recomputed by `audienceBreakdown` on the
 * server each time the selection changes. Nothing here estimates: a segment is
 * a saved filter that is evaluated afresh, so a preview that was cheaper than
 * the real thing would be a preview of something else.
 *
 * THE FOUR PROTECTIONS ARE NOT CHOICES. Consent, unsubscription and the
 * suppression list are re-checked inside `newsletter_queue_claim` on every
 * single batch, so they hold whatever this screen says. That is why the hint
 * tells the operator not to bother excluding those people by hand — and why
 * the numbers are shown as deductions rather than as options.
 *
 * STALE NUMBERS ARE MARKED, NEVER GUESSED. While a recount is in flight the
 * panel dims and says so instead of showing the previous selection's totals as
 * though they described the current one.
 */

export type AudienceGroup = {
  id: string;
  name: string;
  isDynamic: boolean;
  /** −1 for a dynamic group: a segment has no stored membership, and inventing
   *  a number for it here would mean resolving every segment on every render. */
  members: number;
};

export function AudiencePicker({ groups, value, onChange, initial, disabled }: {
  groups: AudienceGroup[];
  value: Audience;
  onChange: (next: Audience) => void;
  /** The breakdown the server already computed for the SAVED audience, so the
   *  step has real numbers on first paint instead of a spinner. */
  initial: AudienceBreakdown;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [breakdown, setBreakdown] = useState<AudienceBreakdown>(initial);
  const [stale, setStale] = useState(false);

  /** Which request the panel is waiting for. Two rapid taps on two groups
   *  produce two round trips that can land out of order, and the older answer
   *  would then overwrite the newer one with numbers for a selection the
   *  operator has already moved on from. */
  const latest = useRef(0);
  const key = JSON.stringify(value);

  /**
   * The numbers are re-measured whenever this panel is looked at, INCLUDING on
   * mount — and that is not a wasted round trip.
   *
   * `initial` is what the server computed when the PAGE loaded, for the
   * audience as it was SAVED then. The wizard unmounts this panel whenever the
   * operator walks to another step, so a second visit would otherwise restore
   * a breakdown describing a selection two edits ago — the failure being
   * silent, because stale counts look exactly like fresh ones. `initial` earns
   * its keep by painting real numbers instantly instead of a spinner; the
   * request behind it is what keeps them true.
   */
  useEffect(() => {
    const audience = JSON.parse(key) as Audience;
    if (audience.include.length === 0) {
      setBreakdown({
        selected: 0, deduplicated: 0, mailable: 0,
        noConsent: 0, unsubscribed: 0, suppressed: 0, excludedByGroup: 0,
      });
      setStale(false);
      return;
    }

    setStale(true);
    const ticket = ++latest.current;
    // Debounced: picking four groups in a row is one question, not four.
    const timer = setTimeout(async () => {
      const res = await audiencePreviewAction(audience);
      if (ticket !== latest.current) return;
      if (res.ok && res.data) setBreakdown(res.data);
      setStale(false);
    }, 350);

    return () => clearTimeout(timer);
  }, [key]);

  const toggle = (bucket: "include" | "exclude", id: string) => {
    const other = bucket === "include" ? "exclude" : "include";
    const has = value[bucket].includes(id);
    onChange({
      ...value,
      [bucket]: has ? value[bucket].filter((g) => g !== id) : [...value[bucket], id],
      // A group cannot be on both sides at once: `audienceBreakdown` would
      // include it and then immediately subtract it, and the operator would be
      // looking at a selection that cancels itself out.
      [other]: value[other].filter((g) => g !== id),
    } as Audience);
  };

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title={t("newsletter.groups.none")}
        body={t("newsletter.wizard.excludeHint")}
        action={
          <Link href="/admin/newsletter/grupy"
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
            {t("newsletter.groups.title")}
          </Link>
        }
      />
    );
  }

  const bucket = (name: "include" | "exclude", label: string) => (
    <div>
      <p className="mb-2 text-[13px] font-semibold tracking-tight">{label}</p>
      <ChipRow>
        {groups.map((group) => (
          <Chip
            key={group.id}
            active={value[name].includes(group.id)}
            disabled={disabled}
            className={cn(disabled && "opacity-40")}
            icon={group.isDynamic ? Filter : undefined}
            count={group.isDynamic ? undefined : group.members}
            onClick={() => toggle(name, group.id)}
            data-audience-group={`${name}:${group.id}`}
          >
            {group.name}
          </Chip>
        ))}
      </ChipRow>
    </div>
  );

  /** One row of the arithmetic. `sign` is what makes the column read as a
   *  calculation rather than as eight unrelated statistics. */
  const line = (label: string, n: number, sign?: "minus", emphasis?: boolean) => (
    <div className={cn(
      "flex items-baseline justify-between gap-3 py-1.5",
      emphasis && "mt-1 border-t border-line pt-2.5",
    )}>
      <span className={cn("min-w-0 text-[12.5px]", emphasis ? "font-semibold text-ink" : "text-muted")}>
        {label}
      </span>
      <span className={cn(
        "shrink-0 tabular-nums",
        emphasis ? "text-[15px] font-semibold text-ink" : "text-[13px]",
        sign === "minus" && n > 0 && "text-muted",
      )}>
        {sign === "minus" && n > 0 ? "−" : ""}{n}
      </span>
    </div>
  );

  return (
    <div className="space-y-5" data-audience-picker>
      {bucket("include", t("newsletter.wizard.sendTo"))}
      {bucket("exclude", t("newsletter.wizard.exclude"))}

      <p className="text-[11.5px] leading-relaxed text-faint" data-exclude-hint>
        {t("newsletter.wizard.excludeHint")}
      </p>
      {groups.some((g) => g.isDynamic) && (
        <p className="text-[11.5px] leading-relaxed text-faint">
          {t("newsletter.groups.dynamicHint")}
        </p>
      )}

      {/* ── THE ARITHMETIC ─────────────────────────────────────────────────
          Dimmed, not blanked, while a recount is in flight: an operator
          reading a number has to be able to tell whether it describes what
          they are looking at, and an empty panel tells them nothing at all. */}
      <div className={cn("plate rounded-xl px-3.5 py-2.5 transition-opacity duration-150",
        stale && "opacity-50")} data-audience-breakdown>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
            {t("newsletter.audience.selected")}
          </span>
          {stale && <Loader2 size={13} aria-hidden className="animate-spin text-faint" />}
        </div>

        {line(t("newsletter.audience.selected"), breakdown.selected)}
        {line(t("newsletter.audience.deduplicated"), breakdown.deduplicated)}
        {line(t("newsletter.audience.excludedByGroup"), breakdown.excludedByGroup, "minus")}
        {line(t("newsletter.audience.suppressed"), breakdown.suppressed, "minus")}
        {line(t("newsletter.audience.unsubscribed"), breakdown.unsubscribed, "minus")}
        {line(t("newsletter.audience.noConsent"), breakdown.noConsent, "minus")}
        {line(t("newsletter.audience.mailable"), breakdown.mailable, undefined, true)}
      </div>

      {/* The one outcome an operator must not walk past: groups are selected
          and not a single message would go out. */}
      {value.include.length > 0 && !stale && breakdown.mailable === 0 && (
        <p className="rounded-xl border border-[rgb(var(--warning)/0.4)] bg-[rgb(var(--warning)/0.08)] px-3.5 py-3 text-[12.5px] leading-relaxed text-ink"
          data-audience-empty>
          {t("newsletter.audience.empty")}
        </p>
      )}
    </div>
  );
}
