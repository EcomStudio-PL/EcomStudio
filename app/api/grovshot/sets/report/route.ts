import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = new Set(["product_changed", "wrong_scale", "hands_faces", "light_mood", "scene_mismatch", "other"]);

/**
 * GROVBASE SHOT — "Zgłoś problem": a reason and an optional comment for the
 * quality panel. Never changes the image, never charges, never writes a rule.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  let body: { generationId?: unknown; reason?: unknown; comment?: unknown } = {};
  try { body = await request.json(); } catch { /* validated below */ }
  const id = typeof body.generationId === "string" && UUID.test(body.generationId) ? body.generationId : null;
  const reason = typeof body.reason === "string" && REASONS.has(body.reason) ? body.reason : null;
  const comment = typeof body.comment === "string" ? body.comment.slice(0, 1000) : "";
  if (!id || !reason) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  const { data, error } = await supabase.rpc("grovshot_shot_report", { p_generation_id: id, p_reason: reason, p_comment: comment });
  const r = (error ? null : data) as { ok?: boolean; error?: string } | null;
  if (!r?.ok) return NextResponse.json({ ok: false, error: r?.error ?? "unavailable" }, { status: r?.error === "rate_limited" ? 429 : r?.error === "not_found" ? 404 : 503 });
  return NextResponse.json({ ok: true });
}
