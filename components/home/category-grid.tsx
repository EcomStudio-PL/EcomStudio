import Link from "next/link";
import { HOME_CATEGORIES } from "@/lib/topnav";
import { cn } from "@/lib/utils";

/**
 * CATEGORY GRID — the homepage's main navigation surface per the UX spec:
 * six tiles (Moda, E-commerce, Social Media, Mailing, Inne, Matching), each
 * with an icon, a name and a one-line description. A tile drops the user
 * straight into the Generator with the category preselected — the ≤3-clicks
 * rule. Matching has no backend yet and says so instead of pretending.
 * Mobile renders exactly two columns, as specified.
 */
export function CategoryGrid({ t }: { t: (key: string) => string }) {
  return (
    <div id="kategorie" className="stagger grid grid-cols-2 gap-3 [&>*]:min-w-0 md:grid-cols-3 xl:grid-cols-6 xl:gap-4">
      {HOME_CATEGORIES.map((c) => {
        const Icon = c.icon;
        const body = (
          <>
            <span aria-hidden className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110",
              c.soon
                ? "bg-raised text-faint"
                : "bg-[linear-gradient(145deg,rgb(var(--accent)/0.26),rgb(var(--violet)/0.10))] text-accent shadow-[0_10px_24px_-14px_rgb(var(--accent)/0.9)]",
            )}>
              <Icon size={20} strokeWidth={1.9} />
            </span>
            <span className="mt-3 flex items-center gap-1.5 text-sm font-semibold tracking-tight">
              {t(`cats.${c.key}`)}
              {c.soon && (
                <span className="rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
                  {t("common.soon")}
                </span>
              )}
            </span>
            <span className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted">
              {t(`cats.${c.key}Sub`)}
            </span>
          </>
        );
        const cls = cn(
          "group panel relative flex flex-col rounded-2xl p-4",
          c.soon ? "opacity-70" : "panel-interactive",
        );
        return c.soon
          ? <div key={c.key} className={cls} aria-disabled>{body}</div>
          : <Link key={c.key} href={c.href} className={cls}>{body}</Link>;
      })}
    </div>
  );
}
