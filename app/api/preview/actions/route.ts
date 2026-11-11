import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { featureBlockedForApi } from "@/lib/server/feature-availability";

export const dynamic = "force-dynamic";

/**
 * Whether the image preview offers its smart actions (Zmień format, Zmień
 * rozmiar, Usuń tło, Usuń wybrane) to THIS viewer — the `preview_actions`
 * switch, decided on the server (an admin keeps them, as with every switch).
 * The preview hides the whole section until this says yes, and the runs it
 * starts are refused by /api/tools/run and /api/tools/save on the same switch.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Signed-in only (the preview lives behind sign-in); the body still says
  // "off", so a caller that only reads `enabled` stays safe.
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized", enabled: false }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const blocked = await featureBlockedForApi(supabase, "preview_actions");
  return NextResponse.json({ ok: true, enabled: blocked === null }, { headers: { "Cache-Control": "private, no-store" } });
}
