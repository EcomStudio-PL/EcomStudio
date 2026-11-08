import "server-only";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/services/audit";
import { keepCounters, layoutKey, normalizeHomeLayout } from "@/lib/home-layout";
import type { IceHomeLayout, IceResult } from "@/lib/ice/types";
import { IceRefusal, dbCode, requireIceAdmin, run, type Client } from "./core";

/**
 * „EDYTUJ STRONĘ” ON /home — THE LAYOUT (lib/home-layout.ts, 0170).
 *
 * The state the editor starts from, and its one write. Every save sends the
 * WHOLE document with the updated_at it was read at (compare-and-set: a
 * second tab's newer change is refused, never overwritten), is re-validated
 * here (whatever the browser sent becomes a valid layout or nothing), is
 * written by home_layout_write() — which also writes the history row — and
 * is audited. /home is re-rendered for everybody at its next request.
 */

export type IceHomeLayoutState = IceHomeLayout;

async function readState(supabase: Client): Promise<IceHomeLayoutState> {
  // The admin reads the table itself (its RLS: admins only).
  const { data, error } = await supabase.from("home_layout").select("doc, updated_at").eq("id", "home").maybeSingle();
  if (error) throw new IceRefusal("migration_missing");
  return { layout: normalizeHomeLayout(data?.doc ?? null), updatedAt: data?.updated_at ?? null };
}

export function homeLayoutState(): Promise<IceResult<IceHomeLayoutState>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    return readState(supabase);
  });
}

export function homeLayoutSave(input: { doc: unknown; base: string | null; action?: "save" | "restore" }): Promise<IceResult<IceHomeLayoutState>> {
  return run(async () => {
    const { supabase, adminId } = await requireIceAdmin();
    const action = input.action === "restore" ? "restore" : "save";
    const base = typeof input.base === "string" && input.base.length <= 64 ? input.base : null;
    // Validated here, whatever the editor sent: unknown sections, tools that
    // do not exist, unsafe text and links are dropped, not stored.
    const before = await readState(supabase);
    // …and a slot number once used is never handed out again (keepCounters).
    const layout = keepCounters(normalizeHomeLayout(input.doc), before.layout);
    if (layoutKey(before.layout) === layoutKey(layout) && before.updatedAt !== null) throw new IceRefusal("noop");
    const { data, error } = await supabase.rpc("home_layout_write", { p_doc: layout as never, p_base: base, p_action: action });
    if (error) {
      const code = dbCode(error.message);
      // A newer change from elsewhere: hand the editor what is there now.
      if (code === "conflict") throw new IceRefusal("conflict", await readState(supabase));
      throw new IceRefusal(code === "generic" && /home_layout_write/.test(error.message) ? "migration_missing" : code);
    }
    const updatedAt = (data as { updated_at?: string } | null)?.updated_at ?? null;
    await logAudit(supabase, {
      actorId: adminId, action: "ice.layout.saved", entityType: "home_layout", entityId: "home",
      before: { updatedAt: before.updatedAt }, after: { updatedAt, action },
    });
    revalidatePath("/home");
    return { layout, updatedAt };
  });
}
