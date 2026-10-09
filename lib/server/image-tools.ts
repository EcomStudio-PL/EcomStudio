import "server-only";
import { readProviderKey } from "@/lib/server/provider-credentials";
import { dispatchToken } from "@/lib/server/integrations";
import type { Client } from "@/lib/services/workspace";
import { startUsage, completeUsage, failUsage } from "@/lib/services/usage";
import {
  DEFAULT_SETTINGS, TOOLS, toolBySlug, isPhotoTool,
  AI_SHADOW_BACKGROUNDS, AI_SHADOW_STYLES, BACKGROUND_PROMPT_MAX, BEAUTIFY_SUBJECTS, LIGHTING_INTENTS,
  type AspectRatio, type PhotoToolSlug, type ToolSettings, type ToolSlug, type UpscaleFactor,
} from "@/lib/images/tools";
import { billingFrom, quote, usdToMicros, type BillingConfig, type PriceQuote } from "@/lib/images/pricing";
import {
  ALL_TOOL_PROVIDERS, BACKGROUND_PROVIDERS, EDIT_PROVIDERS, EXPAND_PROVIDERS, UPSCALE_PROVIDERS,
  PHOTOROOM_EDIT_URL, PHOTOROOM_SEGMENT_URL, ToolProviderError, envKey, isSandboxKey, photoroomUrl,
  type BackgroundRemovalProvider, type Creds, type EditOperation, type EditOptions, type ExpandPlan, type ImageEditProvider,
} from "@/lib/images/providers";
import { parsePresets, PRESET_KEY_RE, type AiBackgroundPreset } from "@/lib/images/ai-background-presets";
import {
  composeEditor, compress, dropShadow, flattenToColor, hasRealTransparency, inspect, resizeConvert, watermark,
  MAX_INPUT_BYTES, type OutputFormat,
} from "@/lib/images/local";
import { clampEditorState } from "@/lib/images/editor-state";
import { claimFreeRun, freeToolRules, planQualifies, releaseFreeRun, windowStart } from "@/lib/server/free-tools";
import { recordProviderCalls, type ProviderCall } from "@/lib/server/ai-usage";

/**
 * IMAGE TOOLS SERVICE — the single place a tool run happens.
 *
 * The server is the authority for everything that matters: which provider is
 * reachable, what the operation really costs, how many credits that means and
 * whether the seller keeps them. A paid run reserves credits before the call
 * and refunds them the moment the provider fails, so a seller can never pay
 * for an image they did not receive. Local runs cost nothing and are still
 * recorded, so the admin economics view sees the whole picture.
 */

type ProviderBase = { slug: string; envVar: string; vaultSlug?: string; label: string; keyUrl: string };

/** Where a key was found. Never the key itself. */
export type KeySource = "env" | "vault" | null;

/* ── credentials ───────────────────────────────────────────────────────── */

const vaultCache = new Map<string, { creds: Creds | null; at: number }>();
const VAULT_TTL = 60_000;

/**
 * ENV first — a key in the process environment never touches the database.
 * Otherwise the credential the admin panel stored: Supabase Vault for anything
 * saved since migration 0078, the old AES ciphertext for anything older.
 */
async function resolveCreds(supabase: Client, provider: ProviderBase): Promise<{ creds: Creds; source: KeySource } | null> {
  const fromEnv = envKey(provider);
  if (fromEnv) return { creds: { apiKey: fromEnv }, source: "env" };
  if (!provider.vaultSlug) return null;

  const cached = vaultCache.get(provider.vaultSlug);
  if (cached && Date.now() - cached.at < VAULT_TTL) {
    return cached.creds ? { creds: cached.creds, source: "vault" } : null;
  }

  const { data: row } = await supabase
    .from("ai_providers").select("id").eq("slug", provider.vaultSlug).eq("active", true).maybeSingle();
  let creds: Creds | null = null;
  if (row) {
    // SECURITY DEFINER: the credentials table itself stays admin-only.
    const { data: credRows } = await supabase.rpc("provider_credential_read", { p_token: dispatchToken(), p_provider_id: row.id });
    const cred = credRows?.[0];
    if (cred) {
      const apiKey = await readProviderKey(supabase, row.id, cred);
      creds = apiKey ? { apiKey, baseUrl: cred.base_url } : null;
    }
  }
  vaultCache.set(provider.vaultSlug, { creds, at: Date.now() });
  return creds ? { creds, source: "vault" } : null;
}

/**
 * EVERY VAULT-BACKED PROVIDER, IN ONE ROUND TRIP.
 *
 * `pickProvider` walks its list in preference order and stops at the first key
 * it finds — which means that when the earlier providers are NOT configured
 * (the normal case: one key, five candidates) it pays for a full serial chain
 * of `resolveCreds` calls, each one a query and possibly an RPC, one waiting on
 * the last. Ten of those in sequence is the cost of opening any tools page on a
 * cold lambda, and it buys nothing: the answer for every provider is
 * independent of the answer for every other.
 *
 * So they are all resolved here, in one `ai_providers` read plus a parallel
 * fan-out of credential RPCs, and dropped into the same cache `resolveCreds`
 * already consults. The walk that follows then costs zero queries and still
 * picks in exactly the same order. Nothing about WHICH provider wins changes —
 * only how long finding it takes.
 *
 * Providers whose key is in the environment are skipped: those never touch the
 * database at all.
 */
async function primeVault(supabase: Client): Promise<void> {
  const now = Date.now();
  const wanted = [...new Set(
    ALL_TOOL_PROVIDERS
      .filter((provider) => !envKey(provider) && provider.vaultSlug)
      .map((provider) => provider.vaultSlug as string),
  )].filter((slug) => {
    const cached = vaultCache.get(slug);
    return !(cached && now - cached.at < VAULT_TTL);
  });
  if (wanted.length === 0) return;

  const { data: rows } = await supabase
    .from("ai_providers").select("id, slug").in("slug", wanted).eq("active", true);
  const idBySlug = new Map((rows ?? []).map((row) => [row.slug, row.id]));

  await Promise.all(wanted.map(async (slug) => {
    const id = idBySlug.get(slug);
    let creds: Creds | null = null;
    if (id) {
      // Same SECURITY DEFINER call resolveCreds makes — the credentials table
      // stays admin-only.
      const { data: credRows } = await supabase.rpc("provider_credential_read", { p_token: dispatchToken(), p_provider_id: id });
      const cred = credRows?.[0];
      if (cred) {
        const apiKey = await readProviderKey(supabase, id, cred);
        creds = apiKey ? { apiKey, baseUrl: cred.base_url } : null;
      }
    }
    // A MISS is cached too, exactly as before: "no key for this provider" is
    // an answer worth remembering for a minute.
    vaultCache.set(slug, { creds, at: Date.now() });
  }));
}

/** The edit provider that has a key AND does this particular operation. A
 *  vendor may implement relighting and not ghost mannequins, and a tool must
 *  never be advertised as available because some other edit is. */
async function pickEditProvider(supabase: Client, op: EditOperation, slug?: ToolSlug) {
  const list = EDIT_PROVIDERS.filter((p) => p.supports(op));
  return pickProvider(supabase, slug ? forTool(slug, list) : list);
}

/**
 * A TOOL'S OWN PROVIDER LIST. Most paid tools take the cheapest vendor that
 * has a key; a tool pinned to one vendor (the four photo tools are Photoroom
 * operations) never falls through to another just because its key exists —
 * that is how "Usuń tło" ended up on a fal key that had never once worked.
 * Workflow steps (`runToolProviderStep`) keep the cheapest-first chain.
 */
function forTool<T extends ProviderBase>(slug: ToolSlug, list: T[]): T[] {
  const pin = toolBySlug(slug)?.provider;
  return pin ? list.filter((p) => p.slug === pin) : list;
}

/** A Photoroom key that stamps a watermark. Its results are a test, never a
 *  customer's deliverable — see toolCatalogue and runPaid. */
const isSandbox = (picked: { provider: ProviderBase; creds: Creds }) =>
  picked.provider.slug === "photoroom" && isSandboxKey(picked.creds.apiKey);

/** First provider in the preference list (cheapest first) that has a key. */
async function pickProvider<T extends ProviderBase>(supabase: Client, list: T[]): Promise<{ provider: T; creds: Creds; source: KeySource } | null> {
  for (const provider of list) {
    const resolved = await resolveCreds(supabase, provider);
    if (resolved) return { provider, creds: resolved.creds, source: resolved.source };
  }
  return null;
}

/**
 * FOR THE ADMIN: where a photo tool would go right now — the same pinned pick
 * the runner makes, the endpoint it would call, whether the key is a live or a
 * sandbox one, and the list price of one call. Never the key itself.
 */
export async function photoToolPath(supabase: Client, slug: PhotoToolSlug): Promise<{
  providerSlug: string; label: string; endpoint: string;
  environment: "live" | "sandbox" | null; costUsd: number;
}> {
  const tool = toolBySlug(slug)!;
  const operation = tool.operation as EditOperation | undefined;
  const edit = tool.capability === "edit" && operation !== undefined;
  const list: (BackgroundRemovalProvider | ImageEditProvider)[] = edit
    ? forTool(slug, EDIT_PROVIDERS.filter((p) => p.supports(operation)))
    : forTool(slug, BACKGROUND_PROVIDERS);
  const picked = await pickProvider(supabase, list);
  const provider = picked?.provider ?? list[0];
  const costUsd = !provider ? 0
    : edit ? (provider as ImageEditProvider).estimateUsd(operation) : (provider as BackgroundRemovalProvider).estimateUsd();
  const url = edit
    ? photoroomUrl(picked?.creds.baseUrl, "/v2/edit", PHOTOROOM_EDIT_URL)
    : photoroomUrl(picked?.creds.baseUrl, "/v1/segment", PHOTOROOM_SEGMENT_URL);
  return {
    providerSlug: provider?.slug ?? "photoroom",
    label: provider ? provider.label.split(" — ")[0] : "Photoroom",
    endpoint: `POST ${url}`,
    environment: picked ? (isSandbox(picked) ? "sandbox" : "live") : null,
    costUsd,
  };
}

/* ── catalogue + pricing ───────────────────────────────────────────────── */

export type ToolAvailability = {
  slug: ToolSlug;
  kind: "local" | "paid";
  available: boolean;
  /** Credits per image at the currently active provider. */
  credits: number;
  /** Human label of the backend that would run it, when there is one. */
  providerLabel: string | null;
  /** Why a paid tool cannot run. `sandbox`: the only key is a Photoroom test
   *  key, whose watermarked results are never sold to a customer. */
  reason: "ok" | "no_provider" | "maintenance" | "disabled" | "sandbox";
  /** Which kind of key would answer: a live one, a sandbox (test) one, or none.
   *  Optional so callers that build a placeholder row need not invent it. */
  environment?: "live" | "sandbox" | null;
  /** The run is free when the photo is already cut out ("Zmień kolor tła"). */
  freeWhenTransparent?: boolean;
};

async function loadContext(supabase: Client) {
  const [{ data: services }, { data: billingRow }] = await Promise.all([
    supabase.from("service_catalog").select("slug, credits_cost, enabled, maintenance_mode")
      .in("slug", TOOLS.map((t) => t.service)),
    supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
  ]);
  return {
    services: new Map((services ?? []).map((s) => [s.slug, s])),
    billing: billingFrom(billingRow?.value),
  };
}

/** What the Tools page renders: real availability and the real price.
 *
 *  `admin`: the viewer is an operator. A Photoroom SANDBOX key is then usable
 *  — at 0 credits, so a watermarked test result is never paid for — while for
 *  a customer the same key means "not available": a watermarked image is not
 *  a product GrovBase sells. */
export async function toolCatalogue(supabase: Client, opts: { admin?: boolean } = {}): Promise<ToolAvailability[]> {
  // The catalogue read and the whole credential sweep, side by side: two
  // round trips of waiting instead of a serial walk through ten providers.
  const [{ services, billing }] = await Promise.all([loadContext(supabase), primeVault(supabase)]);
  // One resolution per tool's provider list: the vault is already primed, so
  // each of these is a walk through an in-memory cache rather than a query.
  // Tools that share a list (the unpinned edits, say) resolve identically.
  const picks = await Promise.all(TOOLS.map(async (tool) => {
    if (tool.kind === "local") return null;
    if (tool.capability === "background") return pickProvider(supabase, forTool(tool.slug, BACKGROUND_PROVIDERS));
    if (tool.capability === "upscale") return pickProvider(supabase, forTool(tool.slug, UPSCALE_PROVIDERS));
    if (tool.capability === "expand") return pickProvider(supabase, forTool(tool.slug, EXPAND_PROVIDERS));
    return tool.operation ? pickEditProvider(supabase, tool.operation as EditOperation, tool.slug) : null;
  }));

  return TOOLS.map((tool, index): ToolAvailability => {
    const service = services.get(tool.service);
    const floor = service?.credits_cost ?? 0;
    const free = tool.freeWhenTransparent === true;
    if (service && service.enabled === false) {
      return { slug: tool.slug, kind: tool.kind, available: false, credits: 0, providerLabel: null, reason: "disabled" };
    }
    if (service?.maintenance_mode) {
      return { slug: tool.slug, kind: tool.kind, available: false, credits: 0, providerLabel: null, reason: "maintenance" };
    }
    if (tool.kind === "local") {
      return { slug: tool.slug, kind: "local", available: true, credits: 0, providerLabel: null, reason: "ok" };
    }
    const picked = picks[index];
    if (!picked) {
      return { slug: tool.slug, kind: "paid", available: false, credits: 0, providerLabel: null, reason: "no_provider",
        environment: null, freeWhenTransparent: free };
    }
    if (isSandbox(picked)) {
      return opts.admin
        ? { slug: tool.slug, kind: "paid", available: true, credits: 0, providerLabel: picked.provider.label,
            reason: "ok", environment: "sandbox", freeWhenTransparent: free }
        : { slug: tool.slug, kind: "paid", available: false, credits: 0, providerLabel: null, reason: "sandbox",
            environment: "sandbox", freeWhenTransparent: free };
    }
    // Upscale is priced at its most expensive factor so the card never
    // advertises less than the seller can end up paying. An edit is priced for
    // the operation it will actually request.
    const costUsd = tool.capability === "upscale"
      ? (picked.provider as { estimateUsd: (f: UpscaleFactor) => number }).estimateUsd(4)
      : tool.capability === "edit"
        ? (picked.provider as ImageEditProvider).estimateUsd(tool.operation as EditOperation)
        : (picked.provider as { estimateUsd: () => number }).estimateUsd();
    return {
      slug: tool.slug, kind: "paid", available: true,
      credits: quote(costUsd, floor, billing).credits,
      providerLabel: picked.provider.label,
      reason: "ok",
      environment: "live",
      freeWhenTransparent: free,
    };
  }).sort((a, b) => (toolBySlug(a.slug)?.sortOrder ?? 0) - (toolBySlug(b.slug)?.sortOrder ?? 0));
}

/** Admin view: every provider, where its key would come from, and its state. */
export type ProviderStatus = {
  slug: string;
  label: string;
  envVar: string;
  keyUrl: string;
  source: KeySource;
  status: "connected" | "not_configured";
  capabilities: string[];
};

export async function providerStatuses(supabase: Client): Promise<ProviderStatus[]> {
  const capabilityOf = (slug: string) => [
    BACKGROUND_PROVIDERS.some((p) => p.slug === slug) ? "background" : null,
    UPSCALE_PROVIDERS.some((p) => p.slug === slug) ? "upscale" : null,
    EXPAND_PROVIDERS.some((p) => p.slug === slug) ? "expand" : null,
    EDIT_PROVIDERS.some((p) => p.slug === slug) ? "edit" : null,
  ].filter((x): x is string => x !== null);

  return Promise.all(ALL_TOOL_PROVIDERS.map(async (p): Promise<ProviderStatus> => {
    const resolved = await resolveCreds(supabase, p);
    return {
      slug: p.slug,
      // The catalogue label carries the model name; the admin card wants the
      // vendor, so anything after the em dash is trimmed.
      label: p.label.split(" — ")[0],
      envVar: p.envVar,
      keyUrl: p.keyUrl,
      source: resolved?.source ?? null,
      status: resolved ? "connected" : "not_configured",
      capabilities: capabilityOf(p.slug),
    };
  }));
}

/* ── settings ──────────────────────────────────────────────────────────── */

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(v)) ? (v as T) : fallback;
const hex = (v: unknown, fallback: string) =>
  typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;

/** Never trust the panel: every dial is re-clamped before it reaches sharp. */
export function parseSettings<K extends ToolSlug>(tool: K, raw: unknown): ToolSettings[K] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  switch (tool) {
    case "editor":
      // The whole state goes through clampEditorState — the same function the
      // browser uses — so the panel and the bake can never disagree about what
      // a value means, and a hand-rolled request cannot smuggle one past it.
      return {
        state: clampEditorState(r.state),
        format: pick(r.format, ["jpeg", "png", "webp", "tiff"] as const, d.editor.format),
        quality: clamp(r.quality, 40, 100, d.editor.quality),
      } as ToolSettings[K];
    case "upscale":
      return { factor: (clamp(r.factor, 2, 4, 2) >= 4 ? 4 : 2) as UpscaleFactor } as ToolSettings[K];
    case "remove_bg":
      return { format: pick(r.format, ["png", "webp"] as const, "png") } as ToolSettings[K];
    case "white_bg":
      return {
        color: hex(r.color, d.white_bg.color),
        padding: clamp(r.padding, 0, 25, d.white_bg.padding),
        format: pick(r.format, ["jpeg", "png", "webp", "tiff"] as const, d.white_bg.format),
        quality: clamp(r.quality, 40, 100, d.white_bg.quality),
      } as ToolSettings[K];
    case "expand":
      return { ratio: pick(r.ratio, ["1:1", "4:5", "9:16", "16:9"] as const, d.expand.ratio) } as ToolSettings[K];
    case "shadow":
      return {
        style: pick(r.style, ["soft", "contact", "floating"] as const, d.shadow.style),
        opacity: clamp(r.opacity, 5, 100, d.shadow.opacity),
        blur: clamp(r.blur, 1, 200, d.shadow.blur),
        offsetX: clamp(r.offsetX, -300, 300, d.shadow.offsetX),
        offsetY: clamp(r.offsetY, -300, 300, d.shadow.offsetY),
        background: hex(r.background, d.shadow.background),
      } as ToolSettings[K];
    case "format":
      return {
        format: pick(r.format, ["jpeg", "png", "webp", "tiff"] as const, d.format.format),
        width: r.width == null || r.width === "" ? null : clamp(r.width, 16, 8000, 1600),
        height: r.height == null || r.height === "" ? null : clamp(r.height, 16, 8000, 1600),
        quality: clamp(r.quality, 40, 100, d.format.quality),
        fit: pick(r.fit, ["inside", "cover"] as const, d.format.fit),
      } as ToolSettings[K];
    case "compress":
      return {
        level: pick(r.level, ["light", "balanced", "strong", "auto"] as const, d.compress.level),
        format: pick(r.format, ["keep", "jpeg", "png", "webp", "tiff"] as const, d.compress.format),
      } as ToolSettings[K];
    // ── Generative edits ─────────────────────────────────────────────────
    // These reach a third party, so the clamping matters more than usual: the
    // prompt is free text a seller typed and everything else is a closed set.
    case "ai_background":
      return {
        // A preset is named by KEY only — its prompt is resolved on the server
        // and never travels to or from the browser.
        preset: typeof r.preset === "string" && PRESET_KEY_RE.test(r.preset) ? r.preset : "",
        // Trimmed and capped before it becomes part of an outbound request.
        // Newlines out too — a prompt is one line, and a multi-line value in a
        // multipart field is a needless way to surprise the API.
        prompt: String(r.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, BACKGROUND_PROMPT_MAX),
        guidance: Math.round(clamp(r.guidance, 0, 1, d.ai_background.guidance) * 100) / 100,
        format: pick(r.format, ["png", "jpeg", "webp"] as const, d.ai_background.format),
      } as ToolSettings[K];
    case "relight":
      return {
        intent: pick(r.intent, LIGHTING_INTENTS, d.relight.intent),
        format: pick(r.format, ["png", "jpeg", "webp"] as const, d.relight.format),
      } as ToolSettings[K];
    case "ai_shadow":
      return {
        style: pick(r.style, AI_SHADOW_STYLES, d.ai_shadow.style),
        background: pick(r.background, AI_SHADOW_BACKGROUNDS, d.ai_shadow.background),
        color: hex(r.color, d.ai_shadow.color),
        format: pick(r.format, ["png", "jpeg", "webp"] as const, d.ai_shadow.format),
      } as ToolSettings[K];
    case "beautify":
      return {
        subject: pick(r.subject, BEAUTIFY_SUBJECTS, d.beautify.subject),
        format: pick(r.format, ["png", "jpeg", "webp"] as const, d.beautify.format),
      } as ToolSettings[K];
    case "uncrop":
      return { format: pick(r.format, ["png", "jpeg", "webp"] as const, d.uncrop.format) } as ToolSettings[K];
    case "ghost_mannequin":
      return { format: pick(r.format, ["png", "webp"] as const, d.ghost_mannequin.format) } as ToolSettings[K];
    default:
      return {
        position: pick(r.position, [
          "top-left", "top-center", "top-right", "center-left", "center", "center-right",
          "bottom-left", "bottom-center", "bottom-right", "pattern",
        ] as const, d.watermark.position),
        scale: clamp(r.scale, 2, 100, d.watermark.scale),
        opacity: clamp(r.opacity, 5, 100, d.watermark.opacity),
        margin: clamp(r.margin, 0, 40, d.watermark.margin),
        rotation: clamp(r.rotation, -90, 90, d.watermark.rotation),
        spacing: clamp(r.spacing, 0, 200, d.watermark.spacing),
        format: pick(r.format, ["keep", "jpeg", "png", "webp", "tiff"] as const, d.watermark.format),
        quality: clamp(r.quality, 40, 100, d.watermark.quality),
      } as ToolSettings[K];
  }
}

/* ── expand geometry ───────────────────────────────────────────────────── */

/** Cap so the outpaint request stays inside every provider's frame limits. */
const MAX_EXPAND_SIDE = 2400;

/**
 * Plan the canvas for a ratio change. The original is NEVER cropped: the
 * canvas only ever grows, and the pixels the provider has to invent are the
 * bars on the sides that grew.
 */
export function planExpand(source: { width: number; height: number }, ratio: AspectRatio): ExpandPlan | null {
  const [rw, rh] = ratio.split(":").map(Number);
  const target = rw / rh;
  const current = source.width / source.height;
  if (Math.abs(current - target) < 0.005) return null; // already there

  let width = source.width;
  let height = source.height;
  if (current < target) width = Math.round(source.height * target);
  else height = Math.round(source.width / target);

  // Downscale the whole plan if the canvas would exceed the provider limit.
  const longest = Math.max(width, height);
  const scale = longest > MAX_EXPAND_SIDE ? MAX_EXPAND_SIDE / longest : 1;
  const scaled = {
    width: Math.round(source.width * scale),
    height: Math.round(source.height * scale),
  };
  const canvas = { width: Math.round(width * scale), height: Math.round(height * scale) };
  const left = Math.floor((canvas.width - scaled.width) / 2);
  const up = Math.floor((canvas.height - scaled.height) / 2);

  return {
    ratio,
    source: scaled,
    target: canvas,
    pad: {
      left, up,
      right: canvas.width - scaled.width - left,
      down: canvas.height - scaled.height - up,
    },
  };
}

/* ── run ───────────────────────────────────────────────────────────────── */

export type RunInput = {
  tool: ToolSlug;
  settings: unknown;
  file: Buffer;
  mime: string;
  /** Watermark only. */
  logo?: Buffer | null;
  idempotencyKey?: string;
  /** "Dodaj tło AI" only: an inspiration photo that steers the scene. */
  guidance?: { bytes: Buffer; mime: string } | null;
  /** The viewer is an operator. Only then may a Photoroom sandbox key run —
   *  at 0 credits, labelled as a test. */
  viewerIsAdmin?: boolean;
  /**
   * STORE THE RESULT BEFORE THE RUN COUNTS AS DELIVERED. Given (the photo
   * tools' route), it is called with the finished bytes after the provider
   * answered and BEFORE the usage event is closed as succeeded: a result that
   * could not be stored is refunded like any other failure, and a result that
   * WAS stored survives a refresh, a closed tab or a dropped response.
   */
  deliver?: (out: DeliverInput) => Promise<DeliverResult>;
  /**
   * WAS THIS VERY REQUEST ALREADY DELIVERED? Asked once the usage event holds
   * the idempotency key and before the provider is called. A finished run
   * releases its key (0101), but it stores its result BEFORE it does — so a
   * retry whose first answer was lost finds that result here and is refunded
   * at once, with no second call and no second charge.
   */
  alreadyDelivered?: () => Promise<boolean>;
};

export type DeliverInput = {
  bytes: Buffer;
  mime: string;
  width: number;
  height: number;
  credits: number;
  usageEventId: string | null;
  providerSlug: string;
  endpoint: string | null;
  environment: "live" | "sandbox" | "local";
  meta: Record<string, string>;
};
export type DeliverResult = { ok: true; id: string; path: string } | { ok: false; error: string };

export type RunSuccess = {
  ok: true;
  bytes: Buffer;
  mime: string;
  credits: number;
  before: { width: number; height: number; bytes: number };
  after: { width: number; height: number; bytes: number };
  providerLabel: string | null;
  /** Present when a `deliver` hook stored the result. */
  delivered?: { id: string; path: string };
  environment?: "live" | "sandbox" | "local";
};
export type RunFailure = { ok: false; error: string; missingCredits?: number };

export async function runTool(
  supabase: Client, userId: string, workspaceId: string, input: RunInput,
): Promise<RunSuccess | RunFailure> {
  const tool = toolBySlug(input.tool);
  if (!tool) return { ok: false, error: "unknown_tool" };
  if (input.file.length === 0) return { ok: false, error: "empty_file" };
  if (input.file.length > MAX_INPUT_BYTES) return { ok: false, error: "image_too_large" };

  let before;
  try { before = await inspect(input.file); }
  catch { return { ok: false, error: "unreadable_image" }; }
  if (!before.width || !before.height) return { ok: false, error: "unreadable_image" };

  const { services, billing } = await loadContext(supabase);
  const service = services.get(tool.service);
  if (service && (service.enabled === false || service.maintenance_mode)) {
    return { ok: false, error: "tool_unavailable" };
  }

  // A photo that is ALREADY cut out needs no provider to sit on a colour:
  // it is flattened here, for nothing, instead of buying a second cutout.
  if (tool.freeWhenTransparent && await hasRealTransparency(input.file)) {
    return runLocal(supabase, userId, workspaceId, tool.slug, tool.service, input, before);
  }

  return tool.kind === "local"
    ? runLocal(supabase, userId, workspaceId, tool.slug, tool.service, input, before)
    : runPaid(supabase, userId, workspaceId, tool.slug, tool.service, input, before, billing, service?.credits_cost ?? 0);
}

type Facts = { width: number; height: number; bytes: number; hasAlpha: boolean };

/* ── local path ────────────────────────────────────────────────────────── */

async function runLocal(
  supabase: Client, userId: string, workspaceId: string,
  slug: ToolSlug, serviceSlug: string, input: RunInput, before: Facts,
): Promise<RunSuccess | RunFailure> {
  let output: Buffer;
  try {
    output = await processLocally(slug, input, before);
  } catch (e) {
    const message = e instanceof Error ? e.message : "processing_failed";
    return { ok: false, error: KNOWN_LOCAL_ERRORS.has(message) ? message : "processing_failed" };
  }

  const after = await inspect(output);
  let delivered: { id: string; path: string } | undefined;
  if (input.deliver) {
    const stored = await input.deliver({
      bytes: output, mime: mimeOf(after.format), width: after.width, height: after.height,
      credits: 0, usageEventId: null, providerSlug: "local", endpoint: null, environment: "local", meta: {},
    });
    if (!stored.ok) return { ok: false, error: stored.error };
    delivered = { id: stored.id, path: stored.path };
  }
  // Zero-credit run, still written to the ledger so the economics view can
  // report volume and the free/paid split without a second system.
  const usage = await startUsage(supabase, {
    serverToken: dispatchToken(),
    userId, workspaceId, walletId: "",
    serviceSlug, providerSlug: "local", modelSlug: "sharp",
    creditsCharged: 0,
    // NO IDEMPOTENCY KEY HERE, deliberately. The key exists to stop one submit
    // being charged or run twice; a local run costs nothing, so deduping it
    // would only refuse a seller who legitimately wants to compress the same
    // file again — and it would hide a real second run from the volume figures.
    metadata: { tool: slug, bytes_in: before.bytes, bytes_out: after.bytes },
  });
  if (usage.ok) await completeUsage(supabase, dispatchToken(), usage.eventId, 1, { apiCostUsdMicros: 0 });

  return {
    ok: true, bytes: output, mime: mimeOf(after.format), credits: 0,
    before: { width: before.width, height: before.height, bytes: before.bytes },
    after: { width: after.width, height: after.height, bytes: after.bytes },
    providerLabel: null,
    ...(delivered ? { delivered, environment: "local" as const } : {}),
  };
}

const KNOWN_LOCAL_ERRORS = new Set([
  "needs_transparency", "unreadable_image", "missing_logo", "bad_ratio",
  // The editor's background modes it cannot do honestly — see composeEditor.
  "background_unavailable", "image_too_large",
]);

async function processLocally(slug: ToolSlug, input: RunInput, before: Facts): Promise<Buffer> {
  switch (slug) {
    case "editor": {
      const s = parseSettings("editor", input.settings);
      return composeEditor(input.file, s.state, {
        format: s.format as OutputFormat, quality: s.quality,
      });
    }
    case "white_bg": {
      const s = parseSettings("white_bg", input.settings);
      if (!before.hasAlpha) throw new Error("needs_transparency");
      return flattenToColor(input.file, {
        color: s.color, format: s.format as OutputFormat,
        quality: s.quality, padding: s.padding / 100,
      });
    }
    case "shadow": {
      const s = parseSettings("shadow", input.settings);
      if (!before.hasAlpha) throw new Error("needs_transparency");
      return dropShadow(input.file, {
        style: s.style, opacity: s.opacity / 100, blur: s.blur,
        offsetX: s.offsetX, offsetY: s.offsetY, background: s.background,
      });
    }
    case "format": {
      const s = parseSettings("format", input.settings);
      return resizeConvert(input.file, {
        format: s.format as OutputFormat, width: s.width, height: s.height,
        quality: s.quality, fit: s.fit,
      });
    }
    case "compress": {
      const s = parseSettings("compress", input.settings);
      const { output } = await compress(input.file, {
        level: s.level,
        format: s.format === "keep" ? undefined : (s.format as OutputFormat),
      });
      return output;
    }
    default: {
      const s = parseSettings("watermark", input.settings);
      if (!input.logo?.length) throw new Error("missing_logo");
      return watermark(input.file, input.logo, {
        position: s.position, scale: s.scale / 100, opacity: s.opacity / 100,
        margin: Math.round((before.width * s.margin) / 100),
        rotation: s.rotation, spacing: Math.round((before.width * s.spacing) / 1000),
        format: s.format === "keep" ? undefined : (s.format as OutputFormat),
        quality: s.quality,
      });
    }
  }
}

/* ── paid path ─────────────────────────────────────────────────────────── */

async function runPaid(
  supabase: Client, userId: string, workspaceId: string,
  slug: ToolSlug, serviceSlug: string, input: RunInput, before: Facts,
  billing: BillingConfig, floorCredits: number,
): Promise<RunSuccess | RunFailure> {
  const capability = toolBySlug(slug)!.capability!;
  // The four photo tools — Photoroom-pinned, delivered as a stored result,
  // traced under their own admin key with the endpoint that answered.
  const photo = isPhotoTool(slug);

  // Geometry is settled BEFORE a single credit moves, and each capability
  // resolves its own provider so the call below stays fully typed.
  let plan: ExpandPlan | null = null;
  let factor: UpscaleFactor = 2;
  if (slug === "expand") {
    plan = planExpand(before, parseSettings("expand", input.settings).ratio);
    if (!plan) return { ok: false, error: "already_that_ratio" };
  }
  if (slug === "upscale") {
    factor = parseSettings("upscale", input.settings).factor;
    if (before.width * factor > 8000 || before.height * factor > 8000) {
      return { ok: false, error: "image_too_large" };
    }
  }

  const operation = toolBySlug(slug)?.operation as EditOperation | undefined;
  const background = capability === "background" ? await pickProvider(supabase, forTool(slug, BACKGROUND_PROVIDERS)) : null;
  const upscaler = capability === "upscale" ? await pickProvider(supabase, forTool(slug, UPSCALE_PROVIDERS)) : null;
  const expander = capability === "expand" ? await pickProvider(supabase, forTool(slug, EXPAND_PROVIDERS)) : null;
  const editor = capability === "edit" && operation ? await pickEditProvider(supabase, operation, slug) : null;
  const picked = background ?? upscaler ?? expander ?? editor;
  if (!picked) return { ok: false, error: "no_provider" };

  // A SANDBOX KEY IS A TEST, NOT A PRODUCT. Photoroom stamps every result it
  // returns with a watermark, so a customer is refused before anything moves;
  // an operator may run it — for 0 credits, and the result says what it is.
  const sandbox = isSandbox(picked);
  if (sandbox && !input.viewerIsAdmin) return { ok: false, error: "provider_sandbox" };

  // Every option the provider will be sent, resolved BEFORE a credit moves:
  // an AI background with no scene, or a preset that no longer exists, is
  // refused here for free instead of failing after the reservation.
  let editOptions: EditOptions = {};
  let presetKey: string | null = null;
  if (editor) {
    const resolved = await editOptionsFor(supabase, slug, input);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    editOptions = resolved.options;
    presetKey = resolved.preset;
  }

  const costUsd = background ? background.provider.estimateUsd()
    : upscaler ? upscaler.provider.estimateUsd(factor)
      : expander ? expander.provider.estimateUsd()
        : editor!.provider.estimateUsd(operation!);
  const priced: PriceQuote = quote(costUsd, floorCredits, billing);

  // ── FREE ALLOWANCE ──────────────────────────────────────────────────────
  // Taken here, between the quote and the wallet, so everything downstream —
  // the reservation, the usage row, the refund on failure — works on ONE
  // number and has no idea the run was free. The claim is a single counting
  // statement in the database; a batch cannot race past it.
  //
  // It is also last in line deliberately: a tool with no provider, or an
  // oversized image, has already been refused above. There is no point
  // spending a seller's free run on a request that was never going to happen.
  // A sandbox test costs nothing already, so it never spends one either.
  const rules = await freeToolRules(supabase);
  const rule = sandbox ? undefined : rules.get(slug);
  let freeRemaining: number | null = null;
  // Pinned once: the release below must hand the grant back to the window the
  // claim took it from, not to whichever window the clock has moved on to.
  const freeWindowIso = rule ? windowStart(rule.window).toISOString() : null;
  if (rule && freeWindowIso && planQualifies(rule, await planSlugOf(supabase, workspaceId, rule))) {
    freeRemaining = await claimFreeRun(supabase, workspaceId, slug, rule, freeWindowIso);
  }
  const price: PriceQuote = sandbox || freeRemaining !== null ? { ...priced, credits: 0 } : priced;

  // The claim is taken above because the PRICE depends on it, which means
  // every refusal between there and a run that actually started owes the
  // seller their free run back. Nothing was called, nothing was billed,
  // nothing was delivered (migration 0103).
  const releaseFree = async () => {
    if (freeRemaining === null || !rule) return;
    await releaseFreeRun(supabase, dispatchToken(), workspaceId, slug, rule, freeWindowIso ?? undefined);
  };

  const { data: wallet } = await supabase
    .from("credit_wallets").select("id, balance").eq("workspace_id", workspaceId).maybeSingle();
  if (!wallet) { await releaseFree(); return { ok: false, error: "no_wallet" }; }
  if (wallet.balance < price.credits) {
    await releaseFree();
    return { ok: false, error: "insufficient_credits", missingCredits: price.credits - wallet.balance };
  }

  // Which API answers a photo tool, named on the ledger and on the trace so
  // the admin can see "Photoroom · v1/segment" next to every charge.
  const endpoint = photo ? (capability === "background" ? "v1/segment" : "v2/edit") : null;
  const environment: "live" | "sandbox" = sandbox ? "sandbox" : "live";

  // Reserve: credits leave the wallet now and come straight back if the
  // provider does not deliver.
  const usage = await startUsage(supabase, {
    serverToken: dispatchToken(),
    userId, workspaceId, walletId: wallet.id,
    serviceSlug, providerSlug: picked.provider.slug, modelSlug: picked.provider.label,
    creditsCharged: price.credits,
    idempotencyKey: input.idempotencyKey,
    metadata: {
      tool: slug,
      estimated_cost_usd: costUsd,
      margin_percent: Math.round(price.marginPercent),
      // A zero-credit paid tool is otherwise indistinguishable from a local
      // one on the ledger, and the whole point of the free tier is that its
      // cost is real and has to be visible in the economics view.
      ...(freeRemaining === null ? {} : { free_grant: true, free_remaining: freeRemaining }),
      // Names and codes only — a preset is logged by its key, never its prompt.
      ...(photo ? { endpoint, environment, ...(presetKey ? { preset: presetKey } : {}) } : {}),
    },
  });
  if (!usage.ok) { await releaseFree(); return { ok: false, error: usage.error }; }

  // The same request, already delivered by an earlier attempt: hand the
  // reservation (and a free run) straight back — nothing was called.
  if (input.alreadyDelivered && await input.alreadyDelivered()) {
    await failUsage(supabase, {
      serverToken: dispatchToken(), eventId: usage.eventId, walletId: wallet.id,
      error: "already_delivered", apiCostUsdMicros: 0,
    });
    await releaseFree();
    return { ok: false, error: "already_delivered" };
  }

  // The provider side of this run (ai_provider_calls). The price is the
  // provider catalogue's per-call figure — an ESTIMATE, labelled as one; no
  // image-tool vendor returns what it billed.
  const callStartedAt = Date.now();
  const trace = (ok: boolean, costUsd: number | null, errorCode?: string): ProviderCall => ({
    actorKind: "customer", consumer: "image_tool", userId, workspaceId,
    // A photo tool is booked under its admin key (tool_remove_bg …), which is
    // what its own "Modele, API i koszty" tab reads its runs back by.
    toolKey: photo ? serviceSlug : slug === "upscale" ? "tool_upscale" : slug === "expand" ? "tool_expand" : slug,
    usageEventId: usage.eventId, providerSlug: picked.provider.slug,
    model: endpoint ? `${picked.provider.label} · ${endpoint}` : picked.provider.label,
    status: ok ? "succeeded" : "failed", errorCode: ok ? null : errorCode,
    units: 1, unitKind: "request",
    cost: costUsd == null ? { basis: "unknown" } : { basis: "estimated", usdMicros: usdToMicros(costUsd) },
    durationMs: Date.now() - callStartedAt,
  });

  // Set the moment the provider has answered: from then on the call is ours
  // to pay for, whatever happens to the bytes afterwards.
  let answered: { costUsd: number } | null = null;
  try {
    const request = { bytes: input.file, mime: input.mime };
    // "Zmień kolor tła": the colour rides on the cutout request itself (one
    // Basic-rate call). The provider is always asked for a lossless PNG — the
    // seller's JPEG, when chosen, is encoded here at our own quality.
    const colour = slug === "white_bg" ? parseSettings("white_bg", input.settings) : null;
    const result = background
      ? await background.provider.removeBackground(request, background.creds,
        colour && background.provider.supportsBgColor ? { bgColor: colour.color.toUpperCase(), format: "png" } : undefined)
      : upscaler
        ? await upscaler.provider.upscale(request, { factor, width: before.width, height: before.height }, upscaler.creds)
        : expander
          ? await expander.provider.expand(request, plan!, expander.creds)
          : await editor!.provider.edit(request, operation!, editOptions, editor!.creds);
    answered = { costUsd: result.costUsd };

    let bytes = result.bytes;
    // Providers with a fixed factor (Stability's fast upscaler is always 4×)
    // are brought back to the requested size locally rather than refused.
    if (slug === "upscale") {
      const raw = await inspect(bytes);
      const wanted = before.width * factor;
      if (raw.width > wanted * 1.02) {
        bytes = await resizeConvert(bytes, { format: "png", width: wanted });
      }
    }
    if (slug === "remove_bg") {
      const s = parseSettings("remove_bg", input.settings);
      if (s.format === "webp") bytes = await resizeConvert(bytes, { format: "webp", quality: 92 });
    }
    if (colour && (!background?.provider.supportsBgColor || colour.format !== "png" || colour.padding > 0)) {
      // A vendor without bg_color, a non-PNG export or padding: the colour is
      // laid (or re-encoded) here — on an already flat image this only encodes.
      bytes = await flattenToColor(bytes, {
        color: colour.color, format: colour.format as OutputFormat,
        quality: colour.quality, padding: colour.padding / 100,
      });
    }
    if (slug === "ai_background" || slug === "ai_shadow") {
      // Photoroom was asked for PNG; the seller's format is encoded here.
      const s = parseSettings(slug, input.settings);
      const transparent = slug === "ai_shadow" && parseSettings("ai_shadow", input.settings).background === "transparent";
      const target = transparent && s.format === "jpeg" ? "png" : s.format;
      if (target !== "png") bytes = await resizeConvert(bytes, { format: target, quality: 92 });
    }

    const after = await inspect(bytes);
    const mime = mimeOf(after.format);

    // Stored BEFORE the run is booked as delivered: a result that cannot be
    // kept is refunded like any other failure (the provider's cost stays on
    // our side of the ledger, where it belongs).
    let delivered: { id: string; path: string } | undefined;
    if (input.deliver) {
      const stored = await input.deliver({
        bytes, mime, width: after.width, height: after.height, credits: price.credits,
        usageEventId: usage.eventId, providerSlug: picked.provider.slug, endpoint, environment,
        meta: result.meta ?? {},
      });
      if (!stored.ok) {
        await failUsage(supabase, {
          serverToken: dispatchToken(), eventId: usage.eventId, walletId: wallet.id,
          error: stored.error, apiCostUsdMicros: usdToMicros(result.costUsd),
        });
        await recordProviderCalls(supabase, [trace(true, result.costUsd)]);
        return { ok: false, error: stored.error };
      }
      delivered = { id: stored.id, path: stored.path };
    }

    await completeUsage(supabase, dispatchToken(), usage.eventId, 1, {
      apiCostUsdMicros: usdToMicros(result.costUsd),
      providerRequestId: result.requestId,
    });
    await recordProviderCalls(supabase, [trace(true, result.costUsd)]);
    return {
      ok: true, bytes, mime, credits: price.credits,
      before: { width: before.width, height: before.height, bytes: before.bytes },
      after: { width: after.width, height: after.height, bytes: after.bytes },
      providerLabel: picked.provider.label,
      ...(delivered ? { delivered } : {}),
      ...(photo ? { environment } : {}),
    };
  } catch (e) {
    const known = e instanceof ToolProviderError;
    // A photo tool whose provider already answered failed on OUR side: the
    // call was billed, the seller gets nothing and is refunded.
    const code = photo && answered ? "processing_failed" : known ? e.code : "provider_error";
    // WHAT THE FAILED CALL COST, told apart honestly:
    //   billed  — the provider processed it (it answered, or it reported an
    //             unsupported field after doing the work): the list price;
    //   unknown — a timeout, or (photo tools) a dropped connection: the
    //             provider may or may not have run it, so no figure is
    //             invented — "nieznany", never a confident zero;
    //   zero    — a refusal the provider does not bill.
    const billedUsd = answered ? answered.costUsd
      : known && e.billed ? (sandbox ? 0 : costUsd) : null;
    const unknown = billedUsd == null
      && (code === "provider_timeout" || (photo && code === "provider_unreachable"));
    // The seller keeps their credits: one idempotent refund, always.
    await failUsage(supabase, {
      serverToken: dispatchToken(), eventId: usage.eventId, walletId: wallet.id, error: code,
      apiCostUsdMicros: billedUsd == null ? 0 : usdToMicros(billedUsd),
    });
    await recordProviderCalls(supabase, [trace(false, billedUsd ?? (unknown ? null : 0), code)]);
    return { ok: false, error: code };
  }
}

/* ── as a workflow step ────────────────────────────────────────────────── */

export type ToolStepSlug = "remove_bg" | "upscale" | "expand";

export type ToolStepResult =
  | { ok: true; bytes: Buffer; mime: string; providerSlug: string; providerLabel: string; costUsd: number | null; requestId: string | null }
  /** `retriable`: a 429 / 5xx / timeout / network failure — worth another try.
   *  Everything else (bad image, no key, refused) is final. */
  | { ok: false; error: string; retriable: boolean; providerSlug: string | null };

/**
 * ONE PROVIDER CALL of an existing tool, for a workflow step. The same provider
 * choice (first configured, cheapest first), the same geometry rules and the
 * same post-processing as the tool itself — and NO ledger, no free allowance:
 * the workflow charged the customer once for the whole run. The caller records
 * the call in the provider trace.
 */
export async function runToolProviderStep(
  supabase: Client, slug: ToolStepSlug, image: { bytes: Buffer; mime: string },
  opts: { ratio?: AspectRatio; factor?: UpscaleFactor } = {},
): Promise<ToolStepResult> {
  let before: Facts;
  try { before = await inspect(image.bytes); }
  catch { return { ok: false, error: "unreadable_image", retriable: false, providerSlug: null }; }
  if (!before.width || !before.height) return { ok: false, error: "unreadable_image", retriable: false, providerSlug: null };
  if (image.bytes.length > MAX_INPUT_BYTES) return { ok: false, error: "image_too_large", retriable: false, providerSlug: null };

  const factor: UpscaleFactor = opts.factor ?? 2;
  let plan: ExpandPlan | null = null;
  if (slug === "expand") {
    plan = planExpand(before, opts.ratio ?? "1:1");
    // Already that shape: nothing to expand — the input passes through as is.
    if (!plan) return { ok: true, bytes: image.bytes, mime: image.mime, providerSlug: "local", providerLabel: "local", costUsd: 0, requestId: null };
  }
  if (slug === "upscale" && (before.width * factor > 8000 || before.height * factor > 8000)) {
    return { ok: false, error: "image_too_large", retriable: false, providerSlug: null };
  }

  const background = slug === "remove_bg" ? await pickProvider(supabase, BACKGROUND_PROVIDERS) : null;
  const upscaler = slug === "upscale" ? await pickProvider(supabase, UPSCALE_PROVIDERS) : null;
  const expander = slug === "expand" ? await pickProvider(supabase, EXPAND_PROVIDERS) : null;
  const picked = background ?? upscaler ?? expander;
  if (!picked) return { ok: false, error: "no_provider", retriable: false, providerSlug: null };

  try {
    const request = { bytes: image.bytes, mime: image.mime };
    const result = background
      ? await background.provider.removeBackground(request, background.creds)
      : upscaler
        ? await upscaler.provider.upscale(request, { factor, width: before.width, height: before.height }, upscaler.creds)
        : await expander!.provider.expand(request, plan!, expander!.creds);
    let bytes = result.bytes;
    if (slug === "upscale") {
      const raw = await inspect(bytes);
      const wanted = before.width * factor;
      if (raw.width > wanted * 1.02) bytes = await resizeConvert(bytes, { format: "png", width: wanted });
    }
    const after = await inspect(bytes);
    return {
      ok: true, bytes, mime: mimeOf(after.format), providerSlug: picked.provider.slug,
      providerLabel: picked.provider.label, costUsd: result.costUsd, requestId: result.requestId,
    };
  } catch (e) {
    // The provider layer already classifies: 429, 5xx, timeout and network
    // are retryable; auth, out-of-credit and a refused image are not.
    const known = e instanceof ToolProviderError;
    return { ok: false, error: known ? e.code : "provider_error", retriable: known ? e.retryable : true, providerSlug: picked.provider.slug };
  }
}

/**
 * The panel's settings, translated into what the edit interface takes.
 *
 * Each tool owns a couple of dials and nothing else, so this is a small
 * switch rather than a spread of the raw object: an edit request must carry
 * only fields its operation actually reads, and parseSettings has already
 * clamped every one of them.
 */
/**
 * The workspace's active plan slug, read ONLY when an allowance is actually
 * restricted to certain plans. Most operators will leave the list empty —
 * "free for everyone" — and that case must not cost a query per run.
 */
async function planSlugOf(
  supabase: Client, workspaceId: string, rule: { plans: string[] },
): Promise<string | null> {
  if (rule.plans.length === 0) return null;
  const { data } = await supabase
    .from("subscriptions")
    .select("subscription_plans(slug)")
    .eq("workspace_id", workspaceId).eq("status", "active").maybeSingle();
  const plan = (data as { subscription_plans?: { slug?: string } } | null)?.subscription_plans;
  return plan?.slug ?? null;
}

type ResolvedEdit =
  | { ok: true; options: EditOptions; preset: string | null }
  | { ok: false; error: string };

async function editOptionsFor(supabase: Client, slug: ToolSlug, input: RunInput): Promise<ResolvedEdit> {
  const raw = input.settings;
  switch (slug) {
    case "ai_background": {
      // THE SCENE. A preset is named by key and resolved HERE, from the
      // operator's private list — its prompt never reaches the browser. The
      // seller's own words go AS WRITTEN: no expansion is asked for
      // (`ai.never`), like the generator's "Własny prompt". A preset decides
      // that for itself (the operator's switch).
      const s = parseSettings("ai_background", raw);
      let prompt = s.prompt;
      let expandPrompt = false;
      let preset: string | null = null;
      if (s.preset) {
        const found = (await readAiBackgroundPresets(supabase)).find((p) => p.key === s.preset && p.enabled);
        if (!found) return { ok: false, error: "preset_unavailable" };
        prompt = found.prompt;
        expandPrompt = found.expandPrompt;
        preset = found.key;
      }
      if (!prompt) return { ok: false, error: "prompt_required" };
      return {
        ok: true, preset,
        options: {
          prompt, expandPrompt,
          guidance: input.guidance ? { image: input.guidance, scale: s.guidance } : undefined,
          // Always PNG from the provider — the seller's format is encoded by us.
          format: "png",
        },
      };
    }
    case "relight": {
      const s = parseSettings("relight", raw);
      return { ok: true, preset: null, options: { lighting: s.intent, format: s.format } };
    }
    case "ai_shadow": {
      const s = parseSettings("ai_shadow", raw);
      return {
        ok: true, preset: null,
        options: {
          shadow: s.style,
          transparent: s.background === "transparent",
          color: s.background === "white" ? "#FFFFFF" : s.color,
          format: "png",
        },
      };
    }
    case "beautify": {
      const s = parseSettings("beautify", raw);
      return { ok: true, preset: null, options: { beautify: s.subject, format: s.format } };
    }
    case "uncrop":
      return { ok: true, preset: null, options: { format: parseSettings("uncrop", raw).format } };
    case "ghost_mannequin":
      return { ok: true, preset: null, options: { format: parseSettings("ghost_mannequin", raw).format } };
    default:
      return { ok: true, preset: null, options: {} };
  }
}

/* ── AI background presets ─────────────────────────────────────────────── */

const presetCache: { at: number; list: AiBackgroundPreset[] } = { at: 0, list: [] };
const PRESET_TTL = 30_000;

/**
 * The operator's scene presets for "Dodaj tło AI", WITH their prompts — server
 * only. The row is private (`app_setting_is_private`), so a customer's session
 * cannot select it; this reads it through a SECURITY DEFINER function gated by
 * the server token, the same way provider credentials are read. Nothing set →
 * no presets: the panel then offers only the seller's own description.
 */
export async function readAiBackgroundPresets(supabase: Client): Promise<AiBackgroundPreset[]> {
  if (Date.now() - presetCache.at < PRESET_TTL) return presetCache.list;
  const token = dispatchToken();
  if (!token) return [];
  const { data, error } = await supabase.rpc("ai_background_presets_read", { p_token: token });
  if (error) return presetCache.list;
  const list = parsePresets(data);
  presetCache.at = Date.now();
  presetCache.list = list;
  return list;
}

function mimeOf(format: string): string {
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  if (format === "avif") return "image/avif";
  if (format === "tiff") return "image/tiff";
  return "image/png";
}
