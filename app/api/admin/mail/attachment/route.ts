import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAttachment, type ImapCredentials } from "@/lib/server/imap";
import { readIntegrationSecrets, type MailConfig } from "@/lib/server/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ADMIN-ONLY attachment download.
 *
 * A server action cannot stream bytes, so this is a route — which makes it a
 * URL anyone can guess, and the reason the admin role is re-checked here rather
 * than assumed from the page that produced the link.
 *
 * Everything a sender controls is treated as hostile. The bytes go out as
 * application/octet-stream with nosniff and an attachment disposition, so a
 * .html or .svg from a stranger is saved, never rendered on this origin where
 * it would run with the admin's session. The filename is rebuilt from scratch:
 * path separators, quotes and control characters cannot survive into the
 * header, and the UTF-8 form travels in RFC 5987 `filename*` beside a plain
 * ASCII fallback.
 */

/** Long enough for a real document name, short enough to keep the header sane. */
const FILENAME_MAX = 120;

function safeFilename(raw: string): string {
  let clean = raw
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["']/g, "")
    .trim()
    .slice(0, FILENAME_MAX);
  // The cut counts UTF-16 units, so it can fall between the halves of an emoji
  // and leave a lone high surrogate at the end — encodeURIComponent throws
  // URIError on that below, and the download would answer 500 instead of bytes.
  const last = clean.charCodeAt(clean.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) clean = clean.slice(0, -1);
  // "..", "." and an empty name are all directory traversal in a save dialog.
  return /^\.+$/.test(clean) || !clean ? "attachment" : clean;
}

/** The pre-RFC 5987 half of the header: a client that ignores `filename*` must
 *  still get something it can write to disk. */
function asciiFallback(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/[";\\]/g, "_").trim();
  return ascii || "attachment";
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  // The admin layout guards pages, not routes: without this check any signed-in
  // customer could read the shop's mail.
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const folder = (params.get("folder") ?? "").trim().slice(0, 200);
  const uid = Number(params.get("uid"));
  // The part number is validated again inside fetchAttachment, which is where it
  // meets an IMAP command; this only rejects the obvious junk early.
  const id = (params.get("id") ?? "").trim();
  if (!folder || /[\r\n\0]/.test(folder) || !Number.isFinite(uid) || uid <= 0 || !/^\d+(\.\d+)*$/.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const { config, secrets } = await readIntegrationSecrets<MailConfig>(supabase, "mail");
  const pass = secrets.imap_password ?? "";
  if (!config.imap_host.trim() || !config.imap_user.trim() || !pass) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 409 });
  }
  const cred: ImapCredentials = {
    host: config.imap_host.trim(),
    port: config.imap_port,
    secure: config.imap_secure,
    user: config.imap_user.trim(),
    pass,
  };

  let attachment: Awaited<ReturnType<typeof fetchAttachment>>;
  try {
    attachment = await fetchAttachment(cred, folder, Math.trunc(uid), id);
  } catch {
    // The IMAP layer has already scrubbed its error; it is still not something a
    // download endpoint should answer with.
    return NextResponse.json({ ok: false, error: "imap_error" }, { status: 502 });
  }
  if (!attachment) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const filename = safeFilename(attachment.filename);
  return new NextResponse(new Uint8Array(attachment.content), {
    headers: {
      // Never the sender's own content type: it is what decides whether a
      // browser renders the file instead of saving it.
      "Content-Type": "application/octet-stream",
      "Content-Length": String(attachment.content.byteLength),
      "Content-Disposition": `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      // Somebody else's mail must not sit in a shared cache, and the mailbox is
      // read live anyway.
      "Cache-Control": "private, no-store",
    },
  });
}
