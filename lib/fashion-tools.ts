/**
 * MODA — the four image-to-image tools, described once.
 *
 * These are NOT the category's prompt presets. A preset hands the generator a
 * framing and a style directive and lets the seller write the brief; a tool
 * takes the seller's own photographs and does one specific job to them. Both
 * live in the Moda category and both switch through WorkflowRuntime, so the
 * difference has to be a property of the workflow rather than a second route,
 * a second layout system or a second menu.
 *
 * WHY ONE CONFIG AND NOT FOUR COMPONENTS. Three of these tools are the same
 * panel with a different job behind it — one upload block, a size, a framing,
 * an optional hint, a price and a button. Copying that panel three times would
 * mean three places to fix a padding, and three chances for them to drift into
 * looking like three different products. The panel is therefore ONE component
 * driven by the `slots` and the three `show*` flags below; what stays separate
 * is what genuinely differs per tool — its name, its prompt, its price row,
 * its results and its URL.
 *
 * "Zmiana postaci" is the one that is really different: two DISTINCT pools of
 * photographs, a garment reference and the person who should be wearing it.
 * Those must never be mixed into one list, because the server has to know
 * which is which. That is expressed here as two slots, not as a second
 * component.
 *
 * This module is client-safe on purpose — the panel imports it. It carries no
 * prompts, no model identifiers and NO PRICES; all three are operator-managed
 * and are resolved server-side (lib/server/fashion.ts). The price in
 * particular comes from the model row the operator configured, so changing it
 * is an edit in the admin panel and never a deploy.
 */

/** The pools of photographs a tool accepts. `source` is the single-input
 *  case; `reference` + `model` is the pair. */
export type FashionSlotKey = "source" | "reference" | "model";

export type FashionSlot = {
  key: FashionSlotKey;
  /** How many photographs this pool takes. */
  max: number;
  /** i18n key for the block heading, rendered with `{n}`. */
  labelKey: string;
  /** i18n key for the wording inside the big dropzone. Absent keeps the
   *  default "Import", which is right when a tool has only one pool. */
  zoneLabelKey?: string;
  /** Whether a run may start without anything in this pool. */
  required: boolean;
};

export type FashionToolConfig = {
  /** Workflow key inside the Moda category, and the last URL segment. */
  key: string;
  /** Key in the admin tool registry (lib/services/ai-tools.ts) — the row that
   *  owns this tool's prompt, its engine mode and its model choice. */
  toolKey: string;
  /** Written into generation_jobs.settings so each tool's results are its own
   *  in the gallery, the library and the cost log. */
  operation: string;
  slots: readonly FashionSlot[];
  /** Controls this tool offers. Absent controls are absent from the panel —
   *  "Zmiana postaci" has no resolution and no hint because its reference
   *  screenshot has neither, and a control that decides nothing is worse than
   *  no control at all. */
  showResolution: boolean;
  showFormat: boolean;
  showHint: boolean;
  /** Preselected framing. "auto" means "follow the source photograph". */
  defaultFormat: string;
};

/** The hint textarea's ceiling. Matches the reference panel's `0 / 1000`. */
export const FASHION_HINT_MAX = 1000;

/** One photograph pool, single-input tools. The reference panel says 200. */
const SOURCE_SLOT: FashionSlot = {
  key: "source", max: 200, labelKey: "fashion.slot.source", required: true,
};

/**
 * The three tools that share the single-input panel. Everything except `key`,
 * `toolKey` and `operation` is identical BY DESIGN — that is
 * what makes one component correct for all three.
 */
const SINGLE_INPUT = {
  slots: [SOURCE_SLOT],
  showResolution: true,
  showFormat: true,
  showHint: true,
  defaultFormat: "1:1",
} as const;

export const FASHION_TOOLS: readonly FashionToolConfig[] = [
  {
    key: "ghostMannequin",
    toolKey: "fashion_ghost_mannequin",
    operation: "fashion_ghost_mannequin",
    ...SINGLE_INPUT,
  },
  {
    // The Moda category already had a `flatlay` preset and the brief is
    // explicit that an existing slug wins over a new one. The key is reused,
    // so old links and bookmarks land on the tool that now owns the job.
    key: "flatlay",
    toolKey: "fashion_flat_lay",
    operation: "fashion_flat_lay",
    ...SINGLE_INPUT,
  },
  {
    key: "iron",
    toolKey: "fashion_iron",
    operation: "fashion_iron",
    ...SINGLE_INPUT,
  },
  {
    key: "changePerson",
    toolKey: "fashion_change_person",
    operation: "fashion_change_person",
    // TWO POOLS, NEVER ONE. The garment and the person are different inputs
    // with different meanings, and the server is told which is which.
    slots: [
      { key: "reference", max: 10, labelKey: "fashion.slot.reference", zoneLabelKey: "fashion.zone.reference", required: true },
      { key: "model", max: 10, labelKey: "fashion.slot.model", zoneLabelKey: "fashion.zone.model", required: true },
    ],
    // No resolution and no hint: neither appears on this tool's reference.
    showResolution: false,
    showFormat: true,
    showHint: false,
    defaultFormat: "auto",
  },
] as const;

export const FASHION_TOOL_BY_KEY = new Map(FASHION_TOOLS.map((tool) => [tool.key, tool]));

/** Whether a Moda workflow key is one of the tools rather than a preset. */
export function fashionTool(key: string | undefined | null): FashionToolConfig | null {
  if (!key) return null;
  return FASHION_TOOL_BY_KEY.get(key) ?? null;
}

/** Every operation tag the tools write, for the library's filters. */
export const FASHION_OPERATIONS: readonly string[] = FASHION_TOOLS.map((tool) => tool.operation);
