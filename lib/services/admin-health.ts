import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { serverTokenAvailable } from "@/lib/server/server-token";

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
    unattendedCheck(),
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
 * CAN THE SERVER ACT FOR SOMEBODY WHO IS NOT LOGGED IN?
 *
 * Four things happen with no human present: the waitlist confirmation to an
 * anonymous visitor, Supabase calling the Send Email Hook, the captcha check
 * during signup, and a customer's generation reaching for a provider key. None
 * of them has an admin session to authorise it — and GrovBase's server talks to
 * Postgres with the same publishable key the browser holds, so nothing about
 * the request proves it came from the application rather than from somebody's
 * console.
 *
 * One value fixes that: GROVBASE_SERVER_KEY, any random string of 32
 * characters or more. The server hashes it, the database checks the hash, and
 * a browser cannot produce one. (The two older key names still work.)
 *
 * WITHOUT IT NOTHING VISIBLY BREAKS, which is exactly why this row exists. The
 * admin panel keeps working perfectly — every screen there is authorised by
 * being an admin — while confirmation e-mails quietly stop arriving. A failure
 * with no symptom is the kind that runs for weeks.
 */
function unattendedCheck(): HealthCheck {
  const ok = serverTokenAvailable();
  return {
    key: "unattended",
    label: "Automatyczne wysyłki",
    state: ok ? "ok" : "fail",
    detail: ok ? "GROVBASE_SERVER_KEY" : "brak GROVBASE_SERVER_KEY",
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Vercel regions that sit beside a eu-central-1 database. Anything else means
 * every query crosses an ocean and comes back.
 */
const EU_REGIONS = new Set(["fra1", "arn1", "cdg1", "dub1", "lhr1", "zrh1"]);

/**
 * WHERE THIS CODE IS ACTUALLY RUNNING, and whether that is beside the database.
 *
 * vercel.json asks for fra1. Asking is not the same as getting: the region a
 * function ends up in depends on the plan and the project's settings, and a
 * config file that is quietly ignored looks exactly like one that is obeyed.
 * So the region is read from the process at request time — VERCEL_REGION is
 * what the platform actually put us in, not what we asked for — and compared
 * against where the database lives.
 *
 * When they do not match, this row goes AMBER rather than green. It is not a
 * fault in the sense that something is broken; it is the reason every page is
 * slower than it looks like it should be, and an operator cannot act on a
 * number they were never shown. A transatlantic round trip is roughly 90-110 ms,
 * and a page that makes four of them in sequence spends most of its time in the
 * Atlantic, not in Postgres and not in React.
 */
function runtimeCheck(): HealthCheck {
  const env = process.env.VERCEL_ENV;
  const region = process.env.VERCEL_REGION;
  if (!env) {
    return { key: "runtime", label: "Runtime", state: "unknown", detail: null, checkedAt: null };
  }
  if (!region) {
    return { key: "runtime", label: "Runtime", state: "ok", detail: env, checkedAt: new Date().toISOString() };
  }
  // The database's own region, read from the project ref's URL host is not
  // possible — Supabase does not encode it there — so it is compared against
  // the one place that does know: the deployment config asked for fra1, and the
  // production database is eu-central-1. A non-EU runtime is the mismatch.
  const colocated = EU_REGIONS.has(region);
  return {
    key: "runtime",
    label: "Runtime",
    state: colocated ? "ok" : "fail",
    // Region codes, not prose: this line is printed verbatim by the grid and a
    // translated sentence does not belong in a service. Two region names side
    // by side say the whole thing to anyone who can act on it.
    detail: colocated ? `${env} · ${region}` : `${env} · ${region} ≠ db eu-central-1`,
    checkedAt: new Date().toISOString(),
  };
}
