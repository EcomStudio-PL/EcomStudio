import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { absoluteUrl } from "@/lib/site";
import { PageHeader } from "@/components/ui/page-header";
import { quoteCheckout, type CheckoutRequest } from "@/lib/server/checkout";
import { stripePublishableKey } from "@/lib/stripe/publishable";
import { normaliseCode } from "@/lib/server/grovnews-billing";
import { CheckoutView } from "@/components/checkout/checkout-view";

export const dynamic = "force-dynamic";

/**
 * ONE CHECKOUT FOR ALL THREE THINGS GROVBASE SELLS.
 *
 * A plan, a credit pack and an arbitrary top-up are three different products
 * and one transaction. Building three checkouts would mean three places to fix
 * a VAT field, three places a total could be computed differently, and three
 * pages to keep in step with the design. So the URL names WHAT, and everything
 * after that is shared:
 *
 *     /checkout?kind=subscription&plan=<uuid>&period=monthly
 *     /checkout?kind=package&pack=<uuid>
 *     /checkout?kind=credits&n=2500
 *     /checkout?kind=subscription&plan=<uuid>&period=monthly&code=GROV-XXXX-XXXX
 *     /checkout?kind=grovnews
 *
 * THE QUERY STRING IS AN INTENT, NOT A PRICE. Every parameter above names a
 * row or a quantity. There is no amount in the URL, and none is accepted — a
 * customer editing the address bar can change WHAT they are buying (to another
 * real, active, correctly priced thing) and never what it costs.
 *
 * The page is priced on the SERVER before anything renders, so the summary a
 * customer reads is the server's own figure, and the PaymentIntent created a
 * moment later is priced by the same function a second time.
 */
export default async function CheckoutPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // The app layout already guards this, but a checkout is worth its own line:
  // a signed-out visitor must never reach a page that creates a payment.
  if (!user) redirect("/?auth=login&next=%2Fplan");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/plan");

  const parsed = parseRequest(one);
  if (!parsed) redirect("/plan");

  // THE HOSTED FALLBACK (no publishable key) sells what it always sold, and
  // only that: a plan without a code, a pack, credits. GrovNews and a launch
  // code need the embedded sheet, so without the key they are not offered —
  // rather than shown at one price and charged at another.
  const publishableKey = stripePublishableKey();
  if (!publishableKey && parsed.kind === "grovnews") redirect("/settings");
  const request: CheckoutRequest = !publishableKey && parsed.kind === "subscription"
    ? { kind: "subscription", planId: parsed.planId, period: parsed.period }
    : parsed;

  const priced = await quoteCheckout(supabase, workspace, request);
  const { dict } = await getDictionary();
  const t = makeT(dict);

  // A REFUSAL IS NOT A CHECKOUT. Sending someone to a payment form for
  // something that cannot be sold — a withdrawn pack, a plan whose price has
  // not proved it reached Stripe — and only then telling them, wastes the one
  // moment they had decided to pay. Back to /plan with the reason (GrovNews:
  // back to its card in the settings).
  if (!priced.ok) {
    redirect(request.kind === "grovnews"
      ? "/settings"
      : `/plan?checkout=${encodeURIComponent(priced.reason)}`);
  }

  // The customer's OWN launch code, offered on a monthly plan checkout. Read
  // through grovnews_my_state(), which answers for the session user only.
  let launchCode: string | null = null;
  if (publishableKey && request.kind === "subscription" && request.period !== "annual" && !request.code) {
    const { data: gn } = await supabase.rpc("grovnews_my_state");
    const code = (gn as { launch?: { code?: string | null } | null } | null)?.launch?.code;
    launchCode = typeof code === "string" ? code : null;
  }

  const { data: invoice } = await supabase
    .from("billing_profiles")
    .select("company_name, vat_id, address_line, postal_code, city, country, billing_email")
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        overline={t("nav.groups.account")}
        title={t("checkout.title")}
        sub={t("checkout.sub")}
      />
      <CheckoutView
        quote={priced.quote}
        request={request as unknown as Record<string, unknown>}
        publishableKey={publishableKey}
        launchCode={launchCode}
        // CANONICAL, ALWAYS. A redirect method sends the customer back to
        // whatever this says, and a Vercel deployment hostname would drop them
        // on a URL that is not the product, with a cookie domain that is not
        // theirs. `absoluteUrl` is pinned to the site URL for exactly this.
        returnUrl={absoluteUrl("/checkout/status")}
        invoice={invoice ?? null}
        customerEmail={user.email ?? null}
        customerName={workspace.name ?? null}
      />
    </div>
  );
}

/** The URL, turned into the one shape the pricing code accepts. */
function parseRequest(one: (k: string) => string | undefined): CheckoutRequest | null {
  const kind = one("kind");
  if (kind === "package") {
    const packageId = one("pack");
    return packageId ? { kind: "credit_package", packageId } : null;
  }
  if (kind === "credits") {
    const n = Number(one("n"));
    // Integer-only, here and again on the server. A fractional or absurd value
    // is refused rather than rounded — a silently adjusted quantity is a
    // purchase the customer did not choose.
    return Number.isSafeInteger(n) && n > 0 ? { kind: "custom_credits", credits: n } : null;
  }
  if (kind === "subscription") {
    const planId = one("plan");
    if (!planId) return null;
    const code = normaliseCode(one("code"));
    return {
      kind: "subscription", planId, period: one("period") === "annual" ? "annual" : "monthly",
      ...(code ? { code } : {}),
    };
  }
  if (kind === "grovnews") return { kind: "grovnews" };
  return null;
}
