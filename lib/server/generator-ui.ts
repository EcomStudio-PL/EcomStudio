import "server-only";
import type { Client } from "@/lib/services/workspace";

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

export async function getSessionPreviews(supabase: Client): Promise<SessionPreviews> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "generator_ui").maybeSingle();
  const v = (data?.value ?? {}) as Record<string, unknown>;
  return {
    advertising: safeMediaUrl(v.advertising_session_preview) ?? EMPTY.advertising,
    lifestyle: safeMediaUrl(v.lifestyle_session_preview) ?? EMPTY.lifestyle,
  };
}
