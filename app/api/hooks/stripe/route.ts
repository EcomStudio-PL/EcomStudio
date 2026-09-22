import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dispatchToken } from "@/lib/server/server-token";
import { stripeWebhookSecret, stripeCredentials, paymentsEnabled } from "@/lib/stripe/config";
import { verifyStripeSignature } from "@/lib/stripe/signature";
import { handleStripeEvent, type StripeEvent } from "@/lib/server/stripe-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * STRIPE WEBHOOK — https://grovbase.com/api/hooks/stripe
 *
 * The only thing in GrovBase that may turn money into credits.
 *
 * ORDER IS THE SECURITY, and it is the same order as the Supabase auth hook
 * next door:
 *
 *   1. read the RAW body. `request.text()`, before anything parses it — a
 *      parsed-and-reserialised object has different whitespace and key order
 *      and would never match the signature;
 *   2. verify the Stripe-Signature over exactly those bytes;
 *   3. ONLY THEN JSON.parse.
 *
 * Nothing before step 3 trusts the payload. A body that fails the signature is
 * never parsed, never logged in full and never reaches the database.
 *
 * WHY THERE IS NO SERVICE-ROLE CLIENT HERE. This route accepts unauthenticated
 * POSTs from the public internet. A service-role key in it would be a skeleton
 * key behind a signature check — the single worst place in the codebase to put
 * one. It uses the ordinary anon client and proves it is the server the way
 * every background job here does: a dispatch token checked inside the
 * SECURITY DEFINER functions (0113/0114). The token is never in the browser,
 * and the anon key alone opens none of them.
 *
 * WHAT THE STATUS CODES MEAN TO STRIPE, which retries anything that is not 2xx
 * for up to three days:
 *
 *   200  handled — including "already handled" and "not a type I act on".
 *        A duplicate is a SUCCESS: the guarantee is exactly-once, and saying
 *        "error" to the second copy would have Stripe deliver it forever.
 *   400  the body is not JSON, or carries no event id. Retrying will not fix
 *        a malformed body.
 *   401  the signature is absent, wrong, or outside the timestamp tolerance.
 *        Stripe should not retry a request it signed wrongly, and a forgery
 *        gets no second attempt either.
 *   500  something on our side failed — the database was unreachable, the
 *        server key is missing. This is the one case where a retry is useful,
 *        so it is the one case that asks for one.
 *
 * WHAT IS NEVER IN A RESPONSE OR A LOG: the signing secret, the signature
 * header, the request body. Errors carry an event id and a short code.
 */

type Body = { id?: unknown; type?: unknown; data?: unknown; livemode?: unknown };

export async function POST(request: Request) {
  // 1. RAW BYTES.
  const rawBody = await request.text();

  // 2. SIGNATURE, over those exact bytes.
  const verdict = verifyStripeSignature({
    rawBody,
    header: request.headers.get("stripe-signature"),
    secret: stripeWebhookSecret(),
  });
  if (!verdict.ok) {
    // `no_secret` is OUR misconfiguration rather than a bad caller, and it is
    // worth a 500 so a deployment missing STRIPE_WEBHOOK_SECRET shows up as a
    // failing endpoint in the Stripe dashboard instead of looking like an
    // attacker being turned away.
    const status = verdict.reason === "no_secret" ? 500 : 401;
    console.error("stripe.webhook.signature", verdict.reason);
    return NextResponse.json({ error: verdict.reason }, { status });
  }

  // 3. ONLY NOW parse.
  let body: Body;
  try {
    body = JSON.parse(rawBody) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const type = typeof body.type === "string" ? body.type : "";
  const object = (body.data as { object?: unknown } | undefined)?.object;
  if (!id || !type || !object || typeof object !== "object") {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  const event: StripeEvent = {
    id, type,
    livemode: body.livemode === true,
    data: { object: object as Record<string, unknown> },
  };

  const token = dispatchToken();
  if (!token) {
    // Without the server key nothing can be written, and pretending otherwise
    // would lose the event. 500 keeps it in Stripe's retry queue until the
    // deployment is fixed.
    console.error("stripe.webhook.no_server_key", event.id);
    return NextResponse.json({ error: "server_key_missing" }, { status: 500 });
  }

  try {
    const supabase = await createClient();
    const result = await handleStripeEvent(supabase, token, event);
    if (result.outcome === "no_server_key") {
      return NextResponse.json({ error: "server_key_missing" }, { status: 500 });
    }
    // Every other outcome is an ACKNOWLEDGEMENT. `unresolved_workspace` and
    // `unknown_payment` included: they describe an event this deployment
    // cannot act on, and no number of retries will change that. They are
    // recorded in payment_events for a human to find.
    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (e) {
    // Our fault, as far as we can tell. Ask for the retry.
    console.error("stripe.webhook.failed", event.id, event.type,
      e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}

/**
 * A GET is a human or a monitor checking the endpoint. It is not a delivery,
 * and it must never be treated as one.
 *
 * WHY IT REPORTS READINESS, AND WHY THAT IS NOT A LEAK.
 *
 * Whether this deployment can take money is decided by environment variables
 * that nothing outside the server can see. Before this existed, the only way to
 * find out was to try to buy something — which is a terrible way to discover
 * that a deploy dropped a secret, because the person who finds out is a
 * customer at the till. "Payments are configured" is also not a secret: any
 * signed-in visitor already learns it from whether the buy button works.
 *
 * WHAT IS REPORTED, and nothing else:
 *
 *   ready   all three secrets present and well-formed — see paymentsEnabled().
 *   mode    "live" or "test", derived from the key's own prefix. The single
 *           fact that matters most before a first real payment, and the one
 *           thing no dashboard screenshot can settle: is the code that is
 *           RUNNING holding a live key, or a test one?
 *   grants  whether Postgres ACCEPTS this server's dispatch token.
 *
 * WHY `grants` IS SEPARATE FROM `ready`, AND WHY IT HAD TO EXIST.
 *
 * `ready` is a statement about environment variables: GROVBASE_SERVER_KEY is
 * set and long enough. That is NOT the same as the key being the right one.
 * The database does not hold the key; it holds sha256 of the token derived
 * from it, published into app_settings when an admin saves an integration. A
 * deployment whose key was rotated — or set for the first time after that hash
 * was published — has a perfectly well-formed key that every function on the
 * money path REFUSES. The checkout would work, the payment would be taken, and
 * every grant would fail with `forbidden`.
 *
 * So this asks the database directly, through the same door the webhook uses:
 * stripe_catalogue with every id null. It reads no row and returns no data —
 * the only thing it can fail on is the token check. Nothing about the key
 * reaches the response; the answer is one boolean.
 */
async function grantsAccepted(): Promise<boolean> {
  const token = dispatchToken();
  if (!token) return false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("stripe_catalogue", {
      p_token: token, p_package_id: null, p_plan_id: null, p_price_id: null,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function GET() {
  const creds = stripeCredentials();
  return NextResponse.json({
    endpoint: "stripe",
    ok: true,
    ready: paymentsEnabled(),
    mode: creds?.mode ?? null,
    grants: await grantsAccepted(),
  });
}
