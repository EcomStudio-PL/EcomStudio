import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { CONSENT_SOURCE_FORM, CONSENT_VERSION } from "@/lib/newsletter-consent";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * NEWSLETTER SIGNUP — the "zapisz się" section of a page-builder page.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT CHANGED, AND WHY IT HAD TO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This route used to be a pure forwarder to /api/waitlist, on the argument that
 * GrovBase had exactly one list of people who asked to hear from it. That was
 * true when it was written and 0094 ended it: `newsletter_contacts` is now the
 * marketing list, with consent as a first-class, dated, versioned column and a
 * suppression list that outlives the row. A signup that never reaches it is an
 * address the newsletter module cannot see, cannot segment and — more to the
 * point — has no record of consent for.
 *
 * So the signup now does BOTH, and the split is not arbitrary:
 *
 *   · `newsletter_subscribe` records WHO AGREED TO WHAT, WHEN. It is the legal
 *     artefact and it is the reason this route exists at all now. It runs
 *     first, and a failure here fails the request — a confirmation e-mail for a
 *     signup that was never stored is the worst of both.
 *   · the forward to /api/waitlist is kept EXACTLY as it was, because it is
 *     what sends the confirmation message and the admin notification, and
 *     because that route is the one the brief says not to disturb. Its failure
 *     is not this request's failure: the consent is already recorded, and a
 *     mail server that is down must not discard it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE VISITOR IS NOT ALLOWED TO CHOOSE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `source_key`, the groups and the consent version are decided HERE and are
 * never read from the request body. 0094 spells out why for the first one —
 * "an audience filtered by attacker-supplied text is an audience an attacker
 * chooses" — and the same reasoning covers the other two: a poster who could
 * name their own group would enrol themselves into whichever segment the next
 * campaign targets, and one who could name their own consent version would
 * decide what the record says they agreed to.
 *
 * `consent` IS read from the body, and it is the one thing here that must be.
 * It is the visitor's own act; nothing may infer it, upgrade it or default it
 * to true. An unticked box records the address with `marketing_consent = false`
 * and no campaign will ever reach it — which is a real outcome, not a rejected
 * request.
 */

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

/** The generic page-builder source from 0094's seed. `newsletter_subscribe`
 *  falls back to it for anything it does not recognise anyway; naming it makes
 *  the intent readable in the contact list a year from now. */
const SOURCE_KEY = "form";

/** The seeded default list. A key that is missing or dynamic is ignored by the
 *  function rather than erroring, so a deployment whose groups were renamed
 *  still records the contact — it just records them ungrouped, which is
 *  recoverable, unlike a lost signup. */
const GROUP_KEYS = ["main"];

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (!rateLimit(`newsletter:${ip}`, 10, 60 * 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; } catch { /* below */ }

  const email = str(body.email, 254).toLowerCase();
  const firstName = str(body.name, 120);
  const locale = /^(pl|en|de)$/.test(str(body.locale, 2)) ? str(body.locale, 2) : "pl";
  // Read defensively and never coerced: `Boolean(body.consent)` would turn the
  // string "false" into an agreement.
  const consent = body.consent === true;
  // The field no human sees. Answering "ok" keeps the bot from learning it was
  // caught — and it is checked BEFORE the contact is written, which the old
  // pure-forwarder got for free from the waitlist route and this one has to do
  // for itself now that it writes a row of its own.
  const trap = str(body.company, 200);

  if (trap) return NextResponse.json({ ok: true });
  if (!EMAIL.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("newsletter_subscribe", {
    p_email: email,
    p_first_name: firstName || undefined,
    p_locale: locale,
    p_source_key: SOURCE_KEY,
    p_group_keys: GROUP_KEYS,
    p_consent: consent,
    // Which wording was on screen. Bump it in lib/newsletter-consent.ts when
    // `newsletter.form.consent` changes, or this column stops meaning anything.
    p_consent_version: CONSENT_VERSION,
    p_consent_source: CONSENT_SOURCE_FORM,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "generic" }, { status: 500 });
  }

  const result = (data ?? {}) as { status?: string };

  if (result.status === "invalid") {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  if (result.status === "rate_limited") {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  /*
    SUPPRESSED IS REPORTED, NOT SWALLOWED.

    Somebody who unsubscribed and has now typed their address back into a form
    is told that nothing happened, because the alternative is a green "dziękujemy,
    zapisaliśmy Cię" over a database that recorded nothing — which is precisely
    the class of comfortable lie this module refuses to print anywhere else.

    It does leak that this address is on the suppression list to whoever typed
    it. That is not a leak this route can prevent and not one it creates:
    `newsletter_subscribe` is granted to `anon` and answers 'suppressed' to
    anybody who calls it directly with the same address. Hiding it here would
    cost the honest visitor an accurate answer and cost an attacker nothing.
  */
  if (result.status === "suppressed") {
    return NextResponse.json({ ok: false, error: "suppressed" }, { status: 409 });
  }

  /*
    THE CONFIRMATION E-MAIL AND THE ADMIN NOTIFICATION, unchanged.

    DELIBERATELY A CALL, NOT A COPY — the original reasoning, still standing:
    lifting the waitlist route's body into a shared function is the tidier diff
    and it edits the one endpoint that must be left byte-for-byte alone while
    the site is in pre-launch. One extra hop on a low-traffic form is cheap.

    BEST-EFFORT FROM HERE DOWN. The consent record is already committed above,
    and it is the part with legal meaning. A mail server that is refusing
    connections must not turn a stored, consented signup into an error the
    visitor is asked to retry — retrying would only write the same row again.
  */
  /*
    THE DESTINATION IS THE CONFIGURED ORIGIN, NOT THE ONE IN THE HEADERS.

    This used to build the URL from `x-forwarded-host`, falling back to `host`.
    Both are request headers: whoever posts to this endpoint chooses them, and
    what they were choosing was the host this server then makes an outbound POST
    to — carrying the visitor's address and the rest of their body. That is a
    request forgery with our own credentials and our own egress, reachable from
    an anonymous public form, and it needs no misconfiguration to work. A
    platform that rewrites `x-forwarded-host` correctly makes it unexploitable
    there and nowhere else; the header stops being load-bearing entirely if the
    value simply does not come from the request.

    `SITE_URL` already answers this question everywhere else in the product and
    answers it per environment — a preview deployment resolves to its own
    hostname, so the forward still stays inside the preview, which was the only
    reason to read the headers in the first place.
  */
  try {
    await fetch(new URL("/api/waitlist", SITE_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Passed through so the waitlist route's own notification still knows
        // what the visitor was using; the address is not forwarded on purpose.
        "user-agent": request.headers.get("user-agent") ?? "",
      },
      // Source rewritten so an operator can tell a newsletter signup from a
      // launch-page one. `consent` rides along as the visitor gave it — that
      // route stores it in its own metadata and, like this one, never infers.
      body: JSON.stringify({ ...body, consent, locale, source: "newsletter" }),
    });
  } catch {
    // See above: the signup stands.
  }

  return NextResponse.json({ ok: true });
}
