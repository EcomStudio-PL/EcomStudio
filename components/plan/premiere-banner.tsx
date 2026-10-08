"use client";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

/**
 * THE PREMIERE BANNER — rendered only while the server says the offer runs.
 *
 * The deadline is the SERVER's (lib/server/pricing-offer.ts), and so is "now":
 * the page hands down `serverNow`, and the countdown runs on the difference
 * between the two clocks measured at mount. A visitor with a wrong system
 * clock sees the right countdown, and reloading cannot restart it — there is
 * nothing on this side to restart. When it reaches zero the banner removes
 * itself; the checkout has refused the old price on its own clock since.
 */
export function PremiereBanner({ endsAtMs, serverNow, endsAt, endsAtLabel }: {
  endsAtMs: number; serverNow: number; endsAt: string; endsAtLabel: string;
}) {
  const { t } = useI18n();
  // The skew between the server's clock and this one, fixed at first render.
  const [skew] = useState(() => serverNow - Date.now());
  const [left, setLeft] = useState(() => Math.max(0, endsAtMs - serverNow));

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, endsAtMs - (Date.now() + skew)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endsAtMs, skew]);

  if (left <= 0) return null;
  const s = Math.floor(left / 1000);
  const parts = [
    { v: Math.floor(s / 86400), k: "pricing.premiere.days" },
    { v: Math.floor((s % 86400) / 3600), k: "pricing.premiere.hours" },
    { v: Math.floor((s % 3600) / 60), k: "pricing.premiere.minutes" },
    { v: s % 60, k: "pricing.premiere.seconds" },
  ];

  return (
    <section data-premiere-banner aria-labelledby="premiere-title"
      className="relative isolate overflow-hidden rounded-[28px] px-5 py-6 text-white sm:px-8 sm:py-7"
      style={{
        backgroundImage: "radial-gradient(120% 140% at 0% 0%, rgb(226 0 214 / 0.55), transparent 55%), linear-gradient(120deg, rgb(176 0 172) 0%, rgb(112 24 170) 52%, rgb(40 16 92) 100%)",
        boxShadow: "0 30px 70px -40px rgb(176 0 172 / 0.8)",
      }}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="min-w-0 max-w-xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ring-1 ring-white/25">
            <Sparkles size={12} aria-hidden /> {t("pricing.premiere.badge")}
          </span>
          <h2 id="premiere-title" className="mt-3 font-display text-[1.375rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[1.625rem]">
            {t("pricing.premiere.title")}
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-white/85">{t("pricing.premiere.sub")}</p>
        </div>
        <div className="shrink-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-white/85">{t("pricing.premiere.endsIn")}</p>
          {/* Read once by a screen reader as a date, not re-announced every second. */}
          <time dateTime={endsAt} aria-hidden className="mt-2 flex gap-2">
            {parts.map((p) => (
              <span key={p.k} className="flex w-[64px] flex-col items-center rounded-2xl bg-white/12 py-2.5 ring-1 ring-white/20 sm:w-[72px]">
                <span className="font-display text-[1.625rem] font-semibold tabular-nums leading-none">{String(p.v).padStart(2, "0")}</span>
                <span className="mt-1 text-[10px] font-bold tracking-[0.12em] text-white/80">{t(p.k)}</span>
              </span>
            ))}
          </time>
          <span className="sr-only">{t("pricing.premiere.endsOn", { date: endsAtLabel })}</span>
        </div>
      </div>
    </section>
  );
}
