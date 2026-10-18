"use client";
import { Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { GalleryTrial } from "@/lib/trial-watermark/types";
import { availableLine, daysLeftOf, daysShort, goneLine, isLocked, isMarked, underADay } from "./model";

/**
 * THE MARKS OF A TRIAL IMAGE on the surfaces that list it. Each renders
 * nothing for an ordinary or unlocked image, so a surface can mount them
 * unconditionally and an account that never saw a watermark sees nothing new.
 */

/** "Usuń znak wodny · 3 dni" — the accessible name of every lock control. */
function useLockLabel(trial: GalleryTrial | null | undefined): { label: string; days: string | null } {
  const { t } = useI18n();
  const days = daysShort(t, daysLeftOf(trial));
  return { label: days ? `${t("genv3.wm.unlock")} · ${days}` : t("genv3.wm.unlock"), days };
}

/**
 * THE CARD CHIP — bottom-right of a gallery card or library tile, the one
 * corner both leave empty. Glass like the card's action rail, so it reads as
 * one of the card's controls rather than a sticker on the picture.
 *
 * It sizes itself to the CARD, not the screen: a justified grid makes a 9:16
 * card a third the width of a 16:9 one in the same row. The strip it sits in
 * is a size container, so the chip shows the lock alone on a narrow card, the
 * days from ~88px, and "Usuń znak wodny" too where it fits whole. The strip
 * itself takes no pointer events — only the chip does — so the picture under
 * it still opens the image.
 */
export function TrialLockChip({ trial, onUnlock }: { trial: GalleryTrial | null | undefined; onUnlock: () => void }) {
  const { t } = useI18n();
  const { label, days } = useLockLabel(trial);
  if (!isLocked(trial)) return null;
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex justify-end [container-type:inline-size]">
      <button type="button" data-trial-chip title={label} aria-label={label}
        onClick={(e) => { e.stopPropagation(); onUnlock(); }}
        className="pointer-events-auto flex h-6 max-w-full items-center gap-1 rounded-lg border border-white/15 bg-black/45 px-1.5 text-[10.5px] font-semibold text-white/90 shadow-e2 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white">
        <Lock size={12} aria-hidden className="shrink-0" />
        <span aria-hidden className="hidden truncate [@container(min-width:13rem)]:inline">{t("genv3.wm.unlock")}</span>
        {days && <span aria-hidden className="hidden whitespace-nowrap tabular-nums text-white/70 [@container(min-width:5.5rem)]:inline">{days}</span>}
      </button>
    </div>
  );
}

/** The list rows' lock button, placed before the heart. */
export function TrialLockButton({ trial, onUnlock, className }: {
  trial: GalleryTrial | null | undefined; onUnlock: () => void; className?: string;
}) {
  const { label } = useLockLabel(trial);
  if (!isLocked(trial)) return null;
  return (
    <button type="button" data-trial-row-lock title={label} aria-label={label} onClick={onUnlock}
      className={cn("flex shrink-0 items-center justify-center rounded-lg text-accent transition-colors hover:bg-accent-soft/50", className)}>
      <Lock size={14} aria-hidden />
    </button>
  );
}

/** "3 dni" for a list row's meta line; null when there is nothing to say. */
export function useTrialDays(trial: GalleryTrial | null | undefined): string | null {
  const { t } = useI18n();
  return isLocked(trial) ? daysShort(t, daysLeftOf(trial)) : null;
}

/**
 * THE LIGHTBOX PLATE, above the AKCJE row. Locked: the lock, how long the
 * clean version stays, and "Usuń znak wodny". Expired or unavailable: one
 * muted line and nothing to click — no offer, no promise of getting it back.
 */
export function TrialNotice({ trial, onUnlock }: { trial: GalleryTrial | null | undefined; onUnlock?: () => void }) {
  const { t } = useI18n();
  const gone = goneLine(t, trial);
  if (gone) {
    return <p data-trial-notice="gone" className="rounded-xl bg-sunken/50 px-3 py-2.5 text-[11.5px] leading-relaxed text-faint">{gone}</p>;
  }
  if (!trial || !isLocked(trial)) return null;
  const days = daysLeftOf(trial);
  const urgent = underADay(trial.expiresAt, days);
  return (
    <div data-trial-notice="locked"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-2.5",
        urgent ? "border-[rgb(var(--warning)/0.45)] bg-[rgb(var(--warning)/0.08)]" : "border-[rgb(var(--accent)/0.3)] bg-accent-soft/25")}>
      <span aria-hidden className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
        urgent ? "bg-[rgb(var(--warning)/0.16)] text-warning" : "bg-accent-soft/60 text-accent")}>
        <Lock size={15} />
      </span>
      <p className="min-w-[9rem] flex-1 text-[12.5px] font-semibold leading-snug text-ink">{availableLine(t, days)}</p>
      {onUnlock && (
        <button type="button" onClick={onUnlock} data-trial-unlock
          className="cta flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold">
          <Lock size={13} aria-hidden />
          {t("genv3.wm.unlock")}
        </button>
      )}
    </div>
  );
}

/**
 * Why an editing control is off for a marked image (R5): the model would get
 * the watermark as part of the picture. Locked → "Najpierw usuń znak wodny"
 * with the lock CTA; expired/unavailable → the neutral reason, no CTA.
 */
export function TrialMarkedHint({ trial, onUnlock, lockedKey, goneKey }: {
  trial: GalleryTrial | null | undefined;
  onUnlock?: () => void;
  lockedKey: string;
  goneKey: string;
}) {
  const { t } = useI18n();
  if (!isMarked(trial)) return null;
  const locked = isLocked(trial);
  return (
    <p data-trial-hint={locked ? "locked" : "gone"} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-relaxed text-faint">
      <span>{t(locked ? lockedKey : goneKey)}</span>
      {locked && onUnlock && (
        <button type="button" onClick={onUnlock} data-trial-hint-unlock
          className="inline-flex items-center gap-1 font-semibold text-accent transition-colors hover:text-accent-hover">
          <Lock size={11} aria-hidden />
          {t("genv3.wm.unlock")}
        </button>
      )}
    </p>
  );
}
