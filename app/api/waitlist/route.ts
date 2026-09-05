import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { deliver, type SmtpConfig } from "@/lib/server/mailer";
import { buildDedupeKey, notify } from "@/lib/server/notify";
import { collectEventContext, contextRows, formatWarsaw } from "@/lib/server/event-context";

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
 * The reply is deliberately the same shape for a new address and a known one:
 * the customer is told plainly ("you are already on the list") because that is
 * useful and they just typed the address themselves, but nothing here reveals
 * anyone else's.
 */

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

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
  // asks for a name or a phone at all, so an absent value is normal input and
  // never an error.
  let firstName = "";
  let lastName = "";
  let phone = "";
  try {
    const body = (await request.json()) as {
      email?: unknown; locale?: unknown; source?: unknown; company?: unknown; consent?: unknown;
      first_name?: unknown; last_name?: unknown; phone?: unknown;
    };
    // Only recorded when the page actually asked for it, so a row never claims
    // an agreement the visitor was never shown.
    consent = typeof body.consent === "boolean" ? body.consent : undefined;
    email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
    locale = typeof body.locale === "string" && /^[a-z]{2}$/.test(body.locale) ? body.locale : "pl";
    source = typeof body.source === "string" ? body.source.slice(0, 40) : "landing";
    firstName = optionalText(body.first_name, 80);
    lastName = optionalText(body.last_name, 80);
    phone = optionalText(body.phone, 32);
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
      // The function copies these three into real columns; a key that is not
      // there stays null rather than becoming an empty string on the row.
      ...(firstName === "" ? {} : { first_name: firstName }),
      ...(lastName === "" ? {} : { last_name: lastName }),
      ...(phone === "" ? {} : { phone }),
    } as never,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "generic" }, { status: 500 });
  }

  const result = (data ?? {}) as {
    status?: string;
    mail?: {
      from_name: string; from_email: string; reply_to: string;
      subject: string; body: string; smtp: SmtpConfig;
    };
  };
  if (result.status === "invalid") {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  if (result.status === "exists") {
    return NextResponse.json({ ok: true, status: "exists" });
  }

  // The confirmation, when the admin turned it on. Best-effort by design: a
  // mail server that is down must not lose the signup that already succeeded.
  if (result.mail) {
    const { from_name, from_email, reply_to, subject, body, smtp } = result.mail;
    await deliver(
      { to: email, subject, text: body },
      { from_name, from_email, reply_to },
      smtp,
    ).catch(() => null);
  }

  // Only a genuinely NEW row gets announced: the honeypot answered at the top
  // and "exists" returned above, so a bot and a customer re-typing their
  // address never reach this line. The e-mail doubles as the dedupe key, which
  // keeps the ping unique even if the row is ever deleted and re-added.
  //
  // Read on the request, not inside after(): headers and cookies are
  // request-scoped state. The locale the visitor is reading the page in beats
  // Accept-Language, because it is the one we will write to them in.
  const context = await collectEventContext();
  // Empty rows are dropped rather than rendered as a dangling label, so the
  // fields the admin left off the form simply are not in the message.
  const rows: [string, string][] = [
    ["👤 Użytkownik", `${firstName} ${lastName}`.trim()],
    ["📧 E-mail", email],
    ["📱 Telefon", phone],
    ["🕒 Data", formatWarsaw(new Date())],
    // Which block of the landing page the visitor used, then what the server
    // saw of the visit: campaign, entry point, address, device.
    ["🌍 Źródło", source],
    ...contextRows({ ...context, language: locale.toUpperCase() }),
  ];
  after(() => notify(supabase, {
    type: "waitlist.signup",
    title: "NOWY ZAPIS NA LISTĘ",
    icon: "📝",
    rows: rows.filter(([, value]) => value !== ""),
    footer: "GrovBase Waitlist",
    dedupeKey: buildDedupeKey("waitlist.signup", email),
  }));

  return NextResponse.json({ ok: true, status: "created" });
}
