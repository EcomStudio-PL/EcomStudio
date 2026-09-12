"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { CategoryHeader } from "@/components/category/category-header";
import { GeneratorWorkspace } from "@/components/genv3/workspace";
import { CATEGORY_VARIANT, DEFAULT_VARIANT, findCategory } from "@/lib/categories";
import type { GalleryItem, GenModel } from "@/components/genv3/types";
import type { SessionPreviewMap } from "@/components/genv3/sections";
import { cn } from "@/lib/utils";

/**
 * PRESET SWITCHING WITHOUT A SERVER ROUND-TRIP.
 *
 * The sibling-preset chips used to be plain links to /k/{cat}/{wf}. That route
 * is force-dynamic, so every switch re-ran the whole page on the server —
 * auth, workspace, wallet, model chain, provider health, twenty-four gallery
 * rows and a Storage signing call — and, because the nearest Suspense boundary
 * is the app-wide loading skeleton, the entire workspace was replaced by an
 * unrelated placeholder for the duration. Measured at the database the work is
 * about eight milliseconds; the rest is four sequential round trips between the
 * function region and the Supabase region, and it is spent on data that does
 * not depend on the preset at all.
 *
 * NOTHING here depends on `wf`. The only things a preset changes are its
 * framing, its shot count, its style directive and its labels — all of them
 * static, all of them already in the bundle via lib/categories and the
 * dictionary. So the switch is local state, and the URL is updated with the
 * native History API (which Next's router observes) so deep links, refresh and
 * back/forward keep working exactly as before.
 *
 * The chips stay real anchors with real hrefs and the same classes: a
 * middle-click or ctrl-click still opens the preset in a new tab, and the
 * appearance is unchanged. Only the plain left click is intercepted.
 *
 * GeneratorWorkspace is keyed by preset ON PURPOSE. Its ratio/shots/style props
 * seed state once, so re-using the instance would leave a switched preset
 * showing the previous preset's framing — a switcher that visibly does nothing.
 * Remounting matches what the navigation did before, without the network.
 */
export function WorkflowRuntime({
  catSlug, initialWorkflow, models, credits, workspaceId, engineAvailable,
  initialItems, initialCursor, sessionPreviews,
}: {
  catSlug: string;
  initialWorkflow: string;
  models: GenModel[];
  credits: number;
  workspaceId: string;
  engineAvailable: boolean;
  initialItems: GalleryItem[];
  initialCursor: string | null;
  sessionPreviews: SessionPreviewMap;
}) {
  const { t } = useI18n();
  const category = findCategory(catSlug);
  const [active, setActive] = useState(initialWorkflow);
  const pathname = usePathname();

  /** A preset this category actually offers — anything else is ignored, so a
   *  hand-edited URL can never blank the workspace. */
  const known = useCallback(
    (key: string | undefined) =>
      !!key && (category?.workflows.some((w) => w.key === key && !w.soon) ?? false),
    [category],
  );

  const fromPath = (path: string): string | undefined => {
    const parts = path.split("/");
    // ["", "k", cat, wf]
    return parts[1] === "k" && parts[2] === catSlug ? parts[3] : undefined;
  };

  // Follows Next's own view of the URL, which it keeps in step with the
  // History API calls below. Same-value updates are a no-op.
  useEffect(() => {
    const key = fromPath(pathname ?? "");
    if (known(key)) setActive((prev) => (key === prev ? prev : key!));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, catSlug, known]);

  // Back and forward, read straight off the browser rather than through the
  // router — the panel must land on the right preset even if the entry was one
  // this component pushed itself.
  useEffect(() => {
    const onPop = () => {
      const key = fromPath(window.location.pathname);
      if (known(key)) setActive((prev) => (key === prev ? prev : key!));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catSlug, known]);

  const select = useCallback((event: React.MouseEvent<HTMLAnchorElement>, key: string) => {
    // Modified clicks belong to the browser: open-in-new-tab must keep working.
    if (event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (key === active) return;
    setActive(key);
    window.history.pushState(null, "", `/k/${catSlug}/${key}`);
  }, [active, catSlug]);

  if (!category) return null;
  const workflow = category.workflows.find((w) => w.key === active) ?? category.workflows[0];

  // An empty or missing style entry must stay empty: makeT echoes the key on a
  // miss, and that key would otherwise become the seller's "preferred style".
  const styleKey = `wf.${category.key}.${workflow.key}.style`;
  const styleValue = t(styleKey);
  const styleHint = styleValue && styleValue !== styleKey ? styleValue : undefined;

  return (
    <>
      <CategoryHeader
        compact
        category={category}
        backHref={`/k/${category.slug}`}
        backLabel={t(`cats.${category.key}`)}
        title={t(`wf.${category.key}.${workflow.key}.name`)}
        lead={t(`wf.${category.key}.${workflow.key}.sub`)}
      />

      {/* SIBLING PRESETS — switch workflow without leaving the workspace. */}
      <div className="mb-4 flex flex-wrap gap-1.5" style={{ ["--cat" as string]: category.accent.rgb }}>
        {category.workflows.filter((w) => !w.soon).map((w) => {
          const isActive = w.key === workflow.key;
          return (
            <a key={w.key} href={`/k/${category.slug}/${w.key}`}
              onClick={(e) => select(e, w.key)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-semibold transition-colors duration-200",
                isActive
                  ? "bg-[rgb(var(--cat)/0.16)] text-ink ring-1 ring-[rgb(var(--cat)/0.45)]"
                  : "plate text-muted hover:text-ink",
              )}>
              <w.icon size={14} aria-hidden className={isActive ? "text-[rgb(var(--cat))]" : "text-faint"} />
              {t(`wf.${category.key}.${w.key}.name`)}
              <span className="text-[11px] font-bold tabular-nums text-faint">{w.ratio}</span>
            </a>
          );
        })}
      </div>

      <GeneratorWorkspace
        key={workflow.key}
        mode="managed"
        models={models}
        credits={credits}
        workspaceId={workspaceId}
        engineAvailable={engineAvailable}
        initialItems={initialItems}
        initialCursor={initialCursor}
        initialStyle={styleHint}
        initialRatio={workflow.ratio}
        initialShots={workflow.shots}
        variant={CATEGORY_VARIANT[category.key] ?? DEFAULT_VARIANT}
        sessionPreviews={sessionPreviews}
      />
    </>
  );
}
