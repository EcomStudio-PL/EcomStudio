import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { toolBySlug, MAX_UPLOAD_BYTES } from "@/lib/images/tools";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Keep a tool result.
 *
 * Storage is deliberately lazy: a run returns bytes to the browser and stores
 * nothing, so a seller who tries ten watermark settings costs us ten CPU
 * seconds and zero storage. Only an explicit "save" writes a file, and it
 * goes to the bucket that matches the destination — the product gallery when
 * the result belongs to a product, the workspace library otherwise. Both
 * buckets are private and keyed by workspace in their first path segment,
 * which is exactly what their RLS policies check.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ ok: false, error: "image_too_large" }, { status: 413 });

  const tool = toolBySlug(String(form.get("tool") ?? ""));
  if (!tool) return NextResponse.json({ ok: false, error: "unknown_tool" }, { status: 400 });
  const productId = typeof form.get("productId") === "string" ? String(form.get("productId")) : "";

  const mime = file.type || "image/png";
  const ext = mime.includes("webp") ? "webp" : mime.includes("jpeg") ? "jpg" : "png";
  const bytes = Buffer.from(await file.arrayBuffer());
  const id = crypto.randomUUID();

  if (productId) {
    // Membership is enforced by RLS on both the select and the insert.
    const { data: product } = await supabase
      .from("products").select("id").eq("id", productId).eq("workspace_id", workspace.id).maybeSingle();
    if (!product) return NextResponse.json({ ok: false, error: "product_not_found" }, { status: 404 });

    const path = `${workspace.id}/${productId}/${id}.${ext}`;
    const { error } = await supabase.storage.from("product-images")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (error) return NextResponse.json({ ok: false, error: "storage_failed" }, { status: 500 });

    const { count } = await supabase
      .from("product_images").select("id", { count: "exact", head: true }).eq("product_id", productId);
    const { error: rowError } = await supabase.from("product_images").insert({
      product_id: productId, storage_path: path, sort_order: count ?? 0,
      is_primary: (count ?? 0) === 0,
      metadata: { source: "tool", tool: tool.slug, mime, bytes: bytes.length } as never,
    });
    if (rowError) {
      await supabase.storage.from("product-images").remove([path]);
      return NextResponse.json({ ok: false, error: "storage_failed" }, { status: 500 });
    }
    await supabase.rpc("log_activity", {
      p_workspace_id: workspace.id, p_action: "tool.saved_to_product",
      p_entity_type: "product", p_entity_id: productId, p_metadata: { tool: tool.slug },
    });
    return NextResponse.json({ ok: true, target: "product", path });
  }

  const path = `${workspace.id}/tools/${id}.${ext}`;
  const { error } = await supabase.storage.from("generation-assets")
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (error) return NextResponse.json({ ok: false, error: "storage_failed" }, { status: 500 });

  const { error: rowError } = await supabase.from("tool_results").insert({
    workspace_id: workspace.id, user_id: user.id, tool_slug: tool.slug,
    storage_path: path, mime_type: mime, file_size: bytes.length,
  });
  if (rowError) {
    await supabase.storage.from("generation-assets").remove([path]);
    return NextResponse.json({ ok: false, error: "storage_failed" }, { status: 500 });
  }
  await supabase.rpc("log_activity", {
    p_workspace_id: workspace.id, p_action: "tool.saved_to_library",
    p_entity_type: "tool_result", p_metadata: { tool: tool.slug },
  });
  return NextResponse.json({ ok: true, target: "library", path });
}
