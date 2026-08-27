/**
 * CLOCK-SKEW RETRY — the fix for "logged in, but the app says the account is
 * not set up".
 *
 * GoTrue mints the access token with `iat` set by ITS clock. PostgREST
 * validates that token against the DATABASE node's clock. When the database
 * is a fraction of a second behind, a token that was just issued looks like
 * it comes from the future and every authenticated read is rejected with
 * PGRST303 ("JWT issued at future") for the ~1–2 seconds until the clocks
 * agree. `auth.getUser()` keeps working the whole time, because GoTrue
 * validates against the clock that issued the token — so the app sees a
 * signed-in user whose data reads all come back empty, and renders as if the
 * account had no records. Signing in again lands outside the window, which is
 * why the workaround "log out and log in" appeared to fix it.
 *
 * PGRST303 is transient by definition: the same request succeeds moments
 * later without any change to the session. So we retry it here, at the
 * transport, where every server-side query gets the protection at once — and
 * the user never sees the window at all.
 */

/** Roughly 2.5s of total patience, front-loaded — the observed skew window
 *  closes inside two seconds. */
const BACKOFF_MS = [200, 400, 700, 1200];

/** Only these can carry a PGRST303 body worth retrying. */
const RETRYABLE_STATUS = new Set([400, 401]);

function isReplayable(init?: RequestInit): boolean {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return true;
  // A string body can be sent again; a stream cannot be rewound, so those
  // requests are returned as-is rather than risking a half-sent retry.
  return typeof init?.body === "string" || init?.body == null;
}

export function fetchWithSkewRetry(base: typeof fetch = fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    for (let attempt = 0; ; attempt++) {
      const response = await base(input, init);
      if (attempt >= BACKOFF_MS.length) return response;
      if (!RETRYABLE_STATUS.has(response.status) || !isReplayable(init)) return response;
      // The code lives in the JSON body; read a copy so the caller still gets
      // an unconsumed response when we decide not to retry.
      const body = await response.clone().text().catch(() => "");
      if (!body.includes("PGRST303")) return response;
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
    }
  };
}
