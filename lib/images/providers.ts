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
  estimateUsd: () => 0.02,
  async removeBackground(input, creds) {
    const res = await send(creds.baseUrl || "https://sdk.photoroom.com/v1/segment", {
      method: "POST",
      headers: { "x-api-key": creds.apiKey, Accept: "image/png, application/json" },
      body: form(input, "image_file", { format: "png" }),
    });
    return { ...(await binary(res)), costUsd: 0.02, requestId: res.headers.get("x-request-id") };
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

/* ── registry ──────────────────────────────────────────────────────────── */

/** Cheapest first — the resolver takes the first one that has a key. */
export const BACKGROUND_PROVIDERS: BackgroundRemovalProvider[] = [
  falBackground, photoroomBackground, stabilityBackground, clipdropBackground, removeBgBackground,
];
export const UPSCALE_PROVIDERS: UpscaleProvider[] = [falUpscale, stabilityUpscale, clipdropUpscale];
export const EXPAND_PROVIDERS: ImageExpandProvider[] = [stabilityExpand, falExpand];

export const ALL_TOOL_PROVIDERS: Base[] = (() => {
  const seen = new Map<string, Base>();
  for (const p of [...BACKGROUND_PROVIDERS, ...UPSCALE_PROVIDERS, ...EXPAND_PROVIDERS]) {
    if (!seen.has(p.slug)) seen.set(p.slug, p);
  }
  return [...seen.values()];
})();

/** Key straight from the server environment, if the operator set one there. */
export function envKey(provider: Base): string | null {
  const raw = process.env[provider.envVar];
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}
