import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { generateFromConcept } from "@/lib/server/concept-generation";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Generate (or regenerate) ONE concept's photograph.
 *
 * The browser sends nothing but the concept id. The prompt is decrypted, the
 * model is chosen and the references are resolved entirely on the server, so
 * the response can stay honest and minimal: a job id, the image URLs and the
 * credits charged. "Generuj wszystkie" is this same endpoint driven by the
 * client with limited concurrency — one failed shot never sinks the batch,
 * and each result appears the moment it exists.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let conceptId = "";
  let modelId: string | undefined;
  try {
    const body = (await request.json()) as { conceptId?: string; modelId?: string };
    conceptId = typeof body.conceptId === "string" ? body.conceptId : "";
    if (typeof body.modelId === "string" && /^[0-9a-f-]{36}$/.test(body.modelId)) modelId = body.modelId;
  } catch { /* fall through to validation */ }
  if (!/^[0-9a-f-]{36}$/.test(conceptId)) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const result = await generateFromConcept(supabase, user.id, workspace.id, conceptId, { modelId });
  const status = result.ok ? 200
    : result.error === "insufficient_credits" ? 402
      : result.error === "already_running" ? 409
        : result.error === "not_found" ? 404 : 400;
  return NextResponse.json(result, { status });
}
