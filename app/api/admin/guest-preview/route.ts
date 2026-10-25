import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GUEST_PREVIEW_COOKIE } from "@/lib/public-tools";

export const dynamic = "force-dynamic";

/**
 * "PODGLĄD JAKO GOŚĆ" ON / OFF.
 *
 * A route rather than a server action because it is the one write the
 * middleware lets through while the preview is on (a previewing admin's
 * server actions and API writes are refused there — see
 * lib/supabase/middleware.ts), and leaving the preview must always work.
 *
 * The REAL role is checked before the cookie is set; the cookie itself only
 * removes privilege and is ignored for anyone who is not an admin, so it needs
 * no signature. The admin's session is not touched: they are not signed out,
 * their role does not change, and the public-tools switch is not read or
 * written here.
 */
export async function POST(request: Request) {
  // The role re-read from profiles, as every /api/admin route does: no layout
  // runs for an API call.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  let on = false;
  try {
    const body = (await request.json()) as { on?: unknown };
    on = body?.on === true;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true, on });
  if (on) {
    res.cookies.set(GUEST_PREVIEW_COOKIE, "1", {
      httpOnly: true, sameSite: "lax", path: "/",
      secure: process.env.NODE_ENV === "production",
      // A working session's worth; it ends on its own rather than lingering.
      maxAge: 60 * 60 * 8,
    });
  } else {
    res.cookies.delete(GUEST_PREVIEW_COOKIE);
  }
  return res;
}
