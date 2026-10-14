import "server-only";
import type { Client } from "@/lib/services/workspace";
import { billingFrom, creditsForCost, type BillingConfig } from "@/lib/images/pricing";
import { readThumbnailService, readThumbnailState, type ThumbnailState } from "@/lib/server/thumbnail/settings";
import { estimateSunburstCost, marginOf, type MeasuredCall, type UsageLike } from "@/lib/thumbnail/cost";
import { STEP, THUMBNAIL_REFERENCE_PROMPT_SHA256 } from "@/lib/thumbnail/config";

/**
 * MINIATURKA ON ITS ADMIN PAGE — everything the operator needs to decide,
 * read in the admin's own session (runs and step runs are admin-read).
 *
 *   readiness      what still blocks a customer run, by name
 *   the prompt     published version, its SHA-256, the release reference,
 *                  whether this text is approved and by whom
 *   OpenAI         provider active, key stored (never the key)
 *   money          the price set in Admin → Usługi, Retusz's price, provider
 *                  cost per run (measured from real `usage`, estimated before
 *                  from the runs already made — UNKNOWN until there are some
 *                  and the token rates are entered), margin at the reference
 *                  credit price, and a suggested minimum (never applied)
 *   runs           the last runs: status, error, photos, Retusz, tokens, cost
 */

export type ThumbnailRunRow = {
  id: string;
  createdAt: string;
  status: string;
  error: string | null;
  photos: number;
  retouch: boolean;
  credits: number | null;
  durationMs: number | null;
  model: string | null;
  quality: string | null;
  size: string | null;
  responseSize: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  imageTokens: number | null;
  textTokens: number | null;
  costUsdMicros: number | null;
  composeError: string | null;
  retouchFailed: number;
  delivered: { width: number | null; height: number | null } | null;
};

export type ThumbnailAdmin = {
  state: ThumbnailState;
  service: { credits: number; enabled: boolean; maintenance: boolean } | null;
  billing: BillingConfig;
  referenceSha256: string;
  runs: ThumbnailRunRow[];
  stats: { runs: number; ok: number; failed: number; costKnown: number; costUsdMicros: number };
  /** Average provider cost per composition, from real usage (null = unknown). */
  measured: { samples: number; avgUsdMicros: number | null };
  /** Estimates for the configured photo limit and for 1/4 photos. */
  estimates: { photos: number; usdMicros: number | null }[];
  economics: {
    /** One composition at the catalogue price. */
    thumbnail: ReturnType<typeof marginOf> | null;
    /** Suggested minimum credits from the measured cost (not applied). */
    suggestedMin: number | null;
  };
};

type StepRow = { run_id: string; position: number; item_index: number; status: string; error_code: string | null; output: unknown; cost_usd_micros: number | null; input_tokens: number | null; output_tokens: number | null };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function readThumbnailAdmin(supabase: Client): Promise<ThumbnailAdmin> {
  const [state, service, { data: billingRow }, { data: runRows }] = await Promise.all([
    readThumbnailState(supabase),
    readThumbnailService(supabase),
    supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
    supabase.from("ai_engine_runs")
      .select("id, created_at, status, error, input, credits, duration_ms, api_cost_usd_micros")
      .eq("run_kind", "thumbnail").order("created_at", { ascending: false }).limit(50),
  ]);
  const billing = billingFrom(billingRow?.value);
  const runs = (runRows ?? []) as { id: string; created_at: string; status: string; error: string | null; input: unknown; credits: number | null; duration_ms: number | null; api_cost_usd_micros: number | null }[];
  const ids = runs.map((r) => r.id);
  const { data: stepRows } = ids.length
    ? await supabase.from("ai_engine_step_runs")
        .select("run_id, position, item_index, status, error_code, output, cost_usd_micros, input_tokens, output_tokens")
        .in("run_id", ids)
    : { data: [] as StepRow[] };
  const steps = (stepRows ?? []) as StepRow[];

  const history: MeasuredCall[] = [];
  const rows: ThumbnailRunRow[] = runs.map((r) => {
    const input = obj(r.input);
    const config = obj(input.config);
    const own = steps.filter((s) => s.run_id === r.id);
    const compose = own.find((s) => s.position === STEP.compose);
    const finish = own.find((s) => s.position === STEP.finish && s.status === "succeeded");
    const out = obj(compose?.output);
    const usage = obj(out.usage) as unknown as UsageLike;
    const photos = Array.isArray(input.photos) ? input.photos.length : 0;
    if (compose?.status === "succeeded" && out.usage) history.push({ photos, usage });
    const fin = obj(finish?.output);
    return {
      id: r.id,
      createdAt: r.created_at,
      status: r.status,
      error: r.error,
      photos,
      retouch: input.retouch === true,
      credits: r.credits,
      durationMs: r.duration_ms,
      model: typeof config.model === "string" ? config.model : null,
      quality: typeof config.quality === "string" ? config.quality : null,
      size: typeof config.size === "string" ? config.size : null,
      responseSize: typeof obj(out.response).size === "string" ? String(obj(out.response).size) : null,
      inputTokens: compose?.input_tokens ?? null,
      outputTokens: compose?.output_tokens ?? null,
      imageTokens: num(usage.inputImageTokens),
      textTokens: num(usage.inputTextTokens),
      costUsdMicros: compose?.cost_usd_micros ?? null,
      composeError: compose?.status === "failed" ? compose.error_code : null,
      retouchFailed: own.filter((s) => s.position === STEP.retouch && s.status === "failed").length,
      delivered: finish ? { width: num(fin.width), height: num(fin.height) } : null,
    };
  });

  const known = rows.filter((r) => r.costUsdMicros !== null);
  const costUsdMicros = known.reduce((s, r) => s + (r.costUsdMicros ?? 0), 0);
  const prices = state.config?.tokenPrices ?? null;
  const maxPhotos = state.config?.maxPhotos ?? 10;
  const estimates = [1, 4, maxPhotos].filter((v, i, a) => a.indexOf(v) === i).map((photos) => {
    const e = prices ? estimateSunburstCost(history, photos, prices) : { known: false as const, samples: 0 };
    return { photos, usdMicros: e.known ? e.usdMicros : null };
  });
  const avg = known.length ? Math.round(costUsdMicros / known.length) : null;
  const credits = service?.credits ?? 0;
  return {
    state,
    service: service ? { credits: service.credits, enabled: service.enabled, maintenance: service.maintenance } : null,
    billing,
    referenceSha256: THUMBNAIL_REFERENCE_PROMPT_SHA256,
    runs: rows.slice(0, 20),
    stats: {
      runs: rows.length,
      ok: rows.filter((r) => r.status === "ok").length,
      failed: rows.filter((r) => r.status === "failed").length,
      costKnown: known.length,
      costUsdMicros,
    },
    measured: { samples: known.length, avgUsdMicros: avg },
    estimates,
    economics: {
      thumbnail: credits > 0
        ? marginOf({ credits, plnPerCredit: billing.plnPerCredit, costUsdMicros: avg, usdToPln: billing.usdToPln })
        : null,
      suggestedMin: avg !== null ? creditsForCost(avg / 1_000_000, billing) : null,
    },
  };
}
