/**
 * IMAGE TOOLS — the catalogue of quick operations on product photos.
 *
 * Each tool declares what it does, what it costs and which provider
 * capability it needs. Availability is derived from whether a provider
 * adapter for that capability is actually configured: a tool with no working
 * backend is shown as unavailable, never as a button that pretends to work.
 * Pricing lives in `app_settings.tools` so an admin can change it without a
 * deploy.
 */

export const TOOL_SLUGS = [
  "remove_background", "white_background", "replace_background",
  "remove_object", "expand", "enhance",
] as const;
export type ToolSlug = (typeof TOOL_SLUGS)[number];

/** Provider capability a tool needs; the registry maps these to adapters. */
export type ToolCapability = "background" | "inpaint" | "outpaint" | "upscale";

export type ToolDefinition = {
  slug: ToolSlug;
  capability: ToolCapability;
  /** Default credit cost, overridable per workspace config by an admin. */
  defaultCost: number;
  /** Tools that need an extra control in the panel. */
  input?: "color" | "selection" | "ratio";
  sortOrder: number;
};

export const TOOLS: ToolDefinition[] = [
  { slug: "remove_background", capability: "background", defaultCost: 1, sortOrder: 1 },
  { slug: "white_background", capability: "background", defaultCost: 1, sortOrder: 2 },
  { slug: "replace_background", capability: "background", defaultCost: 1, input: "color", sortOrder: 3 },
  { slug: "remove_object", capability: "inpaint", defaultCost: 2, input: "selection", sortOrder: 4 },
  { slug: "expand", capability: "outpaint", defaultCost: 2, input: "ratio", sortOrder: 5 },
  { slug: "enhance", capability: "upscale", defaultCost: 2, sortOrder: 6 },
];

/** Background presets offered next to the colour picker. */
export const BACKGROUND_PRESETS = ["#FFFFFF", "#F5F5F7", "#EFE9FF", "#111827", "#0F766E", "#F59E0B"];

export const EXPAND_RATIOS = ["1:1", "4:5", "16:9", "9:16"] as const;

/**
 * Provider contract for the tools module. Nothing is registered yet — the
 * image tools need a provider that offers segmentation/inpainting, and none
 * of the configured accounts expose one. The adapter shape is fixed here so
 * plugging one in later is a registration, not a rewrite.
 */
export interface ImageToolsProvider {
  slug: string;
  capabilities: ToolCapability[];
  removeBackground(input: ToolInput): Promise<ToolOutput>;
  replaceBackground(input: ToolInput & { color: string }): Promise<ToolOutput>;
  removeObject(input: ToolInput & { instruction: string }): Promise<ToolOutput>;
  outpaint(input: ToolInput & { ratio: string }): Promise<ToolOutput>;
  enhance(input: ToolInput): Promise<ToolOutput>;
}

export type ToolInput = { base64: string; mime: string };
export type ToolOutput = { base64: string; mime: string };

/** Registered providers, keyed by slug. Empty until a real API is connected. */
const providers = new Map<string, ImageToolsProvider>();

export function registerToolsProvider(provider: ImageToolsProvider) {
  providers.set(provider.slug, provider);
}

/** The provider that can serve this capability, or null when none can. */
export function providerFor(capability: ToolCapability): ImageToolsProvider | null {
  for (const p of providers.values()) {
    if (p.capabilities.includes(capability)) return p;
  }
  return null;
}

export function toolAvailable(tool: ToolDefinition): boolean {
  return providerFor(tool.capability) !== null;
}
