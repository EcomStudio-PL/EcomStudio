/**
 * MODA — the five image-to-image tools, described once.
 *
 * These are NOT the category's prompt presets. A preset hands the generator a
 * framing and a style directive and lets the seller write the brief; a tool
 * takes the seller's own photographs and does one specific job to them. Both
 * live in the Moda category and both switch through WorkflowRuntime, so the
 * difference has to be a property of the workflow rather than a second route,
 * a second layout system or a second menu.
 *
 * WHY ONE CONFIG AND NOT FIVE COMPONENTS. Three of these tools are the same
 * panel with a different job behind it — one upload block, a size, a framing,
 * an optional hint, a price and a button. Copying that panel three times would
 * mean three places to fix a padding, and three chances for them to drift into
 * looking like three different products. The panel is therefore ONE component
 * driven by the `slots` and the flags below; what stays separate is what
 * genuinely differs per tool — its name, its prompt, its price row, its
 * results and its URL.
 *
 * TWO of them take a PAIR of photographs. "Zmiana postaci" takes a garment and
 * the person who should be wearing it; "Zmiana twarzy modela" takes a finished
 * photograph and the face to put on the person already in it. Neither pair may
 * be mixed into one list, because the server has to know which is which — and
 * the two tools must not be collapsed into one either, because the second
 * photograph means something different in each. That is expressed here as two
 * configs with two slots, not as a second component and not as a switch inside
 * one tool.
 *
 * The two pairs also do NOT look the same, and that is configuration rather
 * than an accident: see `numberedSteps` and `denseZones`.
 *
 * This module is client-safe on purpose — the panel imports it. It carries no
 * prompts, no model identifiers and NO PRICES; all three are operator-managed
 * and are resolved server-side (lib/server/fashion.ts). The price in
 * particular comes from the model row the operator configured, so changing it
 * is an edit in the admin panel and never a deploy.
 */

/** The pools of photographs a tool accepts. `source` is the single-input
 *  case; `reference` + `model` and `reference` + `face` are the pairs.
 *
 *  `model` and `face` are NOT the same pool under two names. "Zmiana postaci"
 *  takes a garment and the person who should wear it; "Zmiana twarzy modela"
 *  takes a finished photograph and the face to put on the person already in
 *  it. Different second input, different instruction, different tool — and
 *  keeping the keys apart is what lets the server, the prompt and the history
 *  say which is which. */
export type FashionSlotKey = "source" | "reference" | "model" | "face";

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
  /** Show the "what the AI will do" card under the controls. On where the
   *  tool's reference panel has it; the copy is the tool's own `aiNote`, and
   *  its `sub` when it has not been given one. */
  showAiNote: boolean;
  /**
   * NUMBER THE BLOCKS — "1. Dodaj zdjęcie referencyjne", "2. …", "3. Format".
   *
   * A PER-TOOL DECISION, and deliberately not a global one. Numbering was
   * removed from "Zmiana postaci" on purpose: both of its pools are required,
   * neither can be filled before the other, so the numbers taught an order
   * that does not exist while pushing the pool's capacity off the heading.
   *
   * "Zmiana twarzy modela" is briefed with it and its reference panel shows
   * it, so it gets it HERE rather than by reviving the shared behaviour the
   * other tool just had removed. Numbered mode also moves the wording: the
   * heading carries the instruction and the box keeps the plain "Import" plus
   * its counter, which is where the capacity then lives.
   */
  numberedSteps: boolean;
  /**
   * THE COMPACT UPLOAD BOX — smaller desktop padding, no "0 / 10 zdjęć" line.
   *
   * Was derived from `slots.length > 1`, on the reasoning that a panel with
   * two dropzones cannot give each the room a panel with one gives its only
   * one. That is still true, but it turned out not to be the whole story: two
   * dual-pool tools can want different boxes, because the counter is
   * redundant only when the HEADING already carries the capacity. Numbered
   * mode moves the capacity into the box, so the box has to keep it.
   *
   * So it is an explicit choice per tool, not an inference from the shape.
   */
  denseZones: boolean;
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
  showAiNote: false,
  numberedSteps: false,
  // One pool, one box: the generous zone with its counter, exactly as these
  // three tools' own reference panel shows it.
  denseZones: false,
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
    // NO HINT FIELD, AND ONLY HERE.
    //
    // Ironing is the one job in this set that takes no direction. The other
    // two ask the seller for something the photograph cannot say — which
    // garment to keep, how to lay it out — while "remove the creases" is the
    // whole instruction; an empty box above the CTA invited a sentence that
    // changed nothing and made the panel look like it wanted one.
    //
    // This is a flag on THIS tool, not an edit to the shared panel. The three
    // single-input tools deliberately spread one config object, so deleting
    // the textarea from tool-workspace.tsx would have taken it from
    // Niewidzialny manekin and Leżący produkt as well. The panel already
    // renders the block behind `config.showHint` and already sends
    // `hint: undefined` when it is off, so nothing downstream changes: the
    // tool's own published prompt is what runs, exactly as before.
    showHint: false,
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
    // NO "WHAT THE AI WILL DO" CARD EITHER. It was added when this tool got
    // numbered steps, and it repeated the tool's own description — a sentence
    // the seller had already read on the card they clicked to get here. It
    // also cost about 96px (the card plus the section gap above it) on a panel
    // that had none to spare, so a paragraph explaining the tool was sitting
    // where the tool's one CONTROL should be. The desktop reference shows the
    // panel ending at Format, and so does this.
    showAiNote: false,
    // NO NUMBERS. Both pools are required and neither can be supplied before
    // the other, so there is no sequence to teach — see `numberedSteps`.
    numberedSteps: false,
    // The compact box: the heading already reads "(max. 10)", and with two
    // dropzones stacked in a viewport-locked column the generous padding was
    // spending 292px of a 393px panel on emptiness.
    denseZones: true,
    defaultFormat: "auto",
  },
  {
    // ZMIANA TWARZY MODELA — the fifth tool, and the second dual-pool one.
    //
    // NOT A VARIANT OF "Zmiana postaci", even though the panels rhyme. That
    // tool moves a GARMENT onto a chosen person; this one keeps the whole
    // photograph — the clothes, the pose, the set, the light — and replaces
    // only the face. Different job, different instruction, different prompt
    // row, its own history. The shared panel renders both because the SHAPE
    // is the same, which is exactly what the config is for.
    key: "changeFace",
    toolKey: "fashion_change_face",
    operation: "fashion_change_face",
    slots: [
      // `reference` is the photograph being edited; `face` is the person whose
      // face goes into it. The order is the order the provider sees them, so
      // the operator's prompt may say "the first image" and "the second
      // image" and be right.
      { key: "reference", max: 10, labelKey: "fashion.slot.reference", zoneLabelKey: "fashion.zone.reference", required: true },
      { key: "face", max: 10, labelKey: "fashion.slot.face", zoneLabelKey: "fashion.zone.face", required: true },
    ],
    // One control, as its reference panel shows: no size, no instruction box.
    showResolution: false,
    showFormat: true,
    showHint: false,
    // …and one explanation, because "we will fit the face to the light and the
    // perspective" is not something the panel says anywhere else.
    showAiNote: true,
    numberedSteps: true,
    denseZones: false,
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
