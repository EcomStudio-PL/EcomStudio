import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { activeSecret } from "@/lib/server/auth-hook-secret";
import { verifyWebhook } from "@/lib/server/webhook-signature";
import { dispatchToken, ensureDispatchHash, safeError } from "@/lib/server/integrations";
import {
  isAuthAction, parsePayload, planMails, renderAuthMail, sendAuthMail,
} from "@/lib/server/auth-mail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SUPABASE SEND EMAIL HOOK — https://grovbase.com/api/hooks/supabase/send-email
 *
 * With this hook enabled, GoTrue stops rendering and sending auth mail. It
 * mints the token exactly as before and posts it here; GrovBase writes the
 * message from its own published template and sends it from its own mailbox.
 * The customer never sees a Supabase-branded e-mail, and an admin never
 * copies HTML into a dashboard again.
 *
 * ORDER MATTERS, and it is the whole security of this endpoint:
 *
 *   1. read the RAW body — a re-serialised object has a different signature;
 *   2. verify the Standard Webhooks signature over those exact bytes;
 *   3. ONLY THEN parse.
 *
 * Nothing before step 3 trusts the payload, and an unverified request never
 * reaches the mailer. The secret is never logged, never returned, and never
 * part of an error message.
 *
 * WHAT THIS ANSWERS. 2xx means "handled, do not retry". A signature failure
 * is 401 — Supabase should not retry a request it signed wrongly.
 *
 * ── THE 5-SECOND BUDGET, AND WHY THE MAIL IS SENT AFTER THE RESPONSE ──────
 *
 * Supabase gives an auth hook a HARD BUDGET OF 5 SECONDS for the entire
 * invocation, retries included. This endpoint used to spend that budget doing
 * the actual work: a client, a secret read, a dedupe claim, a template lookup,
 * a full external SMTP session (DNS + TCP + TLS + AUTH + DATA) and a status
 * write — six sequential trips, five of them off-box — and only then answered.
 *
 * On production it lost that race, and the way it lost was silent and awful:
 * GoTrue gave up at five seconds, treated the mail as unsent and ROLLED THE
 * WHOLE SIGNUP BACK, while this function carried on, delivered the message and
 * returned 200 to a caller that had already left. The logs showed a 200 and a
 * `sent` row; auth.users showed nothing; the customer got "we could not send
 * the activation e-mail" — and, being a real attempt as far as GoTrue was
 * concerned, it still burned one of their two e-mails per hour.
 *
 * So the contract is now split at the only place it can honestly be split:
 *
 *   INSIDE the budget — verify the signature and parse. That is what Supabase
 *   is actually waiting to hear: "this delivery is mine, it is genuine, I have
 *   it." CPU and at most one round trip for the secret.
 *
 *   AFTER the response — claim, render, send, record. Delivery is OUR problem,
 *   and holding a signup hostage to an SMTP handshake is what caused the
 *   outage. `after()` keeps the function alive on Vercel until this finishes.
 *
 * The cost of the split is that Supabase no longer retries a failed send. That
 * is a fair trade and an honest one: the account now exists, the customer sees
 * the check-your-inbox screen with a working "send again" button, auth_email_log
 * records exactly what happened, and the admin panel's delivery line shows it.
 * The alternative — which is what shipped before — is destroying the account
 * because a mail server was slow.
 */
export async function POST(request: Request) {
  const started = Date.now();
  const raw = await request.text();

  const supabase = await createClient();
  const secret = await activeSecret(supabase);
  if (!secret) {
    // Configured nowhere yet. Say so plainly in the log; never send an
    // unverified message.
    console.error("authHook.notConfigured");
    return NextResponse.json({ error: "hook not configured" }, { status: 503 });
  }

  const verdict = verifyWebhook(raw, {
    id: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
  }, secret);
  if (!verdict.ok) {
    // The reason is a category, never the secret and never the body.
    console.warn(`authHook.rejected (${verdict.reason})`);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const payload = parsePayload(JSON.parse(raw) as unknown);
  if (!payload) {
    console.error("authHook.badPayload");
    return NextResponse.json({ error: "unsupported payload" }, { status: 400 });
  }

  const action = payload.email_data.email_action_type;
  if (!isAuthAction(action)) {
    // A new action type from a future GoTrue. Returning 200 keeps Supabase
    // from retrying something we will never understand, and the log line
    // tells the operator to add it.
    console.warn(`authHook.unknownAction (${action.slice(0, 40)})`);
    return NextResponse.json({ skipped: "unknown action" }, { status: 200 });
  }

  const meta = payload.user.user_metadata ?? {};
  const firstName = String(meta.first_name ?? "").trim()
    || String(meta.full_name ?? "").trim().split(/\s+/)[0]
    || "";
  const locale = String(meta.locale ?? "").trim().toLowerCase() || "pl";
  const mails = planMails(payload);
  const webhookId = verdict.id;

  // ── EVERYTHING BELOW RUNS AFTER THE RESPONSE ──────────────────────────────
  // Not one line of it is something Supabase is waiting to learn, and every
  // line of it can outlast a five-second budget.
  after(async () => {
    const sendStarted = Date.now();
    // A separate client: the request-scoped one is finished with by now.
    const worker = await createClient();
    // The log/dedupe functions are token-gated the same way the notification
    // dispatcher is; publish the hash if this deployment has not yet.
    await ensureDispatchHash(worker);
    const token = dispatchToken();

    for (const mail of mails) {
      try {
        const rendered = await renderAuthMail(worker, mail, firstName);

        // DEDUPE. One row per (delivery, recipient): the first attempt claims
        // it, a retry of a delivery that already SENT is a no-op, and a retry
        // of one that failed is allowed through.
        let logId: string | null = null;
        if (token) {
          const { data, error } = await worker.rpc("auth_email_claim", {
            p_token: token,
            p_webhook_id: webhookId,
            p_recipient: mail.to,
            p_action: mail.action,
            p_template_key: mail.templateKey,
            p_template_source: rendered.source,
            p_template_version: rendered.templateVersion,
            p_locale: locale,
          });
          if (error) console.error("authHook.claim", safeError(error));
          logId = (data as string | null) ?? null;
          if (!error && logId === null) continue; // already delivered
        }

        const result = await sendAuthMail(worker, mail.to, rendered);
        if (token && logId) {
          await worker.rpc("auth_email_finish", {
            p_token: token,
            p_id: logId,
            p_status: result.sent ? "sent" : "failed",
            p_transport: result.transport,
            p_failure: result.error ?? null,
          });
        }
        // The timing is the point of this line: it is what proves the split
        // was needed, and what will show if delivery ever creeps up again.
        console.log("authHook.delivery", JSON.stringify({
          action: mail.action,
          sent: result.sent,
          transport: result.transport,
          sendMs: Date.now() - sendStarted,
          error: result.sent ? null : (result.error ?? "unknown"),
        }));
      } catch (e) {
        // A throw here must never take the lambda down — the response is long
        // gone and the customer already has their account.
        console.error("authHook.deliveryCrashed", safeError(e));
      }
    }
  });

  // ANSWERED IMMEDIATELY: signature verified, delivery accepted. `ackMs` is
  // the number that has to stay well under Supabase's 5000.
  console.log("authHook.ack", JSON.stringify({
    action, mails: mails.length, ackMs: Date.now() - started,
  }));
  return NextResponse.json({}, { status: 200 });
}

/** A GET is how a person checks the URL is live. It says nothing that is not
 *  already public, and it never reveals whether a secret is configured. */
export function GET() {
  return NextResponse.json(
    { hook: "supabase-send-email", method: "POST" },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
