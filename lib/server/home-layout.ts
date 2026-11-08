import "server-only";
import type { Client } from "@/lib/services/workspace";
import { defaultHomeLayout, normalizeHomeLayout, type HomeLayout } from "@/lib/home-layout";

/**
 * /HOME'S LAYOUT AS STORED (0170) — read on every /home request (the page is
 * force-dynamic and the read is one tiny row through a definer function), so a
 * save in „Edytuj stronę” is on the page at the next render: no cache to
 * invalidate, no rebuild.
 *
 * Anything that fails — the migration not applied, a read error, a document
 * the code cannot use — is the DEFAULT layout: the page exactly as the config
 * draws it, never an empty or a half page.
 */
export type StoredHomeLayout = { layout: HomeLayout; updatedAt: string | null; stored: boolean };

export async function readHomeLayout(supabase: Client): Promise<StoredHomeLayout> {
  try {
    const { data, error } = await supabase.rpc("home_layout_published");
    if (error || !data || typeof data !== "object") return { layout: defaultHomeLayout(), updatedAt: null, stored: false };
    const row = data as { doc?: unknown; updated_at?: unknown };
    return {
      layout: normalizeHomeLayout(row.doc),
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
      stored: true,
    };
  } catch {
    return { layout: defaultHomeLayout(), updatedAt: null, stored: false };
  }
}
