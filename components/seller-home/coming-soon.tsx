"use client";
import { useState, useTransition } from "react";
import { Bell, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { registerInterestAction } from "@/app/actions/seller-home";
import { interestLabelKey, type InterestKey } from "@/lib/seller-home-config";

/**
 * "NADCHODZI" — one compact row, no placeholders. "Powiadom mnie" records the
 * signed-in seller's interest in one click (their account e-mail is already
 * known — nothing to type). Saved rows come from the server, so "Zapisano ✓"
 * is still there after a reload; a repeat click is a no-op.
 */
export function ComingSoon({ keys, saved }: {
  /** Modules still not live (the server drops any that went live). */
  keys: InterestKey[];
  saved: InterestKey[];
}) {
  const { t } = useI18n();
  const [done, setDone] = useState<Set<InterestKey>>(() => new Set(saved));
  const [busy, setBusy] = useState<InterestKey | null>(null);
  const [, start] = useTransition();
  const [announce, setAnnounce] = useState("");

  const notify = (key: InterestKey) => {
    if (done.has(key) || busy) return;
    setBusy(key);
    start(async () => {
      const res = await registerInterestAction(key);
      setBusy(null);
      if (res.ok) {
        setDone((prev) => new Set(prev).add(key));
        setAnnounce(`${t(interestLabelKey(key))}: ${t("sellerHome.soon.saved")}`);
      }
      else toast.error(t("common.error"));
    });
  };

  if (keys.length === 0) return null;
  return (
    <section className="relative" aria-labelledby="seller-soon-title" data-seller-soon>
      <h2 id="seller-soon-title" className="font-display text-[13px] font-bold uppercase tracking-[0.07em] text-ink sm:text-[14px]">
        {t("sellerHome.soon.title")}
      </h2>
      <p className="mt-0.5 text-[12px] text-muted sm:text-[12.5px]">{t("sellerHome.soon.sub")}</p>
      <ul className="mt-2.5 flex flex-wrap gap-2">
        {keys.map((key) => {
          const on = done.has(key);
          return (
            <li key={key} data-soon={key}
              className="inline-flex max-w-full items-center justify-between gap-2 rounded-xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.3))] bg-[rgb(var(--surface)/0.6)] py-1 pl-3 pr-1 max-sm:w-full">
              <span className="min-w-0 text-[13px] font-medium text-ink">{t(interestLabelKey(key))}</span>
              {/* Saved stays focusable (aria-disabled, not disabled) so focus
                  is not lost from under a keyboard user who just pressed it. */}
              <button type="button" onClick={() => notify(key)} aria-disabled={on || busy === key}
                aria-label={`${t(interestLabelKey(key))}: ${on ? t("sellerHome.soon.saved") : t("sellerHome.soon.notify")}`}
                data-notify={key} data-saved={on || undefined}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors",
                  on
                    ? "bg-[rgb(var(--success)/0.12)] text-[rgb(11_94_52)] dark:text-success"
                    : "text-accent-strong hover:bg-[rgb(var(--accent)/0.08)] dark:text-accent",
                )}>
                {on ? <Check size={13} strokeWidth={3} aria-hidden /> : <Bell size={13} aria-hidden />}
                {on ? t("sellerHome.soon.saved") : t("sellerHome.soon.notify")}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </section>
  );
}
