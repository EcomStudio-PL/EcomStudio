import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { clampShots, runPromptSession, type PromptSessionInput } from "@/lib/server/prompt-engine";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** "PRZYGOTUJ UJĘCIA" — reference analysis + scene strategy → 5-10 hidden
 *  concepts. Auth + workspace membership via Supabase RLS. The response
 *  carries ids and counts only; prompts never leave the server. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let body: PromptSessionInput;
  try { body = (await request.json()) as PromptSessionInput; }
  catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }

  const locale = (await cookies()).get("ecs_locale")?.value ?? "pl";
  const result = await runPromptSession(supabase, user.id, workspace.id, {
    ...body,
    shots: clampShots(body.shots),
    locale,
    referencePaths: (body.referencePaths ?? []).filter(
      (p) => typeof p === "string" && p.startsWith(`${workspace.id}/`)
    ),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
