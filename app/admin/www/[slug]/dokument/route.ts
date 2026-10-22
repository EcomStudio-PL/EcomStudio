import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceLoginSecurity } from "@/lib/server/login-security";
import {
  legalTextHeaders, parseLegalLocaleParam, parseLegalSourceParam, readLegalTextFile,
} from "@/lib/server/legal/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ADMIN-ONLY: ONE LANGUAGE OF A LEGAL DOCUMENT, AS A .TXT.
 *
 *   /admin/www/regulamin/dokument?locale=pl                    the draft
 *   /admin/www/regulamin/dokument?locale=pl&source=published   what is live
 *
 * The text goes out exactly as stored — the same string the page and the PDF
 * read — so the file can be compared byte for byte with the source document
 * (`sha256sum`, `diff`). The reading is lib/server/legal/admin.ts.
 *
 * A route is a URL anyone can guess, and the admin layout guards pages, not
 * routes: the role is re-checked here, as the other admin downloads do
 * (app/api/admin/mail/attachment), and so is the step-up — a session on a
 * device the emailed code has not verified gets no draft, exactly as it gets
 * no admin panel.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (await enforceLoginSecurity(supabase)) {
    return NextResponse.json({ ok: false, error: "step_up_required" }, { status: 403 });
  }

  const { slug } = await params;
  const query = new URL(request.url).searchParams;
  const locale = parseLegalLocaleParam(query.get("locale"));
  const source = parseLegalSourceParam(query.get("source"));
  if (!locale || !source) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const file = await readLegalTextFile(supabase, slug, locale, source);
  // No text for that language (or no such page): a plain-text 404, like the
  // PDF route's. The editor offers this link as a download, so the answer is
  // a failed download — never a JSON page in place of the builder.
  if (!file) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }

  const bytes = new TextEncoder().encode(file.text);
  return new NextResponse(bytes, { headers: legalTextHeaders(file.filename, bytes.byteLength) });
}
