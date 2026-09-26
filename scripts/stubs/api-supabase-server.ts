import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/** Test-only stand-in for lib/supabase/server: hands out the fake the test
 *  installed on globalThis. */
const g = globalThis as unknown as { __apiFakeDb?: unknown };

export async function createClient(): Promise<SupabaseClient<Database>> {
  if (!g.__apiFakeDb) throw new Error("no fake db installed");
  return g.__apiFakeDb as SupabaseClient<Database>;
}
