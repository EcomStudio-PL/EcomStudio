import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUnsubscribeToken } from "@/lib/newsletter-consent";

export const dynamic = "force-dynamic";

/**
 * ONE-CLICK UNSUBSCRIBE (RFC 8058) — the address in the List-Unsubscribe header.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE HEADER POINTS HERE AND NOT AT /wypisz-sie/<token>
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * lib/server/mailer.ts sends BOTH `List-Unsubscribe: <url>` and
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Together those two are a
 * promise to Gmail and Apple Mail, and the promise is specific: the client will
 * POST to that URL, with no cookies, no Referer and no human present, and the
 * unsubscribe must HAPPEN. Nothing is rendered; nothing is clicked. A header
 * whose URL leads to a page that only acts when somebody presses a button is a
 * header that lies — and the way that lie is punished is that the provider
 * stops trusting the header, the native button disappears, and the recipient's
 * remaining exit is the spam report, which costs the whole sending domain.
 *
 * In the App Router a `page.tsx` cannot export a POST handler, and a `route.ts`
 * cannot live at the same path as a page. So the unsubscribe URL is one of two
 * things and cannot be both. The choice made here:
 *
 *   · the ONE URL in the mail — footer link, plain-text footer and the
 *     List-Unsubscribe header alike — is this API route. It is built in
 *     lib/server/newsletter/worker.ts, from the token the queue claim handed
 *     over, and there is exactly one of it, which is the property the worker's
 *     own comment asks for;
 *   · POST performs the unsubscribe and returns 200 with no body. That is the
 *     whole of RFC 8058's requirement;
 *   · GET is what a HUMAN does when they click the visible "Wypisz się" link in
 *     the footer, and it redirects them to /wypisz-sie/<token>, which is a real
 *     page in their own language that unsubscribes them on arrival and offers
 *     the way back in.
 *
 * The alternative — header here, footer link at the page — was rejected because
 * it puts two different URLs in one message for one action, and the first time
 * somebody debugs "did the unsubscribe work" they would have to know which of
 * the two the recipient used.
 *
 * WHAT THIS ROUTE NEVER DOES: unsubscribe on GET. The page does that, one click,
 * deliberately. Doing it here as well would mean the redirect and the page each
 * performed the same write, and a redirect that mutates is the thing that makes
 * "why did my link checker unsubscribe everybody" impossible to reason about.
 */

/** One shape for every answer this route gives, whatever happened.
 *
 *  A MAIL CLIENT MUST NEVER SEE A FAILURE HERE. Gmail shows the user "couldn't
 *  unsubscribe" on a non-2xx and, worse, some clients fall back to offering the
 *  spam button instead. A 404 for an unknown token would also be an oracle: it
 *  answers "is this token real" to anybody who cares to ask. So the status is
 *  200 and the body is empty for a good token, an expired one, a malformed one
 *  and a database that is down — the same four answers, because the only party
 *  reading this response is a machine that can do nothing useful with the
 *  difference. A person who needs to know lands on the page instead, which does
 *  distinguish them.
 */
const accepted = () =>
  new NextResponse(null, { status: 200, headers: { "cache-control": "no-store" } });

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const value = token.trim();

  // `newsletter_unsubscribe` takes a `uuid`. PostgREST answers a malformed one
  // with a 22P02 cast error rather than "no such contact", so the shape is
  // checked here and a bad token simply never reaches the database.
  if (!isUnsubscribeToken(value)) return accepted();

  try {
    const supabase = await createClient();
    // `p_reason` is left null on purpose. The column holds the reason a PERSON
    // gave for leaving and is shown to operators as exactly that; stuffing the
    // mechanism ("one-click") into it would fill that column with noise that
    // reads like an answer.
    await supabase.rpc("newsletter_unsubscribe", { p_token: value.toLowerCase() });
  } catch {
    // Swallowed by the rule above: the client gets its 200 either way. The
    // recipient's other exit — the footer link, which lands on the page — still
    // reports honestly if the database is genuinely unreachable.
  }
  return accepted();
}

/**
 * The human path. A visible "Wypisz się" in a mail footer is a GET, and it must
 * land somewhere a person can read, in the language the message was sent in.
 *
 * The token is put back into the path exactly as it arrived (encoded, so a
 * mangled link cannot inject a second path segment) and the page revalidates it
 * from scratch — this redirect asserts nothing about whether it is real.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // The origin the visitor actually reached, not the configured canonical one:
  // a preview deployment has to keep its own host or the redirect would throw
  // a tester at production with a token production has never seen.
  const { origin } = new URL(request.url);
  return NextResponse.redirect(
    `${origin}/wypisz-sie/${encodeURIComponent(token.trim())}`,
    // 303: the answer is a different resource to fetch with GET. Never a 301 —
    // a permanent redirect is cached by the browser, and this URL's POST twin
    // must stay reachable at the same address for the mail client.
    { status: 303, headers: { "cache-control": "no-store" } },
  );
}
