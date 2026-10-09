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
  /** Which API answered ("v1/segment", "v2/edit") — logged with the call. */
  endpoint?: string;
  /** Documented response headers worth keeping with the result: the seed a
   *  generated background used, the cutout's uncertainty score. */
  meta?: Record<string, string>;
};
export type Creds = { apiKey: string; baseUrl?: string | null };

export class ToolProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable = false,
    /** The provider DID process (and bill) the request — the failure is ours
     *  to absorb, so its cost is recorded rather than assumed to be zero. */
    public readonly billed = false,
  ) {
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

/** A cutout can come back flattened onto a colour in the same request, when
 *  the vendor supports it — one call instead of a cutout plus a second step. */
export type CutoutOptions = { bgColor?: string; format?: "png" | "jpg" | "webp" };

export interface BackgroundRemovalProvider extends Base {
  estimateUsd(): number;
  /** Honours `CutoutOptions.bgColor` itself. A provider without it returns a
   *  transparent cutout and the runner flattens the colour locally. */
  supportsBgColor?: boolean;
  removeBackground(input: ToolBytes, creds: Creds, opts?: CutoutOptions): Promise<ToolResponse>;
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
  /** ai_background: the scene to generate — a preset's prompt resolved on the
   *  server, or the seller's own words. Required: a flat colour is "Zmień
   *  kolor tła", not a generative call. */
  prompt?: string;
  /** ai_background: let the provider expand a short prompt into a full scene
   *  description (`background.expandPrompt.mode`). */
  expandPrompt?: boolean;
  /** ai_background: reproduce an earlier scene (`background.seed`). */
  seed?: number;
  /** ai_background: an inspiration photo and how closely it steers the scene. */
  guidance?: { image: ToolBytes; scale: number };
  /** ai_shadow: the backdrop under the cut-out product — a colour, or none. */
  color?: string;
  transparent?: boolean;
  /** relight: which of the model's lighting intents to apply. */
  lighting?: "auto" | "preserve" | "portrait";
  /** ai_shadow: Miękki / Mocny / Unoszący się. */
  shadow?: "soft" | "hard" | "floating";
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

function form(
  input: ToolBytes, field: string, extra: Record<string, string> = {}, files: Record<string, ToolBytes> = {},
): FormData {
  const fd = new FormData();
  fd.append(field, new Blob([new Uint8Array(input.bytes)], { type: input.mime }), "image");
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([new Uint8Array(f.bytes)], { type: f.mime }), "guidance");
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

export const PHOTOROOM_SEGMENT_URL = "https://sdk.photoroom.com/v1/segment";
export const PHOTOROOM_EDIT_URL = "https://image-api.photoroom.com/v2/edit";
/** Free, read-only: the plan a key belongs to and the images it has left. */
export const PHOTOROOM_ACCOUNT_URL = "https://image-api.photoroom.com/v2/account";
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
 * WHICH URL ONE PHOTOROOM ENDPOINT IS CALLED AT.
 *
 * Photoroom's two APIs live on two hosts (sdk.photoroom.com for the cutout,
 * image-api.photoroom.com for the editor), so one stored "base URL" cannot be
 * the full address of both. It used to be: a URL saved in the admin panel was
 * sent every request, whichever endpoint it named — an edit could land on the
 * cutout endpoint and be billed as one. Now a stored value counts only as an
 * ORIGIN (a proxy in front of Photoroom) or as the full address of the SAME
 * endpoint; anything else falls back to Photoroom's own URL. With nothing
 * stored — the normal case — nothing changes.
 */
export function photoroomUrl(baseUrl: string | null | undefined, path: "/v1/segment" | "/v2/edit", fallback: string): string {
  const raw = baseUrl?.trim();
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return fallback;
    const own = u.pathname.replace(/\/+$/, "");
    if (own === "") return `${u.origin}${path}`;
    return own === path ? `${u.origin}${path}` : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The body of a Photoroom 200. Its headers already arrived, so the image was
 * made and billed: a body that then fails to arrive (a timeout, a dropped
 * connection) or arrives empty is a BILLED failure — recorded at the list
 * price, never as a confident $0. Other vendors keep the shared `binary`.
 */
async function photoroomBinary(res: Response): Promise<ToolBytes> {
  let buf: Buffer;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    const name = (e as { name?: string })?.name;
    throw new ToolProviderError(name === "TimeoutError" || name === "AbortError" ? "provider_timeout" : "provider_unreachable", true, true);
  }
  if (buf.length === 0) throw new ToolProviderError("provider_empty_result", false, true);
  return { bytes: buf, mime: res.headers.get("content-type")?.split(";")[0] || "image/png" };
}

const isImageResponse = (res: Response) =>
  (res.headers.get("content-type") ?? "").toLowerCase().startsWith("image/");

/** Response headers Photoroom documents and the four photo tools keep. */
function photoroomMeta(res: Response): Record<string, string> {
  const meta: Record<string, string> = {};
  const seed = res.headers.get("pr-ai-background-seed");
  const uncertainty = res.headers.get("x-uncertainty-score");
  if (seed) meta.seed = seed.slice(0, 32);
  if (uncertainty) meta.uncertainty = uncertainty.slice(0, 16);
  return meta;
}

/**
 * One /v2/edit call.
 *
 * `params` are sent verbatim as multipart fields, so a caller states exactly
 * the documented parameter names and nothing translates them behind its back.
 * Undefined and empty values are dropped rather than sent as "", which the API
 * would read as a real (and wrong) value. `files` carries extra binary fields
 * (the AI background's inspiration photo).
 *
 * `strict` — used by the four photo tools — turns Photoroom's
 * `pr-unsupported-attributes` warning into a failure. Photoroom answers 200
 * and IGNORES a field it does not support, so without this a shadow style the
 * model does not know would come back as a plain cutout and be sold as a
 * shadow. The call was processed, so the error is marked as billed.
 */
export async function photoroomEdit(
  input: ToolBytes,
  params: Record<string, string | number | undefined | null>,
  creds: Creds,
  opts: { files?: Record<string, ToolBytes>; strict?: boolean } = {},
): Promise<ToolResponse> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    fields[key] = String(value);
  }
  const res = await send(photoroomUrl(creds.baseUrl, "/v2/edit", PHOTOROOM_EDIT_URL), {
    method: "POST",
    // No Content-Type header: fetch sets the multipart boundary itself.
    headers: { "x-api-key": creds.apiKey, Accept: "image/png, image/jpeg, image/webp, application/json" },
    body: form(input, "imageFile", fields, opts.files),
  });
  if (opts.strict && res.headers.get("pr-unsupported-attributes")) {
    throw new ToolProviderError("provider_unsupported_params", false, true);
  }
  // A 200 carrying JSON is not an image, whatever the bytes are called.
  if (opts.strict && !isImageResponse(res)) throw new ToolProviderError("provider_empty_result", false, true);
  return {
    ...(await photoroomBinary(res)),
    // A sandbox call costs nothing, and charging a seller credits for a
    // watermarked image would be taking money for a result they cannot use.
    costUsd: isSandboxKey(creds.apiKey) ? 0 : PHOTOROOM_EDIT_USD,
    requestId: res.headers.get("x-request-id"),
    endpoint: "v2/edit",
    meta: photoroomMeta(res),
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
  supportsBgColor: true,
  estimateUsd: () => PHOTOROOM_SEGMENT_USD,
  async removeBackground(input, creds, opts = {}) {
    // DELIBERATELY v1, not /v2/edit. Photoroom bills per image by which API
    // answered — the Remove Background rate even for a Plus subscriber — so
    // cutting out a subject here costs $0.02 instead of the $0.10 the editing
    // endpoint would charge for exactly the same cutout.
    //
    // `bg_color` is the same endpoint's own flatten (remove.bg-compatible,
    // documented as "#FF00FF" or an HTML colour name): "Zmień kolor tła" is ONE
    // request at the Basic rate, not a cutout plus a generative call.
    const fields: Record<string, string> = { format: opts.format ?? "png" };
    if (opts.bgColor) fields.bg_color = opts.bgColor;
    const res = await send(photoroomUrl(creds.baseUrl, "/v1/segment", PHOTOROOM_SEGMENT_URL), {
      method: "POST",
      // Images only: the endpoint can also answer JSON ({base64img}), and a
      // JSON body saved as a "PNG" would be a broken file sold as a result.
      headers: { "x-api-key": creds.apiKey, Accept: "image/png, image/jpeg, image/webp" },
      body: form(input, "image_file", fields),
    });
    if (!isImageResponse(res)) throw new ToolProviderError("provider_empty_result", false, true);
    return {
      ...(await photoroomBinary(res)),
      costUsd: isSandboxKey(creds.apiKey) ? 0 : PHOTOROOM_SEGMENT_USD,
      requestId: res.headers.get("x-request-id"),
      endpoint: "v1/segment",
      meta: photoroomMeta(res),
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
/** Miękki / Mocny / Unoszący się → Photoroom's documented shadow modes. The
 *  newer `ai.preset-*` / `ai.auto-with-overrides` values only work with an
 *  opt-in model header GrovBase does not send, so they are not used. */
const SHADOW_MODE: Record<string, string> = { soft: "ai.soft", hard: "ai.hard", floating: "ai.floating" };

/**
 * CUT OUT, KEPT WHERE IT WAS.
 *
 * The AI background and the AI shadow both act on the cut-out product, so the
 * background removal /v2/edit does by default is what they want — and it is
 * stated explicitly here rather than left to a default. `referenceBox=
 * originalImage` keeps the product at its original position and scale in the
 * original frame ("maintain subject positioning", in Photoroom's words);
 * without it the cutout would be re-fitted to the canvas and the seller's
 * composition would change along with the background.
 */
const CUTOUT_IN_PLACE = { removeBackground: "true", referenceBox: "originalImage" } as const;

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
      // ONE generative call per result. The scene is a prompt — a flat
      // colour is "Zmień kolor tła" at a fifth of the price, so it is never
      // bought here. An inspiration photo rides along as guidance (allowed
      // only with the cutout on, which this always is), with its strength.
      const prompt = opts.prompt?.trim();
      if (!prompt) throw new ToolProviderError("prompt_required");
      return photoroomEdit(input, {
        ...common,
        ...CUTOUT_IN_PLACE,
        "background.prompt": prompt,
        "background.expandPrompt.mode": opts.expandPrompt ? "ai.auto" : "ai.never",
        "background.seed": opts.seed,
        "background.guidance.scale": opts.guidance ? opts.guidance.scale : undefined,
      }, creds, {
        strict: true,
        files: opts.guidance ? { "background.guidance.imageFile": opts.guidance.image } : {},
      });
    }
    if (op === "relight") {
      return photoroomEdit(input, {
        ...framed, "lighting.mode": LIGHTING_MODE[opts.lighting ?? "auto"] ?? LIGHTING_MODE.auto,
      }, creds);
    }
    if (op === "ai_shadow") {
      // The shadow is cast under the CUT-OUT product onto the backdrop the
      // seller chose: a colour, or transparency (PNG/WebP only — a JPEG has no
      // alpha, so a transparent request is always encoded as PNG). No scene,
      // no relighting: only the shadow mode and the backdrop are sent.
      const transparent = Boolean(opts.transparent);
      return photoroomEdit(input, {
        ...common,
        ...CUTOUT_IN_PLACE,
        "export.format": transparent && format === "jpeg" ? "png" : format,
        "shadow.mode": SHADOW_MODE[opts.shadow ?? "soft"] ?? SHADOW_MODE.soft,
        "background.color": transparent ? undefined : (opts.color ?? "#FFFFFF").replace("#", "").toUpperCase(),
      }, creds, { strict: true });
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
