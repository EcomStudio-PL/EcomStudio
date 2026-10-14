import { db } from "./thumb-db";
export async function recordProviderCalls(_db: unknown, calls: readonly Record<string, unknown>[]): Promise<number> {
  db().providerCalls.push(...calls.map((c) => ({ ...c })));
  return calls.length;
}
export async function readTokenPrices() { return []; }
export async function readUnitPrices() { return []; }
