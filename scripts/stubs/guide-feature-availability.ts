import { iceState } from "./ice-state";
import { guideState } from "./guide-state";

/** Test-only stand-in for lib/server/feature-availability (tool-guide suite):
 *  the availability switchboard comes from guideState, who the viewer is from
 *  iceState. Everything else is the real module (imported by path, so this
 *  alias does not loop back to itself). */

export * from "../../lib/server/feature-availability";

export async function getAvailabilityMap(_supabase: unknown): Promise<Record<string, { status: string }>> {
  guideState.liveCalls.push("availability");
  if (guideState.availabilityThrow) throw new Error("availability read failed");
  return guideState.availability;
}

export async function viewerIsAdmin(_supabase: unknown): Promise<boolean> {
  if (iceState.viewerAdminThrow) throw new Error("role lookup failed");
  return iceState.viewerAdmin;
}

export async function isAdminUser(_supabase: unknown): Promise<boolean> {
  return iceState.viewerAdmin;
}
