import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { toolCatalogue } from "@/lib/server/image-tools";
import { CompressWorkbench } from "@/components/tools/compress-workbench";

export const dynamic = "force-dynamic";

/**
 * COMPRESS — its own screen, one step above `/tools/compress` as the generic
 * workbench renders it.
 *
 * Same tool underneath: the "compress" catalogue row, the same price, the same
 * sharp call. What the dedicated surface adds is the reporting — weight
 * before, weight after, and what the whole batch saved — which the generic
 * workbench has no room for. This static segment sits in front of `[slug]`, so
 * `/tools/compress` lands here and every other slug still falls through to the
 * shared page.
 *
 * Availability and cost are read from `toolCatalogue` rather than assumed:
 * a local tool costs nothing today, but the number on the button comes from
 * the catalogue, so the day an operator prices it the screen tells the truth
 * by itself.
 */
export default async function CompressPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");

  const [catalogue, wallet] = await Promise.all([
    toolCatalogue(supabase),
    getWallet(supabase, workspace.id),
  ]);
  // Same guard as the resize screen: a missing catalogue row degrades to an
  // honest "unavailable", never to a crash.
  const entry = catalogue.find((c) => c.slug === "compress")
    ?? { slug: "compress" as const, kind: "local" as const, available: false, credits: 0, providerLabel: null, reason: "maintenance" as const };

  return (
    // The same workspace ground the resize screen, the generator and the
    // editor stand on: inside it every surface resolves to the flat near-black
    // `--workspace-*` ramp, so the violet glass wash is gone and magenta is
    // left where it means something.
    <div className="workspace workspace-page gen-shell pt-1">
      {/* No title bar — the same reason the resize screen lost its: the row
          repeated the menu, the panel and the button. The price lives on the
          cost card, next to the decision it belongs to. */}
      <CompressWorkbench
        available={entry.available}
        credits={entry.credits}
        reason={entry.reason}
        balance={wallet?.balance ?? 0}
      />
    </div>
  );
}
