import "server-only";
import { readProviderKey } from "@/lib/server/provider-credentials";
import { dispatchToken } from "@/lib/server/server-token";
import type { Client } from "@/lib/services/workspace";

/**
 * WHAT EACH API PROVIDER LETS US KNOW ABOUT ITS MONEY — official APIs only.
 *
 * Checked against each provider's own documentation (11.2026):
 *   fal.ai      GET https://api.fal.ai/v1/account/billing?expand=credits
 *               → credits.current_balance in USD. AUTOMATIC.
 *   Stability   GET https://api.stability.ai/v1/user/balance → credits
 *               (1 credit = $0.01). AUTOMATIC.
 *   Photoroom   GET https://image-api.photoroom.com/v2/account → image
 *               credits, not money. MANUAL (the admin enters the USD value).
 *   remove.bg   GET https://api.remove.bg/v1.0/account → image credits, not
 *               money. MANUAL.
 *   OpenAI      no balance endpoint; organisation COSTS only through the
 *               Admin API (/v1/organization/costs, a separate admin key).
 *               MANUAL balance.
 *   Anthropic   no balance endpoint; COSTS only through the Admin API
 *               (/v1/organizations/cost_report, admin key). MANUAL balance.
 *   Google      Gemini API is billed to a Google Cloud billing account after
 *               the fact. POSTPAID: never a prepaid balance.
 *   Clipdrop, Higgsfield — no documented balance endpoint. MANUAL.
 *
 * Nothing here scrapes a dashboard or calls an undocumented endpoint, and
 * nothing ever buys credits: a sync only READS.
 */

export type BalanceKind = "api" | "manual" | "postpaid";

export const PROVIDER_FUNDS: Record<string, { balance: BalanceKind; costsApi: boolean; docs: string }> = {
  fal: { balance: "api", costsApi: false, docs: "https://fal.ai/docs/platform-apis/v1/account/billing" },
  stability: { balance: "api", costsApi: false, docs: "https://platform.stability.ai/docs/api-reference#tag/User/paths/~1v1~1user~1balance/get" },
  photoroom: { balance: "manual", costsApi: false, docs: "https://docs.photoroom.com/getting-started/how-can-i-check-my-api-usage" },
  removebg: { balance: "manual", costsApi: false, docs: "https://www.remove.bg/api#operations-tag-Fetch_account_info" },
  openai: { balance: "manual", costsApi: true, docs: "https://platform.openai.com/docs/api-reference/usage/costs" },
  anthropic: { balance: "manual", costsApi: true, docs: "https://docs.anthropic.com/en/api/usage-cost-api" },
  google: { balance: "postpaid", costsApi: false, docs: "https://ai.google.dev/gemini-api/docs/billing" },
  clipdrop: { balance: "manual", costsApi: false, docs: "https://clipdrop.co/apis/docs" },
  higgsfield: { balance: "manual", costsApi: false, docs: "" },
};

export type SyncResult =
  | { status: "ok"; micros: number }
  | { status: "error"; error: string }
  | { status: "unsupported" }
  | { status: "not_configured" };

const TIMEOUT_MS = 8000;

async function getJson(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json", ...headers }, signal: ctrl.signal, cache: "no-store" });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The balance one provider's official API reports, in USD micros. Pure parsing below is exported for tests. */
export function parseBalance(slug: string, body: unknown): number | null {
  const b = asRecord(body);
  if (slug === "fal") {
    const credits = asRecord(b.credits);
    const value = Number(credits.current_balance);
    const currency = String(credits.currency ?? "USD").toUpperCase();
    return Number.isFinite(value) && currency === "USD" ? Math.round(value * 1_000_000) : null;
  }
  if (slug === "stability") {
    const value = Number(b.credits);
    // Stability sells credits at $10 per 1 000: one credit is one US cent.
    return Number.isFinite(value) ? Math.round(value * 10_000) : null;
  }
  return null;
}

export async function fetchProviderBalance(slug: string, key: string): Promise<SyncResult> {
  const spec = PROVIDER_FUNDS[slug];
  if (!spec || spec.balance !== "api") return { status: "unsupported" };
  try {
    const r = slug === "fal"
      ? await getJson("https://api.fal.ai/v1/account/billing?expand=credits", { Authorization: `Key ${key}` })
      : await getJson("https://api.stability.ai/v1/user/balance", { Authorization: `Bearer ${key}` });
    if (!r.ok) return { status: "error", error: `http_${r.status}` };
    const micros = parseBalance(slug, r.body);
    return micros === null ? { status: "error", error: "unexpected_response" } : { status: "ok", micros };
  } catch (e) {
    return { status: "error", error: e instanceof Error && e.name === "AbortError" ? "timeout" : "network" };
  }
}

/**
 * Read every AUTOMATIC provider's balance and record it (0180,
 * api_provider_sync_record). Works with an admin session or, from the cron,
 * with the server token alone — the key comes from Vault either way and never
 * leaves the server. Returns what happened per provider.
 */
export async function syncProviderBalances(
  supabase: Client,
  providers: { id: string; slug: string; mode: string; active: boolean }[],
  only?: string,
): Promise<Record<string, SyncResult["status"]>> {
  const token = dispatchToken();
  const out: Record<string, SyncResult["status"]> = {};
  for (const p of providers) {
    if (only && p.slug !== only) continue;
    if (p.mode !== "auto") continue;
    let result: SyncResult;
    if (PROVIDER_FUNDS[p.slug]?.balance !== "api") {
      result = { status: "unsupported" };
    } else {
      const key = await readProviderKey(supabase, p.id);
      result = key ? await fetchProviderBalance(p.slug, key) : { status: "not_configured" };
    }
    out[p.slug] = result.status;
    await supabase.rpc("api_provider_sync_record", {
      p_token: token ?? "",
      p_slug: p.slug,
      p_status: result.status,
      p_balance_usd_micros: result.status === "ok" ? result.micros : null,
      p_error: result.status === "error" ? result.error : null,
    });
  }
  return out;
}
