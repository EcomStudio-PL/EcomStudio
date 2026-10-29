import "server-only";
import type { Json } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";
import { promptKeyring, type Sealed } from "@/lib/server/prompt-vault";
import { slotRefusal } from "@/lib/server/slot-refusal";
import { resolveShotBriefs } from "@/lib/server/shot-plan";
import { validPhotoPath } from "@/lib/server/thumbnail/run";
import { orderBudget, parseEngineConfig } from "@/lib/grovshot-v2/config";
import type { UserRow } from "@/lib/grovshot-v2/plan";
import { GROVSHOT_V2_KEYS, type GrovshotStageKey } from "@/lib/grovshot-v2/stages";
import { grovshotV2Enabled } from "@/lib/server/grovshot-v2/flag";
import { readOrderPhotos, sha256 } from "@/lib/server/grovshot-v2/media";
import { roleBackends } from "@/lib/server/grovshot-v2/backends";
import { imageUnitPrice, readEngineState, type StageBody } from "@/lib/server/grovshot-v2/settings";

/**
 * GROVBASE SHOT V2 — STARTING AN ORDER. Nothing is charged here: a shot is
 * charged when it is delivered (after its quality check). The order is
 * refused, before anything is paid, when:
 *   · the engine is not for this customer (flag, trial, advertising) →
 *     `engine_v1` — the panel then runs the V1 path as before;
 *   · a stage is not published / the config does not parse / Nano Banana Pro
 *     or a text model is not usable → `prompt_unconfigured` … (named);
 *   · the price the customer was shown is not the live price → `price_changed`;
 *   · the balance cannot cover the order (with the member's other open
 *     orders) or a cap is reached → the SQL's own codes.
 * The start-time version of every stage is SEALED into the run: a resumed
 * invocation runs on exactly those texts, whatever is published later.
 */

/** 2.2: Claude per role, the Etap 3 prompt writer, the server worker. */
export const ENGINE_VERSION = "grovshot-v2.2";
export const DESCRIPTION_MAX = 20_000;
const UNITS = ["cm", "mm", "m", "in"] as const;

export type SealedStage = { version: number; sha256: string; sealed: Sealed };

export type StoredInput = {
  v: 1;
  engine: "grovshot_v2";
  test: boolean;
  /** Admin tests only: "prompts" = Claude's stages up to the prompts, no
   *  image call; "full" = the whole order (still never charged). */
  test_mode?: "prompts" | "full";
  photos: string[];
  photo_shas: string[];
  photo_key: string;
  card_key: string;
  shots: number;
  aspect_ratio: string;
  resolution: string;
  session_type: "lifestyle";
  description: string;
  description_sha256: string;
  dimensions: string | null;
  dimensions_cm: { w: number | null; d: number | null; h: number | null } | null;
  user_rows: UserRow[] | null;
  acknowledge: boolean;
  quote: { unit: number; total: number };
  model: { id: string; identifier: string; provider: string };
  unit_price_usd_micros: number;
  budget_cap_usd_micros: number;
  stages: Record<GrovshotStageKey, SealedStage>;
  engine_version: string;
};

export type StartBody = {
  photos?: unknown; shots?: unknown; aspectRatio?: unknown; resolution?: unknown; sessionType?: unknown;
  description?: unknown; dimensions?: unknown; shotBriefs?: unknown; acknowledge?: unknown; quotedTotal?: unknown;
};

export type StartResult =
  | { ok: true; runId: string; created: boolean; quote: { unit: number; total: number } }
  | { ok: false; error: string; quote?: { unit: number; total: number }; missingCredits?: number; blockers?: string[]; limit?: number };

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 10_000 ? Math.round(v * 100) / 100 : null;

/** The customer's dimensions: width × depth × height in one unit (each
 *  optional, at least one given). Rendered as numbers and the unit only —
 *  the card template states the axis order. */
export function parseDimensions(raw: unknown):
  { ok: true; text: string | null; cm: StoredInput["dimensions_cm"] } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, text: null, cm: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const d = raw as Record<string, unknown>;
  const unit = UNITS.find((u) => u === d.unit);
  const w = d.width === undefined || d.width === null || d.width === "" ? null : num(d.width);
  const dep = d.depth === undefined || d.depth === null || d.depth === "" ? null : num(d.depth);
  const h = d.height === undefined || d.height === null || d.height === "" ? null : num(d.height);
  const given = [d.width, d.depth, d.height].filter((x) => x !== undefined && x !== null && x !== "");
  if (!unit || given.length === 0) return { ok: false };
  if ((d.width != null && d.width !== "" && w === null) || (d.depth != null && d.depth !== "" && dep === null)
    || (d.height != null && d.height !== "" && h === null)) return { ok: false };
  const toCm = (x: number | null) => (x === null ? null : Math.round((unit === "mm" ? x / 10 : unit === "m" ? x * 100 : unit === "in" ? x * 2.54 : x) * 10) / 10);
  const fmt = (x: number | null) => (x === null ? "?" : String(x).replace(".", ","));
  return { ok: true, text: `${fmt(w)} × ${fmt(dep)} × ${fmt(h)} ${unit}`, cm: { w: toCm(w), d: toCm(dep), h: toCm(h) } };
}

export async function startGrovshotRun(
  supabase: Client, userId: string, workspaceId: string, body: StartBody,
  opts: { test?: { bodies: Record<GrovshotStageKey, StageBody>; mode: "prompts" | "full" } } = {},
): Promise<StartResult> {
  const test = Boolean(opts.test);
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length === 0 || photos.length > 10 || !photos.every((p) => validPhotoPath(p, workspaceId))) return { ok: false, error: "invalid_input" };
  if (new Set(photos).size !== photos.length) return { ok: false, error: "invalid_input" };
  const shots = typeof body.shots === "number" && Number.isInteger(body.shots) ? body.shots : 0;
  if (shots < 1 || shots > 10) return { ok: false, error: "invalid_input" };
  if (body.sessionType !== undefined && body.sessionType !== "lifestyle") return { ok: false, error: "engine_v1" };
  const description = typeof body.description === "string" ? body.description.replace(/\r\n/g, "\n").trim() : "";
  if (Array.from(description).length > DESCRIPTION_MAX) return { ok: false, error: "description_too_long" };
  const dims = parseDimensions(body.dimensions);
  if (!dims.ok) return { ok: false, error: "invalid_dimensions" };
  const briefs = resolveShotBriefs(body.shotBriefs, photos as string[]);
  if (!briefs.ok) return { ok: false, error: "invalid_shot_plan" };
  const quotedTotal = typeof body.quotedTotal === "number" && Number.isInteger(body.quotedTotal) ? body.quotedTotal : null;
  if (!test && quotedTotal === null) return { ok: false, error: "invalid_input" };

  if (!test && !(await grovshotV2Enabled(supabase, userId, workspaceId, { sessionType: "lifestyle" }))) {
    return { ok: false, error: "engine_v1" };
  }
  const state = await readEngineState(supabase);
  // A test runs on the versions the admin chose; everything else is live.
  const bodies = opts.test?.bodies ?? state.bodies;
  const missing = GROVSHOT_V2_KEYS.filter((k) => !bodies[k]);
  if (missing.length > 0) return { ok: false, error: "prompt_unconfigured", blockers: missing };
  if (!state.model) return { ok: false, error: "model_unavailable", blockers: state.blockers };
  const parsed = parseEngineConfig(bodies.grovshot_v2_config!.text);
  if (!parsed.ok) return { ok: false, error: "config_invalid" };
  const config = parsed.config;
  // Every role of THIS config (a test may run a draft) must be answerable
  // now — by its own model or the fallback an admin set, nothing else.
  const roles = (await roleBackends(supabase, config.models).catch(() => null))?.status ?? [];
  const unusable = roles.filter((r) => !r.usable).map((r) => `models.${r.role}:${r.primary.state}`);
  if (roles.length === 0 || unusable.length > 0) return { ok: false, error: "analysis_unavailable", blockers: unusable.length ? unusable : ["models:unreadable"] };

  const ratio = typeof body.aspectRatio === "string" ? body.aspectRatio : "";
  const resolution = typeof body.resolution === "string" ? body.resolution : "";
  if (!state.model.ratios.includes(ratio) || !state.model.resolutions.includes(resolution)) return { ok: false, error: "invalid_input" };
  const unit = state.model.pricing[resolution];
  if (typeof unit !== "number" || unit <= 0) return { ok: false, error: "model_unavailable" };
  const quote = { unit, total: unit * shots };
  if (!test && quote.total !== quotedTotal) return { ok: false, error: "price_changed", quote };
  // The budget is checked against the official provider price — without one
  // there is nothing honest to check it against.
  const unitPrice = imageUnitPrice(state, resolution);
  if (unitPrice === null) return { ok: false, error: "model_unavailable", blockers: ["price_unknown"] };

  // The photos by their bytes: the analysis cache and every later read key on these.
  const read = await readOrderPhotos(supabase, photos as string[]);
  if (!read.ok) return { ok: false, error: read.error };
  const shas = read.photos.map((p) => p.sha256);

  const ring = await promptKeyring(supabase);
  if (!ring.canSeal) return { ok: false, error: "prompt_key_unavailable" };
  const stages = Object.fromEntries(GROVSHOT_V2_KEYS.map((k) => {
    const b = bodies[k]!;
    return [k, { version: b.version, sha256: b.sha256, sealed: ring.seal(b.text) }];
  })) as Record<GrovshotStageKey, SealedStage>;

  const descriptionSha = sha256(description);
  const photoKey = sha256(JSON.stringify({ v: 1, shas, validate: stages.grovshot_v2_validate.sha256, config: stages.grovshot_v2_config.sha256 }));
  const cardKey = sha256(JSON.stringify({
    v: 1, photoKey, card: stages.grovshot_v2_card.sha256, description: descriptionSha, dims: dims.text,
  }));
  const userRows: UserRow[] | null = briefs.briefs?.length ? briefs.briefs.map((b) => ({
    text: b.text?.trim() || undefined, keepFraming: b.keepFraming === true, refIndex: b.refIndex,
  })) : null;
  const acknowledge = body.acknowledge === true;

  const input: StoredInput = {
    v: 1, engine: "grovshot_v2", test, ...(opts.test ? { test_mode: opts.test.mode } : {}),
    photos: photos as string[], photo_shas: shas, photo_key: photoKey, card_key: cardKey,
    shots, aspect_ratio: ratio, resolution, session_type: "lifestyle",
    description, description_sha256: descriptionSha,
    dimensions: dims.text, dimensions_cm: dims.cm,
    user_rows: userRows, acknowledge,
    quote: test ? { unit: 0, total: 0 } : quote,
    model: { id: state.model.id, identifier: state.model.identifier, provider: state.model.providerSlug },
    unit_price_usd_micros: unitPrice,
    budget_cap_usd_micros: orderBudget(config, shots),
    stages,
    engine_version: ENGINE_VERSION,
  };
  // One order per CONTENT within five minutes: a double click, a second tab
  // or a retry after a lost answer is the same order, never a second one.
  const bucket = Math.floor(Date.now() / 300_000);
  const key = `gsv2:${workspaceId}:${bucket}:${sha256(JSON.stringify({
    shas, descriptionSha, dims: dims.text, shots, ratio, resolution, userRows, acknowledge, test, mode: opts.test?.mode ?? null,
  })).slice(0, 40)}`;

  const { data, error } = await supabase.rpc("grovshot_run_create", {
    p_token: dispatchToken() ?? "",
    p_run: {
      workspace_id: workspaceId, idempotency_key: key, run_kind: test ? "grovshot_test" : "grovshot",
      shots, engine_version: ENGINE_VERSION, prompt_version: stages.grovshot_v2_shot.version,
      runs_per_hour: config.limits.runs_per_hour, uncharged_per_day: config.limits.uncharged_runs_per_day,
      input,
    } as unknown as Json,
  });
  const out = (error ? null : data) as { id?: string; created?: boolean; error?: string; missing?: number } | null;
  // The plan's parallel-generation limit refuses the order before it exists.
  if (!out) return { ...(slotRefusal(error?.message) ?? { ok: false, error: "run_create_failed" }), quote };
  if (out.error === "insufficient_credits") return { ok: false, error: "insufficient_credits", quote, missingCredits: out.missing ?? undefined };
  if (out.error) return { ok: false, error: out.error, quote };
  if (!out.id) return { ok: false, error: "run_create_failed", quote };
  return { ok: true, runId: out.id, created: Boolean(out.created), quote };
}
