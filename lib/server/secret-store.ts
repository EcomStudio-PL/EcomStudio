import "server-only";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";

/**
 * THE SECRET STORE — one way to keep an operator-managed secret, for every
 * integration GrovBase will ever have.
 *
 * Mail, Telegram, Turnstile, Photoroom, OpenAI, Gemini, fal and whatever comes
 * next all store their credentials the same way: through here, into Supabase
 * Vault (migration 0078). There is deliberately no second mechanism. Five ways
 * to save an API key is five places to get the masking wrong, five places to
 * leak one into a log, and five things to audit.
 *
 * WHAT THIS FIXES.
 *
 * The old store sealed everything with APP_ENCRYPTION_KEY from the deploy
 * environment. When a deploy dropped that variable the panel did not merely
 * stop sending mail — it DISABLED the password fields, because there was no key
 * to encrypt with. The single action that would have ended the outage was the
 * action the outage prevented. Writing here needs an admin session and nothing
 * else, so that cannot happen again: whoever can log in can always set a new
 * password, and Supabase seals it.
 *
 * WHAT NEVER HAPPENS HERE.
 *
 * No plaintext is returned to a caller that is not the server. `status()` is
 * what the admin panel gets — configured / last four / when — and the last four
 * characters are cut in the DATABASE, because the alternative is shipping the
 * whole credential to a browser so the browser can shorten it. `read()` is the
 * only function that yields plaintext and it is used to open an SMTP session or
 * sign a provider request, never to fill a form field.
 */

/** The vault key for one integration's secret. A flat, greppable convention:
 *  `grovbase.<integration>.<field>`. */
export function secretName(scope: string, field: string): string {
  return `grovbase.${scope}.${field}`;
}

export type SecretStatus = {
  configured: boolean;
  /** Last four characters, computed server-side. Null when nothing is stored. */
  lastFour: string | null;
  updatedAt: string | null;
};

const EMPTY: SecretStatus = { configured: false, lastFour: null, updatedAt: null };

/**
 * Store a secret. Admin session required — enforced in the database, not here,
 * so hiding the button is never what protects it.
 *
 * An empty value is REFUSED rather than treated as a delete. A blank password
 * field is what a form posts when the admin did not retype it, and wiping a
 * working credential because someone saved the page is the most expensive
 * mistake this module could make. Use `clear()` to mean "remove it".
 */
export async function putSecret(
  supabase: Client, name: string, value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = value.trim();
  if (!v) return { ok: false, error: "empty_value" };
  const { error } = await supabase.rpc("secret_put", { p_name: name, p_value: v });
  if (error) {
    // The code and message only. An RPC error on this path can carry the
    // parameters that produced it, and one of those is the secret.
    console.error("secretStore.put", name, error.code ?? "rpc_error");
    return { ok: false, error: error.message === "forbidden" ? "forbidden" : "generic" };
  }
  return { ok: true };
}

/** Remove a stored secret. Returns whether there was one to remove. */
export async function clearSecret(supabase: Client, name: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("secret_clear", { p_name: name });
  if (error) {
    console.error("secretStore.clear", name, error.code ?? "rpc_error");
    return false;
  }
  return data === true;
}

/**
 * What the panel is allowed to know: whether a secret exists, its last four
 * characters and when it changed. Never the value.
 */
export async function secretStatuses(
  supabase: Client, names: readonly string[],
): Promise<Map<string, SecretStatus>> {
  const out = new Map<string, SecretStatus>();
  for (const n of names) out.set(n, EMPTY);
  if (names.length === 0) return out;

  const { data, error } = await supabase.rpc("secret_status", { p_names: [...names] });
  if (error) {
    console.error("secretStore.status", error.code ?? "rpc_error");
    return out;
  }
  for (const row of (data ?? []) as { name: string; configured: boolean; last_four: string | null; updated_at: string | null }[]) {
    out.set(row.name, {
      configured: row.configured === true,
      lastFour: row.last_four,
      updatedAt: row.updated_at,
    });
  }
  return out;
}

/**
 * The plaintext, for the code that is about to use it.
 *
 * Two callers are authorised by the database: an admin acting on their own
 * integration, and the server proving itself with the dispatch token. The token
 * is attached automatically here — an admin-context call does not need it and a
 * server-context call cannot work without it, and neither caller should have to
 * remember which it is.
 *
 * Returns null when nothing is stored OR when the caller is not authorised.
 * Those two look the same on purpose: a caller who may not read a secret should
 * not learn from the answer whether one exists.
 */
export async function readSecret(supabase: Client, name: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("secret_read", {
    p_name: name,
    p_token: dispatchToken(),
  });
  if (error) {
    console.error("secretStore.read", name, error.code ?? "rpc_error");
    return null;
  }
  return typeof data === "string" && data !== "" ? data : null;
}

/** Several at once, for an integration that owns more than one field. */
export async function readSecrets(
  supabase: Client, names: readonly string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const values = await Promise.all(names.map((n) => readSecret(supabase, n)));
  names.forEach((n, i) => {
    const v = values[i];
    if (v) out[n] = v;
  });
  return out;
}
