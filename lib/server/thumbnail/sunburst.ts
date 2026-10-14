import "server-only";
import { randomBytes } from "node:crypto";
import {
  EDIT_TEXT_FIELDS, THUMBNAIL_DEFAULT_BASE, THUMBNAIL_EDIT_PATH,
  boundaryCollides, buildThumbnailEdit, classifyEditError, makeBoundary, parseMultipart, parseUsage, pickThumbnailImage,
  sha256, sniffImageMime, thumbnailEditViolation,
  type EditMime, type SunburstAnswer, type ThumbnailEditSpec,
} from "@/lib/thumbnail/openai-request";

/**
 * MINIATURKA'S ONE PROVIDER CALL — GPT Image 2.5 Sunburst, `images.edits`.
 *
 * Exactly one HTTP request per call of this function: no retry, no second
 * request without a parameter, no other model. The body is serialised here
 * (lib/thumbnail/openai-request.ts), then the EXACT Buffer that will be handed to
 * fetch is parsed back and checked against the contract — the prompt byte for
 * byte, every photo by SHA-256, in order. A mismatch is refused with no HTTP
 * call at all (`thumbnail_request_contract_failed`).
 *
 * What it returns for the record (admin-only, never to the customer): the
 * endpoint, header NAMES (never the key), field names in order, body and
 * prompt SHA-256 and sizes, per-photo SHA-256/size/MIME, and the response's
 * own size/quality/background/format/usage.
 */

export type SunburstBoundary = {
  endpoint: string;
  method: "POST";
  header_names: string[];
  content_type: string;
  fields: string[];
  body_bytes: number;
  body_sha256: string;
  model: string;
  size: string;
  quality: string;
  background: "opaque";
  output_format: "png";
  n: 1;
  prompt_sha256: string;
  prompt_bytes: number;
  prompt_chars: number;
  images: { index: number; filename: string; mime: EditMime; bytes: number; sha256: string }[];
  contract: "ok" | string;
};

export type SunburstOutcome =
  | {
    ok: true;
    image: Buffer;
    mime: EditMime;
    answer: Omit<SunburstAnswer, "b64">;
    requestId: string | null;
    httpStatus: number;
    durationMs: number;
    boundary: SunburstBoundary;
  }
  | {
    ok: false;
    /** Safe code (the panels' vocabulary). */
    error: string;
    retriable: boolean;
    providerCode: string | null;
    httpStatus: number | null;
    requestId: string | null;
    /** True when nothing was sent (contract refusal) — no provider cost. */
    notSent: boolean;
    /** Usage the failing response still carried, when it did. */
    usage: SunburstAnswer["usage"];
    durationMs: number;
    boundary: SunburstBoundary | null;
    upstream?: { status: number; type: string; code: string; message: string; requestId: string | null };
  };

export type SunburstCallInput = {
  apiKey: string;
  baseUrl?: string | null;
  spec: ThumbnailEditSpec;
  /** SHA-256 of each photo as it was meant to be sent, in order. */
  expectedImageSha256: string[];
  timeoutMs: number;
  /** Tests inject a recorder; production uses the global fetch. */
  fetchImpl?: typeof fetch;
};

export async function callSunburst(input: SunburstCallInput): Promise<SunburstOutcome> {
  const started = Date.now();
  const endpoint = `${(input.baseUrl?.replace(/\/$/, "") || THUMBNAIL_DEFAULT_BASE)}${THUMBNAIL_EDIT_PATH}`;
  let boundary = makeBoundary(randomBytes(16));
  for (let i = 0; i < 4 && boundaryCollides(input.spec, boundary); i++) boundary = makeBoundary(randomBytes(16));
  const { body, contentType } = buildThumbnailEdit(input.spec, boundary);

  // READ BACK the bytes about to leave, then check them.
  const parsed = parseMultipart(body, boundary);
  const violation = boundaryCollides(input.spec, boundary)
    ? "boundary_collision"
    : thumbnailEditViolation(parsed, input.spec, input.expectedImageSha256);
  const promptBytes = Buffer.from(input.spec.prompt, "utf8");
  const record: SunburstBoundary = {
    endpoint,
    method: "POST",
    header_names: ["Authorization", "Content-Type"],
    content_type: "multipart/form-data",
    fields: (parsed ?? []).map((p) => p.name),
    body_bytes: body.length,
    body_sha256: sha256(body),
    model: input.spec.model,
    size: input.spec.size,
    quality: input.spec.quality,
    background: "opaque",
    output_format: "png",
    n: 1,
    prompt_sha256: sha256(promptBytes),
    prompt_bytes: promptBytes.length,
    prompt_chars: [...input.spec.prompt].length,
    images: input.spec.images.map((img, index) => ({
      index, filename: img.filename, mime: img.mime, bytes: img.bytes.length, sha256: sha256(img.bytes),
    })),
    contract: violation ?? "ok",
  };
  if (violation || !parsed || parsed.length !== EDIT_TEXT_FIELDS.length + input.spec.images.length) {
    return {
      ok: false, error: "thumbnail_request_contract_failed", retriable: false, providerCode: violation ?? "contract",
      httpStatus: null, requestId: null, notSent: true, usage: null, durationMs: Date.now() - started, boundary: record,
    };
  }

  const doFetch = input.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": contentType },
      // The very Buffer that was hashed and parsed back above.
      // (Buffer.concat allocates a plain ArrayBuffer — never a shared one.)
      body: new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength),
      signal: AbortSignal.timeout(Math.max(1, input.timeoutMs)),
    });
  } catch (e) {
    const timeout = (e as { name?: string } | null)?.name === "TimeoutError";
    return {
      ok: false, error: timeout ? "provider_timeout" : "provider_unreachable", retriable: true, providerCode: null,
      httpStatus: null, requestId: null, notSent: false, usage: null, durationMs: Date.now() - started, boundary: record,
    };
  }
  const requestId = res.headers.get("x-request-id");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const f = classifyEditError(res.status, text, requestId);
    return {
      ok: false, error: f.code, retriable: f.retriable, providerCode: f.providerCode, httpStatus: res.status, requestId,
      notSent: false, usage: null, durationMs: Date.now() - started, boundary: record, upstream: f.upstream,
    };
  }
  let json: unknown;
  try { json = await res.json(); } catch {
    return {
      ok: false, error: "provider_bad_response", retriable: false, providerCode: "invalid_json", httpStatus: res.status, requestId,
      notSent: false, usage: null, durationMs: Date.now() - started, boundary: record,
    };
  }
  const answer = pickThumbnailImage(json);
  if (!answer) {
    const usage = pickUsageOnly(json);
    return {
      ok: false, error: "provider_empty_result", retriable: false, providerCode: "no_image", httpStatus: res.status, requestId,
      notSent: false, usage, durationMs: Date.now() - started, boundary: record,
    };
  }
  const image = Buffer.from(answer.b64, "base64");
  const mime = sniffImageMime(image);
  if (!mime) {
    return {
      ok: false, error: "provider_bad_response", retriable: false, providerCode: "not_an_image", httpStatus: res.status, requestId,
      notSent: false, usage: answer.usage, durationMs: Date.now() - started, boundary: record,
    };
  }
  const meta: Omit<SunburstAnswer, "b64"> = {
    dataCount: answer.dataCount, created: answer.created, size: answer.size, quality: answer.quality,
    background: answer.background, outputFormat: answer.outputFormat, usage: answer.usage,
  };
  return { ok: true, image, mime, answer: meta, requestId, httpStatus: res.status, durationMs: Date.now() - started, boundary: record };
}

/** The usage a response carried even when it carried no image. */
function pickUsageOnly(json: unknown): SunburstAnswer["usage"] {
  return parseUsage(json && typeof json === "object" ? (json as { usage?: unknown }).usage : null);
}
