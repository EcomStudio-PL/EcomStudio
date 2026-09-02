import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { runGeneration, type GenerateInput } from "@/lib/server/generation";
import { QUALITIES, type Quality } from "@/lib/ai/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Real generation endpoint. Auth + workspace membership via Supabase RLS;
 *  the server recomputes cost and owns the whole charge/refund lifecycle. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let body: GenerateInput;
  try { body = (await request.json()) as GenerateInput; }
  catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }

  // WHITELISTED input — this endpoint serves the customer's own prompt
  // ("Własny prompt"), so billing-relevant fields are never read from the
  // body: no costOverride, no hidePromptText, no fallback chain, no
  // concept/session lineage (a custom job must never point at an engine
  // concept), and the origin is pinned to "custom" (base price, prompt
  // stored in clear on the job as the customer's own words).
  const result = await runGeneration(supabase, user.id, workspace.id, {
    modelId: String(body.modelId ?? ""),
    prompt: String(body.prompt ?? ""),
    negative: typeof body.negative === "string" ? body.negative : undefined,
    aspectRatio: body.aspectRatio,
    resolution: body.resolution,
    // Whitelisted here, validated against the model's declared qualities
    // inside runGeneration — never priced from the client's number.
    quality: typeof body.quality === "string" && (QUALITIES as readonly string[]).includes(body.quality)
      ? (body.quality as Quality) : undefined,
    quantity: Number(body.quantity) || 1,
    // The generator no longer creates or requires a product: only free-text
    // context travels, and `newProduct` is deliberately NOT read from the
    // body so this endpoint can never write to the catalogue.
    productDescription: typeof body.productDescription === "string" ? body.productDescription.slice(0, 2000) : undefined,
    promptOrigin: "custom",
    requireCustomVisible: true,
    referencePaths: (body.referencePaths ?? []).filter((p) => typeof p === "string" && p.startsWith(`${workspace.id}/`)),
    referenceImageIds: (body.referenceImageIds ?? []).filter((x) => typeof x === "string"),
    inspirationPaths: (body.inspirationPaths ?? []).filter((p) => typeof p === "string" && p.startsWith(`${workspace.id}/`)).slice(0, 5),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
