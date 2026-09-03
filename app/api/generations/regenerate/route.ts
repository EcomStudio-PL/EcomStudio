import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { generateFromConcept } from "@/lib/server/concept-generation";
import { runGeneration } from "@/lib/server/generation";
import { QUALITIES, type AspectRatio, type Quality, type Resolution } from "@/lib/ai/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * REGENERUJ OBRAZ — one endpoint for both worlds.
 *
 * A generation born from an engine concept re-runs through the concept path
 * (hidden prompt decrypted server-side, engine surcharge included, customer
 * correction riding as an appendix). A custom-prompt generation re-runs its
 * own stored prompt with the correction appended. Either way the server owns
 * the price, the prompt and the references — the browser sends ids and, at
 * most, the customer's correction text.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let generationId = "";
  let instruction = "";
  let modelId: string | undefined;
  let markedImagePath: string | undefined;
  try {
    const body = (await request.json()) as {
      generationId?: string; instruction?: string; modelId?: string; markedImagePath?: string;
    };
    generationId = typeof body.generationId === "string" ? body.generationId : "";
    instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 500) : "";
    if (typeof body.modelId === "string" && /^[0-9a-f-]{36}$/.test(body.modelId)) modelId = body.modelId;
    // The flattened annotation image the modal just uploaded. Storage-path
    // shape only, pinned to THIS workspace's prefix — nothing outside the
    // member's own area can be referenced.
    if (typeof body.markedImagePath === "string"
      && body.markedImagePath.length <= 300
      && body.markedImagePath.startsWith(`${workspace.id}/`)
      && !body.markedImagePath.includes("..")
      && /^[\w\-./]+$/.test(body.markedImagePath)) {
      markedImagePath = body.markedImagePath;
    }
  } catch { /* validated below */ }
  if (!/^[0-9a-f-]{36}$/.test(generationId)) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  // Ownership: the row must exist inside the member's own workspace — the
  // explicit eq is belt-and-braces on top of RLS.
  const { data: gen } = await supabase
    .from("generations")
    .select("id, product_id, generation_jobs(id, prompt_id, prompt_session_id, prompt_text, prompt_origin, aspect_ratio, resolution, model_id, settings)")
    .eq("id", generationId).eq("workspace_id", workspace.id)
    .maybeSingle();
  const job = (gen as unknown as {
    generation_jobs: {
      id: string; prompt_id: string | null; prompt_session_id: string | null;
      prompt_text: string | null;
      prompt_origin: string | null; aspect_ratio: string | null;
      resolution: string | null; model_id: string | null;
      settings: { reference_paths?: unknown; inspiration_paths?: unknown; quality?: unknown } | null;
    } | null;
  } | null)?.generation_jobs;
  if (!gen || !job) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  // A retake keeps the quality the original was rendered at — on BOTH
  // branches. The server still re-validates it against whichever model
  // actually serves, so a stale or foreign value can never be forwarded.
  const jobQuality = (QUALITIES as readonly string[]).includes(String(job.settings?.quality ?? ""))
    ? (job.settings!.quality as Quality) : undefined;

  // ENGINE CONCEPT — the hidden-prompt path handles pricing (surcharge),
  // references, variation and the customer's correction. A custom-origin job
  // always re-runs its own stored prompt, even if it carries a prompt link.
  if (job.prompt_id && job.prompt_origin !== "custom") {
    const result = await generateFromConcept(supabase, user.id, workspace.id, job.prompt_id, {
      modelId, instruction: instruction || undefined, markedImagePath, quality: jobQuality,
    });
    const status = result.ok ? 200
      : result.error === "insufficient_credits" ? 402
        : result.error === "already_running" ? 409
          : result.error === "not_found" ? 404 : 400;
    return NextResponse.json(result, { status });
  }

  // CUSTOM PROMPT — re-run the customer's own stored prompt with their
  // correction appended; references come from the product's current photos.
  const basePrompt = job.prompt_text?.trim();
  if (!basePrompt) return NextResponse.json({ ok: false, error: "not_supported" }, { status: 400 });

  // One live regeneration per source job: a network replay or second tab
  // must not buy a second image (mirrors the concept path's guard, keyed on
  // the lineage this branch itself writes).
  const { data: live } = await supabase
    .from("generation_jobs").select("id")
    .eq("workspace_id", workspace.id).eq("parent_job_id", job.id)
    .in("status", ["queued", "processing"])
    .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .limit(1).maybeSingle();
  if (live) return NextResponse.json({ ok: false, error: "already_running" }, { status: 409 });

  // REFERENCES FOR THE RETAKE. The job's own recorded set comes first: a
  // generation no longer belongs to a product, so `product_images` cannot
  // rebuild it. Jobs created before that was recorded still fall back to the
  // product's photos, which is exactly the case those older rows have.
  const recorded = Array.isArray(job.settings?.reference_paths)
    ? (job.settings!.reference_paths as unknown[])
      .filter((p): p is string =>
        typeof p === "string" && p.startsWith(`${workspace.id}/`) && !p.includes(".."))
      .slice(0, 10)
    : [];
  let referencePaths: string[] = recorded;
  if (referencePaths.length === 0 && gen.product_id) {
    const { data: imgs } = await supabase
      .from("product_images")
      .select("storage_path, sort_order, products!inner(workspace_id)")
      .eq("product_id", gen.product_id)
      .eq("products.workspace_id", workspace.id)
      .order("sort_order", { ascending: true })
      .limit(10);
    referencePaths = (imgs ?? []).map((i) => i.storage_path);
  }
  // Older productless jobs still know their photos through the prompt session
  // they were written from. Reading that relation back is what keeps a retake
  // of last month's shot on the same product instead of refusing it.
  if (referencePaths.length === 0 && job.prompt_session_id) {
    const { data: session } = await supabase
      .from("prompt_sessions").select("reference_paths")
      .eq("id", job.prompt_session_id).eq("workspace_id", workspace.id)
      .maybeSingle();
    referencePaths = (session?.reference_paths ?? [])
      .filter((p) => typeof p === "string" && p.startsWith(`${workspace.id}/`) && !p.includes(".."))
      .slice(0, 10);
  }
  // The mood photos are part of what this shot looked like; a correction that
  // silently dropped them would come back in a different scene.
  const inspirationPaths = Array.isArray(job.settings?.inspiration_paths)
    ? (job.settings!.inspiration_paths as unknown[])
      .filter((p): p is string =>
        typeof p === "string" && p.startsWith(`${workspace.id}/`) && !p.includes(".."))
      .slice(0, 5)
    : [];
  // Without a single product reference the retake would be rendered from the
  // prompt alone and the product would drift — refuse instead of charging for
  // an image that cannot honour the Product Lock.
  if (referencePaths.length === 0) {
    return NextResponse.json({ ok: false, error: "references_required" }, { status: 400 });
  }

  const prompt = instruction
    ? `${basePrompt}\n\nPoprawki klienta do tego samego ujęcia (zastosuj je, ale nie zmieniaj samego produktu ani jego cech): ${instruction}`
    : basePrompt;

  const result = await runGeneration(supabase, user.id, workspace.id, {
    modelId: modelId ?? job.model_id ?? "",
    // Only a client-chosen model must pass the custom-visibility gate; the
    // job's own original model keeps working even if later hidden.
    requireCustomVisible: !!modelId,
    prompt,
    aspectRatio: (job.aspect_ratio || "1:1") as AspectRatio,
    resolution: (job.resolution ?? undefined) as Resolution | undefined,
    quality: jobQuality,
    quantity: 1,
    productId: gen.product_id ?? undefined,
    referencePaths,
    referenceImageIds: [],
    inspirationPaths,
    markedImagePath,
    parentJobId: job.id,
    promptOrigin: "custom",
  });
  return NextResponse.json(result, { status: result.ok ? 200 : result.error === "insufficient_credits" ? 402 : 400 });
}
