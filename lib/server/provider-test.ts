import "server-only";

export type TestStatus =
  | "connected" | "auth_failed" | "quota" | "rate_limited"
  | "model_unavailable" | "unavailable" | "timeout" | "invalid" | "unsupported";
export type TestResult = { status: TestStatus; message: string };

/** HTTP → distinct admin-facing verdicts. 429 is only "rate limited" when the
 *  body does not say the money ran out — a quota that never refills must not
 *  masquerade as a transient limit. */
function classify(httpStatus: number, body?: string): TestResult {
  if (httpStatus >= 200 && httpStatus < 300) return { status: "connected", message: "Connected" };
  if (httpStatus === 401 || httpStatus === 403) return { status: "auth_failed", message: `Authentication failed (${httpStatus})` };
  if (httpStatus === 402) return { status: "quota", message: "Insufficient balance (402)" };
  if (httpStatus === 429) {
    return body && /insufficient_quota|billing|exceeded your current quota|RESOURCE_EXHAUSTED[\s\S]*PerDay/i.test(body)
      ? { status: "quota", message: "Insufficient balance / quota exhausted (429)" }
      : { status: "rate_limited", message: "Rate limited (429)" };
  }
  if (httpStatus === 404) return { status: "model_unavailable", message: "Model or endpoint not found (404)" };
  return { status: "unavailable", message: `Provider returned ${httpStatus}` };
}

/**
 * Lightweight server-side connection tests. The secret never leaves the server
 * and is never logged. Providers without a safe documented probe report
 * "unsupported" honestly instead of faking success.
 */
export async function testProviderConnection(slug: string, apiKey: string, baseUrl?: string | null): Promise<TestResult> {
  const timeout = AbortSignal.timeout(10000);
  try {
    switch (slug) {
      case "openai": {
        const res = await fetch(`${baseUrl || "https://api.openai.com"}/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` }, signal: timeout,
        });
        return classify(res.status, res.ok ? undefined : await res.text().catch(() => undefined));
      }
      case "google": {
        const res = await fetch(
          `${baseUrl || "https://generativelanguage.googleapis.com"}/v1beta/models?pageSize=1&key=${encodeURIComponent(apiKey)}`,
          { signal: timeout }
        );
        if (res.status === 400) return { status: "auth_failed", message: "Authentication failed (invalid key)" };
        return classify(res.status, res.ok ? undefined : await res.text().catch(() => undefined));
      }
      case "anthropic": {
        const res = await fetch(`${baseUrl || "https://api.anthropic.com"}/v1/models?limit=1`, {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, signal: timeout,
        });
        return classify(res.status);
      }
      case "fal": {
        const res = await fetch(`${baseUrl || "https://fal.run"}/fal-ai/status`, {
          headers: { Authorization: `Key ${apiKey}` }, signal: timeout,
        });
        if (res.status === 401 || res.status === 403) return { status: "auth_failed", message: `Authentication failed (${res.status})` };
        if (res.status === 429) return { status: "rate_limited", message: "Rate limited (429)" };
        // fal has no dedicated auth-probe endpoint; a non-auth error only proves reachability.
        return { status: "connected", message: "Endpoint reachable (no dedicated auth probe)" };
      }
      default:
        return { status: "unsupported", message: "No connection test available for this provider yet" };
    }
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") return { status: "timeout", message: "Request timed out" };
    return { status: "unavailable", message: "Network error" };
  }
}
