import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { runPromptSession, type PromptSessionInput } from "@/lib/server/prompt-engine";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** "GENERUJ 5 PROMPTÓW" — real reference analysis + scene strategy.
 *  Auth + workspace membership via Supabase RLS. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let body: PromptSessionInput;
  try { body = (await request.json()) as PromptSessionInput; }
  catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }

  const result = await runPromptSession(supabase, user.id, workspace.id, {
    ...body,
    referencePaths: (body.referencePaths ?? []).filter(
      (p) => typeof p === "string" && p.startsWith(`${workspace.id}/`)
    ),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
