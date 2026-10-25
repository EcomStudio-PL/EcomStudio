import type { ShotBrief } from "@/lib/server/prompt-engine";

/**
 * PLAN UJĘĆ, AT THE DOOR — the one place a shot's chosen photo is checked.
 *
 * The panel names a photo by its storage path (its stable id: reordering the
 * photos must not re-aim a shot). The engine speaks in 1-based positions into
 * the request's reference list. This turns one into the other, and refuses a
 * path that is not one of THIS request's reference photos — a brief can only
 * point at a photo the same request sends (and the route has already kept
 * only this workspace's paths), so a forged or stale id never reaches the
 * planner as "photo #1".
 *
 * A legacy body (positional `refIndex`, no path) is passed through as before;
 * the engine bounds it itself.
 */
export function resolveShotBriefs(
  raw: unknown, referencePaths: readonly string[],
): { ok: true; briefs: ShotBrief[] | undefined } | { ok: false } {
  if (!Array.isArray(raw)) return { ok: true, briefs: undefined };
  const briefs: ShotBrief[] = [];
  for (const item of raw.slice(0, 10)) {
    const b = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    let refIndex = Number.isInteger(b.refIndex) ? (b.refIndex as number) : undefined;
    if (b.refPath !== undefined && b.refPath !== null) {
      if (typeof b.refPath !== "string") return { ok: false };
      const at = referencePaths.indexOf(b.refPath);
      if (at < 0) return { ok: false };
      refIndex = at + 1;
    }
    briefs.push({
      text: typeof b.text === "string" ? b.text.slice(0, 400) : undefined,
      keepFraming: b.keepFraming === true,
      refIndex,
    });
  }
  return { ok: true, briefs };
}
