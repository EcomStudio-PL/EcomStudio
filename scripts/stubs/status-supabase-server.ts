import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/** Test-only stand-in for lib/supabase/server (tool-status suite): hands out
 *  the in-memory client the test installed, and the user it signed in. */
const g = globalThis as unknown as { __statusDb?: unknown; __statusUser?: { id: string } | null };

export async function createClient(): Promise<SupabaseClient<Database>> {
  if (!g.__statusDb) throw new Error("no fake db installed");
  return g.__statusDb as SupabaseClient<Database>;
}

export async function getRequestUser(): Promise<{ id: string } | null> {
  return g.__statusUser ?? null;
}
