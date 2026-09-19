import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { featureBlockedForApi } from "@/lib/server/feature-availability";
import { featureForToolSlug } from "@/lib/features";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { runTool } from "@/lib/server/image-tools";
import { toolBySlug, MAX_UPLOAD_BYTES, ACCEPTED_MIME } from "@/lib/images/tools";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Run one image tool on one file.
 *
 * The processed image comes back as raw bytes with a small JSON header, so a
 * batch of eighty photos never pays the 33% tax of base64 in a JSON body. One
 * request per image is deliberate: the browser drives the queue, shows a live
 * "17 / 82", and a single failure never takes the batch down.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  // A temporarily blocked account keeps its data and loses its access — and
  // access means this route too, not just the screen that links to it.
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }

  const slug = String(form.get("tool") ?? "");
  const tool = toolBySlug(slug);
  if (!tool) return NextResponse.json({ ok: false, error: "unknown_tool" }, { status: 400 });

  // Feature availability (Task 11 C): the run is refused when the module that
  // owns this tool is switched off for customers — the page gate already says
  // why, this is the belt for direct calls.
  const blockedFeature = await featureBlockedForApi(supabase, featureForToolSlug(tool.slug));
  if (blockedFeature) {
    return NextResponse.json({ ok: false, error: "feature_unavailable", feature_status: blockedFeature }, { status: 503 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ ok: false, error: "image_too_large" }, { status: 413 });
  // An empty declared type used to skip validation entirely; now anything
  // that is not on the allowlist — including "no type" — is refused.
  if (!ACCEPTED_MIME.includes(file.type)) {
    return NextResponse.json({ ok: false, error: "unsupported_format" }, { status: 415 });
  }

  const logo = form.get("logo");
  let settings: unknown = {};
  try { settings = JSON.parse(String(form.get("settings") ?? "{}")); }
  catch { settings = {}; }

  const fileBytes = Buffer.from(await file.arrayBuffer());
  const result = await runTool(supabase, user.id, workspace.id, {
    tool: tool.slug,
    settings,
    file: fileBytes,
    mime: file.type || "image/jpeg",
    logo: logo instanceof File ? Buffer.from(await logo.arrayBuffer()) : null,
    // The key is DERIVED, never accepted from the client: a hash of the tool,
    // its settings, the file's name and its exact bytes. Re-sending the same
    // item while the first request is still running resolves to one charge and
    // one run; a different tool or settings can no longer ride an earlier
    // cheap charge for a free run — the old client-supplied key allowed
    // exactly that billing bypass.
    //
    // Being derived is not what makes it safe: the customer knows every
    // input, so they can compute it. What makes it safe is that only the
    // server can create the row it names (migration 0100).
    idempotencyKey: idempotency(workspace.id, tool.slug, settings, fileBytes, file.name),
  });

  if (!result.ok) {
    const status = result.error === "insufficient_credits" ? 402
      : result.error === "no_provider" || result.error === "tool_unavailable" ? 503 : 400;
    return NextResponse.json(result, { status });
  }

  const meta = {
    credits: result.credits,
    before: result.before,
    after: result.after,
    provider: result.providerLabel,
  };
  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.mime,
      "Content-Length": String(result.bytes.length),
      "Cache-Control": "no-store",
      // Base64 keeps non-ASCII provider names legal in a header value.
      "X-Tool-Meta": Buffer.from(JSON.stringify(meta), "utf8").toString("base64"),
    },
  });
}

/** How long a request that never finished keeps blocking an identical one.
 *
 *  The ledger refuses a duplicate key outright (migration 0100) instead of
 *  quietly handing out a second run for one charge, and releases the key as
 *  soon as the run succeeds or fails (0101) — so in the normal case this window
 *  does nothing at all: a retry after a failure, or a re-run after a success,
 *  is allowed immediately.
 *
 *  It is here for the run that ends in neither state: this route has a 120 s
 *  ceiling, and a request killed at it leaves a `pending` event still holding
 *  its key. Without a window that one input would be blocked forever. Five
 *  minutes is the bound on that.
 *
 *  It is a tumbling bucket, not a sliding one, so two submits milliseconds
 *  apart that straddle a boundary get different keys and are both charged.
 *  That is a genuine duplicate charge, at a rate of roughly (gap / 5 min) —
 *  about one double-click in fifteen hundred. A sliding window needs state
 *  this route does not have; the trade is recorded rather than hidden. */
const DEDUPE_WINDOW_MS = 5 * 60_000;

function idempotency(
  workspaceId: string, tool: string, settings: unknown, file: Buffer, filename: string,
): string {
  const digest = createHash("sha256")
    .update(tool)
    .update(JSON.stringify(settings ?? {}))
    // THE NAME, NOT ONLY THE BYTES. Two copies of one photo in a batch are two
    // runs the seller asked for and expects two results from, and the bytes
    // alone cannot tell them apart from one item submitted twice. A genuine
    // re-send carries the same name, so deduplication still works where it
    // should.
    .update(filename)
    .update(file)
    .digest("hex")
    .slice(0, 40);
  return `tools:${workspaceId}:${Math.floor(Date.now() / DEDUPE_WINDOW_MS)}:${digest}`;
}
