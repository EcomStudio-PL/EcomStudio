import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;

/**
 * Card-level settings the CUSTOMER may change:
 * - modelId: the image-model override for this one card (null clears it);
 * - promptText: the prompt body — allowed ONLY on the customer's own
 *   custom cards. GrovBase prompts are never writable (or readable) here.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let body: { promptId?: string; modelId?: string | null; promptText?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }
  const promptId = body.promptId ?? "";
  if (!UUID.test(promptId)) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });

  const { data: card } = await supabase
    .from("generated_prompts").select("id, workspace_id, prompt_origin")
    .eq("id", promptId).eq("workspace_id", workspace.id).maybeSingle();
  if (!card) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const patch: { model_id?: string | null; prompt_text?: string } = {};
  if (body.modelId !== undefined) {
    if (body.modelId === null) patch.model_id = null;
    else {
      if (!UUID.test(body.modelId)) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
      const { data: model } = await supabase
        .from("ai_models").select("id, active, type, ai_providers!inner(active)")
        .eq("id", body.modelId).eq("active", true).eq("type", "image").eq("ai_providers.active", true)
        .maybeSingle();
      if (!model) return NextResponse.json({ ok: false, error: "model_unavailable" }, { status: 400 });
      patch.model_id = body.modelId;
    }
  }
  if (typeof body.promptText === "string") {
    if (card.prompt_origin !== "custom") return NextResponse.json({ ok: false, error: "not_editable" }, { status: 403 });
    const text = body.promptText.trim();
    if (text.length < 3 || text.length > 4000) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
    patch.prompt_text = text;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });

  const { error } = await supabase.from("generated_prompts").update(patch).eq("id", promptId);
  if (error) return NextResponse.json({ ok: false, error: "save_failed" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
