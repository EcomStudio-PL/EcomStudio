import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { countGalleryResults, listGalleryItems, type GallerySessionType } from "@/lib/server/gallery";
import { GALLERY_PAGE_SIZE } from "@/lib/gallery-page";
import { FASHION_OPERATIONS } from "@/lib/fashion-tools";

export const dynamic = "force-dynamic";

/** Operations a client may filter by — never a free-text column value. The
 *  Moda tools' own operations are on the list too (each tool's gallery pages
 *  through its own results, and counts them). */
const OPERATIONS = new Set(["image_retouch", "ecommerce_thumbnail", "none", ...FASHION_OPERATIONS]);

/** Paginated generation gallery for the signed-in member's workspace.
 *  Everything sensitive is projected away server-side — see lib/server/gallery. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  const url = new URL(request.url);
  // Whitelisted: a tool asks for its own operation, the generator for none.
  const op = OPERATIONS.has(url.searchParams.get("op") ?? "") ? url.searchParams.get("op") : null;
  // "Wyniki (24)" on a tool's phone view: the count alone, no rows.
  if (url.searchParams.get("count") === "1") {
    const total = await countGalleryResults(supabase, workspace.id, op);
    return NextResponse.json({ ok: total !== null, total }, { headers: { "Cache-Control": "no-store" } });
  }
  const st = url.searchParams.get("session");
  const page = await listGalleryItems(supabase, workspace.id, {
    cursor: url.searchParams.get("cursor"),
    limit: Number(url.searchParams.get("limit")) || GALLERY_PAGE_SIZE,
    sessionType: st === "advertising" || st === "lifestyle" ? (st as GallerySessionType) : null,
    favorite: url.searchParams.get("fav") === "1",
    q: url.searchParams.get("q"),
    order: url.searchParams.get("order") === "asc" ? "asc" : "desc",
    operation: op,
    // The library's two shelves. Anything else is ignored rather than passed
    // through — this reaches a column value.
    assetType: url.searchParams.get("type") === "video" ? "video"
      : url.searchParams.get("type") === "image" ? "image" : null,
  });
  return NextResponse.json({ ok: true, ...page }, {
    headers: { "Cache-Control": "no-store" },
  });
}
