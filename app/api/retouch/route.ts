import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { runRetouch } from "@/lib/server/retouch";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * RETUSZ ZDJĘĆ — one image per request.
 *
 * The browser uploads the photo to its own workspace prefix and sends the
 * PATH; the prompt, the model and the price are the server's business and
 * none of the three appears in the request or the response. A batch is the
 * client calling this once per photo, so one failure refunds and reports
 * only itself.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  // The user comes from the session, never from the body.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let sourcePath = "";
  let resolution: string | undefined;
  let format: string | undefined;
  try {
    const body = (await request.json()) as { sourcePath?: string; resolution?: string; format?: string };
    sourcePath = typeof body.sourcePath === "string" ? body.sourcePath : "";
    if (typeof body.resolution === "string") resolution = body.resolution.slice(0, 8);
    if (typeof body.format === "string") format = body.format.slice(0, 12);
  } catch { /* validated below */ }

  // Storage-path shape only, pinned to THIS workspace's own area: a member
  // cannot ask the tool to read a file outside it.
  const valid = sourcePath.length > 0 && sourcePath.length <= 300
    && sourcePath.startsWith(`${workspace.id}/`)
    && !sourcePath.includes("..")
    && /^[\w\-./]+$/.test(sourcePath);
  if (!valid) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });

  const result = await runRetouch(supabase, user.id, workspace.id, { sourcePath, resolution, format });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
