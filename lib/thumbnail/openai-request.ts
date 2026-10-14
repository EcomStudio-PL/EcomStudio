import { createHash } from "node:crypto";

/**
 * MINIATURKA → OpenAI Images API `POST /v1/images/edits` — THE REQUEST,
 * BUILT AND CHECKED AS BYTES. Pure functions only: no I/O, no key, no fetch.
 *
 * This is deliberately NOT the shared OpenAI adapter (lib/ai/providers/
 * openai.ts), which is untouched and keeps serving every other tool exactly
 * as before. That adapter builds a `FormData`, whose serialiser rewrites every
 * "\n" in a text field to "\r\n" — the prompt would not reach the model 1:1 —
 * and it retries a 400 without `input_fidelity`. Miniaturka needs one request
 * whose every byte is known before it is sent, so it serialises the multipart
 * body itself and reads it back:
 *
 *   model, prompt, n=1, size, quality, background=opaque, output_format=png,
 *   then one `image[]` part per photo — in the customer's order, duplicates
 *   kept (the field name and repeated-part order are the official SDK's own
 *   serialisation of an image array).
 *
 * Never sent: response_format (unsupported for GPT image models),
 * input_fidelity (not documented for Sunburst), moderation (not an edits
 * field), mask, stream, partial_images, user.
 */

export const THUMBNAIL_EDIT_PATH = "/v1/images/edits";
export const THUMBNAIL_DEFAULT_BASE = "https://api.openai.com";

/** The text fields, in the order they are written. */
export const EDIT_TEXT_FIELDS = ["model", "prompt", "n", "size", "quality", "background", "output_format"] as const;
/** Fields that must never appear in this request. */
export const FORBIDDEN_FIELDS = [
  "response_format", "input_fidelity", "moderation", "mask", "stream", "partial_images", "user", "output_compression",
] as const;

export const EDIT_IMAGE_FIELD = "image[]";
export const EDIT_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export type EditMime = (typeof EDIT_MIMES)[number];

export type EditImage = { bytes: Buffer; mime: EditMime; filename: string };

export type ThumbnailEditSpec = {
  model: string;
  /** Sent byte for byte (UTF-8). Never trimmed, never normalised. */
  prompt: string;
  size: string;
  quality: string;
  images: EditImage[];
};

export const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/** The fixed values of the request, as written into the body. */
export function editFieldValues(spec: ThumbnailEditSpec): Record<(typeof EDIT_TEXT_FIELDS)[number], string> {
  return {
    model: spec.model,
    prompt: spec.prompt,
    n: "1",
    size: spec.size,
    quality: spec.quality,
    background: "opaque",
    output_format: "png",
  };
}

const extOf = (mime: EditMime) => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");

/** A neutral, ordered file name for photo `i` — never the customer's own. */
export function editFilename(index: number, mime: EditMime): string {
  return `photo-${String(index + 1).padStart(2, "0")}.${extOf(mime)}`;
}

/** A multipart boundary from 16 random bytes (RFC 2046: ≤70 chars, safe set). */
export function makeBoundary(random: Buffer): string {
  return `----GrovBaseThumbnail${random.toString("hex")}`;
}

/** True when `boundary` occurs inside any part's content — the body would be
 *  ambiguous, so the caller draws another one. */
export function boundaryCollides(spec: ThumbnailEditSpec, boundary: string): boolean {
  const needle = Buffer.from(`--${boundary}`, "latin1");
  const values = Object.values(editFieldValues(spec)).map((v) => Buffer.from(v, "utf8"));
  return [...values, ...spec.images.map((i) => i.bytes)].some((b) => b.indexOf(needle) !== -1);
}

/**
 * The whole body, as the bytes that will be handed to fetch. Text parts carry
 * no Content-Type (the RFC 7578 default, text/plain); each image part names
 * its real MIME type and a neutral file name.
 */
export function buildThumbnailEdit(spec: ThumbnailEditSpec, boundary: string): { body: Buffer; contentType: string } {
  const chunks: Buffer[] = [];
  const crlf = Buffer.from("\r\n", "latin1");
  const values = editFieldValues(spec);
  for (const name of EDIT_TEXT_FIELDS) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`, "latin1"));
    chunks.push(Buffer.from(values[name], "utf8"));
    chunks.push(crlf);
  }
  for (const img of spec.images) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${EDIT_IMAGE_FIELD}"; filename="${img.filename}"\r\nContent-Type: ${img.mime}\r\n\r\n`,
      "latin1",
    ));
    chunks.push(img.bytes);
    chunks.push(crlf);
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "latin1"));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

export type MultipartPart = { name: string; filename: string | null; contentType: string | null; data: Buffer };

/**
 * READ-BACK: the body parsed again, independently of how it was built. Strict:
 * any byte that is not part of a well-formed part makes the whole body
 * unreadable (null), which the contract check treats as a violation.
 */
export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] | null {
  const open = Buffer.from(`--${boundary}\r\n`, "latin1");
  const sep = Buffer.from(`\r\n--${boundary}`, "latin1");
  const headEnd = Buffer.from("\r\n\r\n", "latin1");
  if (body.indexOf(open) !== 0) return null;
  const parts: MultipartPart[] = [];
  let pos = open.length;
  for (;;) {
    const hEnd = body.indexOf(headEnd, pos);
    if (hEnd < 0) return null;
    const headers = body.subarray(pos, hEnd).toString("latin1").split("\r\n");
    const next = body.indexOf(sep, hEnd + headEnd.length);
    if (next < 0) return null;
    const data = body.subarray(hEnd + headEnd.length, next);
    let name: string | null = null; let filename: string | null = null; let contentType: string | null = null;
    for (const h of headers) {
      const disp = /^Content-Disposition: form-data; name="([^"]*)"(?:; filename="([^"]*)")?$/.exec(h);
      if (disp) { name = disp[1]; filename = disp[2] ?? null; continue; }
      const ct = /^Content-Type: (.+)$/.exec(h);
      if (ct) { contentType = ct[1]; continue; }
      return null;
    }
    if (name === null) return null;
    parts.push({ name, filename, contentType, data: Buffer.from(data) });
    const after = next + sep.length;
    const tail = body.subarray(after, after + 2).toString("latin1");
    if (tail === "--") return body.subarray(after + 2).toString("latin1") === "\r\n" ? parts : null;
    if (tail !== "\r\n") return null;
    pos = after + 2;
  }
}

/**
 * THE CONTRACT, checked on the parsed-back body: exactly these fields in this
 * order, the prompt byte for byte, n=1, the configured size/quality, opaque
 * PNG, one image part per expected photo in order whose bytes hash to the
 * photo that was meant. Returns the first violation, or null.
 */
export function thumbnailEditViolation(
  parts: MultipartPart[] | null,
  spec: ThumbnailEditSpec,
  expectedImageSha256: readonly string[],
): string | null {
  if (!parts) return "body_unparseable";
  const values = editFieldValues(spec);
  const names = parts.map((p) => p.name);
  for (const f of FORBIDDEN_FIELDS) if (names.includes(f)) return `forbidden_field:${f}`;
  const text = parts.slice(0, EDIT_TEXT_FIELDS.length);
  if (text.length !== EDIT_TEXT_FIELDS.length) return "fields_missing";
  for (let i = 0; i < EDIT_TEXT_FIELDS.length; i++) {
    const p = text[i];
    const field = EDIT_TEXT_FIELDS[i];
    if (p.name !== field) return `field_order:${i}`;
    if (p.filename !== null || p.contentType !== null) return `field_not_text:${field}`;
    if (!p.data.equals(Buffer.from(values[field], "utf8"))) return field === "prompt" ? "prompt_bytes_differ" : `field_value:${field}`;
  }
  if (values.n !== "1") return "n_not_one";
  if (!/^(\d+)x(\d+)$/.test(values.size)) return "size_malformed";
  const [w, h] = values.size.split("x").map(Number);
  if (w !== h || w % 16 !== 0) return "size_not_square16";
  const images = parts.slice(EDIT_TEXT_FIELDS.length);
  if (images.length === 0) return "no_images";
  if (images.length > 16) return "too_many_images";
  if (images.length !== spec.images.length || images.length !== expectedImageSha256.length) return "image_count";
  for (let i = 0; i < images.length; i++) {
    const p = images[i];
    if (p.name !== EDIT_IMAGE_FIELD) return `image_field:${i}`;
    if (!p.contentType || !(EDIT_MIMES as readonly string[]).includes(p.contentType)) return `image_mime:${i}`;
    if (p.filename !== editFilename(i, p.contentType as EditMime)) return `image_name:${i}`;
    if (sha256(p.data) !== expectedImageSha256[i]) return `image_sha:${i}`;
  }
  return null;
}

/* ── the answer ───────────────────────────────────────────────────────────*/

export type SunburstUsage = {
  inputTokens: number | null;
  inputTextTokens: number | null;
  inputImageTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  outputImageTokens: number | null;
  outputTextTokens: number | null;
  totalTokens: number | null;
};

export type SunburstAnswer = {
  b64: string;
  /** Images the response carried (n=1 asks for exactly one; only the first
   *  is ever kept, the count is recorded). */
  dataCount: number;
  created: number | null;
  size: string | null;
  quality: string | null;
  background: string | null;
  outputFormat: string | null;
  usage: SunburstUsage | null;
};

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length <= 64 ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** The usage block as the response reported it — absent stays absent, a
 *  figure is never invented. */
export function parseUsage(raw: unknown): SunburstUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = obj(raw);
  const inD = obj(u.input_tokens_details);
  const outD = obj(u.output_tokens_details);
  const usage: SunburstUsage = {
    inputTokens: count(u.input_tokens),
    inputTextTokens: count(inD.text_tokens),
    inputImageTokens: count(inD.image_tokens),
    cachedInputTokens: count(inD.cached_tokens),
    outputTokens: count(u.output_tokens),
    outputImageTokens: count(outD.image_tokens),
    outputTextTokens: count(outD.text_tokens),
    totalTokens: count(u.total_tokens),
  };
  return Object.values(usage).every((v) => v === null) ? null : usage;
}

/** The kept image: `data[0].b64_json`. No image → null (the caller refunds). */
export function pickThumbnailImage(json: unknown): SunburstAnswer | null {
  const j = obj(json);
  const data = Array.isArray(j.data) ? j.data : [];
  const first = obj(data[0]);
  const b64 = typeof first.b64_json === "string" && first.b64_json.length > 0 ? first.b64_json : null;
  if (!b64) return null;
  return {
    b64,
    dataCount: data.length,
    created: count(j.created),
    size: str(j.size),
    quality: str(j.quality),
    background: str(j.background),
    outputFormat: str(j.output_format),
    usage: parseUsage(j.usage),
  };
}

/** PNG/JPEG/WebP by magic bytes — the stored file is named by what it is. */
export function sniffImageMime(b: Buffer): EditMime | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/* ── errors ───────────────────────────────────────────────────────────────*/

export type EditFailure = {
  /** Safe code shown to the customer through the dictionaries. */
  code: string;
  retriable: boolean;
  providerCode: string;
  upstream: { status: number; type: string; code: string; message: string; requestId: string | null };
};

const mask = (s: string) => s
  .replace(/sk-[A-Za-z0-9_\-]{6,}/g, "sk-***")
  .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer ***")
  .slice(0, 300);

/**
 * The HTTP failure, classified the way the shared adapter classifies OpenAI
 * errors (same codes, so the panels already speak them) — copied here, not
 * imported, so that adapter stays byte-identical.
 */
export function classifyEditError(status: number, bodyText: string, requestId: string | null): EditFailure {
  let type = "", code = "", message = "";
  try {
    const parsed = JSON.parse(bodyText) as { error?: { type?: string; code?: string; message?: string } };
    type = parsed.error?.type ?? "";
    code = parsed.error?.code ?? "";
    message = parsed.error?.message ?? "";
  } catch { /* non-JSON body */ }
  const upstream = { status, type: type.slice(0, 80), code: code.slice(0, 80), message: mask(message), requestId };
  const out = (c: string, retriable: boolean, providerCode: string): EditFailure => ({ code: c, retriable, providerCode, upstream });
  if (status === 401) return out("provider_auth_failed", false, code || "invalid_key");
  if (status === 403) return out("provider_auth_failed", false, code || "access_denied");
  if (status === 429) {
    const quota = code === "insufficient_quota" || type === "insufficient_quota" || /quota|billing/i.test(message);
    return quota ? out("provider_quota", false, code || "insufficient_quota") : out("provider_rate_limited", true, code || "rate_limit_exceeded");
  }
  if (status === 404 || code === "model_not_found" || /model .* (does not exist|not found)/i.test(message)) {
    return out("model_unavailable", false, code || "model_not_found");
  }
  if (status === 400 && (code === "content_policy_violation" || code === "moderation_blocked" || /content policy|safety system/i.test(message))) {
    return out("content_policy", false, code || "content_policy_violation");
  }
  if (status === 400 || status === 422) return out("provider_invalid_request", false, code || "invalid_request");
  return out("provider_error", status >= 500 || status === 408, code || `http_${status}`);
}
