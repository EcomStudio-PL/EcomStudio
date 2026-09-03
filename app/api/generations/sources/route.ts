import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { signImageUrls } from "@/lib/services/images";

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
      settings: { reference_paths?: unknown; inspiration_paths?: unknown; marked_path?: unknown } | null;
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

  const all = [...new Set([...references, ...inspirations, ...(marked ? [marked] : [])])];
  const signed = all.length > 0 ? await signImageUrls(supabase, all, 3600) : new Map<string, string>();
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
    references: urls(references),
    inspirations: urls(inspirations),
    marked: marked ? signed.get(marked) ?? null : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
