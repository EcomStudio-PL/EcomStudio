import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { signImageUrls } from "@/lib/services/images";
import { retouchedJobId, retouchedRef } from "@/lib/thumbnail/reuse";

export const dynamic = "force-dynamic";

/**
 * WHAT THIS IMAGE WAS MADE FROM — the product references, the inspiration
 * photos and the marked-guidance copy one generation was rendered with,
 * signed on demand for the details view.
 *
 * On demand because a gallery page carries up to 24 cards with up to 15
 * source photos each; signing those with every page would multiply the
 * storage calls by an order of magnitude for thumbnails almost nobody opens.
 *
 * Nothing here widens access: the generation must sit in the caller's own
 * workspace, only storage paths under that workspace's prefix are ever
 * signed, and the job's prompt columns are not selected at all.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  const generationId = new URL(request.url).searchParams.get("generationId") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(generationId)) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const { data: gen } = await supabase
    .from("generations")
    .select("id, generation_jobs(settings, reference_image_ids, prompt_id, prompt_session_id)")
    .eq("id", generationId).eq("workspace_id", workspace.id)
    .maybeSingle();
  const job = (gen as unknown as {
    generation_jobs: {
      settings: {
        reference_paths?: unknown; inspiration_paths?: unknown; marked_path?: unknown;
        operation?: unknown; retouch?: unknown; retouched_paths?: unknown;
      } | null;
      reference_image_ids: string[] | null;
      prompt_id: string | null;
      prompt_session_id: string | null;
    } | null;
  } | null)?.generation_jobs;
  if (!gen || !job) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  // A path is signable only when it is a plain storage key inside THIS
  // workspace's own area — anything else is dropped, never reported.
  const prefix = `${workspace.id}/`;
  const safe = (p: unknown): p is string =>
    typeof p === "string" && p.length <= 300 && p.startsWith(prefix) && !p.includes("..") && /^[\w\-./]+$/.test(p);
  const clean = (v: unknown, cap: number): string[] => Array.isArray(v) ? v.filter(safe).slice(0, cap) : [];

  let references = clean(job.settings?.reference_paths, 10);
  const inspirations = clean(job.settings?.inspiration_paths, 5);
  const marked = safe(job.settings?.marked_path) ? job.settings!.marked_path as string : null;

  // Rows from the catalogue era remembered product-image ids, not paths.
  if (references.length === 0 && (job.reference_image_ids?.length ?? 0) > 0) {
    const { data: images } = await supabase
      .from("product_images")
      .select("storage_path")
      .in("id", job.reference_image_ids!.slice(0, 10));
    references = clean((images ?? []).map((i) => i.storage_path), 10);
  }

  /**
   * JOBS OLDER THAN THE `reference_paths` SETTING still know exactly which
   * photos they used — through the prompt session they were planned from.
   * The session keeps the uploaded reference paths and the concept keeps the
   * 1-based indices the planner routed to that shot, so this is the recorded
   * relation being read back, not a guess: without it every shot made before
   * that setting existed claims it used no product photo at all.
   */
  let recovered = false;
  if (references.length === 0 && job.prompt_session_id) {
    const { data: session } = await supabase
      .from("prompt_sessions")
      .select("reference_paths")
      .eq("id", job.prompt_session_id).eq("workspace_id", workspace.id)
      .maybeSingle();
    const sessionPaths = clean(session?.reference_paths, 15);
    if (sessionPaths.length > 0) {
      let picked = sessionPaths;
      if (job.prompt_id) {
        const { data: concept } = await supabase
          .from("generated_prompts")
          .select("reference_indices")
          .eq("id", job.prompt_id).eq("workspace_id", workspace.id)
          .maybeSingle();
        const indices = concept?.reference_indices ?? [];
        if (indices.length > 0) {
          const byIndex = indices
            .map((n) => sessionPaths[n - 1])
            .filter((p): p is string => typeof p === "string");
          if (byIndex.length > 0) picked = byIndex;
        }
      }
      references = picked.slice(0, 10);
      recovered = references.length > 0;
    }
  }

  /*
    MINIATURKA — the photos after Retusz („Zdjęcia po retuszu”). A run with
    Packshot AI ON recorded them as `retouched_paths` (the Retusz jobs' files,
    in the order of its photos); a run that was GIVEN retouched photos holds
    them as `retouched:<job>` references among its photos. Either way each is
    looked up as a Retusz job of THIS workspace with its file in the library —
    a photo since deleted simply is not listed. Each comes back with the
    reference the form sends (never a path the browser could change), the
    original it was retouched from (so the form can put it in that photo's
    place) and signed pictures.
  */
  const isThumbnail = job.settings?.operation === "ecommerce_thumbnail";
  const rawRefs = Array.isArray(job.settings?.reference_paths) ? job.settings!.reference_paths as unknown[] : [];
  const carriedIds = isThumbnail ? rawRefs.map(retouchedJobId).filter((x): x is string => !!x) : [];
  const fromRun = isThumbnail && job.settings?.retouch === true && Array.isArray(job.settings?.retouched_paths)
    ? (job.settings!.retouched_paths as unknown[]).filter(safe).map((p) => p.split("/")[1] ?? "").filter((id) => /^[0-9a-f-]{36}$/.test(id))
    : [];
  const retouchIds = [...new Set([...fromRun, ...carriedIds])].slice(0, 16);
  type RetouchFile = { jobId: string; original: string | null; path: string; thumb: string | null };
  const retouchFiles: RetouchFile[] = [];
  if (retouchIds.length > 0) {
    const { data: rjobs } = await supabase.from("generation_jobs")
      .select("id, settings, generations(generation_assets(storage_path, metadata))")
      .in("id", retouchIds).eq("workspace_id", workspace.id);
    const byId = new Map((rjobs ?? []).map((r) => [r.id, r as unknown as {
      id: string; settings: { operation?: unknown; reference_paths?: unknown } | null;
      generations: { generation_assets: { storage_path: string; metadata: unknown }[] | null }[] | null;
    }]));
    for (const id of retouchIds) {
      const r = byId.get(id);
      if (!r || r.settings?.operation !== "image_retouch") continue;
      const asset = (r.generations ?? []).flatMap((g) => g.generation_assets ?? []).find((a) => safe(a.storage_path));
      if (!asset) continue;
      const refs = Array.isArray(r.settings?.reference_paths) ? r.settings!.reference_paths as unknown[] : [];
      const thumb = (asset.metadata as { thumb?: unknown } | null)?.thumb;
      retouchFiles.push({
        jobId: id, original: safe(refs[0]) ? refs[0] : null, path: asset.storage_path,
        thumb: safe(thumb) ? thumb : null,
      });
    }
  }
  // The photos this run was given that were retouched ones: shown among its
  // input photos too (signed from the library, where they live).
  const carriedPaths = carriedIds.map((id) => retouchFiles.find((f) => f.jobId === id)?.path).filter((p): p is string => !!p);

  const all = [...new Set([...references, ...inspirations, ...(marked ? [marked] : [])])];
  const signed = all.length > 0 ? await signImageUrls(supabase, all, 3600) : new Map<string, string>();
  const libraryPaths = [...new Set([...retouchFiles.flatMap((f) => [f.path, ...(f.thumb ? [f.thumb] : [])]), ...carriedPaths])];
  if (libraryPaths.length > 0) {
    const { data: s2 } = await supabase.storage.from("generation-assets").createSignedUrls(libraryPaths, 3600);
    s2?.forEach((x) => { if (x.signedUrl && x.path) signed.set(x.path, x.signedUrl); });
  }
  const urls = (paths: string[]) => paths.map((p) => signed.get(p)).filter((u): u is string => !!u);

  /**
   * "No reference photos" and "we never wrote down what this used" are
   * different answers, and the view must not print the first when it means
   * the second. A job records `reference_paths` (even as an empty list) from
   * the moment the generator started keeping them; anything before that, with
   * nothing recoverable, is simply unknown.
   */
  const known = Array.isArray(job.settings?.reference_paths)
    || (job.reference_image_ids?.length ?? 0) > 0
    || recovered;

  return NextResponse.json({
    ok: true,
    known,
    references: urls([...references, ...carriedPaths]),
    inspirations: urls(inspirations),
    marked: marked ? signed.get(marked) ?? null : null,
    retouched: retouchFiles.flatMap((f) => {
      const url = signed.get(f.path);
      return url ? [{ ref: retouchedRef(f.jobId), original: f.original, url, thumbUrl: (f.thumb && signed.get(f.thumb)) || url }] : [];
    }),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
