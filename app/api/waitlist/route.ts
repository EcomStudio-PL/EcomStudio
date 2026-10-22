import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { notify } from "@/lib/server/notify";
import { collectEventContext } from "@/lib/server/event-context";
import { waitlistSignupNotice } from "@/lib/server/prelaunch/attribution";
import { EMAIL_RE } from "@/lib/launch/email";

export const dynamic = "force-dynamic";

/**
 * ZAPIS NA PREMIERĘ — the one thing an anonymous visitor may write.
 *
 * The route validates and throttles; the DATABASE is the security boundary.
 * `waitlist_subscribe` is a definer function granted to anon that inserts and
 * answers with a word — created / exists / invalid — so no policy anywhere
 * lets a visitor read the list, count it, or probe whether an address is on
 * it beyond the answer they get for their own submission.
 *
 * The reply is the same for a new address and a known one — `created` both
 * times, and since 0144 the function itself cannot tell them apart either:
 * "is this address on the list" is exactly the question a public form must
 * not answer (Landing V2, audit A1, review S5), and the function is reachable
 * with the public key without this route in front of it.
 *
 * NO MAIL FROM THIS DOOR ANY MORE (review S5). It used to send the "Jesteś na
 * liście" welcome to whatever address was typed — a mail with no proof that
 * the address belongs to the person typing it, which is what the pre-launch
 * double opt-in replaced; the same studio switch now governs the welcome AFTER
 * a confirmed DOI only. waitlist_subscribe answers `confirmation: false`
 * always; the address is still recorded (bare, no consent, no name) and the
 * operator still hears about it (deduplicated per address).
 *
 * The Landing V2 page itself no longer posts here — it uses the double opt-in
 * endpoints under /api/public/prelaunch/. This route stays as the target of the
 * CMS newsletter form's forwarder (app/api/public/newsletter/route.ts).
 */

/** The pre-launch address rule (strict, review S6), the same the SQL applies. */
const EMAIL = EMAIL_RE;

/** Optional free-text field off the body: trimmed and capped to the same width
 *  `waitlist_subscribe` stores it at, so nothing is silently truncated later
 *  and an oversized value can never bloat the metadata jsonb. */
function optionalText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  // A person signs up once. Ten attempts an hour from one address is generous
  // for typos and hostile for a script.
  if (!rateLimit(`waitlist:${ip}`, 10, 60 * 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let email = "";
  let locale = "pl";
  let source = "landing";
  let trap = "";
  let consent: boolean | undefined;
  // Optional by design: the admin decides per field whether the landing form
  // asks for a name at all, so an absent value is normal input and never an
  // error. There is no phone field on this form — see 0073.
  let firstName = "";
  let lastName = "";
  try {
    const body = (await request.json()) as {
      email?: unknown; locale?: unknown; source?: unknown; company?: unknown; consent?: unknown;
      first_name?: unknown; last_name?: unknown;
    };
    // The form's consent is mandatory, so a real submission always carries it.
    // Still read defensively: a row must never claim an agreement that was not
    // in the request that created it.
    consent = typeof body.consent === "boolean" ? body.consent : undefined;
    email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
    locale = typeof body.locale === "string" && /^[a-z]{2}$/.test(body.locale) ? body.locale : "pl";
    source = typeof body.source === "string" ? body.source.slice(0, 40) : "landing";
    firstName = optionalText(body.first_name, 80);
    lastName = optionalText(body.last_name, 80);
    // Honeypot: a field no human sees and every naive bot fills in. Answering
    // "ok" keeps the bot from learning it was caught.
    trap = typeof body.company === "string" ? body.company.trim() : "";
  } catch { /* validated below */ }

  if (trap) return NextResponse.json({ ok: true, status: "created" });
  if (!EMAIL.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("waitlist_subscribe", {
    p_email: email,
    p_source: source,
    p_locale: locale,
    p_metadata: {
      ua: (request.headers.get("user-agent") ?? "").slice(0, 200),
      ...(consent === undefined ? {} : { consent, consent_at: new Date().toISOString() }),
      // The function copies these into real columns; a key that is not there
      // stays null rather than becoming an empty string on the row.
      ...(firstName === "" ? {} : { first_name: firstName }),
      ...(lastName === "" ? {} : { last_name: lastName }),
    } as never,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "generic" }, { status: 500 });
  }

  const result = (data ?? {}) as { status?: string; confirmation?: boolean };
  if (result.status === "invalid") {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  // The operator ping. A new and a known address look the same from here now,
  // so the e-mail doubles as the dedupe key: an address is announced once,
  // however often it is typed. The honeypot answered at the top.
  //
  // Read on the request, not inside after(): headers and cookies are
  // request-scoped state. The locale the visitor is reading the page in beats
  // Accept-Language, because it is the one we will write to them in.
  const context = await collectEventContext();
  // The payload builder is shared with the pre-launch signup (which drops the
  // raw IP); this door keeps every row it always sent, the IP included.
  const notice = waitlistSignupNotice(context, { firstName, lastName, email, source, locale }, { withIp: true });
  after(() => notify(supabase, notice));

  return NextResponse.json({ ok: true, status: "created" });
}
