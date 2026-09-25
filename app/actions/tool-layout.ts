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

async function currentRow(supabase: Supa) {
  const { data } = await supabase
    .from("app_settings").select("value, updated_at").eq("key", TOOLS_LAYOUT_KEY).maybeSingle();
  return data;
}

async function write(supabase: Supa, layout: ToolsLayout): Promise<string | null> {
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from("app_settings").upsert(
    { key: TOOLS_LAYOUT_KEY, value: layout, updated_at: updatedAt },
    { onConflict: "key" },
  );
  if (error) return null;
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
    const row = await currentRow(supabase);
    if ((row?.updated_at ?? null) !== baseUpdatedAt) return { ok: false, error: "conflict" };
    const layout = normalizeLayout(input);
    const updatedAt = await write(supabase, layout);
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
    const row = await currentRow(supabase);
    const layout = normalizeLayout(row?.value);
    layout.flags[itemKey] = { tools: flags.tools === true, menu: flags.menu === true, start: flags.start === true };
    const updatedAt = await write(supabase, layout);
    if (!updatedAt) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "tools_layout.flags", entityType: "catalog_item", entityId: itemKey,
      after: layout.flags[itemKey],
    });
    return { ok: true, updatedAt };
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
