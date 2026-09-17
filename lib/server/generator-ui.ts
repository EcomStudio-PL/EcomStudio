import "server-only";
import type { Client } from "@/lib/services/workspace";
import { loadSlots } from "@/lib/server/media-slots";

/**
 * GENERATOR UI SETTINGS — the two session tiles ("Sesja reklamowa" /
 * "Sesja lifestyle") carry a preview slot at the top that shows what each
 * mode produces. What plays there is admin configuration, never a
 * hard-coded asset: `app_settings.generator_ui` holds one URL per slot and
 * the admin swaps it from /admin/system whenever the showcase material
 * changes. An empty slot renders a quiet placeholder, not a broken player.
 */
export type SessionPreviews = {
  advertising: string | null;
  lifestyle: string | null;
};

const EMPTY: SessionPreviews = { advertising: null, lifestyle: null };

/**
 * Only an https URL or a genuinely same-origin path may reach a <video>/
 * <img> src. The path case is resolved against a fixed base and accepted
 * only if it STAYS on that base: a prefix check would wave through
 * "/\\evil.example/x.mp4", which browsers read as protocol-relative.
 */
const BASE = "https://placeholder.invalid";
function safeMediaUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(v, BASE);
    if (u.protocol !== "https:") return null;
    if (u.origin === BASE) return v.startsWith("/") ? u.pathname + u.search : null;
    return u.toString();
  } catch {
    return null;
  }
}

const ADVERTISING_SLOT = "generator.session.advertising.preview";
const LIFESTYLE_SLOT = "generator.session.lifestyle.preview";

/**
 * The slot first, the old setting second.
 *
 * These two previews predate the media slot system and already worked the way
 * it works: an admin-set URL, swapped without a deploy. Now they are set from
 * Media → Sekcje aplikacji like every other picture in the product, and the
 * `app_settings.generator_ui` value stays as the fallback — so an installation
 * that configured them years ago keeps exactly what it had until somebody
 * deliberately replaces it.
 */
export async function getSessionPreviews(supabase: Client): Promise<SessionPreviews> {
  const [{ data }, slots] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "generator_ui").maybeSingle(),
    loadSlots(supabase, [ADVERTISING_SLOT, LIFESTYLE_SLOT]),
  ]);
  const v = (data?.value ?? {}) as Record<string, unknown>;
  const fromSlot = (key: string) => slots.get(key)?.desktop ?? null;
  return {
    advertising: fromSlot(ADVERTISING_SLOT)
      ?? safeMediaUrl(v.advertising_session_preview) ?? EMPTY.advertising,
    lifestyle: fromSlot(LIFESTYLE_SLOT)
      ?? safeMediaUrl(v.lifestyle_session_preview) ?? EMPTY.lifestyle,
  };
}
