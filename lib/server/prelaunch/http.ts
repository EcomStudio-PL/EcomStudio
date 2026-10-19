import "server-only";
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { originAllowed } from "./origin";

/**
 * THE DOOR EVERY PRE-LAUNCH ENDPOINT SHARES.
 *
 * Four anonymous POST routes (signup, resend, confirm, channel) take a body a
 * stranger wrote. Before any of them reads a field, the request has to pass the
 * same checks, in the same order (design §3):
 *
 *   1. POST — anything else is not this endpoint;
 *   2. `Content-Type: application/json` (415 otherwise). A cross-site HTML form
 *      can only send text/plain, urlencoded or multipart without a preflight,
 *      so this alone stops the classic CSRF post (audit §2.2);
 *   3. the Origin rule (403, lib/server/prelaunch/origin.ts);
 *   4. the in-memory per-IP limiter (429) — a brake per warm instance; the
 *      durable limits live in SQL, keyed on the hashed address;
 *   5. a size cap and a JSON OBJECT (400 `bad_request`) — read as text first,
 *      so an oversized body is refused without ever being parsed.
 *
 * The honeypot is the route's own business: its fake success has to look like
 * that route's real one.
 *
 * Every answer is `Cache-Control: no-store`. A uniform response is only
 * uniform if no cache in between replays somebody else's.
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function reply(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function failure(status: number, error: string): NextResponse {
  return reply({ ok: false, error }, status);
}

export type GuardedRequest = { ip: string; body: Record<string, unknown> };

export async function guardRequest(
  request: Request,
  opts: { route: string; limit: number; windowMs: number; maxBytes: number },
): Promise<GuardedRequest | NextResponse> {
  if (request.method !== "POST") {
    const res = failure(405, "method");
    res.headers.set("Allow", "POST");
    return res;
  }
  const type = (request.headers.get("content-type") ?? "").trim().toLowerCase();
  if (!type.startsWith("application/json")) return failure(415, "content_type");
  if (!originAllowed(request)) return failure(403, "origin");

  const ip = clientIp(request);
  if (!rateLimit(`prelaunch:${opts.route}:${ip}`, opts.limit, opts.windowMs)) {
    return failure(429, "rate_limited");
  }

  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > opts.maxBytes) return failure(400, "bad_request");
  let text: string;
  try {
    text = await request.text();
  } catch {
    return failure(400, "bad_request");
  }
  if (Buffer.byteLength(text, "utf8") > opts.maxBytes) return failure(400, "bad_request");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failure(400, "bad_request");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return failure(400, "bad_request");
  return { ip, body: parsed as Record<string, unknown> };
}

/** The honeypot: a field no person sees and every naive bot fills in. */
export function trapped(body: Record<string, unknown>): boolean {
  return typeof body.company === "string" && body.company.trim() !== "";
}
