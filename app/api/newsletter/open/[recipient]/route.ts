import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUnsubscribeToken } from "@/lib/newsletter-consent";

export const dynamic = "force-dynamic";

/**
 * THE OPEN PIXEL.
 *
 * lib/server/newsletter/render.ts embeds `/api/newsletter/open/<recipientId>.png`
 * in every campaign whose `track_opens` is on. This route answers it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE IMAGE COMES BACK. ALWAYS. WHATEVER HAPPENED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A lost open is a missing row in a statistic that lib/newsletter.ts already
 * documents as approximate — Apple Mail Privacy Protection fetches this for
 * recipients who never opened anything, so the number is a lower-bound-shaped
 * guess before this route is even reached. A BROKEN IMAGE is a grey placeholder
 * box, or an "image could not be loaded" line, sitting in the middle of
 * somebody's inbox with our name on it, in a message we sent on purpose. The
 * two failures are not remotely comparable, so:
 *
 *   · the response is 200 with real image bytes for a good id, a fabricated id,
 *     a truncated one and a database that is down;
 *   · the write is deferred with `after()` so the bytes leave before the
 *     database is ever consulted. The recipient's mail client is not made to
 *     wait a round trip to Frankfurt for a pixel it will not display;
 *   · nothing inside the deferred block can throw into the response, because
 *     the response is already gone.
 *
 * NO-STORE IS LOAD-BEARING. Gmail proxies and caches remote images; a cacheable
 * pixel is fetched once, ever, and every subsequent open goes unrecorded while
 * the report still claims to be counting them. It also keeps a shared corporate
 * proxy from serving one recipient's pixel URL to another's client.
 *
 * WHAT IS NOT RECORDED: nothing beyond "a client fetched this recipient's
 * pixel". No IP, no user agent, no timestamp beyond the row's own. That is
 * `newsletter_track`'s decision, and this route deliberately passes it nothing
 * it could use to do otherwise — the request headers are never read.
 */

/* 1×1 fully transparent, both formats, verified 1×1 with an alpha channel
   rather than copied from memory. Constants rather than a generated buffer:
   this runs on every open of every campaign, and 70 bytes do not need a
   library. */
const PIXEL: Record<"png" | "gif", { type: string; bytes: Buffer }> = {
  png: {
    type: "image/png",
    bytes: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  },
  gif: {
    type: "image/gif",
    bytes: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
  },
};

/**
 * Split `8f3c…-….png` into the id and the format.
 *
 * THE SUFFIX IS NOT DECORATION. The renderer writes `.png` because a bare
 * extensionless URL in an `<img src>` is treated as suspicious by several
 * filters and is refused outright by a few image proxies. It is stripped here,
 * and the format ACTUALLY SERVED follows the extension that was asked for
 * rather than being hardcoded: a client that trusts the URL over the
 * Content-Type — and some corporate mail gateways rewriting images do exactly
 * that — must not be handed a GIF at a .png address.
 */
function parse(segment: string): { id: string; format: "png" | "gif" } {
  const value = segment.trim();
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return { id: value, format: "png" };
  const ext = value.slice(dot + 1).toLowerCase();
  return { id: value.slice(0, dot), format: ext === "gif" ? "gif" : "png" };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ recipient: string }> },
) {
  const { recipient } = await params;
  const { id, format } = parse(recipient);
  const image = PIXEL[format];

  // `newsletter_track` takes a `uuid`; a malformed one is a 22P02 cast error
  // rather than an ignored row, so it never leaves this process. The recipient
  // id shares its shape with every other id in this module.
  if (isUnsubscribeToken(id)) {
    after(async () => {
      try {
        const supabase = await createClient();
        // The function itself refuses anything that is not a recipient in
        // status 'sent', so a guessed id records nothing. It is the boundary;
        // this route is a doorbell.
        await supabase.rpc("newsletter_track", {
          p_recipient: id.toLowerCase(),
          p_event: "opened",
        });
      } catch {
        // The pixel has already been delivered. A statistic is the only thing
        // that can be lost here, and that is the trade this route was written
        // to make.
      }
    });
  }

  return new NextResponse(new Uint8Array(image.bytes), {
    status: 200,
    headers: {
      "content-type": image.type,
      "content-length": String(image.bytes.byteLength),
      // See the header comment: a cached pixel is a counter that stops.
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "pragma": "no-cache",
      // Nothing here is a document; stop a client from deciding otherwise.
      "x-content-type-options": "nosniff",
    },
  });
}
