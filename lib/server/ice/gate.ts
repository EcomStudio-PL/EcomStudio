import "server-only";
import { createClient } from "@/lib/supabase/server";
import { enforceLoginSecurity } from "@/lib/server/login-security";
import { iceDbReady, iceSupportedPaths } from "./actions";
import { iceCookies, iceViewerIsAdmin, type IceEditSession } from "./session";

/**
 * WHETHER THIS REQUEST GETS THE VISUAL EDITOR'S LAUNCHER, AND WITH WHAT.
 *
 * A visitor without either cookie costs one cookie read and nothing else. With
 * a cookie, the role is checked (an admin previewing as a customer is a
 * customer here too) and so is the step-up — an admin on an unverified device
 * gets no editor, exactly as they get no admin panel. Nor does anyone while
 * the database lacks the editor (0141 not applied yet).
 */
export type IceGateData = { sessions: IceEditSession[]; supported: string[] };

export async function iceGateData(): Promise<IceGateData | null> {
  try {
    const { hint, edits } = await iceCookies();
    if (!hint && edits.length === 0) return null;
    if (!(await iceViewerIsAdmin())) return null;
    const supabase = await createClient();
    if (await enforceLoginSecurity(supabase)) return null;
    if (!(await iceDbReady(supabase))) return null;
    return { sessions: edits, supported: await iceSupportedPaths(supabase) };
  } catch {
    return null;
  }
}

/** Whether the admin-panel hint still has to be set (cookie read only). */
export async function iceHintMissing(): Promise<boolean> {
  return !(await iceCookies()).hint;
}
