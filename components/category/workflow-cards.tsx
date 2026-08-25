import Link from "next/link";
import { ArrowRight, Layers, Ratio } from "lucide-react";
import type { Category } from "@/lib/categories";
import { cn } from "@/lib/utils";

/**
 * WORKFLOW CARDS — the discovery step of a category page.
 *
 * Every card is a real preset: it carries the framing and the shot count it
 * will apply, shows a preview thumbnail of that framing, and lands the user
 * in a generator already configured for that job. Six identical forms behind
 * six names would defeat the point, so the ratio/shots pair is printed on the
 * card — the user can see the presets differ before clicking.
 */
export function WorkflowCards({ category, t, previews, costPerShot }: {
  category: Category;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Signed thumbnails from the user's own library, one per card when
   *  available — otherwise the ratio frame stands in. */
  previews?: (string | null)[];
  /** Credits one shot costs at the default model, when a model is usable. */
  costPerShot?: number | null;
}) {
  const { rgb, rgb2 } = category.accent;
  return (
    <div
      className="stagger grid grid-cols-2 gap-3 [&>*]:min-w-0 md:grid-cols-3 xl:grid-cols-5 xl:gap-3.5"
      style={{ ["--cat" as string]: rgb, ["--cat2" as string]: rgb2 }}
    >
      {category.workflows.map((w, i) => {
        const Icon = w.icon;
        const preview = previews?.[i] ?? null;
        const disabled = w.soon || category.soon;
        const body = (
          <>
            {/* PREVIEW — the workflow's own framing, so 1:1 and 9:16 presets
                are distinguishable at a glance. */}
            <span
              aria-hidden
              className="relative mb-3 flex items-center justify-center overflow-hidden rounded-xl bg-sunken/70 p-3 ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]"
              style={{ background: `linear-gradient(160deg, rgb(${rgb} / 0.14), rgb(${rgb2} / 0.05))` }}
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" loading="lazy"
                  className="h-20 w-full rounded-lg object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
              ) : (
                <span className={cn(
                  "flex items-center justify-center rounded-lg border-2 border-dashed border-[rgb(var(--cat)/0.45)] text-[rgb(var(--cat))] transition-transform duration-300 group-hover:scale-[1.06]",
                  w.ratio === "1:1" ? "h-16 w-16"
                    : w.ratio === "4:5" ? "h-[4.5rem] w-[3.6rem]"
                      : w.ratio === "16:9" ? "h-[3.4rem] w-[6rem]"
                        : "h-[4.75rem] w-[2.7rem]",
                )}>
                  <Icon size={18} strokeWidth={1.9} />
                </span>
              )}
              <span className="absolute right-2 top-2 rounded-md bg-[rgb(var(--bg)/0.72)] px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-[rgb(var(--cat))] backdrop-blur-sm">
                {w.ratio}
              </span>
              {/* The first workflow is the category's flagship — labelled, so
                  a new user has an obvious place to start. */}
              {i === 0 && !disabled && (
                <span className="absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white backdrop-blur-sm"
                  style={{ background: `rgb(${rgb} / 0.85)` }}>
                  {t("catpage.featured")}
                </span>
              )}
            </span>

            <span className="flex items-center gap-1.5 text-[13.5px] font-semibold tracking-tight">
              {t(`wf.${category.key}.${w.key}.name`)}
              {disabled && (
                <span className="rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
                  {t("common.soon")}
                </span>
              )}
            </span>
            <span className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted">
              {t(`wf.${category.key}.${w.key}.sub`)}
            </span>

            <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[11px] font-medium text-faint">
              <span className="inline-flex items-center gap-1"><Ratio size={11} aria-hidden />{w.ratio}</span>
              <span className="inline-flex items-center gap-1"><Layers size={11} aria-hidden />{w.shots}</span>
              {typeof costPerShot === "number" && costPerShot > 0 && !disabled && (
                <span className="inline-flex items-center gap-1 tabular-nums text-[rgb(var(--cat))]">
                  {t("catpage.cost", { n: costPerShot })}
                </span>
              )}
              {!disabled && (
                <ArrowRight size={12} aria-hidden
                  className="ml-auto text-[rgb(var(--cat))] transition-transform duration-200 group-hover:translate-x-0.5" />
              )}
            </span>
          </>
        );
        const cls = cn(
          "group panel flex flex-col rounded-2xl p-3.5",
          disabled ? "opacity-65" : "panel-interactive hover:border-[rgb(var(--cat)/0.5)]",
        );
        return disabled ? (
          <div key={w.key} className={cls} aria-disabled>{body}</div>
        ) : (
          <Link key={w.key} href={`/k/${category.slug}/${w.key}`} className={cls}>{body}</Link>
        );
      })}
    </div>
  );
}
