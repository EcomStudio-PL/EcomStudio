import { iceState, type AuditRow } from "./ice-state";

/** Test-only stand-in for lib/services/audit (ice suite): records each row. */

export async function logAudit(_supabase: unknown, input: AuditRow): Promise<void> {
  iceState.audits.push(input);
}
