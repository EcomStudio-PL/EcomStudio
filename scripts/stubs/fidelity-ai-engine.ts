/**
 * Test stub for @/lib/server/ai-engine in scripts/ai-fidelity-tests.ts: the
 * tool configuration the test sets, returned as resolveEngine would after the
 * prompt was decrypted (decryption itself is covered by test:promptvault).
 */
import type { EngineConfig } from "../../lib/server/ai-engine";
export type { EngineConfig };

const g = globalThis as unknown as { __fidelityEngine?: EngineConfig | null };

export async function resolveEngine(_supabase: unknown, _toolKey: string): Promise<EngineConfig | null> {
  return g.__fidelityEngine ?? null;
}
