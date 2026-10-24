import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceLoginSecurity } from "@/lib/server/login-security";
import { sniff } from "@/lib/ice/sniff";
import { CONTACT_BUCKET, isContactMime } from "@/lib/contact-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ADMIN-ONLY: one picture attached to a contact ticket (Kontakt V2).
 *
 * The bucket is private and has no public URL; the file is streamed from
 * here, read with the ADMIN'S session (the storage policy lets only an admin
 * read a bound file — 0152), after the role is re-checked here, because a
 * route is a URL anyone can guess and the admin layout guards pages only.
 *
 * The bytes are served as what they ARE (sniffed again: JPG, PNG or WebP —
 * anything else is refused), with nosniff and a sandboxing CSP, inline for
 * the preview or as an attachment for "Pobierz". The name is the safe one
 * the ticket stored, never the visitor's raw file name.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  // The admin's step-up check (a new device confirms a code first), as the
  // admin layout applies it.
  if (await enforceLoginSecurity(supabase)) return NextResponse.json({ ok: false, error: "step_up" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  const { data: row } = await supabase.from("contact_attachments")
    .select("object_path, file_name, mime, message_id").eq("id", id).maybeSingle();
  if (!row || !row.message_id) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const { data: blob, error } = await supabase.storage.from(CONTACT_BUCKET).download(row.object_path);
  if (error || !blob) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = sniff(bytes.subarray(0, 64));
  if (!isContactMime(mime)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 415 });

  const name = (row.file_name ?? "zalacznik").replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 100) || "zalacznik";
  const download = params.get("download") === "1";
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
