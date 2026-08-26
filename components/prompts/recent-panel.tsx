"use client";
import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Clock, Wand2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type RecentSession = {
  id: string;
  productName: string;
  status: string;
  ratio: string;
  createdAt: string;
  thumbnail: string | null;
};

const TONE: Record<string, "green" | "red" | "amber"> = {
  ready: "green", failed: "red",
};

/**
 * RECENT GENERATIONS — the right rail of every generator.
 *
 * It scrolls inside itself rather than stretching the page, which is the
 * whole point: a seller with two hundred sessions should not get a two
 * hundred row tall document. Each row states day, month, year AND the time,
 * because "24.08.2026" alone cannot tell two runs of the same afternoon
 * apart.
 */
export function RecentPanel({ sessions, className, horizontal }: {
  sessions: RecentSession[];
  className?: string;
  /** Phone layout: a swipeable row instead of a fixed rail. */
  horizontal?: boolean;
}) {
  const { t, locale } = useI18n();
  // dd.MM.yyyy · HH:mm in every locale — the order the user reads dates in.
  const stamp = useMemo(() => new Intl.DateTimeFormat(locale, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }), [locale]);
  const fmt = (iso: string) => {
    const parts = stamp.formatToParts(new Date(iso));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("day")}.${get("month")}.${get("year")} · ${get("hour")}:${get("minute")}`;
  };

  const header = (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <p className="overline">{t("psess.recent")}</p>
      <Link href="/library?tab=history"
        className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent transition-opacity duration-200 hover:opacity-75">
        {t("common.viewAll")} <ArrowRight size={12} aria-hidden />
      </Link>
    </div>
  );

  if (sessions.length === 0) {
    return (
      <div className={cn("panel rounded-2xl p-4", className)}>
        {header}
        <div className="py-6 text-center">
          <Wand2 size={20} className="mx-auto text-faint" aria-hidden />
          <p className="mt-2 text-[12.5px] text-muted">{t("psess.empty")}</p>
        </div>
      </div>
    );
  }

  const row = (s: RecentSession, compact: boolean) => (
    <Link
      key={s.id}
      href={`/prompts/${s.id}`}
      prefetch
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors duration-200 hover:border-[rgb(var(--accent)/0.3)] hover:bg-raised",
        compact && "w-[15rem] shrink-0",
      )}
    >
      <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-raised ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]">
        {s.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{s.productName}</span>
        <span className="mt-0.5 flex items-center gap-1 text-[11px] tabular-nums text-faint">
          <Clock size={10} aria-hidden />
          {fmt(s.createdAt)}
          <span className="text-line-strong">·</span>
          {s.ratio}
        </span>
      </span>
      <span className="shrink-0">
        <Badge tone={TONE[s.status] ?? "amber"}>{t(`psess.status_${s.status}`, {}) || s.status}</Badge>
      </span>
    </Link>
  );

  if (horizontal) {
    return (
      <section className={cn("min-w-0", className)}>
        {header}
        <div className="thin-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {sessions.map((s) => row(s, true))}
        </div>
      </section>
    );
  }

  return (
    <div className={cn("panel flex min-h-0 flex-col rounded-2xl p-3.5", className)}>
      {header}
      {/* Its own scroll: the rail keeps a fixed height, the page does not grow. */}
      <div className="thin-scroll -mx-1 max-h-[26rem] min-h-0 space-y-0.5 overflow-y-auto px-1">
        {sessions.map((s) => row(s, false))}
      </div>
    </div>
  );
}
