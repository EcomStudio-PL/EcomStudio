import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { trialReturnAssetId } from "@/lib/server/trial-watermark/unlock";
import { StatusView } from "@/components/checkout/status-view";

export const dynamic = "force-dynamic";

/**
 * WHERE EVERY PAYMENT ENDS, however it got there.
 *
 * A card confirmed in place navigates here. BLIK and Przelewy24 send the
 * customer to their bank and Stripe redirects them back here afterwards — to
 * the canonical grovbase.com address, because that is what `return_url` was
 * built from.
 *
 * Stripe appends its own `payment_intent` and `redirect_status` parameters on
 * that return. Both are read as HINTS ONLY: `redirect_status=succeeded` in a
 * URL is a string a customer can type, and this page grants nothing on the
 * strength of it. It is used solely to know which payment to ask the server
 * about — and the server asks Stripe and the ledger.
 *
 * A PLAN BOUGHT FROM THE TRIAL-WATERMARK PAYWALL brings the customer back to
 * their picture (R17): the server reads the caller's own latest
 * `watermark_plan_selected` event (under 24 h, a name only the server's
 * writer can record) and checks its asset is still a locked trial original
 * of this workspace. Only then does the screen offer "Wróć do zdjęcia" —
 * built from that database id, never from anything in this URL.
 */
export default async function CheckoutStatusPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/?auth=login&next=%2Fcredits");

  // `ref` is what this app put there; `payment_intent` is what Stripe adds on a
  // redirect. Either names a payment; neither proves anything about it.
  const reference = one("ref") ?? one("payment_intent") ?? null;
  const safe = reference && /^(pi|sub)_[A-Za-z0-9_]+$/.test(reference) ? reference : null;

  const workspace = await getCurrentWorkspace(supabase, user.id);
  const unlockAssetId = workspace
    ? await trialReturnAssetId(supabase, { userId: user.id, workspaceId: workspace.id })
    : null;

  return (
    <div className="mx-auto w-full max-w-2xl py-6 sm:py-10">
      <StatusView reference={safe} unlockAssetId={unlockAssetId} viewerKey={user.id} />
    </div>
  );
}
