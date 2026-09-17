import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * NEWSLETTER SIGNUP — the same list, reached from a different page.
 *
 * GrovBase has exactly one list of people who asked to hear from it:
 * `waitlist_subscribers`, written through `waitlist_subscribe`. A newsletter
 * block on a marketing page is that same act of asking, so it goes to that
 * same function with a different `source` — NOT to a second table that would
 * have to be reconciled, exported and unsubscribed from separately.
 *
 * Everything the waitlist route does — validation, the honeypot, the confirmation
 * e-mail, the admin notification — therefore happens here for free. This
 * handler is a thin forwarder with its own rate limit, and that is the whole
 * of it on purpose.
 */

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (!rateLimit(`newsletter:${ip}`, 10, 60 * 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; } catch { /* below */ }

  // Same origin, same server — with the source rewritten so an operator can
  // tell a newsletter signup from a launch-page one.
  //
  // DELIBERATELY A CALL, NOT A COPY. The alternative was to lift the waitlist
  // route's body into a shared function and have both call it; that is the
  // tidier diff and it edits the one endpoint the brief says not to touch
  // while the site is in pre-launch. One extra hop on a low-traffic form is a
  // cheap price for leaving a working signup path byte-for-byte alone.
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost ? `${proto}://${forwardedHost}` : new URL(request.url).origin;
  const url = new URL("/api/waitlist", origin);
  const forwarded = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Passed through so the waitlist route's own notification still knows
      // what the visitor was using; the address is not forwarded on purpose.
      "user-agent": request.headers.get("user-agent") ?? "",
    },
    body: JSON.stringify({ ...body, source: "newsletter" }),
  });

  const result = (await forwarded.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
  return NextResponse.json(
    { ok: Boolean(result.ok), ...(result.error ? { error: result.error } : {}) },
    { status: forwarded.status },
  );
}
