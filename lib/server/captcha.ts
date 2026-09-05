import "server-only";

/**
 * CLOUDFLARE TURNSTILE — the server half of the signup captcha.
 *
 * The browser widget hands the form a one-time token; only this check —
 * secret key in hand — decides whether a human was behind it. The verdict is
 * deliberately coarse, because the caller can only act on three things:
 * "make the user solve it again", "the operator misconfigured the secret",
 * "Cloudflare was unreachable". And the secret itself must never surface in
 * a verdict, a log line, or a thrown message — hence the bare catch below.
 */

export type CaptchaVerdict = {
  ok: boolean;
  error?: "missing_token" | "bad_token" | "bad_secret" | "network";
};

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare's error-codes, folded into the two cases a caller can act on.
 *  timeout-or-duplicate covers a token replayed or verified too late — from
 *  the user's side that is "solve it again", the same as an invalid token,
 *  and so is anything Cloudflare invents that is not a secret-key problem. */
function mapErrorCodes(codes: readonly string[]): CaptchaVerdict["error"] {
  if (codes.includes("invalid-input-secret") || codes.includes("missing-input-secret")) return "bad_secret";
  return "bad_token";
}

export async function verifyTurnstile(secret: string, token: string, remoteIp?: string): Promise<CaptchaVerdict> {
  if (!token) return { ok: false, error: "missing_token" };
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      // Cloudflare answering slowly must not hold a registration hostage.
      signal: AbortSignal.timeout(8000),
    });
    const parsed: unknown = await res.json();
    const outcome = (parsed && typeof parsed === "object" ? parsed : {}) as {
      success?: unknown;
      "error-codes"?: unknown;
    };
    if (outcome.success === true) return { ok: true };
    const codes = Array.isArray(outcome["error-codes"])
      ? outcome["error-codes"].filter((code): code is string => typeof code === "string")
      : [];
    return { ok: false, error: mapErrorCodes(codes) };
  } catch {
    // Network trouble, the 8s timeout, or a non-JSON answer. Nothing from the
    // exception is kept: a fetch error can quote the request it was making,
    // and this request carries the secret.
    return { ok: false, error: "network" };
  }
}
