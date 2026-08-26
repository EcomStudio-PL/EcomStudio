import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { normalizeResolution } from "@/lib/server/prompt-engine";

export const dynamic = "force-dynamic";

const RATIOS = new Set(["1:1", "4:5", "16:9", "9:16"]);
const MAX_PROMPTS = 10;
const MAX_REFS = 8;

/**
 * "WŁASNE PROMPTY" — the customer writes 1-10 prompts themselves. No scene
 * planner, no analysis, no hidden-prompt fee: the session is ready the moment
 * it is saved. Each prompt becomes a normal card that generates through the
 * same model-choice + billing pipeline, at the model's BASE credit price.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let body: {
    productId?: string; productName?: string; description?: string; extraInfo?: string;
    aspectRatio?: string; resolution?: string; referencePaths?: string[]; prompts?: string[];
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }

  const name = body.productName?.trim() ?? "";
  const ratio = body.aspectRatio ?? "1:1";
  const referencePaths = (body.referencePaths ?? [])
    .filter((p) => typeof p === "string" && p.startsWith(`${workspace.id}/`))
    .slice(0, MAX_REFS);
  const prompts = (body.prompts ?? [])
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length >= 3)
    .slice(0, MAX_PROMPTS);

  if (name.length < 2 || !RATIOS.has(ratio)) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  if (referencePaths.length === 0) return NextResponse.json({ ok: false, error: "references_required" }, { status: 400 });
  if (prompts.length === 0) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });

  // Product: reuse or create — identical contract to the engine flow, and
  // edits made in the form persist on the product itself.
  let productId = body.productId ?? null;
  if (productId) {
    const { data: product } = await supabase
      .from("products").select("id").eq("id", productId).eq("workspace_id", workspace.id).maybeSingle();
    if (!product) return NextResponse.json({ ok: false, error: "product_not_found" }, { status: 404 });
    await supabase.from("products")
      .update({ name, description: body.description?.trim() || null, extra_info: body.extraInfo?.trim() || null })
      .eq("id", productId).eq("workspace_id", workspace.id);
  } else {
    const { data: created, error } = await supabase.from("products").insert({
      workspace_id: workspace.id, owner_id: user.id, name,
      description: body.description?.trim() || null, extra_info: body.extraInfo?.trim() || null,
      status: "ready",
    }).select("id").single();
    if (error || !created) return NextResponse.json({ ok: false, error: "product_create_failed" }, { status: 400 });
    productId = created.id;
    await supabase.from("product_images").insert(
      referencePaths.map((path, i) => ({
        product_id: created.id, storage_path: path, sort_order: i, is_primary: i === 0,
      }))
    );
  }

  const { data: session, error: sessionError } = await supabase.from("prompt_sessions").insert({
    workspace_id: workspace.id, user_id: user.id, product_id: productId,
    product_name: name,
    description: body.description?.trim() || null,
    extra_info: body.extraInfo?.trim() || null,
    aspect_ratio: ratio,
    resolution: normalizeResolution(body.resolution),
    reference_paths: referencePaths,
    status: "ready",
    mode: "custom",
  }).select("id").single();
  if (sessionError || !session) return NextResponse.json({ ok: false, error: "session_create_failed" }, { status: 400 });

  const allRefs = referencePaths.map((_, i) => i + 1);
  const rows = prompts.map((prompt, idx) => ({
    product_id: productId!, workspace_id: workspace.id, session_id: session.id,
    concept_name: `Shot ${idx + 1}`, shot_type: "custom", scene_type: null,
    customer_title: `Ujęcie ${idx + 1}`,
    customer_description: null,
    // The customer's own prompt is THEIR text: stored in clear, editable.
    prompt_text: prompt, negative_prompt: null,
    prompt_origin: "custom",
    prompt_encrypted: null, prompt_iv: null, prompt_tag: null,
    primary_reference: 1,
    supporting_references: [] as never,
    reference_indices: allRefs,
    reference_image_ids: [], reference_rationale: null,
    format: ratio, style: null,
    priority: idx + 1, status: "ready" as const, lock_strength: "LOW",
  }));
  const { error: insertError } = await supabase.from("generated_prompts").insert(rows);
  if (insertError) return NextResponse.json({ ok: false, error: "session_create_failed" }, { status: 400 });

  await supabase.rpc("log_activity", {
    p_workspace_id: workspace.id, p_action: "prompts.custom_created",
    p_entity_type: "prompt_session", p_entity_id: session.id,
    p_metadata: { prompts: rows.length, images: referencePaths.length },
  });
  return NextResponse.json({ ok: true, sessionId: session.id, productId, promptCount: rows.length });
}
