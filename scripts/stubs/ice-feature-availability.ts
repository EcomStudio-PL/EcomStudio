import { iceState } from "./ice-state";

/** Test-only stand-in for lib/server/feature-availability (ice suite): who
 *  the viewer is comes from iceState. */

export async function viewerIsAdmin(_supabase: unknown): Promise<boolean> {
  if (iceState.viewerAdminThrow) throw new Error("role lookup failed");
  return iceState.viewerAdmin;
}

export async function isAdminUser(_supabase: unknown): Promise<boolean> {
  return iceState.viewerAdmin;
}
