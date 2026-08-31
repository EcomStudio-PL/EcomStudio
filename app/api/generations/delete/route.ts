import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";

export const dynamic = "force-dynamic";

/** Remove one generation: the definer RPC checks membership and deletes the
 *  rows, handing back the storage paths; the storage objects are then removed
 *  under the caller's own member delete policy on the bucket. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let generationId = "";
  try {
    const body = (await request.json()) as { generationId?: string };
    generationId = typeof body.generationId === "string" ? body.generationId : "";
  } catch { /* validated below */ }
  if (!/^[0-9a-f-]{36}$/.test(generationId)) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const { data: paths, error } = await supabase.rpc("delete_generation", { gen_id: generationId });
  if (error) {
    const status = /not_found/.test(error.message) ? 404 : 400;
    return NextResponse.json({ ok: false, error: "not_found" }, { status });
  }
  const toRemove = (paths ?? []).filter((p): p is string => typeof p === "string" && p.length > 0);
  if (toRemove.length > 0) {
    await supabase.storage.from("generation-assets").remove(toRemove);
  }
  return NextResponse.json({ ok: true });
}
