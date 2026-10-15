import "server-only";
import type { Client } from "@/lib/services/workspace";
import { STEP } from "@/lib/thumbnail/config";

/**
 * MINIATURKA — ONE RUN, STAGE BY STAGE, FOR THE ADMIN.
 *
 * Read in the admin's own session: runs, step runs, Retusz jobs and the
 * Retusz network boundary are admin-read; the images are signed with the
 * admin's session (product-images / generation-assets admit admins).
 * Nothing here is ever sent to a customer: the customer's route reads
 * lib/server/thumbnail/status.ts.
 *
 *   1  the photos as uploaded
 *   2  Retusz AI per photo — the real request as the Retusz path recorded it
 *      at its network boundary (provider, model, endpoint, prompt hash,
 *      input hash, fields) and the file it delivered
 *   3  the composition — the real OpenAI request (endpoint, model, params,
 *      prompt hash, each input's hash checked against its Retusz job), the
 *      response (size, hash) and usage
 *   4  the local finish — the delivered file and its checks
 *
 * The provider's raw image is NOT stored: the finish is deterministic
 * (resize, +5% brightness, white margin — no AI), so the delivered file
 * shows the composition's content; its size and hash are recorded.
 *
 * Never a key, never prompt text: hashes and versions only.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? v as Json : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DiagImage = { path: string; url: string | null };

export type RetouchStage = {
  index: number;
  status: string;
  error: string | null;
  original: DiagImage;
  output: DiagImage | null;
  jobId: string | null;
  reused: boolean;
  recovered: boolean;
  /** As recorded by the Retusz path at its network boundary (admin-only). */
  request: {
    provider: string | null; model: string | null; endpoint: string | null; method: string | null;
    store: boolean | null; fields: string[]; inputOrder: string[]; httpRequests: number | null; fallback: string | null;
    historyCount: number | null; imageSize: string | null; aspectRatio: string | null;
    systemInstruction: boolean | null; generationConfig: boolean | null; contractOk: boolean | null;
    promptVersion: number | null; promptSha256: string | null; publishedEqualsProvider: boolean | null;
    inputSha256: string | null; inputBytes: number | null; inputTransform: string | null; inputEqualsOriginal: boolean | null;
    bodySha256: string | null;
  } | null;
  delivered: { providerWidth: number | null; providerHeight: number | null; storedWidth: number | null; storedHeight: number | null; storedSha256: string | null; postprocess: string | null } | null;
};

export type ThumbnailDiagnostics = {
  id: string;
  createdAt: string;
  status: string;
  error: string | null;
  /** A read failed: what is missing below is UNKNOWN, not absent. */
  incomplete: boolean;
  retouch: boolean;
  photos: DiagImage[];
  retouchStages: RetouchStage[];
  compose: {
    status: string | null;
    error: string | null;
    provider: string | null; model: string | null; endpoint: string | null; method: string | null;
    quality: string | null; size: string | null; n: number | null; background: string | null; outputFormat: string | null;
    fields: string[]; promptVersion: number | null; promptSha256: string | null; contract: string | null;
    inputs: { index: number; sourcePath: string | null; sentSha256: string | null; bytes: number | null; mime: string | null; transform: string | null; retouchJobId: string | null; retouchVerified: boolean | null }[];
    requestId: string | null; httpStatus: number | null;
    response: { width: number | null; height: number | null; sha256: string | null; dataCount: number | null; durationMs: number | null } | null;
    usage: Json | null; costUsdMicros: number | null;
  } | null;
  finish: {
    status: string | null;
    image: DiagImage | null;
    width: number | null; height: number | null; marginPx: number | null;
    inner: Json | null; checks: Json | null; postprocess: string[];
  } | null;
};

export async function readThumbnailDiagnostics(supabase: Client, runId: string): Promise<ThumbnailDiagnostics | "unavailable" | null> {
  if (!UUID.test(runId)) return null;
  const { data: run, error: runError } = await supabase.from("ai_engine_runs")
    .select("id, created_at, status, error, input, run_kind").eq("id", runId).maybeSingle();
  if (runError) return "unavailable";
  if (!run || run.run_kind !== "thumbnail") return null;
  let incomplete = false;
  const input = obj(run.input);
  const photoPaths = (Array.isArray(input.photos) ? input.photos : []).filter((p): p is string => typeof p === "string");
  const { data: stepRows, error: stepError } = await supabase.from("ai_engine_step_runs")
    .select("position, item_index, status, error_code, output").eq("run_id", runId);
  if (stepError) incomplete = true;
  const steps = (stepRows ?? []) as { position: number; item_index: number; status: string; error_code: string | null; output: unknown }[];

  // The Retusz jobs and their network boundary (one trace run per job).
  const retouchSteps = steps.filter((s) => s.position === STEP.retouch).sort((a, b) => a.item_index - b.item_index);
  const jobIds = retouchSteps.map((s) => str(obj(s.output).job_id)).filter((v): v is string => Boolean(v));
  const [{ data: jobRows, error: jobError }, { data: traceRows, error: traceError }] = await Promise.all([
    jobIds.length ? supabase.from("generation_jobs").select("id, settings").in("id", jobIds) : Promise.resolve({ data: [] as { id: string; settings: unknown }[], error: null }),
    jobIds.length ? supabase.from("ai_engine_runs").select("job_id, network_boundary").eq("run_kind", "trace").in("job_id", jobIds) : Promise.resolve({ data: [] as { job_id: string | null; network_boundary: unknown }[], error: null }),
  ]);
  if (jobError || traceError) incomplete = true;
  const jobs = new Map((jobRows ?? []).map((j) => [j.id, obj(j.settings)]));
  const boundaries = new Map((traceRows ?? []).filter((r) => r.job_id).map((r) => [r.job_id as string, obj(r.network_boundary)]));

  const compose = steps.find((s) => s.position === STEP.compose);
  const diag = steps.find((s) => s.position === STEP.diagnostics);
  const finish = steps.find((s) => s.position === STEP.finish);
  const composeOut = obj(compose?.output);
  const failedRecord = obj(diag?.output);
  const request = obj(composeOut.request ?? failedRecord.request);
  const boundary = obj(request.boundary);
  const finishOut = obj(finish?.output);

  // Every image, signed in batches per bucket (admin session).
  const want = { product: new Set<string>(photoPaths), assets: new Set<string>() };
  for (const s of retouchSteps) { const p = str(obj(s.output).path); if (p) want.assets.add(p); }
  const finalPath = str(finishOut.path);
  if (finalPath) want.assets.add(finalPath);
  const urls = new Map<string, string>();
  const sign = async (bucket: string, key: string, paths: Set<string>) => {
    if (paths.size === 0) return;
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls([...paths], 3600);
    if (error) incomplete = true;
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(`${key}:${s.path}`, s.signedUrl);
  };
  await Promise.all([
    sign("product-images", "p", want.product),
    sign("generation-assets", "a", want.assets),
  ]);
  const img = (key: string, path: string | null): DiagImage | null => (path ? { path, url: urls.get(`${key}:${path}`) ?? null } : null);

  const retouchStages: RetouchStage[] = Boolean(input.retouch) ? photoPaths.map((photo, index) => {
    const s = retouchSteps.find((x) => x.item_index === index);
    const o = obj(s?.output);
    const jobId = str(o.job_id);
    const job = jobId ? jobs.get(jobId) ?? {} : {};
    const b = jobId ? boundaries.get(jobId) ?? null : null;
    const out = obj(Array.isArray(job.provider_output) ? job.provider_output[0] : null);
    const pin = obj(Array.isArray(b?.provider_inputs) ? (b?.provider_inputs as unknown[])[0] : null);
    return {
      index,
      status: s?.status ?? "pending",
      error: s?.error_code ?? null,
      original: img("p", photo)!,
      output: img("a", str(o.path)),
      jobId,
      reused: o.reused === true,
      recovered: o.recovered === true,
      request: b ? {
        provider: str(b.provider), model: str(b.model), endpoint: str(b.endpoint), method: str(b.method),
        store: typeof b.store === "boolean" ? b.store : null,
        fields: Array.isArray(b.request_field_names) ? (b.request_field_names as unknown[]).map(String) : [],
        inputOrder: Array.isArray(b.input_order) ? (b.input_order as unknown[]).map(String) : [],
        httpRequests: num(b.http_requests), fallback: str(b.fallback), historyCount: num(b.history_count),
        imageSize: str(b.image_size), aspectRatio: str(b.aspect_ratio),
        systemInstruction: typeof b.system_instruction_present === "boolean" ? b.system_instruction_present : null,
        generationConfig: typeof b.generation_config_present === "boolean" ? b.generation_config_present : null,
        contractOk: typeof b.contract_ok === "boolean" ? b.contract_ok : null,
        promptVersion: num(b.prompt_version), promptSha256: str(b.provider_prompt_sha256),
        publishedEqualsProvider: str(b.published_prompt_sha256) !== null ? b.published_prompt_sha256 === b.provider_prompt_sha256 : null,
        inputSha256: str(pin.sha256), inputBytes: num(pin.bytes), inputTransform: str(b.input_transform),
        inputEqualsOriginal: str(pin.sha256) !== null ? pin.sha256 === b.input_original_sha256 : null,
        bodySha256: str(b.request_body_sha256),
      } : null,
      delivered: Object.keys(out).length ? {
        providerWidth: num(out.provider_returned_width), providerHeight: num(out.provider_returned_height),
        storedWidth: num(out.stored_width), storedHeight: num(out.stored_height),
        storedSha256: str(out.stored_sha256), postprocess: str(out.postprocess),
      } : null,
    };
  }) : [];

  const response = obj(composeOut.response);
  const inputs = Array.isArray(request.inputs) ? (request.inputs as unknown[]).map(obj) : [];
  return {
    id: run.id,
    createdAt: run.created_at,
    status: run.status,
    error: run.error,
    incomplete,
    retouch: Boolean(input.retouch),
    photos: photoPaths.map((p) => img("p", p)!),
    retouchStages,
    compose: compose || diag ? {
      status: compose?.status ?? null,
      error: compose?.error_code ?? str(failedRecord.error),
      provider: str(request.provider), model: str(request.model) ?? str(boundary.model),
      endpoint: str(boundary.endpoint) ?? str(request.endpoint), method: str(boundary.method),
      quality: str(request.quality), size: str(request.size), n: num(request.n),
      background: str(request.background), outputFormat: str(request.output_format),
      fields: Array.isArray(boundary.fields) ? (boundary.fields as unknown[]).map(String) : [],
      promptVersion: num(request.prompt_version), promptSha256: str(request.prompt_sha256), contract: str(boundary.contract),
      inputs: inputs.map((x) => ({
        index: num(x.index) ?? 0, sourcePath: str(x.source_path), sentSha256: str(x.sent_sha256), bytes: num(x.bytes),
        mime: str(x.mime), transform: str(x.transform), retouchJobId: str(x.retouch_job_id),
        retouchVerified: typeof x.retouch_verified === "boolean" ? x.retouch_verified : null,
      })),
      requestId: str(composeOut.request_id) ?? str(failedRecord.request_id),
      httpStatus: num(response.http_status) ?? num(failedRecord.http_status),
      response: Object.keys(response).length ? {
        width: num(response.width), height: num(response.height), sha256: str(response.sha256),
        dataCount: num(response.data_count), durationMs: num(response.duration_ms),
      } : null,
      usage: Object.keys(obj(composeOut.usage ?? failedRecord.usage)).length ? obj(composeOut.usage ?? failedRecord.usage) : null,
      costUsdMicros: num(composeOut.cost_usd_micros) ?? num(failedRecord.cost_usd_micros),
    } : null,
    finish: finish ? {
      status: finish.status,
      image: img("a", finalPath),
      width: num(finishOut.width), height: num(finishOut.height), marginPx: num(finishOut.margin_px),
      inner: Object.keys(obj(finishOut.inner)).length ? obj(finishOut.inner) : null,
      checks: Object.keys(obj(finishOut.checks)).length ? obj(finishOut.checks) : null,
      postprocess: Array.isArray(finishOut.postprocess) ? (finishOut.postprocess as unknown[]).map(String) : [],
    } : null,
  };
}
