import "server-only";
import { decryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import type { Client } from "@/lib/services/workspace";
import { startUsage, completeUsage, failUsage } from "@/lib/services/usage";
import {
  DEFAULT_SETTINGS, TOOLS, toolBySlug,
  type AspectRatio, type ToolSettings, type ToolSlug, type UpscaleFactor,
} from "@/lib/images/tools";
import { billingFrom, quote, usdToMicros, type BillingConfig, type PriceQuote } from "@/lib/images/pricing";
import {
  ALL_TOOL_PROVIDERS, BACKGROUND_PROVIDERS, EXPAND_PROVIDERS, UPSCALE_PROVIDERS,
  ToolProviderError, envKey,
  type Creds, type ExpandPlan,
} from "@/lib/images/providers";
import {
  composeEditor, compress, dropShadow, flattenToColor, inspect, resizeConvert, watermark,
  MAX_INPUT_BYTES, type OutputFormat,
} from "@/lib/images/local";
import { clampEditorState } from "@/lib/images/editor-state";

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
 * Otherwise the encrypted credential the admin panel stores, decrypted with
 * the server-only master key.
 */
async function resolveCreds(supabase: Client, provider: ProviderBase): Promise<{ creds: Creds; source: KeySource } | null> {
  const fromEnv = envKey(provider);
  if (fromEnv) return { creds: { apiKey: fromEnv }, source: "env" };
  if (!provider.vaultSlug || !encryptionAvailable()) return null;

  const cached = vaultCache.get(provider.vaultSlug);
  if (cached && Date.now() - cached.at < VAULT_TTL) {
    return cached.creds ? { creds: cached.creds, source: "vault" } : null;
  }

  const { data: row } = await supabase
    .from("ai_providers").select("id").eq("slug", provider.vaultSlug).eq("active", true).maybeSingle();
  let creds: Creds | null = null;
  if (row) {
    // SECURITY DEFINER: the credentials table itself stays admin-only, and
    // the ciphertext is useless without APP_ENCRYPTION_KEY.
    const { data: credRows } = await supabase.rpc("get_active_provider_credential", { p_provider_id: row.id });
    const cred = credRows?.[0];
    if (cred) {
      try {
        creds = { apiKey: decryptSecret(cred.encrypted_value, cred.iv, cred.auth_tag), baseUrl: cred.base_url };
      } catch { creds = null; }
    }
  }
  vaultCache.set(provider.vaultSlug, { creds, at: Date.now() });
  return creds ? { creds, source: "vault" } : null;
}

/** First provider in the preference list (cheapest first) that has a key. */
async function pickProvider<T extends ProviderBase>(supabase: Client, list: T[]): Promise<{ provider: T; creds: Creds; source: KeySource } | null> {
  for (const provider of list) {
    const resolved = await resolveCreds(supabase, provider);
    if (resolved) return { provider, creds: resolved.creds, source: resolved.source };
  }
  return null;
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
  /** Why a paid tool cannot run. */
  reason: "ok" | "no_provider" | "maintenance" | "disabled";
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

/** What the Tools page renders: real availability and the real price. */
export async function toolCatalogue(supabase: Client): Promise<ToolAvailability[]> {
  const { services, billing } = await loadContext(supabase);
  const [background, upscale, expand] = await Promise.all([
    pickProvider(supabase, BACKGROUND_PROVIDERS),
    pickProvider(supabase, UPSCALE_PROVIDERS),
    pickProvider(supabase, EXPAND_PROVIDERS),
  ]);

  return TOOLS.map((tool): ToolAvailability => {
    const service = services.get(tool.service);
    const floor = service?.credits_cost ?? 0;
    if (service && service.enabled === false) {
      return { slug: tool.slug, kind: tool.kind, available: false, credits: 0, providerLabel: null, reason: "disabled" };
    }
    if (service?.maintenance_mode) {
      return { slug: tool.slug, kind: tool.kind, available: false, credits: 0, providerLabel: null, reason: "maintenance" };
    }
    if (tool.kind === "local") {
      return { slug: tool.slug, kind: "local", available: true, credits: 0, providerLabel: null, reason: "ok" };
    }
    const picked = tool.capability === "background" ? background
      : tool.capability === "upscale" ? upscale : expand;
    if (!picked) {
      return { slug: tool.slug, kind: "paid", available: false, credits: 0, providerLabel: null, reason: "no_provider" };
    }
    // Upscale is priced at its most expensive factor so the card never
    // advertises less than the seller can end up paying.
    const costUsd = tool.capability === "upscale"
      ? (picked.provider as { estimateUsd: (f: UpscaleFactor) => number }).estimateUsd(4)
      : (picked.provider as { estimateUsd: () => number }).estimateUsd();
    return {
      slug: tool.slug, kind: "paid", available: true,
      credits: quote(costUsd, floor, billing).credits,
      providerLabel: picked.provider.label,
      reason: "ok",
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
};

export type RunSuccess = {
  ok: true;
  bytes: Buffer;
  mime: string;
  credits: number;
  before: { width: number; height: number; bytes: number };
  after: { width: number; height: number; bytes: number };
  providerLabel: string | null;
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
  // Zero-credit run, still written to the ledger so the economics view can
  // report volume and the free/paid split without a second system.
  const usage = await startUsage(supabase, {
    userId, workspaceId, walletId: "",
    serviceSlug, providerSlug: "local", modelSlug: "sharp",
    creditsCharged: 0,
    idempotencyKey: input.idempotencyKey,
    metadata: { tool: slug, bytes_in: before.bytes, bytes_out: after.bytes },
  });
  if (usage.ok) await completeUsage(supabase, usage.eventId, 1, { apiCostUsdMicros: 0 });

  return {
    ok: true, bytes: output, mime: mimeOf(after.format), credits: 0,
    before: { width: before.width, height: before.height, bytes: before.bytes },
    after: { width: after.width, height: after.height, bytes: after.bytes },
    providerLabel: null,
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

  const background = capability === "background" ? await pickProvider(supabase, BACKGROUND_PROVIDERS) : null;
  const upscaler = capability === "upscale" ? await pickProvider(supabase, UPSCALE_PROVIDERS) : null;
  const expander = capability === "expand" ? await pickProvider(supabase, EXPAND_PROVIDERS) : null;
  const picked = background ?? upscaler ?? expander;
  if (!picked) return { ok: false, error: "no_provider" };

  const costUsd = background ? background.provider.estimateUsd()
    : upscaler ? upscaler.provider.estimateUsd(factor)
      : expander!.provider.estimateUsd();
  const price: PriceQuote = quote(costUsd, floorCredits, billing);

  const { data: wallet } = await supabase
    .from("credit_wallets").select("id, balance").eq("workspace_id", workspaceId).maybeSingle();
  if (!wallet) return { ok: false, error: "no_wallet" };
  if (wallet.balance < price.credits) {
    return { ok: false, error: "insufficient_credits", missingCredits: price.credits - wallet.balance };
  }

  // Reserve: credits leave the wallet now and come straight back if the
  // provider does not deliver.
  const usage = await startUsage(supabase, {
    userId, workspaceId, walletId: wallet.id,
    serviceSlug, providerSlug: picked.provider.slug, modelSlug: picked.provider.label,
    creditsCharged: price.credits,
    idempotencyKey: input.idempotencyKey,
    metadata: { tool: slug, estimated_cost_usd: costUsd, margin_percent: Math.round(price.marginPercent) },
  });
  if (!usage.ok) return { ok: false, error: usage.error };

  try {
    const request = { bytes: input.file, mime: input.mime };
    const result = background
      ? await background.provider.removeBackground(request, background.creds)
      : upscaler
        ? await upscaler.provider.upscale(request, { factor, width: before.width, height: before.height }, upscaler.creds)
        : await expander!.provider.expand(request, plan!, expander!.creds);

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

    const after = await inspect(bytes);
    await completeUsage(supabase, usage.eventId, 1, {
      apiCostUsdMicros: usdToMicros(result.costUsd),
      providerRequestId: result.requestId,
    });
    return {
      ok: true, bytes, mime: mimeOf(after.format), credits: price.credits,
      before: { width: before.width, height: before.height, bytes: before.bytes },
      after: { width: after.width, height: after.height, bytes: after.bytes },
      providerLabel: picked.provider.label,
    };
  } catch (e) {
    const code = e instanceof ToolProviderError ? e.code : "provider_error";
    // The seller keeps their credits: one idempotent refund, always.
    await failUsage(supabase, { eventId: usage.eventId, walletId: wallet.id, error: code, apiCostUsdMicros: 0 });
    return { ok: false, error: code };
  }
}

function mimeOf(format: string): string {
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  if (format === "avif") return "image/avif";
  if (format === "tiff") return "image/tiff";
  return "image/png";
}
