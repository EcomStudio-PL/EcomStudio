import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { buildZip } from "@/lib/server/zip";
import { readSets, usedVersion, zipName } from "@/lib/server/grovshot-shot/sets";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GROVBASE SHOT — "Pobierz zestaw (ZIP)": the version each shot uses, in the
 * gallery's order, named 01_hero.png, 02_uzycie.png… (the file's real type).
 * Only the member's own set; files fetched through short-lived signed URLs.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });
  const sets = await readSets(supabase, workspace.id, 30);
  const set = sets?.find((s) => s.id === id);
  if (!set) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const picks = set.shots.map((s) => ({ shot: s, v: usedVersion(s) })).filter((x) => x.v);
  if (picks.length === 0) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { data: signed } = await supabase.storage.from("generation-assets").createSignedUrls(picks.map((x) => x.v!.path), 600);
  const files: { name: string; data: Uint8Array }[] = [];
  for (const [i, x] of picks.entries()) {
    const url = signed?.[i]?.signedUrl;
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (res.ok) files.push({ name: zipName(x.shot.n, x.shot.kind, x.v!.path), data: new Uint8Array(await res.arrayBuffer()) });
    } catch { /* skip an unreachable file, keep the rest */ }
  }
  if (files.length === 0) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 502 });
  const day = set.createdAt.slice(0, 10);
  const slug = (set.product ?? "zestaw").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "zestaw";
  return new NextResponse(Buffer.from(buildZip(files)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="grovbase-${slug}-${day}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
