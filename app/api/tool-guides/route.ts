import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { viewerIsAdmin } from "@/lib/server/feature-availability";
import { hasToolResults, hasUsedTool, readSeenVersion } from "@/lib/services/tool-guides";
import { loadFormatUses, loadGuide, loadReorderHint, toolIsLive } from "@/lib/server/tool-guides";
import { isGuideTool, type GuideResponse } from "@/lib/tool-guides";

export const dynamic = "force-dynamic";

/**
 * ONE TOOL'S GUIDE, FOR THE SIGNED-IN VIEWER: the tutorial and starter
 * gallery in their language (published copy, pictures as public URLs), the
 * tutorial version they have seen, whether the tool is live for them,
 * whether their workspace already has results in that tool's gallery, and
 * whether they themselves have used the tool before.
 *
 * Asked for by the gallery itself, after it has painted — so a tool page (the
 * frozen Retusz page included) needs no change and waits for nothing. Reads
 * only; costs nothing; no model, provider or credit is involved.
 */
export async function GET(request: Request) {
  const tool = new URL(request.url).searchParams.get("tool");
  if (!isGuideTool(tool)) return NextResponse.json({ ok: false, error: "unknown_tool" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const [locale, workspace, admin] = await Promise.all([
    getLocale(),
    getCurrentWorkspace(supabase, user.id),
    viewerIsAdmin(supabase),
  ]);
  const [guide, seen, live, hasResults, usedBefore, reorderHint, formatUses] = await Promise.all([
    loadGuide(supabase, tool, locale),
    readSeenVersion(supabase, user.id, tool),
    toolIsLive(supabase, tool, { admin }),
    workspace ? hasToolResults(supabase, workspace.id, tool) : Promise.resolve(null),
    workspace ? hasUsedTool(supabase, workspace.id, user.id, tool) : Promise.resolve(null),
    loadReorderHint(tool, locale),
    loadFormatUses(tool, locale),
  ]);

  const body: GuideResponse = {
    guide, seen, live, hasResults, usedBefore,
    ...(reorderHint !== undefined ? { reorderHint } : {}),
    ...(formatUses ? { formatUses } : {}),
  };
  return NextResponse.json({ ok: true, ...body }, { headers: { "Cache-Control": "no-store" } });
}
