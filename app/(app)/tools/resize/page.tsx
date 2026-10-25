import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { toolCatalogue } from "@/lib/server/image-tools";
import { ResizeWorkbench } from "@/components/tools/resize-workbench";
import { ToolScope } from "@/components/public-tools/tool-scope";
import { guestReadClient, publicToolAudience } from "@/lib/server/public-tools";
import { publicToolMetadata } from "@/lib/server/public-tool-meta";
import { publicToolByKey } from "@/lib/public-tools";

const TOOL = publicToolByKey("resize")!;

/** Title, description, canonical, robots — Public Tools V1. */
export function generateMetadata() {
  return publicToolMetadata(TOOL);
}

export const dynamic = "force-dynamic";

/**
 * RESIZE — its own screen, one step above `/tools/format`.
 *
 * Scaling a whole shoot is the operation sellers repeat most, so it gets a
 * batch surface of its own instead of a preset buried in the format tool's
 * settings rail. The tool underneath IS "format": the same catalogue row, the
 * same price, the same sharp call — which is why availability and cost are
 * read from `toolCatalogue` here rather than assumed to be free. A local tool
 * costs nothing today, but the number on the button comes from the catalogue,
 * so the day an operator prices it the screen tells the truth by itself.
 */
export default async function ResizePage() {
  // Public Tools V1: a visitor (or an admin's guest preview) gets the same
  // workbench, priced by the same catalogue, with no wallet behind it.
  const audience = await publicToolAudience(TOOL.path);
  if (audience.kind === "guest") {
    const reader = guestReadClient();
    const guestCatalogue = reader ? await toolCatalogue(reader) : [];
    const guestEntry = guestCatalogue.find((c) => c.slug === "format")
      ?? { slug: "format" as const, kind: "local" as const, available: false, credits: 0, providerLabel: null, reason: "maintenance" as const };
    return (
      <ToolScope tool={TOOL} audience={audience}>
        <div className="workspace workspace-page gen-shell pt-1">
          <ResizeWorkbench available={guestEntry.available} credits={guestEntry.credits} reason={guestEntry.reason} balance={0} />
        </div>
      </ToolScope>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");

  const [catalogue, wallet] = await Promise.all([
    toolCatalogue(supabase),
    getWallet(supabase, workspace.id),
  ]);
  // A lookup that "cannot fail" is exactly how the editor page crashed. If the
  // catalogue ever comes back without this row, the screen says the tool is
  // unavailable — it does not throw the customer into the error boundary.
  const entry = catalogue.find((c) => c.slug === "format")
    ?? { slug: "format" as const, kind: "local" as const, available: false, credits: 0, providerLabel: null, reason: "maintenance" as const };

  return (
    <ToolScope tool={TOOL} audience={audience}>
    {/* WORKSPACE GROUND — the same class the generator, the editor and Retusz
        already carry. Inside it the surface tokens resolve to the flat
        near-black ramp (`--workspace-*`), so this screen loses the violet glass
        wash without a single page-local colour: magenta survives where it means
        something — the chosen resolution, focus, the CTA. */}
    <div className="workspace workspace-page gen-shell pt-1">
      {/*
        No title bar. "Narzędzia → Zmiana rozmiaru → Za darmo → Przeskaluj
        wiele zdjęć naraz" was a row that repeated what the menu, the panel
        and the button already say; the seller opens this screen to work, and
        the workspace is what they get. The price still leads — it is on the
        cost card above the button, where the decision is made.
      */}
      <ResizeWorkbench
        available={entry.available}
        credits={entry.credits}
        reason={entry.reason}
        balance={wallet?.balance ?? 0}
      />
    </div>
    </ToolScope>
  );
}
