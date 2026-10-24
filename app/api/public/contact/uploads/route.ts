import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { dispatchToken } from "@/lib/server/integrations";
import { ipHash } from "@/lib/server/contact-tickets";
import { CONTACT_LIMITS } from "@/lib/contact-page";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * UPLOAD SLOTS FOR ONE CONTACT FORM SUBMISSION (Kontakt V2).
 *
 * A picture of up to 5 MB does not fit through a Vercel function (4.5 MB), so
 * the browser uploads it straight to the private bucket — but only to a path
 * this route asked the database to reserve for THIS submission a moment ago
 * (contact_reserve_uploads, 0152: random name, 30 minutes, at most six per
 * submission and fifteen an hour per IP hash). The storage policy lets an
 * upload land nowhere else. Nothing here returns a URL anyone could open.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (!rateLimit(`contact-upload:${ip}`, 20, 60 * 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  let submissionId = "";
  let count = 0;
  try {
    const raw = await request.text();
    if (raw.length > 2048) throw new Error("too_big");
    const body = JSON.parse(raw) as Record<string, unknown>;
    submissionId = typeof body.submissionId === "string" ? body.submissionId : "";
    count = typeof body.count === "number" && Number.isInteger(body.count) ? body.count : 0;
  } catch { /* refused below */ }
  if (!UUID.test(submissionId) || count < 1 || count > CONTACT_LIMITS.files) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const token = dispatchToken();
  const hash = ipHash(ip);
  if (!token || !hash) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contact_reserve_uploads", {
    p_token: token, p_submission: submissionId, p_count: count, p_ip_hash: hash,
  });
  if (error) {
    console.error("contact.uploads", error.code ?? "-");
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
  const result = (data ?? {}) as { status?: string; paths?: unknown };
  if (result.status === "ok" && Array.isArray(result.paths) && result.paths.every((p) => typeof p === "string")) {
    return NextResponse.json({ ok: true, paths: result.paths });
  }
  const error_ = result.status === "rate_limited" ? "rate_limited" : result.status === "too_many" ? "upload_limit" : "invalid";
  return NextResponse.json({ ok: false, error: error_ }, { status: error_ === "rate_limited" ? 429 : 400 });
}
