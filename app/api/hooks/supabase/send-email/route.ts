import { NextResponse } from "next/server";
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
 * is 401 — Supabase should not retry a request it signed wrongly. A transient
 * failure on our side (SMTP down) is 500, so the delivery IS retried, and the
 * dedupe row lets that retry through precisely because the first attempt
 * failed.
 */
export async function POST(request: Request) {
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

  // The log/dedupe functions are token-gated the same way the notification
  // dispatcher is; publish the hash if this deployment has not yet.
  await ensureDispatchHash(supabase);
  const token = dispatchToken();

  const meta = payload.user.user_metadata ?? {};
  const firstName = String(meta.first_name ?? "").trim()
    || String(meta.full_name ?? "").trim().split(/\s+/)[0]
    || "";
  const locale = String(meta.locale ?? "").trim().toLowerCase() || "pl";

  const mails = planMails(payload);
  let anyFailed = false;

  for (const mail of mails) {
    const rendered = await renderAuthMail(supabase, mail, firstName);

    // DEDUPE. One row per (delivery, recipient): the first attempt claims it,
    // a retry of a delivery that already SENT is a no-op, and a retry of one
    // that failed is allowed through.
    let logId: string | null = null;
    if (token) {
      const { data, error } = await supabase.rpc("auth_email_claim", {
        p_token: token,
        p_webhook_id: verdict.id,
        p_recipient: mail.to,
        p_action: mail.action,
        p_template_key: mail.templateKey,
        p_template_source: rendered.source,
        p_template_version: rendered.templateVersion,
        p_locale: locale,
      });
      if (error) console.error("authHook.claim", safeError(error));
      logId = (data as string | null) ?? null;
      if (!error && logId === null) {
        // Already delivered. Nothing to do, and nothing went wrong.
        continue;
      }
    }

    const result = await sendAuthMail(supabase, mail.to, rendered);
    if (!result.sent) anyFailed = true;
    if (token && logId) {
      await supabase.rpc("auth_email_finish", {
        p_token: token,
        p_id: logId,
        p_status: result.sent ? "sent" : "failed",
        p_transport: result.transport,
        p_failure: result.error ?? null,
      });
    }
    if (!result.sent) {
      // The address and the reason, never the token.
      console.error(`authHook.sendFailed (${mail.action}) ${result.error ?? "unknown"}`);
    }
  }

  // A failed send earns a 500 so Supabase retries it; everything else is done.
  if (anyFailed) return NextResponse.json({ error: "delivery failed" }, { status: 500 });
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
