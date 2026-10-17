import { toolSlotKey, workflowSlotKey } from "@/lib/media-slots";
import { GUIDE_MAX_STEPS, guideSlotKey, type GuideToolKey } from "@/lib/tool-guides";

/*
 * Kept apart from lib/tool-guides.ts on purpose: the catalogue's slot keys
 * come from lib/media-slots, which carries the whole category and tool-card
 * catalogue — weight every tool screen's gallery would otherwise download
 * for keys only the server and the admin section read.
 */

/**
 * The picture a starter gallery shows when the admin chose none: the tool's
 * own catalogue picture — the one already approved for the /tools card — so
 * the default is a real, signed-off image and never a stock photo claiming an
 * output. A tool whose card has no picture falls back to the drawn showcase.
 */
export const STARTER_FALLBACK_SLOTS: Record<GuideToolKey, readonly string[]> = {
  prompts: [toolSlotKey("generator")],
  generator: [toolSlotKey("custom")],
  retouch: [toolSlotKey("retouch")],
  ecommerce_thumbnail: [workflowSlotKey("ecommerce", "thumbnail")],
  fashion_ghost_mannequin: [workflowSlotKey("moda", "ghostMannequin")],
  fashion_flat_lay: [workflowSlotKey("moda", "flatlay")],
  fashion_iron: [workflowSlotKey("moda", "iron")],
  fashion_change_person: [workflowSlotKey("moda", "changePerson")],
  fashion_change_face: [workflowSlotKey("moda", "changeFace")],
  tool_remove_bg: [toolSlotKey("remove_bg")],
  tool_white_bg: [toolSlotKey("background"), toolSlotKey("white_bg")],
  tool_ai_background: [toolSlotKey("ai_background")],
  tool_ai_shadow: [toolSlotKey("shadow"), toolSlotKey("ai_shadow")],
  resize: [toolSlotKey("resize")],
  compress: [toolSlotKey("compress")],
  // No starter gallery on these screens (guideHasStarter); listed so every
  // guide key has its catalogue picture on record.
  editor: [toolSlotKey("editor"), toolSlotKey("adjust")],
  tool_upscale: [toolSlotKey("upscale")],
  tool_expand: [toolSlotKey("expand")],
  tool_watermark: [toolSlotKey("watermark")],
};

/** Every picture key one tool's guide can read (≤ 7, far below the
 *  resolver's 200-key bound), plus the starter's catalogue fallback. */
export function guideImageKeys(tool: GuideToolKey): string[] {
  return [
    ...Array.from({ length: GUIDE_MAX_STEPS }, (_, i) => guideSlotKey(tool, "tutorial", i + 1)),
    guideSlotKey(tool, "starter", 1),
    ...STARTER_FALLBACK_SLOTS[tool],
  ];
}
