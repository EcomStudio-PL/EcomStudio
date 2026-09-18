import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUnsubscribeToken } from "@/lib/newsletter-consent";

export const dynamic = "force-dynamic";

/**
 * THE CLICK REDIRECT — `/r/<recipient>/<link>`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DESTINATION COMES FROM THE DATABASE. NEVER FROM THE REQUEST.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This route has no query string, reads no query string, and could not use one
 * if a caller invented it. Both path segments are ids, `newsletter_track`
 * resolves the second into a URL server-side, and that URL is the only thing
 * this route will redirect to.
 *
 * The alternative — `/r?to=https://…&rid=…`, which is what most tracking
 * redirects look like — is an OPEN REDIRECT ON OUR OWN DOMAIN. Anybody could
 * mint `https://grovbase.com/r?to=<their phishing page>`, and it would carry
 * this site's name, its reputation and its HTTPS padlock into a link they send
 * to somebody else. Link scanners, mail filters and humans all read the first
 * part of a URL. There is no amount of allowlisting that makes it safe, so the
 * capability simply does not exist here.
 *
 * `newsletter_links` is scoped per campaign and `newsletter_track` joins the
 * link to the RECIPIENT'S OWN campaign before returning it, so a link id from
 * one campaign cannot be replayed against a recipient of another — the check
 * lives in the function, which is the boundary, and this route relies on it
 * rather than re-implementing it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AN UNRESOLVED CLICK STILL LANDS SOMEWHERE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A 404 here is served to a REAL PERSON who clicked a REAL button in a REAL
 * message we sent them. The reasons it can happen are all ours, not theirs: the
 * campaign was deleted after sending, the recipient row was purged, the link
 * row went with the campaign. Showing them "not found" for our bookkeeping is
 * the wrong answer, so an unknown click goes to the site's front page — they
 * wanted to get to GrovBase, and they do.
 */

/** The front page of whatever host the click actually arrived on. Deliberately
 *  the request's own origin rather than the configured canonical one, so a
 *  preview deployment's fallback stays inside that preview. */
const home = (request: Request) => new URL(request.url).origin;

/**
 * Is this something we are willing to send a person to?
 *
 * Belt and braces. `collectUrls` in the renderer only ever registers http(s)
 * destinations, so a stored `javascript:` or `data:` URL should be impossible —
 * but this is the one line in the module that hands a browser a URL to follow,
 * and "should be impossible" is not the standard for that line. An operator
 * editing `newsletter_links` by hand is enough to make it reachable.
 */
function safeDestination(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ recipient: string; link: string }> },
) {
  const { recipient, link } = await params;
  const recipientId = recipient.trim();
  const linkId = link.trim();

  const fallback = () =>
    // 302, never 301. A permanently redirected URL is cached by the browser and
    // by intermediaries, and the second click from the same person would then
    // never reach this route — the destination would still be correct and the
    // click would silently stop being counted, which is the worst shape of
    // measurement bug because the report keeps looking healthy.
    NextResponse.redirect(home(request), { status: 302, headers: { "cache-control": "no-store" } });

  // Both parameters are `uuid` columns; PostgREST answers a malformed one with
  // a 22P02 cast error rather than an empty result, so the shape is checked
  // before the database is ever asked.
  if (!isUnsubscribeToken(recipientId) || !isUnsubscribeToken(linkId)) return fallback();

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("newsletter_track", {
      p_recipient: recipientId.toLowerCase(),
      p_event: "clicked",
      p_link: linkId.toLowerCase(),
    });
    if (error) return fallback();

    // The function answers `{status, url}`. It returns 'unknown' for a
    // recipient that is not in status 'sent' and for a link that does not
    // belong to that recipient's campaign, and in both cases `url` is absent —
    // so there is nothing to second-guess and nothing to fall back to except
    // the front page.
    const result = (data ?? {}) as { status?: string; url?: string | null };
    const destination = result.status === "ok" ? safeDestination(result.url) : null;
    if (!destination) return fallback();

    return NextResponse.redirect(destination, {
      status: 302,
      // Same reason as above, and one more: this URL is unique per recipient, so
      // a cached copy in a shared proxy is somebody else's click.
      headers: { "cache-control": "no-store" },
    });
  } catch {
    // The person clicked. They get a page either way.
    return fallback();
  }
}
