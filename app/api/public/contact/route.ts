import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { buildDedupeKey, notify } from "@/lib/server/notify";
import { isContactTopic } from "@/lib/cms-forms";

export const dynamic = "force-dynamic";

/**
 * THE CONTACT FORM.
 *
 * Built on the waitlist route's shape, because it has the same problem: an
 * endpoint an anonymous visitor may post to. The layers, outermost first:
 *
 *   1. a honeypot, which catches the naive bots for free;
 *   2. an in-memory per-address rate limit, which blunts a burst;
 *   3. a SECURITY DEFINER function, which is the actual boundary. It
 *      revalidates everything, applies a per-e-mail limit that survives a
 *      restart, and is the only grant anon has on this table. Nothing here
 *      can read anyone's message back out.
 *
 * The admin is told through the existing notification pipeline — the same
 * outbox, the same Telegram card, the same admin e-mail as a waitlist signup.
 * There is no second mail system in this feature.
 */

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request) {
  const ip = clientIp(request);
  // Generous for someone re-sending after a typo, useless for a script.
  if (!rateLimit(`contact:${ip}`, 8, 60 * 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let name = "", email = "", message = "", topic = "other", trap = "", locale = "pl";
  try {
    const body = (await request.json()) as Record<string, unknown>;
    name = str(body.name, 120);
    email = str(body.email, 254).toLowerCase();
    message = str(body.message, 4000);
    const wanted = str(body.topic, 40);
    topic = isContactTopic(wanted) ? wanted : "other";
    locale = /^[a-z]{2}$/.test(str(body.locale, 2)) ? str(body.locale, 2) : "pl";
    // The field no human sees. Answering "ok" keeps the bot from learning.
    trap = str(body.company, 200);
  } catch { /* validated below */ }

  if (trap) return NextResponse.json({ ok: true });
  if (!EMAIL.test(email) || message.length < 5 || name.length === 0) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_contact_message", {
    p_topic: topic,
    p_name: name,
    p_email: email,
    p_message: message,
    p_locale: locale,
    p_source: "website",
    p_metadata: {
      // Deliberately no IP. Somebody writing to us is not a session to profile.
      ua: (request.headers.get("user-agent") ?? "").slice(0, 200),
      referer: (request.headers.get("referer") ?? "").slice(0, 300),
    } as never,
  });
  if (error) return NextResponse.json({ ok: false, error: "generic" }, { status: 500 });

  const status = ((data ?? {}) as { status?: string }).status;
  if (status === "rate_limited") {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  if (status !== "created") {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  // Told once, after the response. A slow Telegram must not hold up the
  // "dziękujemy" the person is waiting for.
  after(() => notify(supabase, {
    type: "contact.message",
    title: "NOWA WIADOMOŚĆ Z FORMULARZA",
    icon: "✉️",
    rows: [
      ["👤 Od", name],
      ["📧 E-mail", email],
      ["🏷️ Temat", topic],
    ],
    // The message itself as a quote, trimmed: the card is a notification, and
    // the full text is one click away in the panel.
    quote: message.slice(0, 600),
    data: { name, email, topic, message: message.slice(0, 1200) },
    footer: "GrovBase Kontakt",
    dedupeKey: buildDedupeKey("contact.message", email, message.slice(0, 40)),
  }));

  return NextResponse.json({ ok: true });
}
