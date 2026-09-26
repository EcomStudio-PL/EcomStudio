import "server-only";
import type { Client } from "@/lib/services/workspace";
import { readSecret, secretName } from "@/lib/server/secret-store";
import { isValidAuthHeader, isValidSourceSecret, type SourceAuthKind } from "@/lib/grovnews-research";
import type { ProbeSummary } from "@/lib/grovnews-import";
import {
  SafeFetchError, fetchWith, httpsTransport, robotsGate, type FetchOptions, type FetchedDocument, type Transport,
} from "./fetch";
import { parseApiJson, parseFeed, type ParsedFeed } from "./feed";
import { newestEntryAt } from "./probe";

/**
 * API SOURCES (0128) — a source that is an HTTP API rather than a public
 * feed, optionally behind a key.
 *
 * THE SAME FETCHER, THE SAME LIMITS. Every request goes through fetchWith —
 * https only, every resolved address public (checked at connect time),
 * redirects followed by hand and re-checked, one deadline, a byte cap on the
 * decompressed body. What an API adds is exactly one header:
 *
 *   · the credential is read from the vault at the moment of the request
 *     (`grovbase.grovnews_source.<id>`, admin-written, server-read with the
 *     dispatch token) — never from the table, never from the browser;
 *   · it is sent to the source's OWN origin only: `headersFor` is asked for
 *     every hop, and a redirect to any other origin gets no credential;
 *   · robots.txt is read without it. An API with no auth is public content
 *     like any feed, so its robots.txt is honoured; an API the admin holds a
 *     key for is an agreed interface, and its robots.txt is not consulted.
 *
 * WHAT COMES BACK: a JSON Feed, RSS or Atom document (the feed parser), or a
 * plain JSON list the minimal mapping in feed.ts understands. Anything else is
 * `unrecognized_format`. A 401/403 is `auth_failed`. Errors are CODES — the
 * upstream body and the secret never appear in one.
 */

export const API_ACCEPT =
  "application/json, application/feed+json;q=0.9, application/rss+xml;q=0.8, application/atom+xml;q=0.8, application/xml;q=0.7, */*;q=0.1";

/** The vault name of one API source's secret. */
export function sourceSecretName(sourceId: string): string {
  return secretName("grovnews_source", sourceId);
}

export type ApiAuth =
  | { kind: "none" }
  | { kind: "bearer"; secret: string }
  | { kind: "header"; header: string; secret: string };

/** The headers for ONE hop: the credential only while the request is still
 *  on the source's own origin. */
export function authHeadersFor(auth: ApiAuth, origin: string): (url: URL) => Record<string, string> {
  return (url) => {
    if (auth.kind === "none" || url.origin !== origin) return {};
    return auth.kind === "bearer"
      ? { authorization: `Bearer ${auth.secret}` }
      : { [auth.header.toLowerCase()]: auth.secret };
  };
}

/** An API failure as the code the health rule (0128 §2.1) and the screens
 *  know. Never a message. */
export function apiErrorCode(e: unknown): string {
  if (e instanceof SafeFetchError) {
    if (e.code === "http_status" && (e.status === 401 || e.status === 403)) return "auth_failed";
    return e.status ? `${e.code}_${e.status}` : e.code;
  }
  if (e instanceof Error && /^[a-z_]{2,40}$/.test(e.message)) return e.message;
  return "network";
}

/** A response as entries: a feed when it is one, else the generic mapping. */
export function parseApiResponse(body: string, url: string, now: number = Date.now()): ParsedFeed | null {
  return parseFeed(body, url, now) ?? parseApiJson(body, url, now);
}

/** How a saved source authenticates, with its secret — or `secret_missing`
 *  when it should carry one and none is stored. */
export async function resolveApiAuth(
  db: Client, source: { id: string; authKind?: SourceAuthKind | null; authHeader?: string | null },
): Promise<ApiAuth | "secret_missing"> {
  const kind = source.authKind ?? "none";
  if (kind === "none") return { kind: "none" };
  const secret = await readSecret(db, sourceSecretName(source.id));
  if (!isValidSourceSecret(secret)) return "secret_missing";
  if (kind === "bearer") return { kind: "bearer", secret: secret.trim() };
  if (!isValidAuthHeader(source.authHeader)) return "secret_missing";
  return { kind: "header", header: source.authHeader, secret: secret.trim() };
}

export type ApiRead = { doc: FetchedDocument; parsed: ParsedFeed };

/** Read an API once. Throws a SafeFetchError or `unrecognized_format`. */
export async function readApi(
  url: string, auth: ApiAuth, deps: { transport?: Transport; now?: number } = {},
): Promise<ApiRead> {
  const transport = deps.transport ?? httpsTransport;
  const fetcher = (u: string, o: FetchOptions) => fetchWith(transport, u, o);
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new SafeFetchError("invalid_url");
  }
  const doc = await fetcher(url, {
    accept: API_ACCEPT, maxBytes: 2_000_000, timeoutMs: 15_000,
    headersFor: authHeadersFor(auth, origin),
    beforeHop: auth.kind === "none" ? robotsGate(fetcher) : undefined,
  });
  const parsed = parseApiResponse(doc.body, doc.url, deps.now ?? Date.now());
  if (!parsed) throw new Error("unrecognized_format");
  return { doc, parsed };
}

const DETECTED: Record<ParsedFeed["kind"], ProbeSummary["detectedType"]> = {
  rss: "RSS", rdf: "RSS", atom: "ATOM", json: "PUBLIC_FEED", page: null, api: null,
};

export type ApiProbe = ProbeSummary & { apiKind: ParsedFeed["kind"] | null; entries: number };

/** "Testuj źródło" for an API source: works / what it returned / its newest
 *  entry — or why not, as a code. Never throws; never carries the secret or
 *  the upstream body. */
export async function probeApiSource(
  db: Client,
  source: { id: string; url: string | null; authKind?: SourceAuthKind | null; authHeader?: string | null },
  deps: { transport?: Transport; now?: number } = {},
): Promise<ApiProbe> {
  const checkedAt = new Date(deps.now ?? Date.now()).toISOString();
  const base = {
    verdict: "FAILED" as ProbeSummary["verdict"], code: null as string | null, httpStatus: null as number | null,
    resolvedUrl: null as string | null, detectedType: null as ProbeSummary["detectedType"], feedUrl: null, options: [],
    recommended: null, sample: [] as string[], checkedAt, lastItemAt: null as string | null, apiKind: null as ParsedFeed["kind"] | null,
    entries: 0,
  };
  if (!source.url) return { ...base, code: "no_url" };
  const auth = await resolveApiAuth(db, source);
  if (auth === "secret_missing") return { ...base, verdict: "UNSUPPORTED", code: "secret_missing" };
  try {
    const { doc, parsed } = await readApi(source.url, auth, deps);
    const entries = parsed.entries.length;
    return {
      ...base,
      verdict: entries > 0 ? "OK" : "EMPTY", code: entries > 0 ? null : "empty", httpStatus: doc.status,
      resolvedUrl: doc.url.startsWith("https://") ? doc.url : null, detectedType: DETECTED[parsed.kind],
      sample: parsed.entries.slice(0, 5).map((e) => e.title), lastItemAt: newestEntryAt(parsed.entries), apiKind: parsed.kind,
      entries,
    };
  } catch (e) {
    const code = apiErrorCode(e);
    const status = e instanceof SafeFetchError && e.status ? e.status : null;
    return {
      ...base,
      verdict: code === "auth_failed" || code === "robots" ? "UNSUPPORTED"
        : code === "timeout" || code === "network" || (status ?? 0) >= 500 || status === 429 ? "RETRY" : "FAILED",
      code, httpStatus: status,
    };
  }
}

/** What a probe of an API source means for its health record (the shape
 *  grovnews_source_checked takes). */
export function healthFromApiProbe(probe: ApiProbe): {
  ok: boolean; error: string | null; http: number | null; detected_type: string | null; resolved_url: string | null; entries: number | null;
} {
  const common = { http: probe.httpStatus, detected_type: probe.detectedType, resolved_url: probe.resolvedUrl };
  if (probe.verdict === "OK") return { ok: true, error: null, ...common, entries: probe.entries };
  if (probe.verdict === "EMPTY") return { ok: true, error: null, ...common, entries: 0 };
  return { ok: false, error: probe.code ?? "error", ...common, entries: null };
}
