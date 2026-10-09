import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { featureBlockedForApi, viewerIsAdmin } from "@/lib/server/feature-availability";
import { featureForPhotoTool } from "@/lib/features";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { rateLimit } from "@/lib/server/rate-limit";
import { parseSettings, runTool } from "@/lib/server/image-tools";
import {
  PHOTO_RESULT_BUCKET, listPhotoResults, loadSource, prepareInput, storeResult, validSourcePath,
} from "@/lib/server/photo-tools";
import { isPhotoTool, PHOTO_MAX_BYTES, type PhotoToolSlug } from "@/lib/images/tools";

export const runtime = "nodejs";
// The provider timeout (120 s) must fire INSIDE this budget, so a slow call
// ends in a refunded failure with an "unknown" cost — not in a killed lambda
// that leaves the reservation for the reconciler.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * THE FOUR PHOTO TOOLS — one photo per request, by STORAGE PATH.
 *
 * The browser uploads the photo to its own workspace folder (as Retusz and
 * Moda do) and sends the path, so no photo ever travels in a request body —
 * Vercel refuses bodies over 4.5 MB — and the result goes back as a signed
 * link to the stored file, never as bytes, for the same reason on the way out.
 *
 * Everything that matters is decided on the server: which provider, what it
 * costs, whether the seller keeps their credits. The Photoroom key never
 * leaves it; a preset's prompt never leaves it either.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  // A temporarily blocked account keeps its data and loses its access.
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;

  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }

  const tool = String(body.tool ?? "");
  if (!isPhotoTool(tool)) return NextResponse.json({ ok: false, error: "unknown_tool" }, { status: 400 });

  const blockedFeature = await featureBlockedForApi(supabase, featureForPhotoTool(tool));
  if (blockedFeature) {
    return NextResponse.json({ ok: false, error: "feature_unavailable", feature_status: blockedFeature }, { status: 503 });
  }
  // A brake, not a vault: per warm instance, per seller. Photoroom's own
  // default is 60 images a minute for the whole account.
  if (!rateLimit(`photo-tools:${user.id}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  const sourcePath = body.sourcePath;
  if (!validSourcePath(sourcePath, workspace.id)) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }
  // The inspiration photo is "Dodaj tło AI"'s alone; anywhere else it is
  // ignored rather than sent.
  const guidancePath = tool === "ai_background" && body.guidancePath != null ? body.guidancePath : null;
  if (guidancePath !== null && !validSourcePath(guidancePath, workspace.id)) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const raw = await loadSource(supabase, sourcePath);
  if (!raw) return NextResponse.json({ ok: false, error: "source_missing" }, { status: 404 });
  if (raw.length > PHOTO_MAX_BYTES) return NextResponse.json({ ok: false, error: "image_too_large" }, { status: 413 });
  const input = await prepareInput(raw, tool);
  if (!input) return NextResponse.json({ ok: false, error: "unsupported_format" }, { status: 415 });

  let guidance: { bytes: Buffer; mime: string } | null = null;
  if (guidancePath) {
    const g = await loadSource(supabase, guidancePath);
    if (!g) return NextResponse.json({ ok: false, error: "source_missing" }, { status: 404 });
    if (g.length > PHOTO_MAX_BYTES) return NextResponse.json({ ok: false, error: "image_too_large" }, { status: 413 });
    guidance = await prepareInput(g, tool);
    if (!guidance) return NextResponse.json({ ok: false, error: "unsupported_format" }, { status: 415 });
  }

  // Normalised once: the key below and the run see the same values.
  const settings = parseSettings(tool, body.settings);
  const admin = await viewerIsAdmin(supabase);

  const result = await runTool(supabase, user.id, workspace.id, {
    tool,
    settings,
    file: input.bytes,
    mime: input.mime,
    guidance,
    viewerIsAdmin: admin,
    // DERIVED on the server, as /api/tools/run does: one uploaded photo with
    // one set of settings, sent twice within the window (a double click, a
    // retried request whose answer was lost), is ONE charge and ONE provider
    // call — the second is refused as a duplicate. The panel's `attempt` (one
    // per press of the button, reused by that photo's retry) only goes INTO
    // the hash, so pressing the button again for a second variant is a new
    // run, while a retry of the same press can never pay twice.
    idempotencyKey: idempotency(workspace.id, tool, settings, sourcePath, guidancePath, attemptOf(body.attempt)),
    deliver: storeResult(supabase, {
      workspaceId: workspace.id, userId: user.id, tool,
      sourcePath, guidancePath, settings,
    }),
  });

  if (!result.ok) {
    const status = result.error === "insufficient_credits" ? 402
      : result.error === "no_provider" || result.error === "tool_unavailable" || result.error === "provider_sandbox" ? 503
        : result.error === "duplicate_request" ? 409
          : result.error === "provider_rate_limited" ? 429 : 400;
    return NextResponse.json(result, { status });
  }
  if (!result.delivered) return NextResponse.json({ ok: false, error: "storage_failed" }, { status: 500 });

  await supabase.rpc("log_activity", {
    p_workspace_id: workspace.id, p_action: "tool.photo_result",
    p_entity_type: "tool_result", p_entity_id: result.delivered.id,
    p_metadata: { tool, credits: result.credits, environment: result.environment ?? "live" },
  });

  const { data: signed } = await supabase.storage.from(PHOTO_RESULT_BUCKET).createSignedUrl(result.delivered.path, 3600);
  return NextResponse.json({
    ok: true,
    credits: result.credits,
    environment: result.environment ?? "live",
    result: {
      id: result.delivered.id,
      url: signed?.signedUrl ?? null,
      width: result.after.width,
      height: result.after.height,
      mime: result.mime,
      bytes: result.after.bytes,
    },
    before: result.before,
  });
}

/** The tool's history, newest first, a page at a time (signed for an hour). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
  const url = new URL(request.url);
  const tool = url.searchParams.get("tool") ?? "";
  if (!isPhotoTool(tool)) return NextResponse.json({ ok: false, error: "unknown_tool" }, { status: 400 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });
  const before = url.searchParams.get("before");
  const page = await listPhotoResults(supabase, workspace.id, tool as PhotoToolSlug, {
    before: before && !Number.isNaN(Date.parse(before)) ? before : null,
  });
  return NextResponse.json({ ok: true, ...page }, { headers: { "Cache-Control": "no-store" } });
}

/** Five-minute buckets, as /api/tools/run: a request that never finished
 *  (its lambda killed) stops blocking an identical one after the window. */
const DEDUPE_WINDOW_MS = 5 * 60_000;

/** The panel's per-press token: a short plain string, or nothing. */
function attemptOf(raw: unknown): string {
  return typeof raw === "string" && /^[\w-]{1,64}$/.test(raw) ? raw : "";
}

function idempotency(
  workspaceId: string, tool: string, settings: unknown, sourcePath: string, guidancePath: string | null, attempt: string,
): string {
  const digest = createHash("sha256")
    .update(tool)
    .update(JSON.stringify(settings ?? {}))
    .update(sourcePath)
    .update(guidancePath ?? "")
    .update(attempt)
    .digest("hex")
    .slice(0, 40);
  return `photo:${workspaceId}:${Math.floor(Date.now() / DEDUPE_WINDOW_MS)}:${digest}`;
}
