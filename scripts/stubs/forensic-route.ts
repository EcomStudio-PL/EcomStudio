/**
 * Test stubs for scripts/retouch-forensic-tests.ts — ONLY what the real
 * /api/retouch route needs around it (session, account block, feature switch,
 * workspace, workflow driver). Everything after runRetouch is the real code.
 */
const g = globalThis as unknown as { __forensicClient?: unknown; __forensicUser?: { id: string } | null };

// @/lib/supabase/server
export async function createClient() {
  const client = g.__forensicClient as Record<string, unknown>;
  return { ...client, auth: { getUser: async () => ({ data: { user: g.__forensicUser ?? null }, error: null }) } };
}
export async function getRequestUser() { return g.__forensicUser ?? null; }

// @/lib/server/account-block
export async function accountBlockedResponse(): Promise<null> { return null; }

// @/lib/server/feature-availability
export async function featureBlockedForApi(): Promise<null> { return null; }

// @/lib/server/engine/drive
export function driveAfterResponse(): void {}
