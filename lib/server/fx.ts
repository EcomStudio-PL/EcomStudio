import "server-only";
import { unstable_cache } from "next/cache";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";

/**
 * THE INFORMATIONAL ZŁOTY FIGURE — "≈ 197,98 zł" under "$49.90".
 *
 * Prices are set and charged in USD (Stripe). The złoty figure is a courtesy:
 * the NBP mid rate (table A) of the latest publication, never a fixed
 * coefficient, never what anyone is charged, and it never moves a price.
 *
 *   1. NBP's API, cached for 6 hours (one request per instance per 6 h);
 *   2. a successful reading is kept in `fx_rates` (server-token write);
 *   3. NBP unreachable → the last reading kept, shown WITH its date;
 *   4. nothing at all → null, and the page shows the dollar price alone.
 *
 * Analytics converts provider costs with the same readings (by date), which
 * is why every reading is kept rather than only the last one.
 */

export type FxRate = { rate: number; date: string; source: "NBP"; table: string | null; stale: boolean };

const NBP_URL = "https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json";
/** A reading older than this is shown with its date and called stale. */
const STALE_DAYS = 7;

type NbpAnswer = { rates?: { no?: string; effectiveDate?: string; mid?: number }[] };

async function fetchNbp(): Promise<{ rate: number; date: string; table: string | null } | null> {
  try {
    const res = await fetch(NBP_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const body = (await res.json()) as NbpAnswer;
    const row = body.rates?.[0];
    const rate = row?.mid;
    const date = row?.effectiveDate;
    if (typeof rate !== "number" || !(rate > 0) || rate > 100 || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return { rate, date, table: row?.no ?? null };
  } catch {
    return null;
  }
}

const cachedNbp = unstable_cache(fetchNbp, ["fx-nbp-usd-pln"], { revalidate: 6 * 3600 });

async function lastStored(supabase: Client): Promise<{ rate: number; date: string; table: string | null } | null> {
  const { data } = await supabase.from("fx_rates").select("rate, effective_date, table_no")
    .eq("pair", "USD/PLN").order("effective_date", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const rate = Number(data.rate);
  return rate > 0 ? { rate, date: data.effective_date, table: data.table_no ?? null } : null;
}

const isStale = (date: string) => Date.now() - Date.parse(`${date}T12:00:00Z`) > STALE_DAYS * 86400_000;

/** The USD→PLN reading the pages show, or null when none was ever had. */
export async function usdPlnRate(supabase: Client): Promise<FxRate | null> {
  const live = await cachedNbp();
  if (live) {
    const token = dispatchToken();
    // Best effort: keeping the reading must never cost the page its render.
    if (token) {
      void supabase.rpc("fx_rate_store", {
        p_token: token, p_pair: "USD/PLN", p_rate: live.rate, p_date: live.date, p_source: "NBP", p_table: live.table ?? "",
      }).then(() => undefined, () => undefined);
    }
    return { ...live, source: "NBP", stale: isStale(live.date) };
  }
  const kept = await lastStored(supabase).catch(() => null);
  return kept ? { ...kept, source: "NBP", stale: isStale(kept.date) } : null;
}

/** All kept readings in a date range, for converting historical costs. */
export async function usdPlnHistory(supabase: Client, fromIso: string): Promise<{ date: string; rate: number }[]> {
  const { data } = await supabase.from("fx_rates").select("effective_date, rate")
    .eq("pair", "USD/PLN").gte("effective_date", fromIso.slice(0, 10)).order("effective_date");
  return (data ?? []).map((r) => ({ date: r.effective_date, rate: Number(r.rate) }));
}
