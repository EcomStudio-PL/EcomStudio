/**
 * THE STEP-UP, AT THE REQUEST LAYER.
 *
 * WHAT WENT WRONG (P1-23). The emailed-code gate lived in two LAYOUTS —
 * app/(app)/layout.tsx and app/admin/layout.tsx — and layouts only run when a
 * page renders. /auth/sign-in writes full session cookies and redirects as
 * soon as the password is right, so between that moment and the first page
 * render there is a valid session that has passed exactly one factor. Every
 * route handler is reachable in that state: the ones that spend the customer's
 * credits, and the ones that hand back their work.
 *
 * A gate in the rendering layer cannot defend a request that never renders.
 * This module is the same question asked one layer lower, in middleware.
 *
 * WHY THIS FILE IS SEPARATE FROM lib/server/login-security.ts. That module is
 * `server-only` and uses node:crypto and next/headers; middleware runs on the
 * edge runtime, where importing it would either fail to bundle or drag the
 * whole module in. What is needed here is small enough to state twice: the
 * same sha256 of the same cookie, computed with WebCrypto.
 *
 * SCOPE, AND WHY IT STOPS WHERE IT DOES. API routes only. Those are the paths
 * the finding names — generate, tools/run, library/zip, generations/sources —
 * and they are the ones with no other gate in front of them. Server actions
 * are NOT gated here: they are POSTs to page URLs, they already pass through a
 * layout on the way in, and gating them at the edge would mean answering a
 * React action with a redirect, which is a different contract. That is a
 * deliberate stopping point, not an oversight.
 */

/** sha256 hex, WebCrypto — must produce the same string as hashDevice() in
 *  lib/server/login-security.ts, because the database matches on that value. */
export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Paths that must never be gated.
 *
 * `/api/public/`, the newsletter worker, the cron entry points and the
 * provider hooks all authenticate themselves — by token, by secret, or not at
 * all because they are public — and none of them belongs to a signed-in
 * customer whose device could be challenged. Gating them would break them
 * without protecting anything.
 */
const EXEMPT = [
  "/api/public/",
  "/api/newsletter/",
  "/api/cron/",
  "/api/hooks/",
  "/api/waitlist",
];

/** THE PREDICATE, exported so it can be tested without a browser. */
export function stepUpAppliesTo(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  return !EXEMPT.some((p) => pathname.startsWith(p));
}

/**
 * POSITIVE VERDICTS ONLY, for thirty seconds, per instance.
 *
 * Without this every API call pays for one extra database round trip. With it,
 * a burst — which is what a batch of eighty photos is — pays for one.
 *
 * Only "trusted" is remembered, and never "untrusted": a customer who has just
 * typed their code must be let in on the very next request, so a negative
 * answer has to be asked again every time. A device revoked from the settings
 * page keeps working for up to thirty seconds, which is the cost of this and
 * is stated here rather than discovered.
 */
const TTL_MS = 30_000;
const passes = new Map<string, number>();

export function cachedPass(key: string, nowMs: number = Date.now()): boolean {
  const at = passes.get(key);
  if (at !== undefined && nowMs - at < TTL_MS) return true;
  if (at !== undefined) passes.delete(key);
  return false;
}

export function rememberPass(key: string, nowMs: number = Date.now()): void {
  // A lambda instance that lives long enough to serve thousands of users
  // should not grow a map of all of them. The cap is generous for a burst and
  // irrelevant to correctness: a dropped entry only costs one extra check.
  if (passes.size > 5_000) passes.clear();
  passes.set(key, nowMs);
}

/** Exported for the test suite, which must not inherit state between cases. */
export function resetPassCache(): void {
  passes.clear();
}
