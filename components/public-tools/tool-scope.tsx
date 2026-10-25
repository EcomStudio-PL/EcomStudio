import { createClient, getRequestUser } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { memberToolFacts, trialWatermarkLikely, type ToolAudience } from "@/lib/server/public-tools";
import { iceEditSession } from "@/lib/server/ice/session";
import type { PublicTool } from "@/lib/public-tools";
import { ToolViewerProvider } from "./tool-viewer";
import { PublicToolSeo } from "./tool-seo";

/**
 * THE VIEWER OF ONE TOOL PAGE, for the panel under it (Public Tools V1).
 *
 * A visitor (or an admin's guest preview): the visitor's facts, and under the
 * panel the tool's public block — examples, three questions, "Wypróbuj za
 * darmo" — which only visitors see.
 *
 * A member: their facts, read on the server — the welcome-bonus offer, the
 * paid-plan rule the checkout applies to top-ups, the address confirmation,
 * and whether the next paid run would carry the trial watermark. No public
 * block — except for an admin editing THIS page in "Edytuj stronę", who sees
 * it with every example frame, filled or not, so each can be filled.
 */
export async function ToolScope({ tool, audience, children }: {
  tool: PublicTool;
  audience: ToolAudience;
  children: React.ReactNode;
}) {
  if (audience.kind === "guest") {
    return (
      <ToolViewerProvider value={{ tool: tool.key, path: tool.path, facts: { kind: "guest", preview: audience.preview }, trialWatermark: false }}>
        {children}
        <PublicToolSeo tool={tool} />
      </ToolViewerProvider>
    );
  }
  const supabase = await createClient();
  const user = await getRequestUser();
  const workspace = user ? await getCurrentWorkspace(supabase, user.id) : null;
  // iceEditSession is an admin's only (and never during a guest preview).
  const editing = (await iceEditSession())?.path === tool.path;
  const block = editing ? <PublicToolSeo tool={tool} editing /> : null;
  if (!user || !workspace) return <>{children}{block}</>;
  const [facts, watermark] = await Promise.all([
    memberToolFacts(supabase, user, workspace),
    trialWatermarkLikely(supabase, workspace.id),
  ]);
  return (
    <ToolViewerProvider value={{
      tool: tool.key, path: tool.path, facts, trialWatermark: watermark,
      ...(facts.emailVerified || !user.email ? {} : { email: user.email }),
    }}>
      {children}
      {block}
    </ToolViewerProvider>
  );
}
