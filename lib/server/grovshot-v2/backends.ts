import "server-only";
import type { Client } from "@/lib/services/workspace";
import type { VisionBackend, VisionProvider } from "@/lib/ai/engine/vision";
import { readProviderKey } from "@/lib/server/provider-credentials";
import { dispatchToken } from "@/lib/server/server-token";
import { STAGE_ROLES, type EngineConfig, type StageModelRef, type StageProvider, type StageRole } from "@/lib/grovshot-v2/config";

/**
 * GROVBASE SHOT V2 — WHICH MODEL ANSWERS EACH ROLE.
 *
 * Exactly what the published config names: the role's model, then its
 * fallback ONLY when an admin wrote one. Nothing else is ever asked — not
 * the V1 planner chain, not "another provider that happens to have a key".
 * A provider is usable when it is ACTIVE in the provider panel and its key
 * opens (the vault, through the same runtime door every generation uses);
 * an admin can switch a provider off without deleting its key, and every
 * role on it then stops with a named reason instead of moving elsewhere.
 */

export type ProviderState = "ok" | "inactive" | "no_key";
export type RoleBackend = { ref: StageModelRef; isFallback: boolean };
export type RoleStatus = {
  role: StageRole;
  primary: StageModelRef & { state: ProviderState };
  fallback: (StageModelRef & { state: ProviderState }) | null;
  /** At least one configured model can be asked right now. */
  usable: boolean;
};

const PROVIDER_SLUGS: Record<StageProvider, VisionProvider> = { anthropic: "anthropic", openai: "openai", google: "google" };

/** One provider's runtime credential, or why there is none. */
export async function credentialOf(
  supabase: Client, slug: StageProvider,
): Promise<{ state: ProviderState; apiKey?: string; baseUrl?: string | null }> {
  const { data: provider } = await supabase.from("ai_providers").select("id, active").eq("slug", slug).maybeSingle();
  if (!provider || !provider.active) return { state: "inactive" };
  const { data: rows } = await supabase.rpc("provider_credential_read", { p_token: dispatchToken() ?? "", p_provider_id: provider.id });
  const cred = Array.isArray(rows) ? rows[0] : null;
  if (!cred) return { state: "no_key" };
  const apiKey = await readProviderKey(supabase, provider.id, cred);
  return apiKey ? { state: "ok", apiKey, baseUrl: cred.base_url ?? null } : { state: "no_key" };
}

export type RoleBackends = { backends: Record<StageRole, VisionBackend[]>; status: RoleStatus[] };

/** Every role's backends, each provider's key opened once. */
export async function roleBackends(supabase: Client, models: EngineConfig["models"]): Promise<RoleBackends> {
  const wanted = new Set<StageProvider>();
  for (const role of STAGE_ROLES) {
    const m = models[role];
    if (m) { wanted.add(m.provider); if (m.fallback) wanted.add(m.fallback.provider); }
  }
  const creds = new Map<StageProvider, Awaited<ReturnType<typeof credentialOf>>>();
  await Promise.all([...wanted].map(async (p) => {
    creds.set(p, await credentialOf(supabase, p).catch(() => ({ state: "no_key" as const })));
  }));
  const backendOf = (ref: StageModelRef): VisionBackend | null => {
    const c = creds.get(ref.provider);
    if (!c || c.state !== "ok" || !c.apiKey) return null;
    return {
      provider: PROVIDER_SLUGS[ref.provider], cred: { apiKey: c.apiKey, baseUrl: c.baseUrl ?? null },
      model: ref.model, ...(ref.provider === "anthropic" && ref.effort ? { effort: ref.effort } : {}),
    };
  };
  const backends = {} as Record<StageRole, VisionBackend[]>;
  const status: RoleStatus[] = [];
  for (const role of STAGE_ROLES) {
    const m = models[role];
    if (!m) {
      backends[role] = [];
      continue;
    }
    const list = [backendOf(m), m.fallback ? backendOf(m.fallback) : null].filter((b): b is VisionBackend => b !== null);
    backends[role] = list;
    status.push({
      role,
      primary: { ...m, fallback: undefined, state: creds.get(m.provider)?.state ?? "no_key" } as StageModelRef & { state: ProviderState },
      fallback: m.fallback ? { ...m.fallback, state: creds.get(m.fallback.provider)?.state ?? "no_key" } : null,
      usable: list.length > 0,
    });
  }
  return { backends, status };
}
