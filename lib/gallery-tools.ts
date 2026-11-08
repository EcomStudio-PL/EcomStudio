/**
 * GALLERY PER TOOL — the ONE mapping of a tool to the modes (tabs) it owns.
 *
 * A mode is what `generation_jobs.tool_mode` records for every job (0169:
 * derived in the database from fields only the server writes — the route's
 * slot, the operation, the engine, the prompt origin). A TOOL's gallery lists
 * the results of all of its modes together; the Library lists everything.
 *
 * Used by the server (lib/server/gallery.ts, /api/generations — the query
 * filters `tool_mode in (modes)`, so pages, counts, favourites and the session
 * tabs stay inside the tool) and by the client (which tool a gallery asks for,
 * whose in-progress tiles it shows). A new tool needs one entry here; nothing
 * else decides what a gallery shows. The client only ever names a TOOL — never
 * a list of modes — and an unknown tool is refused.
 *
 * `operation` is the legacy name a tool's gallery used to send (`?op=`): kept,
 * so a page or client written before this still lands on its own tool.
 */
import { FASHION_TOOLS } from "@/lib/fashion-tools";
import { THUMBNAIL_OPERATION, THUMBNAIL_TOOL_KEY } from "@/lib/thumbnail/config";

export type GalleryTool = {
  /** The modes whose results this tool's gallery shows (`generation_jobs.tool_mode`). */
  modes: readonly string[];
  /** The `settings.operation` its gallery filtered by before 0169, if any. */
  operation?: string;
};

export const GALLERY_TOOLS: Readonly<Record<string, GalleryTool>> = {
  /** The studio: GrovBase Shot 1.0 (`prompts`) + Stwórz zdjęcie (`generator`)
   *  — one tool, two tabs, one gallery. The category presets (/k/…) are the
   *  same GrovBase Shot engine and share it. */
  grovbase_shot: { modes: ["prompts", "generator"] },
  /** Retusz zdjęć. */
  retouch: { modes: ["retouch"], operation: "image_retouch" },
  /** Miniaturka. */
  [THUMBNAIL_TOOL_KEY]: { modes: [THUMBNAIL_TOOL_KEY], operation: THUMBNAIL_OPERATION },
  /** The Moda tools: tool key = mode = operation, by design (lib/fashion-tools.ts). */
  ...Object.fromEntries(FASHION_TOOLS.map((t) => [t.toolKey, { modes: [t.toolKey], operation: t.operation }])),
};

/** A tool id — checked against GALLERY_TOOLS at runtime (isGalleryTool) wherever
 *  it comes from outside the code (a query string). The Moda tools' ids come
 *  from their own config, so this is a string, not a closed union. */
export type GalleryToolId = string;

export function isGalleryTool(id: unknown): id is GalleryToolId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(GALLERY_TOOLS, id);
}

/** The modes of a tool (a copy; never a list a caller supplied). */
export function galleryModes(tool: GalleryToolId): string[] {
  const t = isGalleryTool(tool) ? GALLERY_TOOLS[tool] : null;
  return t ? [...t.modes] : [];
}

/** The tool a legacy `?op=` belongs to (null: not a tool's operation). */
export function galleryToolForOperation(operation: string | null | undefined): GalleryToolId | null {
  if (!operation) return null;
  for (const [id, t] of Object.entries(GALLERY_TOOLS) as [GalleryToolId, GalleryTool][]) {
    if (t.operation === operation) return id;
  }
  return null;
}

/** The tool that owns a mode (an in-progress tile's `tool`, a job's `tool_mode`). */
export function galleryToolForMode(mode: string | null | undefined): GalleryToolId | null {
  if (!mode) return null;
  for (const [id, t] of Object.entries(GALLERY_TOOLS) as [GalleryToolId, GalleryTool][]) {
    if (t.modes.includes(mode)) return id;
  }
  return null;
}
