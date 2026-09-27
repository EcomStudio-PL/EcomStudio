/** Test stub for the credit ledger: every charge succeeds and is recorded. */
const g = globalThis as unknown as { __fidelityLedger?: string[] };
const log = (s: string) => { (g.__fidelityLedger ??= []).push(s); };
export async function startUsage(): Promise<{ ok: true; eventId: string }> { log("start"); return { ok: true, eventId: "ev-1" }; }
export async function completeUsage(): Promise<void> { log("complete"); }
export async function failUsage(): Promise<void> { log("fail"); }
