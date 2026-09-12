import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { deliver, deliverHtml, type SmtpConfig } from "@/lib/server/mailer";
import { buildDedupeKey, notify } from "@/lib/server/notify";
import { collectEventContext, contextRows, eventDataFrom, formatWarsaw } from "@/lib/server/event-context";
import { dispatchToken, readIntegrationSecrets, type MailConfig } from "@/lib/server/integrations";
import {
  defaultTemplate, lookupPublishedTemplate, renderTemplateEmail,
} from "@/lib/server/message-templates";

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
  //
  // WHAT IT SAYS comes from the template studio (waitlist.confirmation:email)
  // like every other message GrovBase sends; WHETHER it is sent, and what it is
  // sent THROUGH, still comes from waitlist_subscribe — that function is the
  // security boundary and it hands back a payload only when confirmation is
  // switched on. The old email_settings copy is the last fallback, so a
  // deployment whose template lookup is unavailable still sends what it always
  // sent rather than nothing.
  if (result.mail) {
    const { from_name, from_email, reply_to, subject, body, smtp } = result.mail;
    const identity = { from_name, from_email, reply_to };
    // THE PASSWORD, PREFERABLY FROM THE VAULT. waitlist_subscribe hands back
    // the email_settings copy, which is AES ciphertext sealed with
    // APP_ENCRYPTION_KEY — the exact thing an operator is no longer expected to
    // maintain. What the admin last typed into Komunikacja → Kanały lives in
    // Supabase Vault instead, so that is tried first and the ciphertext stays
    // as the fallback for a deployment that has not re-saved yet.
    //
    // This is an anonymous request with no admin to authorise it, so the read
    // is authorised by the proof-of-server token (secret_read → server_call_ok).
    const mailSecrets = await readIntegrationSecrets<MailConfig>(supabase, "mail");
    const vaultPassword = mailSecrets.secrets.smtp_password
      ?? (mailSecrets.config.smtp_same_as_imap ? mailSecrets.secrets.imap_password : undefined);
    if (vaultPassword) smtp.password = vaultPassword;
    const now = new Date();
    const data = {
      first_name: firstName,
      name: `${firstName} ${lastName}`.trim(),
      email,
      date: now.toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw" }),
      time: now.toLocaleTimeString("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" }),
    };
    const token = dispatchToken();
    const def = (token
      ? await lookupPublishedTemplate(supabase, token, "waitlist.confirmation", "email")
      : null) ?? defaultTemplate("waitlist.confirmation:email");
    if (def?.channel === "email") {
      const rendered = renderTemplateEmail(def.email, data, {});
      await deliverHtml(
        { to: email, subject: rendered.subject, text: rendered.text, html: rendered.html },
        identity, smtp,
      ).catch(() => null);
    } else {
      await deliver({ to: email, subject, text: body }, identity, smtp).catch(() => null);
    }
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
    ["🕒 Data", formatWarsaw(new Date())],
    // Which block of the landing page the visitor used, then what the server
    // saw of the visit: campaign, entry point, address, device.
    ["🌍 Źródło", source],
    ...contextRows({ ...context, language: locale.toUpperCase() }),
  ];
  const tplData = eventDataFrom(context, {
    name: `${firstName} ${lastName}`.trim(),
    email,
    source,
    language: locale.toUpperCase(),
  });
  after(() => notify(supabase, {
    type: "waitlist.signup",
    title: "NOWY ZAPIS NA LISTĘ",
    icon: "📝",
    rows: rows.filter(([, value]) => value !== ""),
    data: tplData,
    footer: "GrovBase Waitlist",
    dedupeKey: buildDedupeKey("waitlist.signup", email),
  }));

  return NextResponse.json({ ok: true, status: "created" });
}
