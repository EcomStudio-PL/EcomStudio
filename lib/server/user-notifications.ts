import "server-only";
import type { Json } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import { EMPTY_BELL, parseBell, type BellPayload } from "@/lib/notifications/catalog";

/**
 * POWIADOMIENIA V2 — THE ONE WAY A GENERATION TELLS ITS CUSTOMER.
 *
 * A row carries a TYPE and a META (tool key, counts, credits) — never a
 * sentence and never an error code meant for an operator; the words come from
 * lib/notifications/catalog.ts at render time. The category is the
 * database's (0160 trigger), so nothing here can light a badge by mistake.
 *
 * Every write is best-effort and deduplicated by job (`dedupe_key`, unique per
 * user): a finisher that runs twice, a retry, a second driver of the same run
 * — each says it once. A notification never breaks the work it reports on.
 */

/** "The credits came back" only when the ledger SAYS so: the job's usage
 *  event is refunded with a refund transaction. Read after the refund call. */
async function chargeOutcome(supabase: Client, jobId: string): Promise<{ refunded: number | null; charged: number | null }> {
  try {
    const { data } = await supabase.from("usage_events")
      .select("status, credits_charged, refund_tx_id")
      .eq("generation_job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1);
    const ev = data?.[0];
    if (!ev) return { refunded: null, charged: null };
    if (ev.status === "refunded" && ev.refund_tx_id && ev.credits_charged > 0) {
      return { refunded: ev.credits_charged, charged: ev.credits_charged };
    }
    // Failed with nothing taken (the charge never landed): say so honestly.
    if (ev.status === "failed" && ev.credits_charged === 0) return { refunded: null, charged: 0 };
    return { refunded: null, charged: null };
  } catch {
    return { refunded: null, charged: null };
  }
}

async function insert(supabase: Client, row: {
  userId: string; type: string; href: string | null; meta: Record<string, Json>; dedupeKey: string;
}): Promise<void> {
  if (!row.userId) return;
  try {
    // A duplicate (same user, same dedupe key) is refused by the unique index;
    // that refusal IS the deduplication, so its error is not a failure.
    await supabase.from("notifications").insert({
      user_id: row.userId, type: row.type, title: row.type, body: null,
      href: row.href, meta: row.meta, dedupe_key: row.dedupeKey,
    });
  } catch { /* best effort */ }
}

/** A finished generation → Aktywność. `tool` is the feature key
 *  (lib/features.ts) the result belongs to. */
export async function notifyGenerationDone(supabase: Client, input: {
  userId: string; tool: string; jobId: string; count: number; generationId?: string | null;
}): Promise<void> {
  const href = input.generationId ? `/library?open=${encodeURIComponent(input.generationId)}` : "/library";
  await insert(supabase, {
    userId: input.userId, type: "generation_done", href,
    meta: { tool: input.tool, count: input.count, job_id: input.jobId, ...(input.generationId ? { generation_id: input.generationId } : {}) },
    dedupeKey: `generation_done:${input.jobId}`,
  });
}

/** A failed generation → Aktywność. Call AFTER the refund: the message says
 *  the credits came back only if the ledger confirms it. */
export async function notifyGenerationFailed(supabase: Client, input: {
  userId: string; tool: string; jobId: string;
}): Promise<void> {
  const outcome = await chargeOutcome(supabase, input.jobId);
  await insert(supabase, {
    userId: input.userId, type: "generation_failed", href: null,
    meta: {
      tool: input.tool, job_id: input.jobId,
      ...(outcome.refunded !== null ? { refunded: outcome.refunded } : {}),
      ...(outcome.charged !== null ? { charged: outcome.charged } : {}),
    },
    dedupeKey: `generation_failed:${input.jobId}`,
  });
}

/** The bell's whole state for the signed-in caller, in one round trip. */
export async function readBell(supabase: Client): Promise<BellPayload> {
  try {
    const { data, error } = await supabase.rpc("notification_bell", { p_limit: 20 });
    return error ? EMPTY_BELL : parseBell(data);
  } catch {
    return EMPTY_BELL;
  }
}
