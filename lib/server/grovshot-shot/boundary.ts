import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

/**
 * GROVBASE SHOT — THE NETWORK BOUNDARY, OBSERVED.
 *
 * What the process view calls "really sent" is captured HERE: at the global
 * `fetch` the Anthropic SDK and the shared Google adapter hand their final,
 * serialised request to — after every SDK transformation, nothing earlier.
 *
 * Scope: only a call made inside `observeProviderCalls(sink, fn)` (the
 * lifestyle engine's Claude steps and Nano Banana Pro rounds) is recorded.
 * Every other request in the process — Retusz, Miniaturka, any other tool —
 * finds no sink and goes straight to the original fetch. Nothing is ever
 * changed: the wrapper passes the very same arguments and returns the very
 * same Response; it only reads a COPY of the request body (a string, as both
 * SDKs send it) and a clone of the response.
 *
 * What is kept (admin-only step rows):
 *   - method, URL without the query string's key, header NAMES (values only
 *     for an allowlist with no secret in it: versions, content type);
 *   - the request body as sent, every image's base64 replaced by
 *     {"$image": n} — its MIME, byte count, SHA-256 and pixel size listed
 *     separately (the bytes themselves stay out of the database);
 *   - the response: status, request id, the JSON with any image data
 *     replaced the same way (Claude's text answer kept as text).
 * Never: an API key, an authorization header, a cookie.
 *
 * A body that is not a string (a stream or a Request object) is recorded as
 * NOT observable — never reconstructed and labelled as sent.
 */

export const BOUNDARY_VERSION = 1;
const MAX_BODY_CHARS = 600_000;
const MAX_TEXT_CHARS = 200_000;
const SAFE_HEADERS = new Set(["anthropic-version", "anthropic-beta", "content-type", "api-revision", "accept"]);
const SAFE_RESPONSE_HEADERS = ["request-id", "x-request-id", "anthropic-organization-id"];

export type SentImage = {
  n: number; mime: string | null; bytes: number; sha256: string; width: number | null; height: number | null;
  /** How the image travels in the request. */
  encoding: "inline_base64";
};
export type BoundaryResponse =
  | { status: number; request_id: string | null; body: unknown; text: string | null; images: SentImage[]; truncated: boolean }
  | { error: string };
export type BoundaryRequest = {
  provider: "anthropic" | "google" | "other";
  at: number;
  ms: number | null;
  method: string;
  url: string;
  header_names: string[];
  headers: Record<string, string>;
  /** sha256 / length of the exact body string handed to fetch. */
  body_sha256: string | null;
  body_chars: number | null;
  observable: boolean;
  body: unknown;
  images: SentImage[];
  truncated: boolean;
  response: BoundaryResponse | null;
};
export type BoundarySink = { requests: BoundaryRequest[]; pending: Promise<unknown>[] };

export const newSink = (): BoundarySink => ({ requests: [], pending: [] });

const store = new AsyncLocalStorage<BoundarySink>();
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

function providerOf(url: string): BoundaryRequest["provider"] {
  if (/anthropic\.com/i.test(url)) return "anthropic";
  if (/googleapis\.com|generativelanguage/i.test(url)) return "google";
  return "other";
}

/** The URL with every query value that could be a credential removed. */
export function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) if (/key|token|auth|sig/i.test(k)) u.searchParams.set(k, "[redacted]");
    u.username = ""; u.password = "";
    return u.toString();
  } catch {
    return raw.replace(/([?&](?:key|token|auth)[^=]*=)[^&]*/gi, "$1[redacted]");
  }
}

function headerList(h: HeadersInit | undefined): { names: string[]; safe: Record<string, string> } {
  const names: string[] = [];
  const safe: Record<string, string> = {};
  const add = (k: string, v: string) => {
    const name = k.toLowerCase();
    names.push(name);
    if (SAFE_HEADERS.has(name)) safe[name] = v.slice(0, 200);
  };
  if (!h) return { names, safe };
  if (h instanceof Headers) h.forEach((v, k) => add(k, v));
  else if (Array.isArray(h)) for (const [k, v] of h) add(String(k), String(v));
  else for (const [k, v] of Object.entries(h)) add(k, String(v));
  return { names: names.sort(), safe };
}

/**
 * Walks a parsed JSON body: every object carrying base64 image data
 * (Anthropic `{type:"base64", media_type, data}`, Google `{mimeType, data}`)
 * gets `data` replaced by {"$image": n}; the decoded bytes are measured.
 */
function stripImages(node: unknown, images: { n: number; mime: string | null; buf: Buffer }[]): unknown {
  if (Array.isArray(node)) return node.map((x) => stripImages(x, images));
  if (!node || typeof node !== "object") return node;
  const o = node as Record<string, unknown>;
  const mime = typeof o.media_type === "string" ? o.media_type : typeof o.mimeType === "string" ? o.mimeType
    : typeof o.mime_type === "string" ? o.mime_type : null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const isImage = typeof v === "string" && k === "data"
      && (mime !== null ? /^image\//.test(mime) : v.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(v.slice(0, 400)));
    if (isImage) {
      const n = images.length + 1;
      images.push({ n, mime, buf: Buffer.from(v, "base64") });
      out[k] = { $image: n };
    } else out[k] = stripImages(v, images);
  }
  return out;
}

async function measure(images: { n: number; mime: string | null; buf: Buffer }[]): Promise<SentImage[]> {
  const { default: sharp } = await import("sharp");
  return Promise.all(images.map(async (x) => {
    let width: number | null = null;
    let height: number | null = null;
    try {
      const m = await sharp(x.buf, { failOn: "none" }).metadata();
      width = m.width ?? null; height = m.height ?? null;
    } catch { /* not decodable here: sizes stay unknown */ }
    return { n: x.n, mime: x.mime, bytes: x.buf.length, sha256: sha(x.buf), width, height, encoding: "inline_base64" as const };
  }));
}

function parseBody(text: string): { body: unknown; images: { n: number; mime: string | null; buf: Buffer }[]; truncated: boolean } {
  const images: { n: number; mime: string | null; buf: Buffer }[] = [];
  try {
    const body = stripImages(JSON.parse(text), images);
    const s = JSON.stringify(body);
    if (s.length > MAX_BODY_CHARS) return { body: { $truncated: true, head: s.slice(0, MAX_BODY_CHARS) }, images, truncated: true };
    return { body, images, truncated: false };
  } catch {
    return { body: { $text: text.slice(0, MAX_TEXT_CHARS) }, images, truncated: text.length > MAX_TEXT_CHARS };
  }
}

/** Claude's answer text (the concatenated text blocks), as returned. */
function anthropicText(body: unknown): string | null {
  const content = (body as { content?: unknown })?.content;
  if (!Array.isArray(content)) return null;
  const t = content.map((b) => (b && typeof b === "object" && (b as { type?: unknown }).type === "text" ? String((b as { text?: unknown }).text ?? "") : "")).join("");
  return t ? t.slice(0, MAX_TEXT_CHARS) : null;
}

async function readResponse(res: Response, rec: BoundaryRequest): Promise<void> {
  try {
    const text = await res.text();
    const parsed = parseBody(text);
    const images = await measure(parsed.images);
    const headers: Record<string, string> = {};
    let requestId: string | null = null;
    for (const h of SAFE_RESPONSE_HEADERS) {
      const v = res.headers.get(h);
      if (v) { headers[h] = v.slice(0, 120); requestId = requestId ?? v.slice(0, 120); }
    }
    rec.response = {
      status: res.status, request_id: requestId, body: parsed.body,
      text: rec.provider === "anthropic" ? anthropicText(parsed.body) : null, images, truncated: parsed.truncated,
    };
  } catch (e) {
    rec.response = { error: e instanceof Error ? e.name : "unreadable" };
  }
}

let installed = false;

/** Installs the observing wrapper once per process (idempotent). */
export function installBoundaryObserver(): void {
  if (installed || typeof globalThis.fetch !== "function") return;
  installed = true;
  const original = globalThis.fetch;
  const observed = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const sink = store.getStore();
    if (!sink) return original(input, init);
    let rec: BoundaryRequest | null = null;
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const { names, safe } = headerList(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const bodyText = typeof init?.body === "string" ? init.body : null;
      const parsed = bodyText !== null ? parseBody(bodyText) : null;
      rec = {
        provider: providerOf(url), at: Date.now(), ms: null, method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
        url: safeUrl(url), header_names: names, headers: safe,
        body_sha256: bodyText !== null ? sha(bodyText) : null, body_chars: bodyText?.length ?? null,
        observable: bodyText !== null, body: parsed?.body ?? null, images: [], truncated: parsed?.truncated ?? false, response: null,
      };
      sink.requests.push(rec);
      if (parsed && parsed.images.length) {
        const r = rec;
        sink.pending.push(measure(parsed.images).then((m) => { r.images = m; }).catch(() => undefined));
      }
    } catch {
      rec = null;
    }
    const t0 = Date.now();
    try {
      const res = await original(input, init);
      if (rec) {
        rec.ms = Date.now() - t0;
        sink.pending.push(readResponse(res.clone(), rec));
      }
      return res;
    } catch (e) {
      if (rec) { rec.ms = Date.now() - t0; rec.response = { error: e instanceof Error ? e.name : "fetch_failed" }; }
      throw e;
    }
  }) as typeof fetch;
  // Keep whatever the platform marked its own fetch with (Next.js checks
  // `__nextPatched` before patching again).
  for (const k of Object.keys(original)) {
    try { (observed as unknown as Record<string, unknown>)[k] = (original as unknown as Record<string, unknown>)[k]; } catch { /* read-only */ }
  }
  globalThis.fetch = observed;
}

/** Runs `fn` with every provider request it makes recorded into `sink`. */
export function observeProviderCalls<T>(sink: BoundarySink, fn: () => Promise<T>): Promise<T> {
  installBoundaryObserver();
  return store.run(sink, fn);
}

/** Waits (bounded) for the response copies and image measurements. */
export async function settleSink(sink: BoundarySink, maxMs = 3_000): Promise<void> {
  if (sink.pending.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(sink.pending),
    new Promise((r) => { timer = setTimeout(r, maxMs); }),
  ]);
  if (timer) clearTimeout(timer);
}

/** What stays after the retention purge (no text, no prompt). */
export function boundarySummary(sink: BoundarySink) {
  return {
    v: BOUNDARY_VERSION,
    requests: sink.requests.length,
    observable: sink.requests.every((r) => r.observable),
    images: sink.requests.reduce((s, r) => s + r.images.length, 0),
    image_sha256: sink.requests.flatMap((r) => r.images.map((i) => i.sha256)),
    body_chars: sink.requests.reduce((s, r) => s + (r.body_chars ?? 0), 0),
    status: sink.requests.map((r) => (r.response && "status" in r.response ? r.response.status : null)),
    providers: [...new Set(sink.requests.map((r) => r.provider))],
  };
}

export function boundaryRecord(sink: BoundarySink) {
  return { v: BOUNDARY_VERSION, captured_at: "fetch", requests: sink.requests };
}
