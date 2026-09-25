"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { TOOLS_LAYOUT_KEY } from "@/lib/server/tool-layout";
import { catalogItem } from "@/lib/tool-cards";
import { normalizeLayout, type LayoutFlags, type ToolsLayout } from "@/lib/tool-layout";

/**
 * THE CATALOGUE LAYOUT — admin writes.
 *
 * One JSON document in `app_settings` (`tools_layout`). Every write goes
 * through `normalizeLayout`, so what is stored is only ever sections and items
 * the code knows, with a flag set for every item — never a key a client made
 * up. The layout decides presentation only: nothing here touches a tool's
 * route, engine, model, credits, prompt or status.
 */

type Result = { ok: true; updatedAt: string | null } | { ok: false; error: "forbidden" | "conflict" | "invalid" | "generic" };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("forbidden");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("forbidden");
  return { supabase, adminId: user.id };
}

type Supa = Awaited<ReturnType<typeof requireAdmin>>["supabase"];

/** The stored row, or `null` when there is none. A failed read is NOT "no
 *  row": treating it so would write the default over an admin's layout. */
async function currentRow(supabase: Supa): Promise<{ ok: true; row: { value: unknown; updated_at: string } | null } | { ok: false }> {
  const { data, error } = await supabase
    .from("app_settings").select("value, updated_at").eq("key", TOOLS_LAYOUT_KEY).maybeSingle();
  return error ? { ok: false } : { ok: true, row: data };
}

/**
 * Write the layout only if the stored version is still `base` (null: no row
 * yet). The check and the write are one statement — an insert that a second
 * insert cannot pass, or an update conditioned on `updated_at` — so two saves
 * racing each other cannot both succeed.
 */
async function writeIf(supabase: Supa, layout: ToolsLayout, base: string | null): Promise<string | "conflict" | null> {
  const updatedAt = new Date().toISOString();
  if (base === null) {
    const { error } = await supabase.from("app_settings")
      .insert({ key: TOOLS_LAYOUT_KEY, value: layout, updated_at: updatedAt });
    if (error) return error.code === "23505" ? "conflict" : null;
  } else {
    const { data, error } = await supabase.from("app_settings")
      .update({ value: layout, updated_at: updatedAt })
      .eq("key", TOOLS_LAYOUT_KEY).eq("updated_at", base)
      .select("key");
    if (error) return null;
    if (!data || data.length === 0) return "conflict";
  }
  // /tools, the menus in every layout and the Start page all read it.
  revalidatePath("/", "layout");
  return updatedAt;
}

/**
 * Save the whole layout — the "Układ narzędzi" editor's Save. `baseUpdatedAt`
 * is the version the editor loaded: when the stored one has moved on since
 * (another admin, or a flag switched on the tool's own row), the save is
 * refused rather than silently undoing that change.
 */
export async function saveToolsLayoutAction(input: unknown, baseUpdatedAt: string | null): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const layout = normalizeLayout(input);
    const updatedAt = await writeIf(supabase, layout, baseUpdatedAt);
    if (updatedAt === "conflict") return { ok: false, error: "conflict" };
    if (!updatedAt) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "tools_layout.saved", entityType: "app_settings", entityId: TOOLS_LAYOUT_KEY,
      after: {
        sections: layout.sections.map((s) => `${s.key}${s.visible ? "" : "(hidden)"}:${s.items.length}`).join(","),
      },
    });
    return { ok: true, updatedAt };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/**
 * Switch one item's three flags — used from the tool's own row on the
 * "Narzędzia i silniki" screen. Read, change that one entry, write: the rest
 * of the layout is left exactly as stored.
 */
export async function setItemFlagsAction(itemKey: string, flags: LayoutFlags): Promise<Result> {
  try {
    if (!catalogItem(itemKey)) return { ok: false, error: "invalid" };
    const { supabase, adminId } = await requireAdmin();
    const next: LayoutFlags = { tools: flags.tools === true, menu: flags.menu === true, start: flags.start === true };
    // Read, change this one entry, write if nobody wrote in between — and if
    // somebody did, start again from what they stored, so neither change is lost.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await currentRow(supabase);
      if (!current.ok) return { ok: false, error: "generic" };
      const layout = normalizeLayout(current.row?.value);
      layout.flags[itemKey] = next;
      const updatedAt = await writeIf(supabase, layout, current.row?.updated_at ?? null);
      if (updatedAt === "conflict") continue;
      if (!updatedAt) return { ok: false, error: "generic" };
      await logAudit(supabase, {
        actorId: adminId, action: "tools_layout.flags", entityType: "catalog_item", entityId: itemKey, after: next,
      });
      return { ok: true, updatedAt };
    }
    return { ok: false, error: "conflict" };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/** Back to the layout the product ships with: the stored row is removed. */
export async function resetToolsLayoutAction(): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { error } = await supabase.from("app_settings").delete().eq("key", TOOLS_LAYOUT_KEY);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/", "layout");
    await logAudit(supabase, {
      actorId: adminId, action: "tools_layout.reset", entityType: "app_settings", entityId: TOOLS_LAYOUT_KEY,
    });
    // No stored row: the shipped default is in force again.
    return { ok: true, updatedAt: null };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}
