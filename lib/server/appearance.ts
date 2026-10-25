import "server-only";
import type { Client } from "@/lib/services/workspace";

/**
 * ULUBIONE V2 — the favourite ring around a liked tile. ON unless an admin
 * turned it off: Zaawansowane → general → favorite_ring (0160 adds the field
 * as true). Only the ring follows it; the red heart and the like itself never
 * change. A row that cannot be read is the default, ON.
 */
export async function favoriteRingEnabled(supabase: Client): Promise<boolean> {
  try {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "general").maybeSingle();
    const value = (data?.value ?? {}) as Record<string, unknown>;
    return value.favorite_ring !== false;
  } catch {
    return true;
  }
}
