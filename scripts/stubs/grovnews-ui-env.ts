/**
 * Request-scope stand-ins for scripts/grovnews-ui-tests.ts: the Supabase
 * client, the dictionary and the admin check come from the test (a fake rpc /
 * from recorder), not from cookies. Aliased over @/lib/supabase/server,
 * @/lib/i18n/server and @/lib/server/feature-availability in that test's
 * esbuild command only.
 */
import pl from "@/lib/i18n/dictionaries/pl.json";

type Env = { client: unknown; admin: boolean };
const env = (): Env => (globalThis as unknown as { __grovnewsUi: Env }).__grovnewsUi;

export async function createClient() {
  return env().client;
}

export async function getDictionary() {
  return { locale: "pl" as const, dict: pl };
}

export async function viewerIsAdmin(): Promise<boolean> {
  return env().admin;
}
