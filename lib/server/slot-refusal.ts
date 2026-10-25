/**
 * The database's refusal of a job over the plan's limit (0161), as the
 * customer's error: `concurrency_limit` with the limit it hit, or
 * `concurrency_limit` without one for a click that tried to run too many
 * photos at once. Anything else is not a limit and returns null.
 */
export function slotRefusal(message: string | null | undefined): { ok: false; error: string; limit?: number } | null {
  if (!message) return null;
  const hit = /generation_limit_reached:(\d{1,3})/.exec(message);
  if (hit) return { ok: false, error: "concurrency_limit", limit: Number(hit[1]) };
  if (message.includes("generation_batch_full")) return { ok: false, error: "concurrency_limit" };
  return null;
}
