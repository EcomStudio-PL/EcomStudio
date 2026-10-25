"use client";
import { useI18n } from "@/lib/i18n/provider";
import { GeneratorWorkspace } from "@/components/genv3/workspace";
import { CATEGORY_VARIANT, DEFAULT_VARIANT, categoryHref, categoryPath, findCategory } from "@/lib/categories";
import { useIsGuest } from "@/components/public-tools/tool-viewer";
import { fashionTool } from "@/lib/fashion-tools";
import { FashionToolWorkspace } from "@/components/fashion/tool-workspace";
import { ThumbnailWorkspace } from "@/components/thumbnail/workspace";
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
 * the category's section of /tools — instead of two places that had to be
 * kept in step.
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
/** Everything the Moda tools need, resolved once by the page. */
export type FashionRuntimeData = {
  /** Sizes and framings the shared model really offers. */
  resolutions: string[];
  ratios: string[];
  /** Size → credits for one image, carrying the operator's override. */
  pricing: Record<string, number>;
  /** Per tool: can it run, and what has it made before. */
  tools: Record<string, {
    available: boolean;
    /** Results one run delivers (1, or the published workflow's count). */
    outputsPerRun: number;
    initialItems: GalleryItem[];
    initialCursor: string | null;
  }>;
};

/** Everything Miniaturka needs, resolved once by the page (null elsewhere). */
export type ThumbnailRuntimeData = {
  /** Prompt published + approved, price set, OpenAI key — it can run. */
  ready: boolean;
  /** Why not, for an admin only (codes); empty for a customer. */
  blockers: string[];
  maxPhotos: number;
  /** Credits for the composition (null = not priced yet). */
  thumbnailCredits: number | null;
  /** Retusz AI per photo, at Retusz's own price. */
  retouch: { available: true; unit: number } | { available: false; unit: null; reason: string };
  /** Edge of the delivered square, px. */
  target: number;
  /** A run of this member still in progress — resumed on load. */
  openRunId: string | null;
  initialItems: GalleryItem[];
  initialCursor: string | null;
};

export function WorkflowRuntime({
  catSlug, initialWorkflow, models, credits, workspaceId, engineAvailable,
  initialItems, initialCursor, sessionPreviews, fashion = null, thumbnail = null,
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
  /** Non-null only for Miniaturka (/k/ecommerce/thumbnail). */
  thumbnail?: ThumbnailRuntimeData | null;
}) {
  const { t } = useI18n();
  const guest = useIsGuest();
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
  const back = { href: guest ? categoryHref(category) : categoryPath(category), label: t(`cats.${category.key}`) };
  const toolName = t(`wf.${category.key}.${workflow.key}.name`);

  return (
    <>
      {/* THE WAY BACK, THE NAME AND THE "?" are the tool frame's one header
          row now (components/tool-frame/frame.tsx), drawn by each panel: the
          category it came from (a visitor: the catalogue itself — the
          category's own address is a member's forward) and the tool's name. */}

      {/* MINIATURKA — its own panel (photos → optional Retusz → one
          composition → 2560×2560). It exists for one workflow only, so it
          needs no per-workflow key; the two branches below keep theirs. */}
      {thumbnail && <ThumbnailWorkspace workspaceId={workspaceId} credits={credits} data={thumbnail} back={back} title={toolName} />}
      {!thumbnail && <>{tool && fashion ? (
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
          outputsPerRun={fashion.tools[workflow.key]?.outputsPerRun ?? 1}
          resolutions={fashion.resolutions}
          ratios={fashion.ratios}
          pricing={fashion.pricing}
          initialItems={fashion.tools[workflow.key]?.initialItems ?? []}
          initialCursor={fashion.tools[workflow.key]?.initialCursor ?? null}
          back={back}
          title={toolName}
        />
      ) : (
      <GeneratorWorkspace
        key={workflow.key}
        managed={{
          models, engineAvailable, sessionPreviews,
          variant: CATEGORY_VARIANT[category.key] ?? DEFAULT_VARIANT,
          initialStyle: styleHint, initialRatio: workflow.ratio, initialShots: workflow.shots,
        }}
        initialTab="grovshot"
        credits={credits}
        workspaceId={workspaceId}
        initialItems={initialItems}
        initialCursor={initialCursor}
        back={back}
        title={toolName}
      />
      )}</>}
    </>
  );
}
