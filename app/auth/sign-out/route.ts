import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Sign-out as a native form POST — same standalone-PWA reasoning as
 *  /auth/sign-in: the cookie removals must ride a plain 303 response. */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const origin = new URL(request.url).origin;
  const res = NextResponse.redirect(`${origin}/login`, { status: 303 });
  res.headers.set("Cache-Control", "no-store");
  (await cookies()).getAll().forEach((c) => res.cookies.set(c.name, c.value));
  return res;
}
