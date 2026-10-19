/** Test-only stand-in for lib/supabase/server (prelaunch suite): hands out the
 *  session fake the suite installed (scripts/stubs/prelaunch-supabase.ts). */
const g = globalThis as unknown as { __prelaunchSession?: { client: { auth: { getUser: () => Promise<{ data: { user: unknown } }> } } } };

export async function createClient(): Promise<never> {
  if (!g.__prelaunchSession) throw new Error("no session fake installed");
  return g.__prelaunchSession.client as never;
}

export async function getRequestUser(): Promise<never> {
  if (!g.__prelaunchSession) throw new Error("no session fake installed");
  const { data } = await g.__prelaunchSession.client.auth.getUser();
  return data.user as never;
}
