import "server-only";
import type { AspectRatio, UpscaleFactor } from "./tools";

/**
 * PAID TOOL PROVIDERS — background removal, super-resolution and outpainting.
 *
 * Three narrow interfaces, several interchangeable implementations, one
 * ordered preference list per capability. The list is sorted cheapest-first,
 * so whichever key an operator connects, the module automatically runs the
 * least expensive backend that can do the job and the cost engine reprices
 * the tool around it.
 *
 * Keys are read from the server environment only. Nothing in this file is
 * reachable from the browser (`server-only`), no key is ever logged, and an
 * unconfigured provider is simply absent rather than faked.
 */

export type ToolBytes = { bytes: Buffer; mime: string };
export type ToolResponse = ToolBytes & {
  /** What this single call really cost us, in USD. Recorded on the ledger. */
  costUsd: number;
  requestId: string | null;
};
export type Creds = { apiKey: string; baseUrl?: string | null };

export class ToolProviderError extends Error {
  constructor(public readonly code: string, public readonly retryable = false) {
    super(code);
    this.name = "ToolProviderError";
  }
}

type Base = {
  slug: string;
  label: string;
  /** Server env var carrying the key. Also the name shown to the operator. */
  envVar: string;
  /** Where an operator generates that key. */
  keyUrl: string;
  /** Matching `ai_providers.slug`, when the key may instead live in the
   *  encrypted credential vault the admin panel writes to. */
  vaultSlug?: string;
};

export interface BackgroundRemovalProvider extends Base {
  estimateUsd(): number;
  removeBackground(input: ToolBytes, creds: Creds): Promise<ToolResponse>;
}

export interface UpscaleProvider extends Base {
  estimateUsd(factor: UpscaleFactor): number;
  upscale(input: ToolBytes, opts: { factor: UpscaleFactor; width: number; height: number }, creds: Creds): Promise<ToolResponse>;
}

export type ExpandPlan = {
  ratio: AspectRatio;
  /** Pixels to paint on each side of the original. */
  pad: { left: number; right: number; up: number; down: number };
  /** Resulting canvas. */
  target: { width: number; height: number };
  source: { width: number; height: number };
};

export interface ImageExpandProvider extends Base {
  estimateUsd(): number;
  expand(input: ToolBytes, plan: ExpandPlan, creds: Creds): Promise<ToolResponse>;
}

/**
 * THE GENERATIVE EDITS, AS ONE CAPABILITY.
 *
 * Background removal, upscale and expand each got their own interface above
 * because each takes its own shaped argument and several vendors compete for
 * them. The edits below are different: they are all "hand the model the photo
 * and a mode, get the photo back", they all arrive from the same vendor
 * endpoint, and they will keep arriving — Photoroom ships new ones regularly.
 * Six more one-method interfaces would mean six more preference arrays, six
 * more branches in the runner and six more places to forget.
 *
 * So they share one interface and are distinguished by an operation name. A
 * second vendor can implement any subset: `supports()` is what the resolver
 * asks, so a provider that only does relighting never gets handed a ghost
 * mannequin.
 */
export const EDIT_OPERATIONS = [
  "ai_background", "relight", "ai_shadow", "beautify", "uncrop", "ghost_mannequin",
] as const;
export type EditOperation = (typeof EDIT_OPERATIONS)[number];

/** Everything the edits between them can be told. Each provider reads only the
 *  fields its operation actually uses. */
export type EditOptions = {
  /** ai_background: a described scene, or a flat colour when no prompt is set. */
  prompt?: string;
  color?: string;
  /** relight: which of the model's lighting intents to apply. */
  lighting?: "auto" | "preserve" | "portrait";
  /** ai_shadow: how hard the cast shadow should be. */
  shadow?: "soft" | "auto";
  /** beautify: product pack-shot look, or the one tuned for food. */
  beautify?: "auto" | "food";
  /** Output encoding, so a transparent result is not silently flattened. */
  format?: "png" | "jpeg" | "webp";
  /** Square canvas the subject is fitted into, when the operation resizes. */
  outputSize?: string;
};

export interface ImageEditProvider extends Base {
  supports(op: EditOperation): boolean;
  estimateUsd(op: EditOperation): number;
  edit(input: ToolBytes, op: EditOperation, opts: EditOptions, creds: Creds): Promise<ToolResponse>;
}

/* ── shared helpers ────────────────────────────────────────────────────── */

const TIMEOUT = 120_000;

function classify(status: number): ToolProviderError {
  if (status === 401 || status === 403) return new ToolProviderError("provider_auth_failed");
  if (status === 402) return new ToolProviderError("provider_out_of_credit");
  if (status === 413) return new ToolProviderError("image_too_large");
  if (status === 429) return new ToolProviderError("provider_rate_limited", true);
  return new ToolProviderError("provider_error", status >= 500);
}

async function send(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) }).catch((e: unknown) => {
    const name = (e as { name?: string })?.name;
    throw new ToolProviderError(name === "TimeoutError" ? "provider_timeout" : "provider_unreachable", true);
  });
  if (!res.ok) throw classify(res.status);
  return res;
}

/** Binary-returning endpoints (Stability, Clipdrop, remove.bg, Photoroom). */
async function binary(res: Response): Promise<ToolBytes> {
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new ToolProviderError("provider_empty_result");
  return { bytes: buf, mime: res.headers.get("content-type")?.split(";")[0] || "image/png" };
}

function form(input: ToolBytes, field: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.append(field, new Blob([new Uint8Array(input.bytes)], { type: input.mime }), "image");
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}

/* ── Photoroom /v2/edit ────────────────────────────────────────────────────
 *
 * ONE ENDPOINT, MANY FEATURES. Photoroom's Image Editing API is a single
 * POST that takes the image plus a set of dot-namespaced switches —
 * `shadow.mode`, `lighting.mode`, `expand.mode`, `background.color` and so on
 * — and returns the finished image as bytes. So every Photoroom-backed tool in
 * GrovBase is the same call with a different parameter bag, and this helper is
 * the only place that knows the wire format.
 *
 * BILLING SHAPE, WHICH THE COST ENGINE HAS TO MATCH. Photoroom prices per
 * image, by which API answered: the Remove Background API (/v1/segment) bills
 * at the Basic rate and the Image Editing API (/v2/edit) at the Plus rate —
 * and it bills that way even across plans, so a Plus subscriber calling
 * /v1/segment pays the Basic price and vice versa. That is why background
 * removal keeps using v1 below: it is the same result for a fifth of the cost.
 *
 * SANDBOX IS A PROPERTY OF THE KEY, not of the URL. A key beginning with
 * `sandbox_` runs against the same endpoints, returns a WATERMARKED image and
 * is metered separately (Photoroom documents roughly 1000 calls a month, 100 a
 * day, at no charge). Nothing here has to switch hosts — see `isSandboxKey`,
 * which exists so the panel can SAY which environment a key belongs to and the
 * cost engine can stop charging for a watermarked result.
 */

const PHOTOROOM_EDIT_URL = "https://image-api.photoroom.com/v2/edit";
/** Per-image list price of one /v2/edit call, in USD (Plus rate). */
export const PHOTOROOM_EDIT_USD = 0.10;
/** Per-image list price of one /v1/segment call, in USD (Basic rate). */
export const PHOTOROOM_SEGMENT_USD = 0.02;

/** Photoroom's own marker. A sandbox key is still a real key — it just bills
 *  nothing and stamps the result, so both facts have to reach the operator. */
export function isSandboxKey(apiKey: string): boolean {
  return apiKey.trim().toLowerCase().startsWith("sandbox_");
}

/**
 * One /v2/edit call.
 *
 * `params` are sent verbatim as multipart fields, so a caller states exactly
 * the documented parameter names and nothing translates them behind its back.
 * Undefined and empty values are dropped rather than sent as "", which the API
 * would read as a real (and wrong) value.
 */
export async function photoroomEdit(
  input: ToolBytes,
  params: Record<string, string | number | undefined | null>,
  creds: Creds,
): Promise<ToolResponse> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    fields[key] = String(value);
  }
  const res = await send(creds.baseUrl?.trim() || PHOTOROOM_EDIT_URL, {
    method: "POST",
    // No Content-Type header: fetch sets the multipart boundary itself.
    headers: { "x-api-key": creds.apiKey, Accept: "image/png, image/jpeg, image/webp, application/json" },
    body: form(input, "imageFile", fields),
  });
  return {
    ...(await binary(res)),
    // A sandbox call costs nothing, and charging a seller credits for a
    // watermarked image would be taking money for a result they cannot use.
    costUsd: isSandboxKey(creds.apiKey) ? 0 : PHOTOROOM_EDIT_USD,
    requestId: res.headers.get("x-request-id"),
  };
}

/** fal returns hosted URLs; we download immediately and never expose them. */
async function falRun(path: string, body: unknown, creds: Creds): Promise<ToolBytes & { requestId: string | null }> {
  const base = creds.baseUrl?.replace(/\/$/, "") || "https://fal.run";
  const res = await send(`${base}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${creds.apiKey}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    image?: { url?: string; content_type?: string };
    images?: { url?: string; content_type?: string }[];
    request_id?: string;
  };
  const image = json.image ?? json.images?.[0];
  if (!image?.url) throw new ToolProviderError("provider_empty_result");
  const dl = await fetch(image.url, { signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
  if (!dl?.ok) throw new ToolProviderError("provider_download_failed", true);
  return {
    bytes: Buffer.from(await dl.arrayBuffer()),
    mime: image.content_type || dl.headers.get("content-type")?.split(";")[0] || "image/png",
    requestId: json.request_id ?? null,
  };
}

const dataUri = (i: ToolBytes) => `data:${i.mime};base64,${i.bytes.toString("base64")}`;

/* ── background removal ────────────────────────────────────────────────── */

const falBackground: BackgroundRemovalProvider = {
  slug: "fal", label: "fal.ai — BiRefNet v2", envVar: "FAL_KEY", vaultSlug: "fal",
  keyUrl: "https://fal.ai/dashboard/keys",
  estimateUsd: () => 0.004,
  async removeBackground(input, creds) {
    const out = await falRun("fal-ai/birefnet/v2", { image_url: dataUri(input) }, creds);
    return { ...out, costUsd: 0.004 };
  },
};

const photoroomBackground: BackgroundRemovalProvider = {
  slug: "photoroom", label: "Photoroom", envVar: "PHOTOROOM_API_KEY", vaultSlug: "photoroom",
  keyUrl: "https://app.photoroom.com/api-dashboard",
  estimateUsd: () => PHOTOROOM_SEGMENT_USD,
  async removeBackground(input, creds) {
    // DELIBERATELY v1, not /v2/edit. Photoroom bills per image by which API
    // answered — the Remove Background rate even for a Plus subscriber — so
    // cutting out a subject here costs $0.02 instead of the $0.10 the editing
    // endpoint would charge for exactly the same cutout.
    const res = await send(creds.baseUrl?.trim() || "https://sdk.photoroom.com/v1/segment", {
      method: "POST",
      headers: { "x-api-key": creds.apiKey, Accept: "image/png, application/json" },
      body: form(input, "image_file", { format: "png" }),
    });
    return {
      ...(await binary(res)),
      costUsd: isSandboxKey(creds.apiKey) ? 0 : PHOTOROOM_SEGMENT_USD,
      requestId: res.headers.get("x-request-id"),
    };
  },
};

const clipdropBackground: BackgroundRemovalProvider = {
  slug: "clipdrop", label: "Clipdrop", envVar: "CLIPDROP_API_KEY", vaultSlug: "clipdrop",
  keyUrl: "https://clipdrop.co/apis/account",
  estimateUsd: () => 0.02,
  async removeBackground(input, creds) {
    const res = await send("https://clipdrop-api.co/remove-background/v1", {
      method: "POST",
      headers: { "x-api-key": creds.apiKey },
      body: form(input, "image_file"),
    });
    return { ...(await binary(res)), costUsd: 0.02, requestId: res.headers.get("x-request-id") };
  },
};

const stabilityBackground: BackgroundRemovalProvider = {
  slug: "stability", label: "Stability AI", envVar: "STABILITY_API_KEY", vaultSlug: "stability",
  keyUrl: "https://platform.stability.ai/account/keys",
  estimateUsd: () => 0.05,
  async removeBackground(input, creds) {
    const res = await send("https://api.stability.ai/v2beta/stable-image/edit/remove-background", {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiKey}`, Accept: "image/*" },
      body: form(input, "image", { output_format: "png" }),
    });
    return { ...(await binary(res)), costUsd: 0.05, requestId: res.headers.get("x-request-id") };
  },
};

const removeBgBackground: BackgroundRemovalProvider = {
  slug: "removebg", label: "remove.bg", envVar: "REMOVE_BG_API_KEY", vaultSlug: "removebg",
  keyUrl: "https://www.remove.bg/dashboard#api-key",
  estimateUsd: () => 0.20,
  async removeBackground(input, creds) {
    const res = await send("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": creds.apiKey },
      body: form(input, "image_file", { size: "auto", format: "png" }),
    });
    return { ...(await binary(res)), costUsd: 0.20, requestId: res.headers.get("x-request-id") };
  },
};

/* ── upscale ───────────────────────────────────────────────────────────── */

/** Stability's fast upscaler is a flat 4×; a 2× request is served by the same
 *  call and resampled down locally, which is still the cheapest route. */
const stabilityUpscale: UpscaleProvider = {
  slug: "stability", label: "Stability AI — Fast Upscaler", envVar: "STABILITY_API_KEY", vaultSlug: "stability",
  keyUrl: "https://platform.stability.ai/account/keys",
  estimateUsd: () => 0.02,
  async upscale(input, _opts, creds) {
    const res = await send("https://api.stability.ai/v2beta/stable-image/upscale/fast", {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiKey}`, Accept: "image/*" },
      body: form(input, "image", { output_format: "png" }),
    });
    return { ...(await binary(res)), costUsd: 0.02, requestId: res.headers.get("x-request-id") };
  },
};

const falUpscale: UpscaleProvider = {
  slug: "fal", label: "fal.ai — ESRGAN", envVar: "FAL_KEY", vaultSlug: "fal",
  keyUrl: "https://fal.ai/dashboard/keys",
  estimateUsd: () => 0.006,
  async upscale(input, opts, creds) {
    const out = await falRun("fal-ai/esrgan", { image_url: dataUri(input), scale: opts.factor }, creds);
    return { ...out, costUsd: 0.006 };
  },
};

const clipdropUpscale: UpscaleProvider = {
  slug: "clipdrop", label: "Clipdrop", envVar: "CLIPDROP_API_KEY", vaultSlug: "clipdrop",
  keyUrl: "https://clipdrop.co/apis/account",
  estimateUsd: () => 0.04,
  async upscale(input, opts, creds) {
    // Clipdrop caps the target at 4096 px on each side.
    const width = Math.min(4096, opts.width * opts.factor);
    const height = Math.min(4096, opts.height * opts.factor);
    const res = await send("https://clipdrop-api.co/image-upscaling/v1/upscale", {
      method: "POST",
      headers: { "x-api-key": creds.apiKey },
      body: form(input, "image_file", { target_width: String(width), target_height: String(height) }),
    });
    return { ...(await binary(res)), costUsd: 0.04, requestId: res.headers.get("x-request-id") };
  },
};

/* ── expand / outpaint ─────────────────────────────────────────────────── */

const stabilityExpand: ImageExpandProvider = {
  slug: "stability", label: "Stability AI — Outpaint", envVar: "STABILITY_API_KEY", vaultSlug: "stability",
  keyUrl: "https://platform.stability.ai/account/keys",
  estimateUsd: () => 0.04,
  async expand(input, plan, creds) {
    const extra: Record<string, string> = { output_format: "png", creativity: "0.2" };
    // Only non-zero sides are sent; the API rejects a request with all four
    // at zero, which the caller already guards against.
    for (const side of ["left", "right", "up", "down"] as const) {
      if (plan.pad[side] > 0) extra[side] = String(Math.min(2000, plan.pad[side]));
    }
    const res = await send("https://api.stability.ai/v2beta/stable-image/edit/outpaint", {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiKey}`, Accept: "image/*" },
      body: form(input, "image", extra),
    });
    return { ...(await binary(res)), costUsd: 0.04, requestId: res.headers.get("x-request-id") };
  },
};

const falExpand: ImageExpandProvider = {
  slug: "fal", label: "fal.ai — Bria Expand", envVar: "FAL_KEY", vaultSlug: "fal",
  keyUrl: "https://fal.ai/dashboard/keys",
  estimateUsd: () => 0.04,
  async expand(input, plan, creds) {
    const out = await falRun("fal-ai/bria/expand", {
      image_url: dataUri(input),
      canvas_size: [plan.target.width, plan.target.height],
      original_image_size: [plan.source.width, plan.source.height],
      original_image_location: [plan.pad.left, plan.pad.up],
    }, creds);
    return { ...out, costUsd: 0.04 };
  },
};

/* ── Photoroom: upscale, expand and the generative edits ───────────────── */

const PHOTOROOM_BASE = {
  slug: "photoroom", envVar: "PHOTOROOM_API_KEY", vaultSlug: "photoroom",
  keyUrl: "https://app.photoroom.com/api-dashboard",
} as const;

/**
 * KEEP THE WHOLE PHOTO.
 *
 * /v2/edit is an EDITOR, and its default is to cut the subject out — every
 * documented example that wants the original frame back sends
 * `removeBackground=false` and `referenceBox=originalImage` explicitly. Left
 * off, an "upscale" would hand the seller a transparent cutout of their
 * product instead of a larger version of their photograph, and a "relight"
 * would quietly delete the studio they shot it in.
 *
 * So every operation below states which of the two it wants, deliberately.
 */
const WHOLE_PHOTO = { removeBackground: "false", referenceBox: "originalImage" } as const;

/** Photoroom's AI upscaler is a fixed 4×; a 2× request is served by the same
 *  call and resampled locally, exactly as the Stability one above is. */
const photoroomUpscale: UpscaleProvider = {
  ...PHOTOROOM_BASE, label: "Photoroom — AI Upscale",
  estimateUsd: () => PHOTOROOM_EDIT_USD,
  async upscale(input, _opts, creds) {
    // ai.fast over ai.slow: this runs inside a 120 s serverless request with a
    // seller watching a batch counter, and the quality gap does not pay for a
    // timeout. ai.slow is the better picture when there is time to wait.
    return photoroomEdit(input, {
      ...WHOLE_PHOTO, "upscale.mode": "ai.fast", "export.format": "png",
    }, creds);
  },
};

const photoroomExpand: ImageExpandProvider = {
  ...PHOTOROOM_BASE, label: "Photoroom — AI Expand",
  estimateUsd: () => PHOTOROOM_EDIT_USD,
  async expand(input, plan, creds) {
    // The plan already carries the canvas GrovBase wants; Photoroom is told the
    // target size and paints the difference itself rather than taking per-side
    // padding the way Stability does.
    return photoroomEdit(input, {
      ...WHOLE_PHOTO,
      "expand.mode": "ai.auto",
      outputSize: `${plan.target.width}x${plan.target.height}`,
      "export.format": "png",
    }, creds);
  },
};

/** Documented parameter values, kept in one table so a call site never spells
 *  a mode by hand. Anything not verified against the API is simply absent. */
const LIGHTING_MODE: Record<string, string> = {
  auto: "ai.auto",
  preserve: "ai.preserve-hue-and-saturation",
  portrait: "ai.optimize-portrait",
};
const BEAUTIFY_MODE: Record<string, string> = { auto: "ai.auto", food: "ai.food" };

const photoroomEdits: ImageEditProvider = {
  ...PHOTOROOM_BASE, label: "Photoroom — AI Edit",
  supports: () => true,
  estimateUsd: () => PHOTOROOM_EDIT_USD,
  async edit(input, op, opts, creds) {
    const format = opts.format ?? "png";
    const common = { "export.format": format, outputSize: opts.outputSize };
    // Relight, beautify and uncrop act on the PHOTOGRAPH; a new background, a
    // cast shadow and a ghost mannequin act on the SUBJECT and therefore want
    // the cutout /v2/edit does by default.
    const framed = { ...common, ...WHOLE_PHOTO };

    if (op === "ai_background") {
      // A described scene when the seller wrote one, a flat colour otherwise.
      // Sending both would let the API pick, and the seller would not know
      // which of their two answers it honoured.
      return photoroomEdit(input, opts.prompt?.trim()
        ? { ...common, "background.prompt": opts.prompt.trim() }
        : { ...common, "background.color": (opts.color ?? "#FFFFFF").replace("#", "") }, creds);
    }
    if (op === "relight") {
      return photoroomEdit(input, {
        ...framed, "lighting.mode": LIGHTING_MODE[opts.lighting ?? "auto"] ?? LIGHTING_MODE.auto,
      }, creds);
    }
    if (op === "ai_shadow") {
      return photoroomEdit(input, {
        ...common, "shadow.mode": opts.shadow === "auto" ? "ai.auto-with-overrides" : "ai.soft",
      }, creds);
    }
    if (op === "beautify") {
      return photoroomEdit(input, {
        ...framed, "beautify.mode": BEAUTIFY_MODE[opts.beautify ?? "auto"] ?? BEAUTIFY_MODE.auto,
      }, creds);
    }
    if (op === "uncrop") {
      return photoroomEdit(input, { ...framed, "uncrop.mode": "ai.auto" }, creds);
    }
    return photoroomEdit(input, { ...common, "ghostMannequin.mode": "ai.auto" }, creds);
  },
};

/* ── registry ──────────────────────────────────────────────────────────── */

/** Cheapest first — the resolver takes the first one that has a key. */
export const BACKGROUND_PROVIDERS: BackgroundRemovalProvider[] = [
  falBackground, photoroomBackground, stabilityBackground, clipdropBackground, removeBgBackground,
];
// Photoroom sits LAST in both lists on purpose: at $0.10 a call it is the
// dearest of the three, and the resolver takes the first provider that has a
// key. An operator who connects only Photoroom gets it everywhere; one who
// also has fal keeps paying fal's $0.006 for an upscale.
export const UPSCALE_PROVIDERS: UpscaleProvider[] = [
  falUpscale, stabilityUpscale, clipdropUpscale, photoroomUpscale,
];
export const EXPAND_PROVIDERS: ImageExpandProvider[] = [stabilityExpand, falExpand, photoroomExpand];

/** The generative edits. Photoroom is the only vendor that does these today,
 *  which is exactly why they go through an interface rather than a direct call. */
export const EDIT_PROVIDERS: ImageEditProvider[] = [photoroomEdits];

export const ALL_TOOL_PROVIDERS: Base[] = (() => {
  const seen = new Map<string, Base>();
  for (const p of [
    ...BACKGROUND_PROVIDERS, ...UPSCALE_PROVIDERS, ...EXPAND_PROVIDERS, ...EDIT_PROVIDERS,
  ]) {
    if (!seen.has(p.slug)) seen.set(p.slug, p);
  }
  return [...seen.values()];
})();

/** Key straight from the server environment, if the operator set one there. */
export function envKey(provider: Base): string | null {
  const raw = process.env[provider.envVar];
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}
