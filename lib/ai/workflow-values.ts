/**
 * WORKFLOW VALUES — what a step hands to the steps after it, and how that
 * value is (a) stored on the step run, (b) rendered into a later instruction
 * and (c) iterated by a FOR EACH. Pure and client-safe, so the runtime and the
 * tests share exactly one definition.
 *
 * A value is always one of five typed shapes — never a string glued together
 * from pieces. A model's answer is parsed and validated into its shape BEFORE
 * any later step can see it; a value that does not validate is a failed step,
 * not a best-effort guess passed along.
 */

import type { Json } from "@/lib/database.types";

export type ImageRef = { bucket: "generation-assets" | "product-images"; path: string; mime: string };

export type StepValue =
  | { kind: "text"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "json"; value: Json }
  | { kind: "image"; image: ImageRef }
  /** A FOR EACH step's results, by item index. `null` = that item failed. */
  | { kind: "collection"; items: (StepValue | null)[] };

export const TEXT_OUTPUT_MAX = 8000;
export const LIST_ITEM_MAX = 2000;
export const JSON_OUTPUT_MAX = 8000;

const PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9_\-./]{1,200}$/;

function isImageRef(v: unknown): v is ImageRef {
  if (!v || typeof v !== "object") return false;
  const r = v as ImageRef;
  return (r.bucket === "generation-assets" || r.bucket === "product-images")
    && typeof r.path === "string" && PATH.test(r.path) && !r.path.includes("..")
    && typeof r.mime === "string" && /^image\/[a-z0-9.+-]{2,20}$/.test(r.mime);
}

/** Parse a stored step output back into a value — null when it is not one. */
export function parseStepValue(raw: unknown, depth = 0): StepValue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  switch (v.kind) {
    case "text":
      return typeof v.text === "string" ? { kind: "text", text: v.text.slice(0, TEXT_OUTPUT_MAX) } : null;
    case "list":
      return Array.isArray(v.items) && v.items.every((x) => typeof x === "string")
        ? { kind: "list", items: (v.items as string[]).map((x) => x.slice(0, LIST_ITEM_MAX)) } : null;
    case "json":
      return v.value === undefined ? null : { kind: "json", value: v.value as Json };
    case "image":
      return isImageRef(v.image) ? { kind: "image", image: v.image } : null;
    case "collection":
      if (depth > 0 || !Array.isArray(v.items)) return null;
      return { kind: "collection", items: v.items.map((x) => (x === null ? null : parseStepValue(x, depth + 1))) };
    default:
      return null;
  }
}

export function toJson(v: StepValue): Json {
  return v as unknown as Json;
}

/**
 * The value as text inside a later instruction. The compiler then sanitises
 * it and fences it as DATA — a model's output is never an instruction.
 */
export function renderValue(v: StepValue | null | undefined): string | null {
  if (!v) return null;
  switch (v.kind) {
    case "text": return v.text.trim() || null;
    case "list": return v.items.length ? v.items.map((x, i) => `${i + 1}. ${x}`).join("\n") : null;
    case "json": {
      const s = JSON.stringify(v.value, null, 2);
      return s && s !== "null" ? s.slice(0, JSON_OUTPUT_MAX) : null;
    }
    case "image": return "(obraz)";
    case "collection": {
      const ok = v.items.filter((x): x is StepValue => x !== null);
      if (ok.length === 0) return null;
      if (ok.every((x) => x.kind === "image")) return `(${ok.length} obrazów)`;
      return ok.map((x, i) => `${i + 1}. ${renderValue(x) ?? ""}`).join("\n");
    }
  }
}

/** The items a FOR EACH iterates, capped. Failed items of a collection are
 *  not iterated (there is nothing to work on). */
export function iterate(v: StepValue | null | undefined, maxItems: number): StepValue[] {
  if (!v) return [];
  const cap = Math.max(0, maxItems);
  if (v.kind === "list") return v.items.filter((x) => x.trim()).slice(0, cap).map((text) => ({ kind: "text", text }));
  if (v.kind === "collection") return v.items.filter((x): x is StepValue => x !== null).slice(0, cap);
  return [];
}

/** The images a value carries (an image, or a collection of them). */
export function imagesOf(v: StepValue | null | undefined): ImageRef[] {
  if (!v) return [];
  if (v.kind === "image") return [v.image];
  if (v.kind === "collection") return v.items.flatMap((x) => (x?.kind === "image" ? [x.image] : []));
  return [];
}

/**
 * A text model's answer, validated into the step's declared shape. Anything
 * else — an empty answer, a list with no usable items, JSON that does not
 * parse — is `null`: the step failed (and may be retried), nothing is passed on.
 */
export function shapeTextOutput(
  kind: "text" | "list" | "json", data: unknown, maxItems: number | null,
): StepValue | null {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (kind === "text") {
    const text = typeof obj.output === "string" ? obj.output.trim() : "";
    return text ? { kind: "text", text: text.slice(0, TEXT_OUTPUT_MAX) } : null;
  }
  if (kind === "list") {
    const raw = Array.isArray(obj.items) ? obj.items : [];
    const items = raw.filter((x): x is string => typeof x === "string")
      .map((x) => x.trim()).filter(Boolean)
      .slice(0, Math.max(1, maxItems ?? 1))
      .map((x) => x.slice(0, LIST_ITEM_MAX));
    return items.length ? { kind: "list", items } : null;
  }
  const source = typeof obj.json === "string" ? obj.json.trim() : "";
  if (!source || source.length > JSON_OUTPUT_MAX) return null;
  try {
    const value = JSON.parse(source) as Json;
    if (value === null || typeof value !== "object") return null;
    return { kind: "json", value };
  } catch {
    return null;
  }
}

/**
 * RETRY POLICY — the one rule every step type shares. Only failures another
 * attempt can plausibly fix are retried: a rate limit, an overloaded or 5xx
 * provider, a timeout, a network error, or an answer that did not validate.
 * NOT retried: an invalid prompt or image, missing/invalid credentials, an
 * empty provider balance, a model that does not exist, a missing input — a
 * second attempt would fail the same way and only cost money.
 */
const RETRIABLE = new Set([
  // text / vision layer
  "analysis_rate_limited", "analysis_overloaded", "analysis_unreachable", "analysis_timeout",
  "analysis_empty", "analysis_invalid", "output_invalid",
  // image models
  "provider_rate_limited", "provider_overloaded", "provider_unreachable", "provider_timeout",
  "provider_busy", "provider_empty_result",
]);
const FINAL = new Set([
  "analysis_unavailable", "analysis_quota", "analysis_model_missing", "analysis_bad_request",
  "provider_auth_failed", "provider_out_of_credit", "provider_quota", "provider_invalid_request", "content_policy", "invalid_input",
  "image_too_large", "unreadable_image", "no_provider", "model_unavailable", "references_unsupported",
  "variable_missing", "input_missing", "insufficient_credits", "credential_error",
]);

export function isRetriable(code: string, providerSaysRetriable?: boolean): boolean {
  if (FINAL.has(code)) return false;
  if (RETRIABLE.has(code)) return true;
  // Unclassified codes (a generic 5xx "…_error") follow the provider layer's
  // own verdict, and default to NOT retrying — never pay twice on a guess.
  return providerSaysRetriable === true;
}
