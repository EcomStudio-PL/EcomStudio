import Link from "next/link";
import { ArrowRight, Layers, Ratio } from "lucide-react";
import type { Category } from "@/lib/categories";
import { Media } from "@/components/mobile/media";
import { cn } from "@/lib/utils";

/**
 * WORKFLOW CARDS — the discovery step of a category page.
 *
 * Every card is a real preset: it carries the framing and the shot count it
 * will apply, shows a preview thumbnail of that framing, and lands the user
 * in a generator already configured for that job. Six identical forms behind
 * six names would defeat the point, so the ratio/shots pair is printed on the
 * card — the user can see the presets differ before clicking.
 *
 * The card is the same five parts on every width — frame, title, description,
 * spacer, meta footer — with the frame holding a fixed 4:3 and the footer
 * pushed down by `mt-auto`. The "Polecany workflow" flag sits at the TOP-LEFT
 * of the frame and the ratio chip at the BOTTOM-RIGHT: on a two-column phone
 * grid those two badges shared one line and overlapped.
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
      className="stagger grid grid-cols-2 gap-2.5 [&>*]:min-w-0 sm:gap-3 md:grid-cols-3 xl:grid-cols-5 xl:gap-3.5"
      style={{ ["--cat" as string]: rgb, ["--cat2" as string]: rgb2 }}
    >
      {category.workflows.map((w, i) => {
        const Icon = w.icon;
        const preview = previews?.[i] ?? null;
        const disabled = w.soon || category.soon;
        const body = (
          <>
            {/* PREVIEW — the workflow's own framing, so 1:1 and 9:16 presets
                are distinguishable at a glance. The frame owns its height
                before the thumbnail loads, so a row never re-flows. */}
            <span
              aria-hidden
              className="relative block overflow-hidden rounded-xl ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]"
              style={{ background: `linear-gradient(160deg, rgb(${rgb} / 0.14), rgb(${rgb2} / 0.05))` }}
            >
              {preview ? (
                <Media src={preview} ratio="4/3" rounded="rounded-xl" className="w-full" />
              ) : (
                <span className="flex aspect-[4/3] items-center justify-center p-2">
                  <span className={cn(
                    "flex items-center justify-center rounded-lg border-2 border-dashed border-[rgb(var(--cat)/0.45)] text-[rgb(var(--cat))] transition-transform duration-300 group-hover:scale-[1.06]",
                    w.ratio === "1:1" ? "h-[3.4rem] w-[3.4rem]"
                      : w.ratio === "4:5" ? "h-[4rem] w-[3.2rem]"
                        : w.ratio === "16:9" ? "h-[2.9rem] w-[5.1rem]"
                          : "h-[4.2rem] w-[2.4rem]",
                  )}>
                    <Icon size={18} strokeWidth={1.9} />
                  </span>
                </span>
              )}
              {/* Ratio chip at the BOTTOM-right — the flagship flag owns the
                  top line by itself. */}
              <span className="absolute bottom-1.5 right-1.5 rounded-md bg-[rgb(var(--bg)/0.72)] px-1.5 py-0.5 text-[9.5px] font-bold leading-none tracking-wide text-[rgb(var(--cat))] backdrop-blur-sm">
                {w.ratio}
              </span>
              {/* The first workflow is the category's flagship — labelled, so
                  a new user has an obvious place to start. */}
              {i === 0 && !disabled && (
                <span className="absolute left-1.5 right-1.5 top-1.5 truncate rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-[0.08em] text-white backdrop-blur-sm"
                  style={{ background: `rgb(${rgb} / 0.85)` }}>
                  {t("catpage.featured")}
                </span>
              )}
            </span>

            <span className="mt-2.5 flex items-start gap-1.5 text-[13px] font-semibold leading-tight tracking-tight sm:text-[13.5px]">
              <span className="min-w-0 flex-1">{t(`wf.${category.key}.${w.key}.name`)}</span>
              {disabled && (
                <span className="shrink-0 rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-faint">
                  {t("common.soon")}
                </span>
              )}
            </span>
            {/* Two lines, always two lines' worth of space: titles and footers
                then line up across the row whatever the copy length. */}
            <span className="mt-1 line-clamp-2 min-h-[2.1rem] text-[11px] leading-snug text-muted sm:text-[11.5px]">
              {t(`wf.${category.key}.${w.key}.sub`)}
            </span>

            <span className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-line pt-2 text-[11px] font-medium text-faint">
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
          "group panel flex h-full flex-col rounded-2xl p-2.5 sm:p-3.5",
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
