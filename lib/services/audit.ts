import type { Client } from "./workspace";

/** Append an admin action to the audit log. Callers are admin server
 *  actions (RLS additionally enforces is_admin + actor = auth.uid()). */
export async function logAudit(supabase: Client, input: {
  actorId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}) {
  await supabase.from("audit_logs").insert({
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
  });
}
