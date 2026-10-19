"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { remainingParts, unitKey, type CountdownUnit } from "./countdown-math";

/**
 * DO PREMIERY ZOSTAŁO — days, hours, minutes to the approved launch moment.
 *
 * The PremiereBanner pattern (components/plan/premiere-banner.tsx), for the
 * same reasons: the deadline AND "now" are the server's. The page hands down
 * `serverNow`, the skew between the two clocks is fixed at mount, and the
 * countdown runs on that difference — a visitor whose system clock is a day
 * off still sees the right number, and the first client render is the same
 * arithmetic on the same two props as the server's, so it hydrates without a
 * mismatch.
 *
 * The server only renders this for an APPROVED date that is still ahead
 * (prelaunch_public_config); when the remainder reaches zero the component
 * removes itself rather than counting into the negative.
 *
 * Nothing animates: the numbers change once a minute and that is all, so
 * there is nothing for reduced motion to switch off. A screen reader gets the
 * date once, as a sentence, instead of a live region re-announcing digits.
 */
export function LaunchCountdown({ launchAtMs, serverNow, iso, label, dateLabel, size = "md" }: {
  launchAtMs: number;
  serverNow: number;
  iso: string;
  /** "Do premiery zostało" (CMS). */
  label: string;
  /** The launch moment in words, Europe/Warsaw — for the sr-only line. */
  dateLabel: string;
  /** `sm` sits inside the hero form card; `md` heads the final call to action. */
  size?: "sm" | "md";
}) {
  const { t, locale } = useI18n();
  const [skew] = useState(() => serverNow - Date.now());
  // The state is the remainder in MINUTES (rounded up), not in milliseconds:
  // the one-second tick below then sets the same number fifty-nine times out
  // of sixty, and React bails out of those renders on its own.
  const [minutesLeft, setMinutesLeft] = useState(() => Math.ceil(Math.max(0, launchAtMs - serverNow) / 60_000));

  useEffect(() => {
    const tick = () => setMinutesLeft(Math.ceil(Math.max(0, launchAtMs - (Date.now() + skew)) / 60_000));
    tick();
    // A second's resolution on a minute's display: the change lands within a
    // second of the minute turning.
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [launchAtMs, skew]);

  if (minutesLeft <= 0) return null;
  const parts = remainingParts(minutesLeft * 60_000);
  const units: { unit: CountdownUnit; value: number }[] = [
    { unit: "days", value: parts.days },
    { unit: "hours", value: parts.hours },
    { unit: "minutes", value: parts.minutes },
  ];

  return (
    <div data-launch-countdown className={cn("min-w-0", size === "sm" ? "mt-3" : "mt-6")}>
      <p className={cn(
        "font-semibold uppercase tracking-[0.12em] text-muted",
        size === "sm" ? "text-[10.5px] lg:text-[clamp(10.5px,min(0.72vw,1.17vh),12.5px)]" : "text-[11.5px] sm:text-[12px]",
      )}>{label}</p>
      <time dateTime={iso} aria-hidden className={cn("flex", size === "sm" ? "mt-1.5 gap-1.5" : "mt-2.5 justify-center gap-2.5")}>
        {units.map(({ unit, value }) => (
          <span key={unit} data-launch-countdown-unit={unit}
            className={cn(
              "flex flex-col items-center rounded-xl border border-[rgb(var(--glass-border)/0.18)] bg-[rgb(var(--sunken)/0.55)]",
              size === "sm" ? "min-w-[3.6rem] px-2 py-1.5" : "min-w-[4.6rem] px-3 py-2.5 sm:min-w-[5.2rem]",
            )}>
            <span className={cn(
              "font-display font-semibold tabular-nums leading-none text-ink",
              size === "sm" ? "text-[1.15rem]" : "text-[1.6rem] sm:text-[1.9rem]",
            )}>{String(value).padStart(2, "0")}</span>
            <span className={cn(
              "mt-1 font-semibold uppercase tracking-[0.1em] text-muted",
              size === "sm" ? "text-[9px]" : "text-[10px]",
            )}>{t(unitKey(unit, locale, value))}</span>
          </span>
        ))}
      </time>
      <span className="sr-only">{t("prelaunchUi.cd.sr", { date: dateLabel })}</span>
    </div>
  );
}
