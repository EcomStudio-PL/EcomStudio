import "server-only";
import { cache } from "react";
import type { Client } from "@/lib/services/workspace";
import { DEFAULT_LAYOUT, normalizeLayout, type ToolsLayout } from "@/lib/tool-layout";

/**
 * THE CATALOGUE LAYOUT — server read. One row of `app_settings`
 * (key `tools_layout`), readable by every visitor under the table's existing
 * public-read policy and written only by admins (app/actions/tool-layout.ts).
 *
 * Failure posture, the same as the availability switchboard's: a missing,
 * malformed or unreadable row is the shipped default. A configuration outage
 * must never empty the catalogue.
 */
export const TOOLS_LAYOUT_KEY = "tools_layout";

export type StoredLayout = {
  layout: ToolsLayout;
  /** When the stored row last changed — null while the default is in force.
   *  The editor sends it back so a save cannot silently overwrite a newer one. */
  updatedAt: string | null;
};

export const readToolsLayout = cache(async (supabase: Client): Promise<StoredLayout> => {
  try {
    const { data, error } = await supabase
      .from("app_settings").select("value, updated_at").eq("key", TOOLS_LAYOUT_KEY).maybeSingle();
    if (error || !data) return { layout: DEFAULT_LAYOUT, updatedAt: null };
    return { layout: normalizeLayout(data.value), updatedAt: data.updated_at };
  } catch {
    return { layout: DEFAULT_LAYOUT, updatedAt: null };
  }
});

/** The layout for rendering — /tools, the menus, the Start page. */
export async function getToolsLayout(supabase: Client): Promise<ToolsLayout> {
  return (await readToolsLayout(supabase)).layout;
}
