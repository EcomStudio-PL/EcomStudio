import "server-only";
import { createHash } from "crypto";
import type { Client } from "@/lib/services/workspace";
import { decryptSecret, encryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { ProviderError, type ReferenceImage } from "@/lib/ai/types";
import { proposeScenes, synthesizeScenes, type PlannedScene } from "@/lib/ai/engine/scenes";
import { composeFinalPrompt, validateFinalPrompt, PROMPT_TEMPLATE_VERSION } from "@/lib/ai/engine/template-prompt";
import { VISION_MODEL, type VisionBackend, type VisionOutcome, type VisionProvider } from "@/lib/ai/engine/vision";
import type { ImageAnalysis, SessionInput } from "@/lib/ai/engine/types";
import { startUsage, completeUsage, failUsage } from "@/lib/services/usage";
import { getEngineRuleDirectives, retrieveKnowledgeHints } from "@/lib/server/knowledge";

export type ShotBrief = {
  /** The customer's own words for this shot — optional, max ~300 chars. */
  text?: string;
  /** Keep the framing/composition of the reference photo tied to this shot. */
  keepFraming?: boolean;
  /** 1-based reference image this shot leans on (defaults to the primary). */
  refIndex?: number;
};

export type PromptSessionInput = {
  /** Only ever supplied by callers that already hold a catalogue product;
   *  the generator sends none and creates none. */
  productId?: string;
  /** Optional label. The generator does not ask for a product name — the
   *  vision pass reads the product off the reference photos. */
  productName?: string;
  description?: string;
  extraInfo?: string;
  style?: string;
  aspectRatio: string;
  /** Storage paths in product-images already uploaded by the client. */
  referencePaths: string[];
  /** How many shot concepts to design (1-10; the server clamps). */
  shots?: number;
  /** Output size for every shot in the batch ("1K" | "2K" | "4K"). The
   *  model's real capabilities are enforced again at generation time. */
  resolution?: string;
  /** Locale for the customer-facing card copy (pl / en / de). */
  locale?: string;
  /** Customer-chosen session flavour: steers the internal scene planning. */
  sessionType?: "advertising" | "lifestyle";
  /** Optional per-shot customer briefs, index-aligned with the shot order. */
  shotBriefs?: ShotBrief[];
};

/** The internal directive each session type feeds the planner. These are
 *  engine IP: they never leave the server. */
const SESSION_TYPE_DIRECTIVES: Record<"advertising" | "lifestyle", string> = {
  advertising:
    "Sesja reklamowa: dopracowana, komercyjna sceneria premium, studyjna precyzja światła, kompozycje jak z profesjonalnej kampanii reklamowej.",
  lifestyle:
    "Sesja lifestyle: naturalne, codzienne otoczenie i swobodny klimat, produkt pokazany w realnym użyciu, autentyczne wnętrza lub plenery, miękkie naturalne światło.",
};

/** One customer brief, cleaned to travel inside an engine scene: control
 *  characters out, single line, hard cap. */
export function sanitizeBriefText(raw: unknown): string {
  return String(raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

const KEEP_FRAMING_DIRECTIVE =
  "Zachowaj kadr, kompozycję i perspektywę wskazanego zdjęcia referencyjnego — zmień tylko scenerię i otoczenie.";

/** Only the three sizes the platform knows are ever stored; anything else
 *  falls back to the model default at generation time. */
export function normalizeResolution(raw: unknown): string | null {
  return raw === "1K" || raw === "2K" || raw === "4K" ? raw : null;
}

export const MIN_SHOTS = 1;
export const MAX_SHOTS = 10;
/** The batch size a request gets when it names none — NOT the minimum:
 *  one shot is a deliberate choice, five is the sensible session. */
const DEFAULT_SHOTS = 5;
export function clampShots(raw: unknown): number {
  const n = typeof raw === "number" ? Math.trunc(raw) : Number(raw);
  return Number.isFinite(n) ? Math.min(MAX_SHOTS, Math.max(MIN_SHOTS, n)) : DEFAULT_SHOTS;
}

const CUSTOMER_LANGUAGE: Record<string, string> = { pl: "Polish", en: "English", de: "German" };

/** `prompt_sessions.product_name` is NOT NULL and shows up in the admin's
 *  session list; without a typed description this is the readable stand-in. */
const SESSION_FALLBACK_LABEL = "Sesja generowania";

/**
 * The seller-facing concept payload that IS allowed to leave the server.
 * There is deliberately no field for the prompt: everything internal travels
 * only as AES-256-GCM ciphertext in the encrypted columns.
 */
export type ConceptPayloadMeta = {
  /** prompt_template_version */
  tv?: number;
  /** scene_goal — what this shot is meant to sell */
  goal?: string;
  /** composition_type — camera distance / framing family */
  comp?: string;
  /** scenery category the template used */
  cat?: string;
};

export function encryptConceptPayload(
  prompt: string, negative: string, meta?: ConceptPayloadMeta,
): { ciphertext: string; iv: string; authTag: string } {
  return encryptSecret(JSON.stringify({ p: prompt, n: negative, ...(meta ?? {}) }));
}

export function decryptConceptPayload(row: {
  prompt_encrypted: string | null; prompt_iv: string | null; prompt_tag: string | null;
}): { prompt: string; negative: string; meta: ConceptPayloadMeta } | null {
  if (!row.prompt_encrypted || !row.prompt_iv || !row.prompt_tag) return null;
  try {
    const parsed = JSON.parse(decryptSecret(row.prompt_encrypted, row.prompt_iv, row.prompt_tag)) as
      { p?: string; n?: string } & ConceptPayloadMeta;
    if (typeof parsed.p !== "string" || !parsed.p) return null;
    return {
      prompt: parsed.p, negative: parsed.n ?? "",
      meta: { tv: parsed.tv, goal: parsed.goal, comp: parsed.comp, cat: parsed.cat },
    };
  } catch {
    return null;
  }
}

export type PromptSessionOutput =
  | { ok: true; sessionId: string; productId: string; promptCount: number }
  | { ok: false; error: string; sessionId?: string };

/** Bump when the analysis schema or lock semantics change — cached analyses
 *  from older engines are then ignored rather than silently reused. */
export const ENGINE_VERSION = 3;

/** Stable fingerprint of the ANALYSIS INPUT: the reference set (order-free)
 *  plus the product name and description, because both feed the manifest.
 *  Same fingerprint ⇒ the cached analysis and Product Lock are still true. */
function hashAnalysisInput(
  paths: string[], name: string, description: string | null, extra = "",
): string {
  return createHash("sha256")
    .update([...paths].sort().join("\n"))
    .update("\x00" + name.trim().toLowerCase())
    .update("\x00" + (description ?? "").trim().toLowerCase())
    .update("\x00" + extra)
    .digest("hex").slice(0, 40);
}

/**
 * CANDIDATE POOL SIZE. Asking the planner for a couple of concepts MORE than
 * ordered means the diversity and supported-view filters can reject their
 * duds without forcing a second sequential AI call — the overwhelming
 * majority of sessions now finish the scene stage in exactly one request.
 * Capped so a 10-shot order cannot push the response past token limits.
 */
export function candidatePoolSize(shots: number): number {
  return Math.min(shots + 2, 12);
}

const RATIOS = new Set(["1:1", "3:4", "4:5", "16:9", "9:16"]);
const MAX_REFS = 8;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 18 * 1024 * 1024;

/** Analysis model id, admin-configurable without a deploy:
 *  app_settings("generation").analysis_model. Falls back to the engine
 *  default (which itself falls back across model ids on 404). */
async function getAnalysisModel(supabase: Client): Promise<string> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "generation").maybeSingle();
  const configured = (data?.value as { analysis_model?: string } | null)?.analysis_model;
  return typeof configured === "string" && configured.trim() ? configured.trim() : VISION_MODEL;
}

/**
 * PLANNER PROVIDER CHAIN — its own admin configuration, fully independent of
 * the image models: app_settings("generation").planner_provider is the
 * primary, planner_fallback is OPTIONAL and used only when the admin set it.
 * Credentials come back as ciphertext through the definer RPC and are
 * decrypted only here, server-side. A provider without a usable key is simply
 * absent from the chain — a broken key can never take the others down.
 */
const PLANNER_CAPABLE: VisionProvider[] = ["openai", "google"];

async function plannerProviderOrder(supabase: Client): Promise<VisionProvider[]> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "generation").maybeSingle();
  const cfg = (data?.value ?? {}) as { planner_provider?: string; planner_fallback?: string };
  const primary = PLANNER_CAPABLE.includes(cfg.planner_provider as VisionProvider)
    ? (cfg.planner_provider as VisionProvider) : "openai";
  const fallback = PLANNER_CAPABLE.includes(cfg.planner_fallback as VisionProvider)
    && cfg.planner_fallback !== primary
    ? (cfg.planner_fallback as VisionProvider) : null;
  return fallback ? [primary, fallback] : [primary];
}

async function getVisionBackends(supabase: Client, primaryModel: string): Promise<VisionBackend[]> {
  if (!encryptionAvailable()) return [];
  const order = await plannerProviderOrder(supabase);
  const { data: providers } = await supabase
    .from("ai_providers").select("id, slug").eq("active", true).in("slug", order);
  if (!providers?.length) return [];

  const backends: VisionBackend[] = [];
  for (const slug of order) {
    const provider = providers.find((p) => p.slug === slug);
    if (!provider) continue;
    const { data: credRows } = await supabase.rpc("get_active_provider_credential", { p_provider_id: provider.id });
    const cred = credRows?.[0];
    if (!cred) continue;
    try {
      backends.push({
        provider: slug,
        cred: { apiKey: decryptSecret(cred.encrypted_value, cred.iv, cred.auth_tag), baseUrl: cred.base_url },
        model: slug === "google" ? primaryModel : undefined,
      });
    } catch { /* undecryptable key: skip this provider, keep the rest */ }
  }
  return backends;
}

async function downloadReferences(supabase: Client, paths: string[]): Promise<ReferenceImage[]> {
  const refs: ReferenceImage[] = [];
  let total = 0;
  for (const path of paths.slice(0, MAX_REFS)) {
    const { data: blob } = await supabase.storage.from("product-images").download(path);
    if (!blob) continue;
    const buf = Buffer.from(await blob.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES || total + buf.length > MAX_TOTAL_BYTES) continue;
    total += buf.length;
    const ext = path.split(".").pop()?.toLowerCase();
    refs.push({
      base64: buf.toString("base64"),
      mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "avif" ? "image/avif" : "image/jpeg",
    });
  }
  return refs;
}

/** Follow an adopted in-flight session until it settles. Returns the same
 *  shape the original request will produce, or null when the run failed or
 *  the wait window closed (the caller then proceeds as a normal request). */
async function waitForSession(supabase: Client, sessionId: string): Promise<PromptSessionOutput | null> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const { data: s } = await supabase
      .from("prompt_sessions").select("id, status, product_id").eq("id", sessionId).maybeSingle();
    if (!s) return null;
    if (s.status === "ready") {
      const { count } = await supabase
        .from("generated_prompts").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
      return { ok: true, sessionId, productId: s.product_id ?? "", promptCount: count ?? 0 };
    }
    if (s.status === "failed") return null;
  }
  return null;
}

/**
 * "PRZYGOTUJ N UJĘĆ" (N = 5-10, the seller's choice): analyse every reference
 * once, build the Product Feature Manifest and Product Lock once, design
 * exactly N diverse product-appropriate scenes with per-scene reference
 * selection, and store N encrypted master prompts. Tracked through the
 * universal usage ledger (service `prompt_generation` — 0 credits: preparing
 * the plan never spends the seller's image budget).
 */
export async function runPromptSession(
  supabase: Client, userId: string, workspaceId: string, input: PromptSessionInput
): Promise<PromptSessionOutput> {
  if (!RATIOS.has(input.aspectRatio)) return { ok: false, error: "invalid_input" };
  if (!input.referencePaths?.length) return { ok: false, error: "references_required" };

  // NO PRODUCT NAME IS REQUIRED. The seller drops photos and generates; the
  // vision pass reads the product off the references themselves. Whatever
  // they typed as a description doubles as the session's readable label.
  const productLabel = (input.productName?.trim() || input.description?.trim().split(/[.\n]/)[0] || "").slice(0, 80).trim();

  const analysisModel = await getAnalysisModel(supabase);
  const backends = await getVisionBackends(supabase, analysisModel);
  if (backends.length === 0) return { ok: false, error: "analysis_unavailable" };

  // Normalized customer briefs — index-aligned with the shot order. A brief
  // participates only when it carries at least a few characters of text.
  const shotsOrdered = clampShots(input.shots);
  const sessionType = input.sessionType === "advertising" || input.sessionType === "lifestyle"
    ? input.sessionType : null;
  const briefs = Array.from({ length: shotsOrdered }, (_, i) => {
    const raw = input.shotBriefs?.[i];
    const refIndex = Number.isInteger(raw?.refIndex) && (raw!.refIndex as number) >= 1 && (raw!.refIndex as number) <= MAX_REFS
      ? (raw!.refIndex as number) : null;
    return { text: sanitizeBriefText(raw?.text), keepFraming: !!raw?.keepFraming, refIndex };
  });
  const briefedCount = briefs.filter((b) => b.text.length >= 3).length;

  // Everything that changes WHAT gets planned or rendered is part of the
  // replay/retry fingerprint: flavour, briefs, shot count, framing, size and
  // style. A true network replay (identical body) still dedupes; a request
  // that differs in any output parameter is its own session.
  const referenceHash = hashAnalysisInput(
    input.referencePaths.slice(0, MAX_REFS), productLabel, input.description ?? null,
    JSON.stringify({
      st: sessionType,
      // A row that only picked a REFERENCE now changes what gets rendered,
      // so it belongs in the fingerprint too — otherwise re-generating after
      // swapping just the reference would adopt the previous session.
      b: briefs.filter((b) => b.text || b.keepFraming || b.refIndex !== null),
      n: shotsOrdered,
      ar: input.aspectRatio,
      rs: normalizeResolution(input.resolution),
      sty: input.style?.trim() || null,
    }),
  );

  // A NETWORK REPLAY MUST NOT START A SECOND PIPELINE. A preparation can
  // outlive a proxy's response window; the HTTP stack then re-sends the same
  // POST while the first one is still working. A request whose input matches
  // a session that is being analysed right now adopts that session and waits
  // for its result instead of duplicating the product, the session and the
  // whole analysis.
  const { data: inflight } = await supabase
    .from("prompt_sessions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "analyzing")
    .eq("reference_hash", referenceHash)
    .gte("created_at", new Date(Date.now() - 6 * 60_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(1).maybeSingle();
  if (inflight) {
    const adopted = await waitForSession(supabase, inflight.id);
    if (adopted) return adopted;
    // The in-flight run failed or timed out — continue normally; a failed
    // session is picked up and reused by the retry block below.
  }

  // THE GENERATOR NEVER WRITES TO THE PRODUCT CATALOGUE. A session used to
  // create a `products` row (plus its images) just because photos were
  // uploaded; sellers work from today's photos instead, so the session IS
  // the record. An explicitly supplied product (e.g. from the products page)
  // is still honoured read-only — it is never created or modified here.
  let productId: string | null = null;
  if (input.productId) {
    const { data: product } = await supabase
      .from("products").select("id").eq("id", input.productId).eq("workspace_id", workspaceId).maybeSingle();
    if (!product) return { ok: false, error: "product_not_found" };
    productId = product.id;
  }

  // RETRY REUSES THE FAILED SESSION. A click → error → click again must not
  // litter "Ostatnie sesje" with one dead row per attempt: when the exact
  // same input recently failed, that session is reset and reused instead.
  let sessionId: string | null = null;
  const { data: retryable } = await supabase
    .from("prompt_sessions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "failed")
    .eq("reference_hash", referenceHash)
    .gte("created_at", new Date(Date.now() - 2 * 3600_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (retryable) {
    const { error: reuseError } = await supabase.from("prompt_sessions").update({
      status: "analyzing", error: null, error_stage: null,
      product_id: productId, aspect_ratio: input.aspectRatio,
      resolution: normalizeResolution(input.resolution),
      style: input.style?.trim() || null,
      extra_info: input.extraInfo?.trim() || null,
      session_type: sessionType,
      shot_briefs: briefs as never,
    }).eq("id", retryable.id);
    if (!reuseError) sessionId = retryable.id;
  }
  if (!sessionId) {
    const { data: session, error: sessionError } = await supabase.from("prompt_sessions").insert({
      workspace_id: workspaceId, user_id: userId, product_id: productId,
      product_name: productLabel || SESSION_FALLBACK_LABEL,
      description: input.description?.trim() || null,
      extra_info: input.extraInfo?.trim() || null,
      aspect_ratio: input.aspectRatio, style: input.style?.trim() || null,
      resolution: normalizeResolution(input.resolution),
      reference_paths: input.referencePaths.slice(0, MAX_REFS),
      reference_hash: referenceHash,
      status: "analyzing",
      mode: "engine",
      session_type: sessionType,
      shot_briefs: briefs as never,
    }).select("id").single();
    if (sessionError || !session) return { ok: false, error: "session_create_failed" };
    sessionId = session.id;
  }
  const session = { id: sessionId };

  const { data: wallet } = await supabase
    .from("credit_wallets").select("id").eq("workspace_id", workspaceId).maybeSingle();
  if (!wallet) return { ok: false, error: "no_wallet" };

  const usage = await startUsage(supabase, {
    userId, workspaceId, walletId: wallet.id, serviceSlug: "prompt_generation",
    providerSlug: "google", modelSlug: analysisModel,
    // A reused (retried) session gets a fresh ledger event — the previous one
    // is already closed as failed and must not be resurrected.
    idempotencyKey: retryable ? `psession:${session.id}:retry:${Date.now()}` : `psession:${session.id}`,
    metadata: { session_id: session.id, images: input.referencePaths.length, shots: clampShots(input.shots) },
  });
  if (!usage.ok) {
    await supabase.from("prompt_sessions").update({ status: "failed", error: usage.error }).eq("id", session.id);
    return { ok: false, error: usage.error, sessionId: session.id };
  }

  const sessionInfo: SessionInput = {
    productName: productLabel,
    description: input.description?.trim() || null,
    extraInfo: input.extraInfo?.trim() || null,
    style: input.style?.trim() || null,
    aspectRatio: input.aspectRatio,
  };

  // Stage is tracked so a failed session tells admins WHERE it broke, and the
  // vision outcome records which provider actually served the session.
  let stage: "references" | "analysis" | "scenes" | "prompts" = "references";
  let usedOutcome: VisionOutcome | null = null;
  const startedAt = Date.now();
  // Per-stage wall clock for the admin log — the only way "too slow" ever
  // becomes an actionable statement. Durations only, never prompt content.
  const timings: Record<string, number> = {};
  let mark = Date.now();
  const lap = (name: string) => { timings[name] = Date.now() - mark; mark = Date.now(); };
  try {
    const images = await downloadReferences(supabase, input.referencePaths);
    if (images.length === 0) throw new ProviderError("references_required");
    lap("referencesMs");

    // 1) SCENE PLAN — ONE planner call for the shots the customer did NOT
    // brief themselves. The planner returns scenes only (title, Polish scene
    // description, humans, reference numbers); nothing it says can alter the
    // master template. Pool over-provisioning plus a deterministic synthesis
    // backstop keeps the ordered count exact. The session flavour
    // (advertising / lifestyle) rides as an internal style directive.
    stage = "scenes";
    const shots = shotsOrdered;
    const planned = shots - briefedCount;

    // ENGINE MEMORY — admin-authored rules plus the most similar curated
    // examples from the knowledge base. Both arrive as ciphertext through
    // definer RPCs and are decrypted only here; both are failure-safe and
    // feed EXCLUSIVELY the internal planner brief, never any customer copy.
    const [ruleDirectives, knowledge] = await Promise.all([
      getEngineRuleDirectives(supabase),
      retrieveKnowledgeHints(
        supabase,
        [sessionInfo.productName, sessionInfo.description, sessionInfo.extraInfo].filter(Boolean).join("\n"),
        3,
      ),
    ]);
    const knowledgeBlock = knowledge.hints.length > 0
      ? `Wewnętrzne doświadczenia z podobnych produktów: ${knowledge.hints.join(" | ")}`.slice(0, 1200)
      : null;

    const flavorStyle = [
      sessionInfo.style,
      sessionType ? SESSION_TYPE_DIRECTIVES[sessionType] : null,
      ...ruleDirectives,
      knowledgeBlock,
    ].filter(Boolean).join(". ").slice(0, 2600);
    const scannerInfo = {
      productName: sessionInfo.productName, description: sessionInfo.description,
      extraInfo: sessionInfo.extraInfo, style: flavorStyle || null,
    };
    let scenes: PlannedScene[] = [];
    if (planned > 0) {
      const scened = await proposeScenes(backends, images, scannerInfo, {
        count: candidatePoolSize(planned),
      });
      scenes = scened.scenes.slice(0, planned);
      usedOutcome = scened.outcome;
      if (scenes.length < planned) {
        const missing = planned - scenes.length;
        try {
          const extra = await proposeScenes(backends, images, scannerInfo, {
            count: missing + 1, avoidTitles: scenes.map((c) => c.title),
          });
          scenes = [...scenes, ...extra.scenes.filter((e) => !scenes.some((c) => c.title.toLowerCase() === e.title.toLowerCase()))].slice(0, planned);
        } catch { /* AI refill unavailable — synthesis below still guarantees the count */ }
      }
      if (scenes.length === 0) throw new ProviderError("analysis_empty", true);
      if (scenes.length < planned) {
        scenes = [...scenes, ...synthesizeScenes(scenes, planned - scenes.length, sessionInfo.productName, images.length)].slice(0, planned);
      }
    }

    // A BRIEFED SHOT is the customer's own scene: their words become the
    // scene description verbatim (sanitized), the chosen reference leads,
    // and "Zachowaj kadr referencyjny" pins the reference composition. The
    // master template and fidelity block still wrap it — briefs steer the
    // scene, never the Product Lock. The session directive joins the HIDDEN
    // prompt only; the customer-facing card copy stays their own words.
    const briefCustomerText = new Map<number, string>();
    const briefScene = (b: { text: string; keepFraming: boolean; refIndex: number | null }, i: number): PlannedScene => {
      const lead = b.refIndex ?? 1;
      const refIdx = [...new Set([lead, 1, 2])].filter((n) => n >= 1 && n <= images.length).slice(0, 3);
      const humans = /\b(kobiet|mężczyz|osob|model|człowiek|dziec|ręk|dłoni)/i.test(b.text);
      let description = [
        b.text,
        b.keepFraming ? KEEP_FRAMING_DIRECTIVE : null,
        sessionType ? SESSION_TYPE_DIRECTIVES[sessionType] : null,
      ].filter(Boolean).join(" ");
      // The template validator requires a real scene sentence — a terse brief
      // gets a neutral engine tail instead of being silently replaced.
      if (description.length < 24) description += " Zadbana, realistyczna sceneria dopasowana do produktu.";
      const title = b.text.length > 44 ? `${b.text.slice(0, 44).trimEnd()}…` : (b.text || `Ujęcie ${i + 1}`);
      briefCustomerText.set(i, [b.text, b.keepFraming ? KEEP_FRAMING_DIRECTIVE : null].filter(Boolean).join(" ") || title);
      return {
        title, scene_description: description, human_presence: humans,
        reference_indices: refIdx.length > 0 ? refIdx : [1],
      };
    };

    // Merge into shot order: briefed slots keep their position; planner
    // scenes fill the rest in the order the planner ranked them.
    const plannerQueue = [...scenes];
    scenes = briefs.map((b, i) => {
      if (b.text.length >= 3) return briefScene(b, i);
      const planned = plannerQueue.shift() ?? synthesizeScenes([], 1, sessionInfo.productName, images.length)[0];
      // A ROW MAY CARRY ONLY A REFERENCE. "Use photo #2 for this shot, you
      // invent the scene" is a legitimate choice, so the engine keeps its
      // own scene but leads with the photo the customer picked — without
      // this the chosen reference was silently dropped for such rows.
      if (!planned || !b.refIndex || b.refIndex > images.length) return planned;
      const refIdx = [...new Set([b.refIndex, ...(planned.reference_indices ?? [])])]
        .filter((n) => n >= 1 && n <= images.length).slice(0, 3);
      return {
        ...planned,
        reference_indices: refIdx.length > 0 ? refIdx : [b.refIndex],
        scene_description: b.keepFraming
          ? `${planned.scene_description} ${KEEP_FRAMING_DIRECTIVE}`
          : planned.scene_description,
      };
    }).filter(Boolean) as PlannedScene[];
    await supabase.from("prompt_sessions").update({
      analysis_model: usedOutcome?.model ?? analysisModel,
      analysis_provider: usedOutcome?.provider ?? null,
      fallback_from: usedOutcome?.fallbackFrom ?? null,
      fallback_reason: usedOutcome?.fallbackReason ?? null,
      reference_hash: referenceHash,
    }).eq("id", session.id);
    lap("scenesMs");

    // 2) FINAL PROMPTS — assembled by PLAIN CODE from the one master
    // template + product name + scene description. No negative prompt, no
    // LLM rewriting, stored only as ciphertext. A scene that would produce
    // an invalid prompt is replaced by a deterministic synthesized scene so
    // the count never drops.
    stage = "prompts";
    let qaRepaired = 0;
    const rows = scenes.map((scene, idx) => {
      let prompt = composeFinalPrompt({
        productName: sessionInfo.productName,
        sceneDescription: scene.scene_description,
        humanPresence: scene.human_presence,
      });
      if (!validateFinalPrompt(prompt)) {
        qaRepaired++;
        const replacement = synthesizeScenes(scenes, 1, sessionInfo.productName, images.length)[0]
          ?? { title: scene.title, scene_description: `${sessionInfo.productName} w eleganckim, czystym kadrze reklamowym, produkt w całości widoczny.`, human_presence: false, reference_indices: scene.reference_indices };
        scene = { ...scene, scene_description: replacement.scene_description, human_presence: replacement.human_presence };
        prompt = composeFinalPrompt({
          productName: sessionInfo.productName,
          sceneDescription: scene.scene_description,
          humanPresence: scene.human_presence,
        });
      }
      const sealed = encryptConceptPayload(prompt, "", { tv: PROMPT_TEMPLATE_VERSION });
      return {
        product_id: productId, workspace_id: workspaceId, session_id: session.id,
        concept_name: scene.title, shot_type: "scene", scene_type: null,
        customer_title: scene.title,
        // Briefed shots show the customer their own words — the engine's
        // internal session directive lives only inside the ciphertext.
        customer_description: briefCustomerText.get(idx) ?? scene.scene_description,
        prompt_text: "", negative_prompt: null,
        prompt_encrypted: sealed.ciphertext, prompt_iv: sealed.iv, prompt_tag: sealed.authTag,
        primary_reference: scene.reference_indices[0] ?? 1,
        supporting_references: [] as never,
        reference_indices: scene.reference_indices,
        reference_image_ids: [], reference_rationale: null,
        format: input.aspectRatio, style: input.style?.trim() || null,
        priority: idx + 1, status: "ready" as const, lock_strength: "LOW",
      };
    });
    lap("promptsMs");
    // A reused (retried) session may carry rows from a partially failed run.
    if (retryable) await supabase.from("generated_prompts").delete().eq("session_id", session.id);
    const { error: insertError } = await supabase.from("generated_prompts").insert(rows);
    if (insertError) throw new ProviderError("session_create_failed");
    lap("saveMs");

    await completeUsage(supabase, usage.eventId, rows.length);
    await supabase.from("prompt_sessions")
      .update({
        status: "ready", latency_ms: Date.now() - startedAt,
        engine_version: ENGINE_VERSION,
        knowledge_used: knowledge.exampleIds.length > 0 ? (knowledge.exampleIds as unknown as never) : null,
      })
      .eq("id", session.id);
    // Internal record of what served this session: primary attempted, why we
    // left it, which provider/model succeeded and how long it took.
    await supabase.rpc("log_activity", {
      p_workspace_id: workspaceId, p_action: "prompts.generated",
      p_entity_type: "prompt_session", p_entity_id: session.id,
      p_metadata: {
        prompts: rows.length, requested: shots, images: images.length,
        primary_provider: backends[0]?.provider ?? null, primary_model: analysisModel,
        used_provider: usedOutcome?.provider ?? null, used_model: usedOutcome?.model ?? null,
        fallback_from: usedOutcome?.fallbackFrom ?? null,
        fallback_reason: usedOutcome?.fallbackReason ?? null,
        vision_latency_ms: usedOutcome?.latencyMs ?? null,
        prompt_template_version: PROMPT_TEMPLATE_VERSION,
        engine_version: ENGINE_VERSION,
        engine_rules: ruleDirectives.length,
        knowledge_examples: knowledge.exampleIds,
        qa_repaired: qaRepaired,
        timings,
        retried_session: Boolean(retryable),
        total_latency_ms: Date.now() - startedAt,
      },
    });
    return { ok: true, sessionId: session.id, productId: productId ?? "", promptCount: rows.length };
  } catch (e) {
    const safe = e instanceof ProviderError ? e.safeMessage : "analysis_error";
    const providerCode = e instanceof ProviderError ? e.providerCode : undefined;
    await failUsage(supabase, { eventId: usage.eventId, walletId: wallet.id, error: safe });
    await supabase.from("prompt_sessions").update({
      status: "failed", error: safe, error_stage: stage, latency_ms: Date.now() - startedAt,
    }).eq("id", session.id);
    await supabase.rpc("log_activity", {
      p_workspace_id: workspaceId, p_action: "prompts.failed",
      p_entity_type: "prompt_session", p_entity_id: session.id,
      p_metadata: {
        stage, error: safe, provider_code: providerCode ?? null, model: analysisModel,
        providers_tried: backends.map((b) => b.provider),
        images: input.referencePaths.length, product_id: productId,
        requested: clampShots(input.shots), timings,
        latency_ms: Date.now() - startedAt,
      },
    });
    return { ok: false, error: safe, sessionId: session.id };
  }
}

/** Regenerate ONE card ("Zmień scenę"): one fresh planner scene that avoids
 *  the session's existing titles, assembled into the same master template
 *  and written over the same row. */
export async function regeneratePrompt(
  supabase: Client, workspaceId: string, promptId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: prompt } = await supabase
    .from("generated_prompts").select("id, session_id, workspace_id").eq("id", promptId).maybeSingle();
  if (!prompt || prompt.workspace_id !== workspaceId || !prompt.session_id) return { ok: false, error: "not_found" };

  const { data: session } = await supabase
    .from("prompt_sessions").select("*").eq("id", prompt.session_id).maybeSingle();
  if (!session || session.status !== "ready") return { ok: false, error: "not_found" };

  const analysisModel = await getAnalysisModel(supabase);
  const backends = await getVisionBackends(supabase, analysisModel);
  if (backends.length === 0) return { ok: false, error: "analysis_unavailable" };

  const { data: siblings } = await supabase
    .from("generated_prompts").select("id, concept_name").eq("session_id", session.id);
  const avoid = (siblings ?? []).filter((s) => s.id !== promptId).map((s) => s.concept_name).filter(Boolean) as string[];

  try {
    const images = await downloadReferences(supabase, session.reference_paths ?? []);
    if (images.length === 0) return { ok: false, error: "references_required" };
    const scened = await proposeScenes(backends, images, {
      productName: session.product_name, description: session.description,
      extraInfo: session.extra_info, style: session.style,
    }, { count: 1, avoidTitles: avoid });
    let scene: PlannedScene | undefined = scened.scenes[0];
    if (!scene) return { ok: false, error: "analysis_empty" };
    let finalPrompt = composeFinalPrompt({
      productName: session.product_name,
      sceneDescription: scene.scene_description,
      humanPresence: scene.human_presence,
    });
    if (!validateFinalPrompt(finalPrompt)) {
      scene = synthesizeScenes([], 1, session.product_name, images.length)[0];
      finalPrompt = composeFinalPrompt({
        productName: session.product_name,
        sceneDescription: scene.scene_description,
        humanPresence: scene.human_presence,
      });
    }
    const sealed = encryptConceptPayload(finalPrompt, "", { tv: PROMPT_TEMPLATE_VERSION });
    await supabase.from("generated_prompts").update({
      concept_name: scene.title, shot_type: "scene", scene_type: null,
      customer_title: scene.title,
      customer_description: scene.scene_description,
      prompt_text: "", negative_prompt: null,
      prompt_encrypted: sealed.ciphertext, prompt_iv: sealed.iv, prompt_tag: sealed.authTag,
      primary_reference: scene.reference_indices[0] ?? 1,
      supporting_references: [] as never,
      reference_indices: scene.reference_indices,
      reference_rationale: null, lock_strength: "LOW",
      generation_count: 0, last_job_id: null,
    }).eq("id", promptId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ProviderError ? e.safeMessage : "analysis_error" };
  }
}

