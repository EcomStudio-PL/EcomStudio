import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runAutopilot, type AutopilotInput } from "@/lib/server/grovshot-v2/autopilot";

export const runtime = "nodejs";
// The test orders it starts are driven after the answer (after()), like the test route's.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GROVBASE SHOT V2 — „Autokonfiguracja” for admins (/admin/ai/prompts →
 * Silnik V2): the spec drafts, the publish gate, the publication (config
 * last) and the admin tests within the limit the admin confirmed — with the
 * admin's own session, so every write goes through the same database
 * functions and audit as the editor. A route, not a server action, so the
 * engine is compiled once with the other routes (build memory). The role is
 * re-read from profiles on every call; nothing here is charged to anyone.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  let body: AutopilotInput;
  try { body = (await request.json()) as AutopilotInput; } catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }
  const chain = { origin: new URL(request.url).origin };
  const out = await runAutopilot(supabase, user.id, body, chain)
    .catch(() => ({ ok: false as const, error: "generic", steps: [], runs: [], photos: [], limitUsdMicros: 0 }));
  return NextResponse.json(out, { status: out.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}
