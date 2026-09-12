import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { featureBlockedForApi } from "@/lib/server/feature-availability";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { runFashionTool } from "@/lib/server/fashion";
import { fashionTool } from "@/lib/fashion-tools";
import { FASHION_HINT_MAX } from "@/lib/fashion-tools";
import type { FeatureKey } from "@/lib/features";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * MODA — one result per request, for all four tools.
 *
 * The browser uploads to its own workspace prefix and sends PATHS; the prompt,
 * the model and the price are the server's business and none of the three
 * appears in the request or the response. A batch is the client calling this
 * once per result, so one failure refunds and reports only itself.
 *
 * THE POOL NAMES SURVIVE THE WIRE. `inputs` is an object keyed by pool, not a
 * flat array, because for "Zmiana postaci" the garment and the person are
 * different things and the order they reach the provider in is meaningful.
 * Flattening here would be a silent loss the seller could not see and could
 * not correct.
 */

/** Storage-path shape, pinned to the caller's own workspace area. */
function validPath(path: unknown, workspaceId: string): path is string {
  return typeof path === "string"
    && path.length > 0 && path.length <= 300
    && path.startsWith(`${workspaceId}/`)
    && !path.includes("..")
    && /^[\w\-./]+$/.test(path);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  // The user comes from the session, never from the body.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  // A temporarily blocked account keeps its data and loses its access — and
  // access means this route too, not just the screen that links to it.
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;

  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let body: {
    tool?: unknown; inputs?: unknown; resolution?: unknown; format?: unknown; hint?: unknown;
  } = {};
  try { body = (await request.json()) as typeof body; } catch { /* validated below */ }

  const config = typeof body.tool === "string" ? fashionTool(body.tool) : null;
  if (!config) return NextResponse.json({ ok: false, error: "unknown_tool" }, { status: 400 });

  // Each tool is its own entry in the availability registry, so one can be put
  // into maintenance or marked "coming soon" without touching the others.
  const blockedFeature = await featureBlockedForApi(supabase, config.toolKey as FeatureKey);
  if (blockedFeature) {
    return NextResponse.json(
      { ok: false, error: "feature_unavailable", feature_status: blockedFeature }, { status: 503 });
  }

  // Rebuild `inputs` pool by pool from the tool's OWN slot list, so a caller
  // cannot invent a pool name or smuggle in an extra image.
  const raw = (body.inputs ?? {}) as Record<string, unknown>;
  const inputs: Record<string, string[]> = {};
  for (const slot of config.slots) {
    const list = Array.isArray(raw[slot.key]) ? (raw[slot.key] as unknown[]) : [];
    const paths = list.filter((p): p is string => validPath(p, workspace.id)).slice(0, slot.max);
    if (paths.length !== list.length) {
      return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
    }
    if (paths.length > 0) inputs[slot.key] = paths;
  }
  if (config.slots.some((slot) => slot.required && !inputs[slot.key])) {
    return NextResponse.json({ ok: false, error: "missing_input" }, { status: 400 });
  }

  const resolution = typeof body.resolution === "string" ? body.resolution.slice(0, 8) : undefined;
  const format = typeof body.format === "string" ? body.format.slice(0, 12) : undefined;
  const hint = typeof body.hint === "string" ? body.hint.slice(0, FASHION_HINT_MAX) : undefined;

  const result = await runFashionTool(supabase, user.id, workspace.id, {
    tool: config.key, inputs, resolution, format, hint,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
