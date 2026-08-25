import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { buildZip } from "@/lib/server/zip";

export const dynamic = "force-dynamic";

/**
 * Multi-select "download as ZIP" for the Library. The caller sends storage
 * paths; every path is verified against the caller's OWN workspace assets
 * (RLS-scoped selects — the filter can only narrow), then the files are
 * fetched via short-lived signed URLs and packed store-only. Nothing here
 * widens access: a path outside the workspace simply never matches.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { paths?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }
  const requested = Array.isArray(body.paths)
    ? body.paths.filter((p): p is string => typeof p === "string").slice(0, 60)
    : [];
  if (requested.length === 0) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });

  // Ownership check: keep only paths that exist among this workspace's
  // generation assets or tool results.
  const [{ data: assets }, { data: tools }] = await Promise.all([
    supabase.from("generation_assets")
      .select("storage_path, generations!inner(workspace_id)")
      .in("storage_path", requested)
      .eq("generations.workspace_id", workspace.id),
    supabase.from("tool_results")
      .select("storage_path")
      .in("storage_path", requested)
      .eq("workspace_id", workspace.id),
  ]);
  const allowed = [...new Set([
    ...(assets ?? []).map((a) => a.storage_path),
    ...(tools ?? []).map((t) => t.storage_path),
  ])];
  if (allowed.length === 0) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const { data: signed } = await supabase.storage.from("generation-assets").createSignedUrls(allowed, 600);
  const files: { name: string; data: Uint8Array }[] = [];
  let index = 0;
  for (const s of signed ?? []) {
    if (!s.signedUrl || !s.path) continue;
    try {
      const res = await fetch(s.signedUrl);
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      const base = s.path.split("/").pop() ?? `plik-${index}`;
      index += 1;
      files.push({ name: `${String(index).padStart(2, "0")}-${base}`, data: buf });
    } catch { /* skip unreachable file, keep the rest */ }
  }
  if (files.length === 0) return NextResponse.json({ ok: false, error: "provider_error" }, { status: 502 });

  const zip = buildZip(files);
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="ecomstudio-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
