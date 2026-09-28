/** Test stub for @/lib/services/workspace in the forensic route test. */
export type Client = never;
export async function getCurrentWorkspace(_s: unknown, userId: string) {
  return userId ? { id: "w", name: "W", role: "owner" } : null;
}
