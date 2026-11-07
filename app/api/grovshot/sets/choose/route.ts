import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GROVBASE SHOT — "Użyj tej wersji": the version of a shot the set (and its ZIP) uses. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  let body: { generationId?: unknown } = {};
  try { body = await request.json(); } catch { /* validated below */ }
  const id = typeof body.generationId === "string" && UUID.test(body.generationId) ? body.generationId : null;
  if (!id) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  const { data, error } = await supabase.rpc("grovshot_shot_choose", { p_generation_id: id });
  const r = (error ? null : data) as { ok?: boolean; error?: string } | null;
  if (!r?.ok) return NextResponse.json({ ok: false, error: r?.error ?? "unavailable" }, { status: r?.error === "not_found" ? 404 : 503 });
  return NextResponse.json({ ok: true });
}
