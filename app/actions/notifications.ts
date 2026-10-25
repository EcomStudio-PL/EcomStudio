"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readBell } from "@/lib/server/user-notifications";
import type { BellPayload } from "@/lib/notifications/catalog";

/**
 * THE BELL'S SERVER SIDE. Every action acts on the caller's OWN rows only —
 * the user id comes from the session, never from the browser, and RLS plus
 * 0160's column grants (read_at, banner_dismissed_at) back that up. Each one
 * answers with the bell's fresh state, which is how the optimistic badge in
 * the browser is corrected.
 */

async function session() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { supabase, userId: user.id } : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The polling read (every 60 s and on returning to the tab). */
export async function loadBellAction(): Promise<BellPayload | null> {
  const s = await session();
  return s ? readBell(s.supabase) : null;
}

export async function markNotificationReadAction(id: string): Promise<BellPayload | null> {
  const s = await session();
  if (!s || !UUID.test(id)) return null;
  await s.supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", s.userId).is("read_at", null);
  return readBell(s.supabase);
}

export async function markAllNotificationsReadAction(): Promise<BellPayload | null> {
  const s = await session();
  if (!s) return null;
  await s.supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("user_id", s.userId).is("read_at", null);
  return readBell(s.supabase);
}

/** Closing the bar under the header. Not reading: the row stays unread. */
export async function dismissBannerAction(id: string): Promise<BellPayload | null> {
  const s = await session();
  if (!s || !UUID.test(id)) return null;
  await s.supabase.from("notifications").update({ banner_dismissed_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", s.userId).is("banner_dismissed_at", null);
  return readBell(s.supabase);
}

/** Kept for callers of the V1 bell (mark everything read, refresh the page). */
export async function markNotificationsReadAction() {
  const s = await session();
  if (!s) return { ok: false };
  await s.supabase.from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", s.userId).is("read_at", null);
  revalidatePath("/", "layout");
  return { ok: true };
}
