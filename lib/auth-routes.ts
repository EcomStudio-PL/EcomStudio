/**
 * WHERE THE AUTH DIALOG LIVES.
 *
 * One function so the redirect from /login, the middleware's returnTo bounce
 * and the sign-in route's error bounce cannot drift into three slightly
 * different URLs. The dialog is a query parameter on the landing page, which
 * is what lets it open OVER a page instead of replacing it.
 */
export type AuthMode = "login" | "register" | "forgot";

export const AUTH_MODES: readonly AuthMode[] = ["login", "register", "forgot"];

export function parseAuthMode(value: string | null): AuthMode | null {
  return value && (AUTH_MODES as readonly string[]).includes(value) ? (value as AuthMode) : null;
}

export const AUTH_HOST_PATH = "/";

/** Only these ride along; anything else on the old URL is dropped rather than
 *  reflected back into a fresh one. */
const CARRIED = ["next", "error", "email"] as const;

/** Characters every URL parser — browsers and Node alike — REMOVES before it
 *  parses. That is what makes them dangerous here: a value is inspected with
 *  them present and resolved with them gone, so "/<TAB>/evil.com" passes a
 *  "starts with / and not //" test and then resolves to //evil.com, which is
 *  another origin. */
const PARSER_STRIPPED = /[\u0000-\u001F\u007F]/;

/** An internal path, or "" — never an absolute or protocol-relative value,
 *  which is what an open redirect is made of.
 *
 *  A value carrying a stripped character is REFUSED, not cleaned. Cleaning
 *  would turn an attacker's string into a different string that looks
 *  internal; refusing says what is true, which is that this value cannot be
 *  trusted to mean what it appears to mean. `trim()` only ever removed the
 *  outer ones, and the dangerous ones are interior. */
export function safeReturnTo(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (PARSER_STRIPPED.test(v)) return "";
  return v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : "";
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function authModalUrl(
  mode: AuthMode,
  params?: Record<string, string | string[] | undefined>,
): string {
  const q = new URLSearchParams();
  q.set("auth", mode);
  for (const key of CARRIED) {
    const raw = first(params?.[key]);
    if (!raw) continue;
    const value = key === "next" ? safeReturnTo(raw) : raw;
    if (value) q.set(key, value);
  }
  return `${AUTH_HOST_PATH}?${q.toString()}`;
}
