import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { iceState } from "./ice-state";

/** Test-only stand-in for lib/supabase/server (ice suite): hands out the fake
 *  client the test installed in iceState. */

export async function createClient(): Promise<SupabaseClient<Database>> {
  if (iceState.clientThrow || !iceState.client) throw new Error("no fake client installed");
  return iceState.client as SupabaseClient<Database>;
}

export async function getRequestUser(): Promise<{ id: string } | null> {
  const c = iceState.client as { user?: { id: string } | null } | null;
  return c?.user ?? null;
}
