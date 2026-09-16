import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { previewPathFor, thumbPathFor } from "@/lib/thumbs";

export const dynamic = "force-dynamic";

/** Remove one generation: the definer RPC checks membership and deletes the
 *  rows, handing back the storage paths; the storage objects are then removed
 *  under the caller's own member delete policy on the bucket. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  // Blocked accounts keep their data — including the ability to lose it by
  // accident. Deletion is access, so it pauses too.
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
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
  const originals = (paths ?? []).filter((p): p is string => typeof p === "string" && p.length > 0);
  if (originals.length > 0) {
    // THE DERIVATIVES GO WITH THE ORIGINAL. `delete_generation` hands back the
    // rows' storage_path — the originals — but each image also has a grid
    // thumbnail and a preview beside it at a derived path. Removing only the
    // original would leave two orphans per asset in the bucket for good, and
    // the customer would keep paying for storage they asked us to free.
    // Derived paths are computed, not looked up, and removing one that was
    // never made is a no-op.
    const toRemove = originals.flatMap((p) => [p, thumbPathFor(p), previewPathFor(p)]);
    await supabase.storage.from("generation-assets").remove(toRemove);
  }
  return NextResponse.json({ ok: true });
}
