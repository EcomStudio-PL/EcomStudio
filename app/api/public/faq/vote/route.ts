import { NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { dispatchToken, serverSecret } from "@/lib/server/server-token";
import { FAQ_SLUG, FAQ_SLUG_MAX } from "@/lib/faq";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "CZY TO POMOGŁO?" — one vote per question per browser (FAQ V1).
 *
 * The browser gets a random id in an httpOnly cookie scoped to this route;
 * what is stored is a salted hash of it (and of the IP, for the hourly limit
 * of faq_vote(), 0155) — never the id, never the address. The database keeps
 * the first vote of a browser and answers a second one with "already", which
 * the page shows exactly like a fresh "thank you": nobody is told what they
 * voted before, and nothing about other voters ever comes back.
 *
 * Votes count only for a question a visitor can see; the token keeps every
 * other caller out of faq_vote() itself.
 */

const COOKIE = "gb_fv";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 1024;

const refuse = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

const hash = (secret: string, kind: string, value: string) =>
  createHash("sha256").update(`grovbase-faq-${kind}:${secret}:${value}`).digest("hex");

function cookieId(request: Request): string | null {
  const raw = request.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(raw);
  const v = m ? decodeURIComponent(m[1]) : "";
  return UUID.test(v) ? v : null;
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (!rateLimit(`faq-vote:${ip}`, 40, 60 * 60_000)) return refuse("rate_limited", 429);

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return refuse("invalid", 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return refuse("invalid", 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return refuse("invalid", 400);
  }
  const slug = typeof body.slug === "string" ? body.slug : "";
  const vote = body.vote;
  if (!FAQ_SLUG.test(slug) || slug.length > FAQ_SLUG_MAX.item || (vote !== "yes" && vote !== "no")) return refuse("invalid", 400);

  const secret = serverSecret();
  const token = dispatchToken();
  if (!secret || !token) return refuse("unavailable", 503);

  const known = cookieId(request);
  const id = known ?? randomUUID();
  const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.rpc("faq_vote", {
    p_token: token, p_slug: slug, p_voter: hash(secret, "voter", id), p_ip_hash: hash(secret, "ip", ip),
    p_helpful: vote === "yes",
  });
  if (error) {
    console.error("faq.vote", error.code ?? "-");
    return refuse("unavailable", 503);
  }

  const status = typeof data === "string" ? data : "";
  const res = status === "ok" || status === "already"
    ? NextResponse.json({ ok: true })
    : status === "rate_limited" ? refuse("rate_limited", 429)
    : status === "not_found" ? refuse("not_found", 404)
    : refuse("invalid", 400);
  if (!known) {
    res.cookies.set(COOKIE, id, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/api/public/faq", maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}
