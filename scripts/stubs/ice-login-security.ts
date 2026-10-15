import { iceState } from "./ice-state";

/** Test-only stand-in for lib/server/login-security (ice suite): the step-up
 *  answer comes from iceState (null = verified device). */

export async function enforceLoginSecurity(_supabase: unknown): Promise<string | null> {
  iceState.stepUpCalls += 1;
  return iceState.stepUp;
}
