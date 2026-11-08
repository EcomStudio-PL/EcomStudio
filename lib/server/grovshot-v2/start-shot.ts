import "server-only";
import type { Json } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";
import { slotRefusal } from "@/lib/server/slot-refusal";
import { validPhotoPath } from "@/lib/server/thumbnail/run";
import { resolveShotBriefs } from "@/lib/server/shot-plan";
import { grovshotV2Enabled, isAdminUserId } from "@/lib/server/grovshot-v2/flag";
import { readOrderPhotos, sha256 } from "@/lib/server/grovshot-v2/media";
import { roleBackends } from "@/lib/server/grovshot-v2/backends";
import { imageUnitPrice, readEngineState } from "@/lib/server/grovshot-v2/settings";
import { parseDimensions, DESCRIPTION_MAX, type StartBody, type StartResult } from "@/lib/server/grovshot-v2/start";
import type { ShotInput } from "@/lib/server/grovshot-v2/lifestyle";
import { readKb } from "@/lib/grovshot-shot/kb";
import { SHOT_ENGINE_VERSION } from "@/lib/grovshot-shot/contract";
import { parseUserPlan } from "@/lib/grovshot-shot/plan";
import { IMAGE_MAX_CALLS, parseShotSettings } from "@/lib/grovshot-shot/settings";

/**
 * GROVBASE SHOT — STARTING AN ORDER ON THE LIFESTYLE ENGINE. Nothing is
 * charged here: a shot is charged when its image is delivered (V2's ledger
 * path, unchanged); the balance and the order caps are checked in SQL
 * (grovshot_run_create) against what the member's open orders may still
 * charge. Refused before anything is paid when the engine is not this
 * customer's (flag, the margin gate) → `engine_v1`; no ACTIVE knowledge
 * version → `knowledge_unpublished`; a step's Claude model or Nano Banana Pro
 * cannot be asked → named; the price shown is not the live one →
 * `price_changed`. The order pins the knowledge version (id + hash), the
 * engine settings and the engine version: it ends on them, whatever is
 * activated later.
 */

export const NOTES_MAX = 1_000;
/** The manual shot plan is an admin's tool; a customer's request carrying one is refused. */
const RUNS_PER_HOUR = 20;
const UNCHARGED_PER_DAY = 30;

export async function startShotOrder(supabase: Client, userId: string, workspaceId: string, body: StartBody & { notes?: unknown; userPlan?: unknown }): Promise<StartResult> {
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length === 0 || photos.length > 10 || !photos.every((p) => validPhotoPath(p, workspaceId)) || new Set(photos).size !== photos.length) {
    return { ok: false, error: "invalid_input" };
  }
  const shots = typeof body.shots === "number" && Number.isInteger(body.shots) ? body.shots : 0;
  if (shots < 1 || shots > 10) return { ok: false, error: "invalid_input" };
  if (body.sessionType !== undefined && body.sessionType !== "lifestyle") return { ok: false, error: "engine_v1" };
  const description = typeof body.description === "string" ? body.description.replace(/\r\n/g, "\n").trim() : "";
  if (Array.from(description).length > DESCRIPTION_MAX) return { ok: false, error: "description_too_long" };
  const quotedTotal = typeof body.quotedTotal === "number" && Number.isInteger(body.quotedTotal) ? body.quotedTotal : null;
  if (quotedTotal === null) return { ok: false, error: "invalid_input" };
  // The old form's dimensions travel as part of the notes (the description is the source of dimensions).
  const dims = parseDimensions(body.dimensions);
  if (!dims.ok) return { ok: false, error: "invalid_dimensions" };
  const rawNotes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (Array.from(rawNotes).length > NOTES_MAX) return { ok: false, error: "notes_too_long" };
  const notes = [rawNotes, dims.text ? `Wymiary podane przez klienta: ${dims.text}` : ""].filter(Boolean).join("\n");

  if (!(await grovshotV2Enabled(supabase, userId, workspaceId, { sessionType: "lifestyle" }))) return { ok: false, error: "engine_v1" };
  const admin = await isAdminUserId(supabase, userId);
  // Admin-only parameters are refused from anyone else — never just hidden.
  if (!admin && (body.userPlan !== undefined || (Array.isArray(body.shotBriefs) && body.shotBriefs.length > 0))) return { ok: false, error: "invalid_input" };
  // An admin's plan: the new rows, or the current form's shot briefs (text + one reference photo per row).
  const briefs = admin && body.userPlan === undefined ? resolveShotBriefs(body.shotBriefs, photos as string[]) : null;
  if (briefs && !briefs.ok) return { ok: false, error: "invalid_shot_plan" };
  const planRaw = body.userPlan !== undefined ? body.userPlan
    : briefs?.ok && briefs.briefs?.length ? briefs.briefs.slice(0, shots).map((x, i) => ({ numer: i + 1, opis: x.text, ...(x.refIndex ? { referencje: [x.refIndex] } : {}) }))
      : undefined;
  const userPlan = admin && planRaw !== undefined ? parseUserPlan(planRaw, { shots, photoCount: photos.length }) : null;
  if (userPlan === "invalid") return { ok: false, error: "invalid_shot_plan" };

  const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", "grovshot_shot").maybeSingle();
  const settings = parseShotSettings(settingsRow?.value ?? null);
  if (!settings.ok) return { ok: false, error: "config_invalid", blockers: settings.errors };
  if (!settings.settings.scenarios.lifestyle) return { ok: false, error: "engine_v1" };
  if (Array.from(description).length < settings.settings.description_min_chars) return { ok: false, error: "description_too_short" };

  const { data: kbRow, error: kbError } = await supabase.rpc("grovshot_shot_kb", { p_token: dispatchToken() ?? "", p_version_id: null });
  if (kbError) return { ok: false, error: "knowledge_unreadable" };
  const kbPin = kbRow as { id?: string; version?: number; sha256?: string; parsed?: unknown } | null;
  if (!kbPin?.id || !kbPin.sha256 || !readKb(kbPin.parsed)) return { ok: false, error: "knowledge_unpublished", blockers: ["knowledge_unpublished"] };

  const state = await readEngineState(supabase);
  if (!state.model) return { ok: false, error: "model_unavailable", blockers: state.blockers };
  const roles = (await roleBackends(supabase, settings.settings.models as never).catch(() => null))?.status ?? [];
  const unusable = roles.filter((r) => !r.usable).map((r) => `models.${r.role}:${r.primary.state}`);
  if (roles.length === 0 || unusable.length > 0) return { ok: false, error: "analysis_unavailable", blockers: unusable.length ? unusable : ["models:unreadable"] };
  const ratio = typeof body.aspectRatio === "string" ? body.aspectRatio : "";
  const resolution = typeof body.resolution === "string" ? body.resolution : "";
  if (!state.model.ratios.includes(ratio) || !state.model.resolutions.includes(resolution)) return { ok: false, error: "invalid_input" };
  const unit = state.model.pricing[resolution];
  if (typeof unit !== "number" || unit <= 0) return { ok: false, error: "model_unavailable" };
  const quote = { unit, total: unit * shots };
  if (quote.total !== quotedTotal) return { ok: false, error: "price_changed", quote };
  const unitPrice = imageUnitPrice(state, resolution);
  if (unitPrice === null) return { ok: false, error: "model_unavailable", blockers: ["price_unknown"] };

  const read = await readOrderPhotos(supabase, photos as string[]);
  if (!read.ok) return { ok: false, error: read.error };
  const shas = read.photos.map((p) => p.sha256);
  const input: ShotInput = {
    v: 2, engine: "grovshot_v2", pipeline: "lifestyle", engine_version: SHOT_ENGINE_VERSION, test: false,
    photos: photos as string[], photo_shas: shas, shots, aspect_ratio: ratio, resolution, session_type: "lifestyle",
    description, notes, user_plan: userPlan ?? null,
    quote, model: { id: state.model.id, identifier: state.model.identifier, provider: state.model.providerSlug },
    unit_price_usd_micros: unitPrice,
    budget_cap_usd_micros: Math.round(settings.settings.text_budget_usd * 1_000_000 + shots * IMAGE_MAX_CALLS * (unitPrice + 10_000)),
    settings: settings.settings,
    kb: { version_id: kbPin.id, version: Number(kbPin.version) || 0, sha256: kbPin.sha256 },
  };
  const bucket = Math.floor(Date.now() / 300_000);
  const key = `gsls:${workspaceId}:${bucket}:${sha256(JSON.stringify({ shas, d: sha256(description), notes, shots, ratio, resolution, userPlan, kb: kbPin.sha256 })).slice(0, 40)}`;
  const { data, error } = await supabase.rpc("grovshot_run_create", {
    p_token: dispatchToken() ?? "",
    p_run: {
      workspace_id: workspaceId, idempotency_key: key, run_kind: "grovshot", shots, engine_version: SHOT_ENGINE_VERSION,
      prompt_version: input.kb.version, runs_per_hour: RUNS_PER_HOUR, uncharged_per_day: UNCHARGED_PER_DAY, input,
    } as unknown as Json,
  });
  const out = (error ? null : data) as { id?: string; created?: boolean; error?: string; missing?: number } | null;
  if (!out) return { ...(slotRefusal(error?.message) ?? { ok: false, error: "run_create_failed" }), quote };
  if (out.error === "insufficient_credits") return { ok: false, error: "insufficient_credits", quote, missingCredits: out.missing ?? undefined };
  if (out.error) return { ok: false, error: out.error, quote };
  if (!out.id) return { ok: false, error: "run_create_failed", quote };
  return { ok: true, runId: out.id, created: Boolean(out.created), quote };
}

/**
 * A PAID REGENERATION of one shot of the member's own lifestyle order: the
 * same final prompt and references (the order's pinned knowledge, settings
 * and model), one new generation, charged only when its image is delivered —
 * a new order of one shot on the same ledger path. The earlier image stays;
 * the customer picks the version the set uses.
 */
type SrcRun = { user_id?: string; workspace_id?: string; run_kind?: string; status?: string; input?: Record<string, unknown> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readSrc(supabase: Client, runId: string): Promise<SrcRun | null> {
  const { data: rows } = await supabase.rpc("ai_engine_run_read", { p_token: dispatchToken() ?? "", p_run_id: runId });
  return Array.isArray(rows) ? (rows[0] as SrcRun | undefined) ?? null : null;
}

export async function startShotRegen(
  supabase: Client, userId: string, workspaceId: string, clickedRunId: string, clickedShot: number, quotedTotal: unknown,
  requestId?: string | null,
): Promise<StartResult> {
  if (!Number.isInteger(clickedShot) || clickedShot < 1 || clickedShot > 10) return { ok: false, error: "invalid_input" };
  const own = (r: SrcRun | null): r is SrcRun & { input: Record<string, unknown> } =>
    Boolean(r && r.input && r.user_id === userId && r.workspace_id === workspaceId && r.run_kind === "grovshot" && r.input.pipeline === "lifestyle");
  // A tile that is itself a regeneration regenerates the ORIGINAL order's shot
  // (one level: a regeneration always points at its order, never at another
  // regeneration) — same prompt, same references, a new separate image.
  let sourceRunId = clickedRunId;
  let shot = clickedShot;
  let src = await readSrc(supabase, sourceRunId);
  if (!own(src)) return { ok: false, error: "not_found" };
  const link = src.input.regen as { source_run_id?: unknown; shot?: unknown } | null | undefined;
  if (link) {
    if (typeof link.source_run_id !== "string" || !UUID_RE.test(link.source_run_id) || !Number.isInteger(link.shot)) return { ok: false, error: "not_found" };
    sourceRunId = link.source_run_id;
    shot = Number(link.shot);
    src = await readSrc(supabase, sourceRunId);
    if (!own(src) || src.input.regen) return { ok: false, error: "not_found" };
  }
  const input = src.input;
  if (src.status === "queued" || src.status === "running") return { ok: false, error: "order_in_progress" };
  if (shot > Number(input.shots)) return { ok: false, error: "invalid_input" };
  if (!(await grovshotV2Enabled(supabase, userId, workspaceId, { sessionType: "lifestyle" }))) return { ok: false, error: "engine_v1" };
  const state = await readEngineState(supabase);
  const resolution = String(input.resolution ?? "");
  const unit = state.model?.pricing[resolution];
  if (!state.model || typeof unit !== "number" || unit <= 0) return { ok: false, error: "model_unavailable" };
  const quote = { unit, total: unit };
  if (quotedTotal !== quote.total) return { ok: false, error: "price_changed", quote };
  const unitPrice = imageUnitPrice(state, resolution);
  if (unitPrice === null) return { ok: false, error: "model_unavailable" };
  const regenInput: ShotInput = {
    v: 2, engine: "grovshot_v2", pipeline: "lifestyle", engine_version: SHOT_ENGINE_VERSION, test: false,
    photos: input.photos as string[], photo_shas: input.photo_shas as string[], shots: 1,
    aspect_ratio: String(input.aspect_ratio), resolution, session_type: "lifestyle", description: "", notes: "", user_plan: null,
    quote, model: input.model as ShotInput["model"], unit_price_usd_micros: unitPrice,
    budget_cap_usd_micros: IMAGE_MAX_CALLS * (unitPrice + 10_000),
    settings: input.settings, kb: input.kb as ShotInput["kb"], regen: { source_run_id: sourceRunId, shot },
  };
  // One confirmed click = one generation: the client's request id makes a
  // double submit of the SAME click land on the same run; a new click is a new
  // image. Without an id (older clients): one per shot per 5 minutes.
  const key = requestId && UUID_RE.test(requestId)
    ? `gslsr:${workspaceId}:${sha256(`${sourceRunId}:${shot}:${requestId}`).slice(0, 40)}`
    : `gslsr:${workspaceId}:${Math.floor(Date.now() / 300_000)}:${sha256(`${sourceRunId}:${shot}`).slice(0, 32)}`;
  const { data, error } = await supabase.rpc("grovshot_run_create", {
    p_token: dispatchToken() ?? "",
    p_run: {
      workspace_id: workspaceId, idempotency_key: key, run_kind: "grovshot", shots: 1, engine_version: SHOT_ENGINE_VERSION,
      prompt_version: Number((input.kb as { version?: number } | undefined)?.version) || null,
      runs_per_hour: RUNS_PER_HOUR, uncharged_per_day: UNCHARGED_PER_DAY, input: regenInput,
    } as unknown as Json,
  });
  const out = (error ? null : data) as { id?: string; created?: boolean; error?: string; missing?: number } | null;
  if (!out) return { ...(slotRefusal(error?.message) ?? { ok: false, error: "run_create_failed" }), quote };
  if (out.error === "insufficient_credits") return { ok: false, error: "insufficient_credits", quote, missingCredits: out.missing ?? undefined };
  if (out.error) return { ok: false, error: out.error, quote };
  if (!out.id) return { ok: false, error: "run_create_failed", quote };
  return { ok: true, runId: out.id, created: Boolean(out.created), quote };
}
