import "server-only";
import type { Client } from "@/lib/services/workspace";
import { CUSTOM_INSPIRATION_DEFAULT, customInspirationEnabled } from "@/lib/generator/studio";

/**
 * Is „Inspiracja (opcjonalnie)” on for Stwórz zdjęcie? Read from the existing
 * app_settings("generation") row (readable by every signed-in session and the
 * guest reader). A failed read is the default — OFF — never "on by accident".
 */
export async function readCustomInspirationEnabled(supabase: Client): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("app_settings").select("value").eq("key", "generation").maybeSingle();
    if (error) return CUSTOM_INSPIRATION_DEFAULT;
    return customInspirationEnabled(data?.value ?? null);
  } catch {
    return CUSTOM_INSPIRATION_DEFAULT;
  }
}
