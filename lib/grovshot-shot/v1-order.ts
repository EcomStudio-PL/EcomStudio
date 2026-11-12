import { V2_DESCRIPTION_MAX } from "@/lib/generator/studio";
import type { ShotSettings } from "@/lib/grovshot-shot/settings";

/**
 * GROVBASE SHOT ON THE EARLIER PATH (/api/prompts/generate) — WHAT AN ORDER MAY CARRY.
 *
 * The panel is one form for everyone: photos, the Allegro description,
 * format, count. A member the lifestyle engine is not for (the flag, a trial
 * workspace) runs on the earlier GrovBase Shot path — with the SAME rules the
 * engine's start route applies (lib/server/grovshot-v2/start-shot.ts), read
 * from the same setting (app_settings `grovshot_shot`):
 *
 *   · a scenario the settings switched off is refused — today the
 *     advertising session (`scenario_unavailable`); no scenario = lifestyle;
 *   · the description is required: at least `description_min_chars`
 *     (`description_too_short`), at most the panel's cap (`description_too_long`);
 *   · a manual shot plan is an admin-only parameter — refused from anyone
 *     else (`invalid_input`), never silently dropped.
 *
 * Pure: the route reads the settings and the role, this decides.
 */
export type V1OrderCheck =
  | { ok: true; sessionType: "lifestyle" | "advertising"; description: string }
  | { ok: false; error: "scenario_unavailable" | "description_too_short" | "description_too_long" | "invalid_input" };

export function checkV1ShotOrder(
  body: { sessionType?: unknown; description?: unknown; shotBriefs?: unknown },
  settings: Pick<ShotSettings, "scenarios" | "description_min_chars">,
  isAdmin: boolean,
): V1OrderCheck {
  const requested = body.sessionType === undefined || body.sessionType === null ? "lifestyle" : body.sessionType;
  if (requested !== "lifestyle" && requested !== "advertising") return { ok: false, error: "invalid_input" };
  const enabled = requested === "lifestyle" ? settings.scenarios.lifestyle : settings.scenarios.reklamowa;
  if (!enabled) return { ok: false, error: "scenario_unavailable" };
  if (!isAdmin && Array.isArray(body.shotBriefs) && body.shotBriefs.length > 0) return { ok: false, error: "invalid_input" };
  const description = typeof body.description === "string" ? body.description.replace(/\r\n/g, "\n").trim() : "";
  const length = Array.from(description).length;
  if (length > V2_DESCRIPTION_MAX) return { ok: false, error: "description_too_long" };
  if (length < Math.max(1, settings.description_min_chars)) return { ok: false, error: "description_too_short" };
  return { ok: true, sessionType: requested, description };
}
