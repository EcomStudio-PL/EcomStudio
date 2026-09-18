"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { GeneratorWorkspace } from "@/components/genv3/workspace";
import { CATEGORY_VARIANT, DEFAULT_VARIANT, findCategory } from "@/lib/categories";
import { fashionTool } from "@/lib/fashion-tools";
import { FashionToolWorkspace } from "@/components/fashion/tool-workspace";
import type { GalleryItem, GenModel } from "@/components/genv3/types";
import type { SessionPreviewMap } from "@/components/genv3/sections";

/**
 * ONE TOOL PER SCREEN.
 *
 * A tool page is a way back and the tool. That is the whole layout, and it is
 * the second thing this screen has lost: first the category hero, now the row
 * of sibling chips that sat under it.
 *
 * WHY THE CHIPS WENT. They answered "which other tool could I be using",
 * which is a question the CATEGORY page exists to answer, and they answered it
 * on every screen where the seller had already decided. In Moda that was four
 * chips; in E-commerce five. On a phone the row wrapped to two lines and the
 * panel started that much further down. Choosing a tool is now one place —
 * /k/{cat} — instead of two places that had to be kept in step.
 *
 * WHAT WENT WITH THEM, AND WHY THAT IS NOT OVER-REMOVAL. This component used
 * to hold local `active` state, a History pushState, a popstate listener and a
 * pathname effect. All four existed for ONE reason: a chip click had to change
 * the panel without re-running a force-dynamic page. With no chips there is no
 * client-side switch to make, so every one of them became unreachable — and a
 * popstate listener nothing can trigger is not caution, it is a trap for the
 * next reader.
 *
 * Deriving the workflow straight from the prop is also strictly MORE correct
 * than the state was. The App Router can reuse this instance across a
 * navigation between two /k/{cat}/* routes; seeded-once state would then show
 * the previous tool until an effect caught up, which is precisely what those
 * effects were there to paper over. A prop cannot go stale.
 *
 * WHAT DID NOT GO: the tool registry, the routes, the category config, the
 * per-tool data the page resolves, and the choice between a tool panel and the
 * generator. Nothing about how a tool RUNS is in here.
 *
 * Both branches stay keyed by workflow. Their ratio/shots/style props seed
 * state once, so if the router does reuse this instance across routes the key
 * is what forces a clean panel instead of the previous tool's uploads.
 */
/** Everything the four Moda tools need, resolved once by the page. */
export type FashionRuntimeData = {
  /** Sizes and framings the shared model really offers. */
  resolutions: string[];
  ratios: string[];
  /** Size → credits for one image, carrying the operator's override. */
  pricing: Record<string, number>;
  /** Per tool: can it run, and what has it made before. */
  tools: Record<string, {
    available: boolean;
    initialItems: GalleryItem[];
    initialCursor: string | null;
  }>;
};

export function WorkflowRuntime({
  catSlug, initialWorkflow, models, credits, workspaceId, engineAvailable,
  initialItems, initialCursor, sessionPreviews, fashion = null,
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
  /** Non-null only for Moda. */
  fashion?: FashionRuntimeData | null;
}) {
  const { t } = useI18n();
  const category = findCategory(catSlug);

  if (!category) return null;
  /** Straight from the prop, which the server resolved from the URL. A
   *  hand-edited or retired key falls back to the category's first workflow,
   *  so the workspace can never render blank. */
  const workflow = category.workflows.find((w) => w.key === initialWorkflow)
    ?? category.workflows[0];
  /** Null for a preset — the generator then renders exactly as before. */
  const tool = workflow.tool ? fashionTool(workflow.key) : null;

  // An empty or missing style entry must stay empty: makeT echoes the key on a
  // miss, and that key would otherwise become the seller's "preferred style".
  const styleKey = `wf.${category.key}.${workflow.key}.style`;
  const styleValue = t(styleKey);
  const styleHint = styleValue && styleValue !== styleKey ? styleValue : undefined;

  return (
    <>
      {/* A WAY BACK, AND NOTHING ELSE.
          This used to be the category hero: a washed card with the category
          overline, a 56px icon tile, the tool's name at clamp(1.35rem…2rem)
          and its description. Every word of it was already on screen — the
          name in the selected chip directly below, the description in the
          panel — so it spent roughly 150px of phone height, and a comparable
          band on desktop, restating the answer to a question nobody had. The
          thing the seller opened the page for started below the fold.

          (The name then lived in the selected chip below this link. The chips
          are gone too, so the tool's name is now only where it always
          mattered: on the card the seller clicked, and in the page title.)

          A plain link is what is left, in the same idiom /tools/[slug] and
          /prompts/[id] already use. It is a real <Link> to the category, not
          history.back(): a tool reached from a bookmark, a shared URL or an
          e-mail has no history to go back to, and "back" that lands outside
          the app is worse than no button.

          NOT REMOVED FROM THE CATEGORY PAGE. /k/[cat] keeps its full
          CategoryHeader — there the wash and the icon ARE the screen's
          subject, and it is the destination this link points at. */}
      <Link href={`/k/${category.slug}`}
        data-tool-back
        className="mb-3 inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted transition-colors hover:text-ink">
        <ArrowLeft size={14} aria-hidden />
        {t(`cats.${category.key}`)}
      </Link>

      {/* The sibling-chip row stood here. Nothing replaces it: the back link's
          own `mb-3` is the gap to the panel, so there is no wrapper, no height
          and no margin left behind. */}

      {tool && fashion ? (
        /* A TOOL. Keyed like the generator below, and for the same reason: the
           panel seeds its pools, its size and its framing from props once, so
           an instance the router reused across two /k/{cat}/* routes would
           otherwise hold the previous tool's uploads. */
        <FashionToolWorkspace
          key={workflow.key}
          config={tool}
          workspaceId={workspaceId}
          credits={credits}
          available={fashion.tools[workflow.key]?.available ?? false}
          resolutions={fashion.resolutions}
          ratios={fashion.ratios}
          pricing={fashion.pricing}
          initialItems={fashion.tools[workflow.key]?.initialItems ?? []}
          initialCursor={fashion.tools[workflow.key]?.initialCursor ?? null}
        />
      ) : (
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
      )}
    </>
  );
}
