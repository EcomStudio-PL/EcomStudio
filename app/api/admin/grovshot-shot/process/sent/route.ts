import { NextResponse } from "next/server";
import { intParam, noStore, UUID } from "@/lib/server/grovshot-shot/guard";
import { createClient } from "@/lib/supabase/server";
import { sentImage } from "@/lib/server/grovshot-shot/process";

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
 * GROVBASE SHOT → one image AS SENT to a provider (admins only). The bytes
 * are re-derived from the order photo with the engine's own transform and
 * served only when their SHA-256 equals the hash observed at the network
 * boundary (header x-grovshot-sha256). Anything else is a 409 with the
 * reason — the original photo is never passed off as the sent image.
 */
export async function GET(request: Request) {
  const a = await requireAdmin();
  if ("error" in a) return a.error;
  const url = new URL(request.url);
  const run = url.searchParams.get("run") ?? "";
  const pos = intParam(url.searchParams.get("pos"), 1, 20);
  const item = intParam(url.searchParams.get("item"), -1, 99);
  const req = intParam(url.searchParams.get("req"), 0, 9);
  const n = intParam(url.searchParams.get("n"), 1, 12);
  if (!UUID.test(run) || pos === null || item === null || req === null || n === null) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: noStore });
  }
  const r = await sentImage(a.supabase, run, pos, item, req, n);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, photo: r.photo ?? null }, { status: r.error === "not_found" ? 404 : 409, headers: noStore });
  return new NextResponse(new Uint8Array(r.bytes), {
    headers: { ...noStore, "Content-Type": r.mime, "x-grovshot-sha256": r.sha256, "x-grovshot-photo": String(r.photo) },
  });
}
