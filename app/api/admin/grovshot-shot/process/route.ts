import { NextResponse } from "next/server";
import { intParam, noStore, UUID } from "@/lib/server/grovshot-shot/guard";
import { createClient } from "@/lib/supabase/server";
import { readProcess, readStepDetail } from "@/lib/server/grovshot-shot/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The role re-checked IN this route (no layout runs for an API call). */
async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401, headers: noStore }) } as const;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { error: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: noStore }) } as const;
  return { supabase, adminId: user.id } as const;
}

/**
 * GROVBASE SHOT → the process view's data (admins only, checked here first).
 *   GET ?run=<id>                    the graph of one order
 *   GET ?run=<id>&pos=<p>&item=<i>   one step row in full (prompts, the
 *                                    observed payload, the response)
 */
export async function GET(request: Request) {
  const a = await requireAdmin();
  if ("error" in a) return a.error;
  const url = new URL(request.url);
  const run = url.searchParams.get("run") ?? "";
  if (!UUID.test(run)) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: noStore });
  const pos = intParam(url.searchParams.get("pos"), 1, 20);
  const item = intParam(url.searchParams.get("item"), -1, 99);
  if (pos !== null && item !== null) {
    const step = await readStepDetail(a.supabase, run, pos, item);
    if (!step) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: noStore });
    return NextResponse.json({ ok: true, step }, { headers: noStore });
  }
  const data = await readProcess(a.supabase, run);
  if (!data) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: noStore });
  return NextResponse.json({ ok: true, data }, { headers: noStore });
}
