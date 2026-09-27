import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * A tool's tab bar: PODSTAWOWE · SILNIK · WORKFLOW · MODELE, API I KOSZTY ·
 * WIEDZA. Labels are never squeezed or truncated — on a phone the bar scrolls
 * sideways (with a visible thin scrollbar and snap points) instead.
 */
export function ToolTabs({ toolKey, tabs, active, label, t }: {
  toolKey: string; tabs: readonly string[]; active: string; label: string;
  t: (key: string) => string;
}) {
  return (
    <nav aria-label={label} data-tool-tabs
      className="thin-scroll -mx-1 mb-5 flex snap-x gap-1 overflow-x-auto overscroll-x-contain px-1 pb-1.5">
      {tabs.map((key) => (
        <Link key={key} href={`/admin/ai/${toolKey}?tab=${key}`} scroll={false}
          aria-current={key === active ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 snap-start items-center whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition-colors",
            key === active ? "bg-raised text-ink" : "text-muted hover:text-ink",
          )}>
          {t(`aicc.tab.${key}`)}
        </Link>
      ))}
    </nav>
  );
}
