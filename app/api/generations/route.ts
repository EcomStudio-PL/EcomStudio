import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listGalleryItems, type GallerySessionType } from "@/lib/server/gallery";

export const dynamic = "force-dynamic";

/** Operations a client may filter by — never a free-text column value. */
const OPERATIONS = new Set(["image_retouch", "none"]);

/** Paginated generation gallery for the signed-in member's workspace.
 *  Everything sensitive is projected away server-side — see lib/server/gallery. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  const url = new URL(request.url);
  const st = url.searchParams.get("session");
  const page = await listGalleryItems(supabase, workspace.id, {
    cursor: url.searchParams.get("cursor"),
    limit: Number(url.searchParams.get("limit")) || 24,
    sessionType: st === "advertising" || st === "lifestyle" ? (st as GallerySessionType) : null,
    favorite: url.searchParams.get("fav") === "1",
    q: url.searchParams.get("q"),
    order: url.searchParams.get("order") === "asc" ? "asc" : "desc",
    // Whitelisted: a tool asks for its own operation, the generator for none.
    operation: OPERATIONS.has(url.searchParams.get("op") ?? "") ? url.searchParams.get("op") : null,
  });
  return NextResponse.json({ ok: true, ...page }, {
    headers: { "Cache-Control": "no-store" },
  });
}
