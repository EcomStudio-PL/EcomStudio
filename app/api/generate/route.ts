import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { runGeneration, type GenerateInput } from "@/lib/server/generation";

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

  const result = await runGeneration(supabase, user.id, workspace.id, {
    ...body,
    referencePaths: (body.referencePaths ?? []).filter((p) => typeof p === "string" && p.startsWith(`${workspace.id}/`)),
    referenceImageIds: (body.referenceImageIds ?? []).filter((x) => typeof x === "string"),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
