import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

/**
 * SYSTEM HEALTH — only what has actually been checked.
 *
 * The old health card had a row reading "Vercel — Połączono" in green. Nothing
 * had asked Vercel anything; the badge was a literal, hardcoded green. That is
 * worse than no row at all, because an operator glancing at a green wall
 * concludes the platform is fine when the panel has in fact verified nothing.
 *
 * So this module answers with three states and never with two:
 *
 *   ok      — something was checked and it worked, and we can say WHEN
 *   fail    — something was checked and it did not work
 *   unknown — nobody has ever checked, or the check is not implemented
 *
 * "unknown" renders grey and says "nie zweryfikowano" rather than borrowing
 * either colour. A row is only allowed to be green if a real round trip
 * happened and left a timestamp behind.
 */

export type HealthState = "ok" | "fail" | "unknown";

export type HealthCheck = {
  key: string;
  /** Already-resolved label; the caller translates, this module names. */
  label: string;
  state: HealthState;
  /** One short line of evidence — a region, an error bucket, a count. Never a
   *  driver message: the stored strings are the already-scrubbed *_safe ones. */
  detail: string | null;
  /** ISO timestamp of the check this state comes from, or null when the state
   *  is derived from the request currently being served. */
  checkedAt: string | null;
};

/** The stored vocabularies both integration rows and provider credentials use.
 *  Anything outside them is treated as unknown rather than guessed at. */
function fromStoredStatus(status: string | null | undefined): HealthState {
  if (status === "connected" || status === "ok") return "ok";
  if (status == null || status === "" || status === "not_configured") return "unknown";
  return "fail";
}

export async function readSystemHealth(supabase: Client): Promise<HealthCheck[]> {
  const [db, integrations, credentials] = await Promise.all([
    // A real query against a real table: this one is verified by definition,
    // because we are reading its answer.
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("integration_settings").select("type, status, last_tested_at, last_error_safe"),
    supabase
      .from("ai_provider_credentials")
      .select("last_test_status, last_tested_at, ai_providers(name)"),
  ]);

  const now = new Date().toISOString();
  const checks: HealthCheck[] = [
    {
      key: "database",
      label: "Supabase",
      state: db.error == null ? "ok" : "fail",
      detail: db.error == null ? `${db.count ?? 0} profiles` : "query_failed",
      checkedAt: now,
    },
    runtimeCheck(),
  ];

  for (const row of integrations.data ?? []) {
    checks.push({
      key: `integration:${row.type}`,
      label: row.type,
      state: fromStoredStatus(row.status),
      detail: row.last_error_safe,
      checkedAt: row.last_tested_at,
    });
  }

  for (const row of credentials.data ?? []) {
    // The embedded row arrives as an object or an array depending on the
    // relationship shape; both are handled so a provider never renders as
    // "undefined".
    const provider = row.ai_providers as unknown as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(provider) ? provider[0]?.name : provider?.name;
    checks.push({
      key: `provider:${name ?? "unknown"}`,
      label: name ?? "—",
      state: fromStoredStatus(row.last_test_status),
      detail: row.last_test_status ?? null,
      checkedAt: row.last_tested_at,
    });
  }

  return checks;
}

/**
 * The one thing we can say about the hosting without asking anybody: this code
 * is running, and these are the environment's own words for where. When the
 * variables are absent — a local server, a container without them — the honest
 * answer is that we do not know, not a green badge.
 */
function runtimeCheck(): HealthCheck {
  const env = process.env.VERCEL_ENV;
  const region = process.env.VERCEL_REGION;
  if (!env) {
    return { key: "runtime", label: "Runtime", state: "unknown", detail: null, checkedAt: null };
  }
  return {
    key: "runtime",
    label: "Runtime",
    state: "ok",
    detail: region ? `${env} · ${region}` : env,
    checkedAt: new Date().toISOString(),
  };
}
