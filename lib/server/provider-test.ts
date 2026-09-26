import "server-only";

export type TestStatus =
  | "connected" | "auth_failed" | "quota" | "rate_limited"
  | "model_unavailable" | "unavailable" | "timeout" | "invalid" | "unsupported"
  // Failures BEFORE the provider is even asked — the key cannot reach a
  // runtime call, which is exactly what customers would hit.
  | "server_unconfigured" | "key_unreadable" | "no_credential";

/**
 * `detail` is a short CODE (never a provider message, never a key): an HTTP
 * status like "http_404", "sandbox" / "live" for keys that say which they are,
 * "reachable" when a provider has no auth-only endpoint. The panel translates
 * it; nothing here is shown raw.
 */
export type TestResult = { status: TestStatus; detail: string | null; latencyMs: number | null };

/** HTTP → distinct admin-facing verdicts. 429 is only "rate limited" when the
 *  body does not say the money ran out — a quota that never refills must not
 *  masquerade as a transient limit. */
function classify(httpStatus: number, body?: string): { status: TestStatus; detail: string | null } {
  if (httpStatus >= 200 && httpStatus < 300) return { status: "connected", detail: null };
  if (httpStatus === 401 || httpStatus === 403) return { status: "auth_failed", detail: `http_${httpStatus}` };
  if (httpStatus === 402) return { status: "quota", detail: "http_402" };
  if (httpStatus === 429) {
    return body && /insufficient_quota|billing|exceeded your current quota|RESOURCE_EXHAUSTED[\s\S]*PerDay/i.test(body)
      ? { status: "quota", detail: "http_429" }
      : { status: "rate_limited", detail: "http_429" };
  }
  if (httpStatus === 404) return { status: "model_unavailable", detail: "http_404" };
  return { status: "unavailable", detail: `http_${httpStatus}` };
}

const trimBase = (base: string | null | undefined, fallback: string) =>
  (base?.trim() || fallback).replace(/\/+$/, "");

/**
 * The cheapest REAL check each provider offers — a request that proves the
 * key is accepted and bills nothing (a model listing, or an auth-first
 * endpoint called without a payload). The secret never leaves the server and
 * is never logged. A provider with no such endpoint reports "unsupported"
 * honestly rather than a guessed success.
 */
export async function testProviderConnection(slug: string, apiKey: string, baseUrl?: string | null): Promise<TestResult> {
  const timeout = AbortSignal.timeout(10000);
  const started = Date.now();
  const done = (r: { status: TestStatus; detail: string | null }): TestResult =>
    ({ ...r, latencyMs: Date.now() - started });
  try {
    switch (slug) {
      case "openai": {
        const res = await fetch(`${trimBase(baseUrl, "https://api.openai.com")}/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` }, signal: timeout,
        });
        return done(classify(res.status, res.ok ? undefined : await res.text().catch(() => undefined)));
      }
      case "google": {
        const res = await fetch(
          `${trimBase(baseUrl, "https://generativelanguage.googleapis.com")}/v1beta/models?pageSize=1&key=${encodeURIComponent(apiKey)}`,
          { signal: timeout },
        );
        if (res.status === 400) return done({ status: "auth_failed", detail: "http_400" });
        return done(classify(res.status, res.ok ? undefined : await res.text().catch(() => undefined)));
      }
      case "anthropic": {
        const res = await fetch(`${trimBase(baseUrl, "https://api.anthropic.com")}/v1/models?limit=1`, {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, signal: timeout,
        });
        return done(classify(res.status));
      }
      case "fal": {
        // fal has no auth-only endpoint. Its API authenticates BEFORE routing,
        // so an unknown path with a valid key answers 404/405/422, and with a
        // bad key 401/403. A 5xx proves nothing about the key and is reported
        // as unavailable — it used to be counted as "connected".
        const res = await fetch(`${trimBase(baseUrl, "https://fal.run")}/fal-ai/status`, {
          headers: { Authorization: `Key ${apiKey}` }, signal: timeout,
        });
        if (res.status === 401 || res.status === 403) return done({ status: "auth_failed", detail: `http_${res.status}` });
        if (res.status === 429) return done({ status: "rate_limited", detail: "http_429" });
        if (res.status >= 500) return done({ status: "unavailable", detail: `http_${res.status}` });
        return done({ status: "connected", detail: res.ok ? null : "reachable" });
      }
      case "photoroom": {
        // A PROBE THAT COSTS NOTHING. Photoroom bills per image processed and
        // publishes no free status endpoint, so this posts a request with NO
        // image: authentication is checked before the (absent) image, so a
        // rejected key answers 401/403 and an accepted one 400 "no image".
        const res = await fetch(baseUrl?.trim() || "https://sdk.photoroom.com/v1/segment", {
          method: "POST",
          headers: { "x-api-key": apiKey, Accept: "application/json" },
          body: new FormData(),
          signal: timeout,
        });
        const sandbox = apiKey.trim().toLowerCase().startsWith("sandbox_");
        if (res.status === 401 || res.status === 403) return done({ status: "auth_failed", detail: `http_${res.status}` });
        if (res.status === 402) return done({ status: "quota", detail: "http_402" });
        if (res.status === 429) return done({ status: "rate_limited", detail: "http_429" });
        if (res.status === 400 || res.ok) return done({ status: "connected", detail: sandbox ? "sandbox" : "live" });
        return done(classify(res.status));
      }
      default:
        return { status: "unsupported", detail: null, latencyMs: null };
    }
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") return done({ status: "timeout", detail: null });
    return done({ status: "unavailable", detail: "network" });
  }
}
