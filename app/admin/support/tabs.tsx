import Link from "next/link";
import { cn } from "@/lib/utils";

/** "Wątki" (the in-app support desk) and "Zgłoszenia z formularza" (Kontakt
 *  V2) — one menu entry, two lists. */
export function SupportTabs({ active, fresh, t }: {
  active: "threads" | "tickets"; fresh: number; t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const tab = (on: boolean) => cn(
    "inline-flex min-h-[38px] items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold transition-colors",
    on ? "bg-accent-soft/70 text-accent" : "text-muted hover:text-ink",
  );
  return (
    <nav aria-label={t("chat.tickets.tabs")} className="mb-5 flex flex-wrap gap-1.5 border-b border-line pb-3" data-support-tabs>
      <Link href="/admin/support" className={tab(active === "threads")} aria-current={active === "threads" ? "page" : undefined}>
        {t("chat.tickets.tabThreads")}
      </Link>
      <Link href="/admin/support/zgloszenia" className={tab(active === "tickets")} aria-current={active === "tickets" ? "page" : undefined}>
        {t("chat.tickets.tabTickets")}
        {fresh > 0 && (
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold leading-none text-white" aria-label={t("chat.tickets.freshAria", { n: fresh })}>
            {fresh}
          </span>
        )}
      </Link>
    </nav>
  );
}
