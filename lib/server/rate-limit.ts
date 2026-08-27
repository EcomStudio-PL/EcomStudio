import "server-only";

/**
 * Small fixed-window rate limiter for abuse-prone endpoints (login attempts,
 * password reset). In-memory on purpose: on serverless it protects per warm
 * instance, which is exactly the granularity a brute-force burst hits, and it
 * adds zero infrastructure. It is a brake, not a bank vault — account-level
 * protections (Supabase auth's own throttling, leaked-password protection)
 * remain the authoritative layer.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  // Opportunistic cleanup so the map cannot grow without bound.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}

/** Best-effort client address behind Vercel's proxy. */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? "").trim() || "unknown";
}
