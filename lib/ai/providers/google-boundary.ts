import { createHash } from "node:crypto";

/**
 * NETWORK-BOUNDARY CAPTURE (Retusz) — what the HTTP request to Google really
 * carries, read back from the exact string handed to `fetch`.
 *
 * It does not ask the request builder what it meant to send: it parses the
 * serialised body itself, so a field added anywhere between the builder and
 * the socket shows up here. Admin-only record (ai_engine_runs): no API key
 * (the URL is recorded without its query), no prompt text (length + SHA-256),
 * no image bytes (SHA-256 + size).
 */

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const ALLOWED_TOP = ["contents", "generationConfig"];
const ALLOWED_CONFIG = ["imageConfig", "responseModalities"];
const ALLOWED_IMAGE_CONFIG = ["aspectRatio", "imageSize"];

export type GeminiBoundary = {
  provider: "google";
  model: string;
  api_version: string | null;
  endpoint: string;
  method: "POST";
  request_body_sha256: string;
  request_body_bytes: number;
  top_level_fields: string[];
  contents_length: number;
  roles: string[];
  history_count: number;
  parts_length: number;
  parts_order: string[];
  text_parts_count: number;
  image_parts_count: number;
  system_instruction_present: boolean;
  tools_present: boolean;
  tool_config_present: boolean;
  safety_settings_present: boolean;
  cached_content_present: boolean;
  provider_prompt_length: number | null;
  provider_prompt_utf8_bytes: number | null;
  provider_prompt_sha256: string | null;
  provider_inputs: { mime_type: string; bytes: number; sha256: string }[];
  generation_config: unknown;
  extra_fields: string[];
  extra_text_parts: number;
  strict_stateless: boolean;
};

/** `url` may carry `?key=…`; only origin + path are kept. */
export function captureGeminiBoundary(url: string, payload: string, model: string): GeminiBoundary {
  const u = new URL(url);
  const body = JSON.parse(payload) as Record<string, unknown>;
  const contents = Array.isArray(body.contents) ? (body.contents as Record<string, unknown>[]) : [];
  const last = contents[contents.length - 1] ?? {};
  const parts = Array.isArray(last.parts) ? (last.parts as Record<string, unknown>[]) : [];
  const extra: string[] = [];
  for (const k of Object.keys(body)) if (!ALLOWED_TOP.includes(k)) extra.push(k);
  contents.forEach((c, i) => {
    for (const k of Object.keys(c)) if (k !== "role" && k !== "parts") extra.push(`contents[${i}].${k}`);
  });
  const order = parts.map((p, i) => {
    const keys = Object.keys(p);
    if (keys.length !== 1) extra.push(`parts[${i}]{${keys.join(",")}}`);
    return keys.includes("text") ? "text" : keys.includes("inlineData") ? "inlineData" : keys.join("+") || "empty";
  });
  const config = (body.generationConfig ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(config)) if (!ALLOWED_CONFIG.includes(k)) extra.push(`generationConfig.${k}`);
  const imageConfig = (config.imageConfig ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(imageConfig)) if (!ALLOWED_IMAGE_CONFIG.includes(k)) extra.push(`generationConfig.imageConfig.${k}`);

  const texts = parts.filter((p) => typeof p.text === "string").map((p) => p.text as string);
  const images = parts
    .map((p) => p.inlineData as { mimeType?: string; data?: string } | undefined)
    .filter((d): d is { mimeType?: string; data?: string } => !!d)
    .map((d) => {
      const bytes = Buffer.from(d.data ?? "", "base64");
      return { mime_type: d.mimeType ?? "", bytes: bytes.length, sha256: sha(bytes) };
    });
  for (const [k, v] of Object.entries(imageConfig)) if (typeof v !== "string") extra.push(`generationConfig.imageConfig.${k}:${typeof v}`);
  const prompt = texts.length === 1 ? texts[0]! : null;
  const version = /^\/(v\d+[a-z0-9]*)\//.exec(u.pathname)?.[1] ?? null;
  const has = (k: string) => k in body;
  const strict = contents.length === 1 && last.role === "user"
    && order.join(",") === "text,inlineData" && extra.length === 0
    && JSON.stringify(config.responseModalities) === '["IMAGE"]';
  return {
    provider: "google",
    model,
    api_version: version,
    endpoint: `${u.origin}${u.pathname}`,
    method: "POST",
    request_body_sha256: sha(payload),
    request_body_bytes: Buffer.byteLength(payload),
    top_level_fields: Object.keys(body),
    contents_length: contents.length,
    roles: contents.map((c) => String(c.role ?? "")),
    history_count: Math.max(0, contents.length - 1),
    parts_length: parts.length,
    parts_order: order,
    text_parts_count: texts.length,
    image_parts_count: images.length,
    system_instruction_present: has("systemInstruction") || has("system_instruction"),
    tools_present: has("tools"),
    tool_config_present: has("toolConfig") || has("tool_config"),
    safety_settings_present: has("safetySettings") || has("safety_settings"),
    cached_content_present: has("cachedContent") || has("cached_content"),
    provider_prompt_length: prompt === null ? null : Array.from(prompt).length,
    provider_prompt_utf8_bytes: prompt === null ? null : Buffer.byteLength(prompt),
    provider_prompt_sha256: prompt === null ? null : sha(prompt),
    provider_inputs: images,
    generation_config: config,
    extra_fields: extra,
    extra_text_parts: Math.max(0, texts.length - 1),
    strict_stateless: strict,
  };
}
