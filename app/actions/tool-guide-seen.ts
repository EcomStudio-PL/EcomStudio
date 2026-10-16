"use server";
import { createClient } from "@/lib/supabase/server";
import { publishedGuide } from "@/lib/server/tool-guides-published";
import { markSeen } from "@/lib/services/tool-guides";
import { isGuideTool } from "@/lib/tool-guides";

type Result = { ok: true } | { ok: false; error: string };

/**
 * "This user has seen this tool's tutorial." Called when the tutorial opens
 * by itself — not when it closes — so leaving the page mid-tutorial does not
 * bring it back on every visit. The VERSION comes from the server's own
 * published guide, never from the browser, and the write is the user's own
 * preferences row (RLS) merged in one statement.
 */
export async function markToolTutorialSeenAction(tool: string): Promise<Result> {
  if (!isGuideTool(tool)) return { ok: false, error: "unknown_tool" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  const version = (await publishedGuide(tool))?.version ?? 1;
  return (await markSeen(supabase, tool, version)) ? { ok: true } : { ok: false, error: "generic" };
}
