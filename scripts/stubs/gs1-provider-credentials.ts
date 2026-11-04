/** GrovShot V1 planner tests: the vault read, faked (never a real key). */
export async function readProviderKey(_supabase: unknown, providerId: string): Promise<string | null> {
  return providerId === "p-broken" ? null : `sk-test-${providerId}`;
}
