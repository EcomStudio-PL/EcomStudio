import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readAdminTest, startAdminTest, type TestInput } from "@/lib/server/grovshot-v2/admin-test";

export const runtime = "nodejs";
// The test order is driven after the answer (after()), like a customer's.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GROVBASE SHOT V2 — „Test silnika” for admins (/admin/ai/prompts → Silnik
 * V2). POST starts a test order on the chosen versions — "prompts" (Claude
 * only, no image) or "full" (paid image calls: refused unless confirmed);
 * GET ?run=<id> reads it (and keeps the admin's own idle test moving). The
 * role is re-read from profiles on every call; nothing here is charged.
 */
async function admin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 }) } as const;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { error: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) } as const;
  return { supabase, adminId: user.id } as const;
}

export async function POST(request: Request) {
  const a = await admin();
  if ("error" in a) return a.error;
  let body: TestInput;
  try { body = (await request.json()) as TestInput; } catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }
  const chain = { origin: new URL(request.url).origin };
  const out = await startAdminTest(a.supabase, a.adminId, body, chain).catch(() => ({ ok: false as const, error: "generic" }));
  return NextResponse.json(out, { status: out.ok ? 202 : 400 });
}

export async function GET(request: Request) {
  const a = await admin();
  if ("error" in a) return a.error;
  const runId = new URL(request.url).searchParams.get("run") ?? "";
  if (!UUID.test(runId)) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  const chain = { origin: new URL(request.url).origin };
  const out = await readAdminTest(a.supabase, a.adminId, runId, chain).catch(() => ({ ok: false as const, error: "generic" }));
  return NextResponse.json(out, { status: out.ok ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}
