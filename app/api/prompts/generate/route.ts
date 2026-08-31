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
    sessionType: body.sessionType === "advertising" || body.sessionType === "lifestyle"
      ? body.sessionType : undefined,
    // Brief contents are sanitized again inside the engine; here only the
    // shape is constrained so a hostile body cannot smuggle anything odd.
    shotBriefs: Array.isArray(body.shotBriefs)
      ? body.shotBriefs.slice(0, 10).map((b) => ({
        text: typeof b?.text === "string" ? b.text.slice(0, 400) : undefined,
        keepFraming: b?.keepFraming === true,
        refIndex: Number.isInteger(b?.refIndex) ? (b!.refIndex as number) : undefined,
      }))
      : undefined,
    referencePaths: (body.referencePaths ?? []).filter(
      (p) => typeof p === "string" && p.startsWith(`${workspace.id}/`)
    ),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
