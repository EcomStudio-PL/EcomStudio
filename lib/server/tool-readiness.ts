import "server-only";
import type { Client } from "@/lib/services/workspace";
import { featureForPhotoTool, featureForToolSlug, type FeatureKey } from "@/lib/features";
import { TOOLS, isPhotoTool, toolBySlug } from "@/lib/images/tools";
import { toolCatalogue } from "@/lib/server/image-tools";
import type { ToolReadiness } from "@/lib/tool-readiness-admin";

/**
 * WHY A TOOL CAN OR CANNOT RUN, PER ADMIN SWITCH — for the operator's eyes only.
 *
 * The status an operator saves (feature_availability) says whether customers
 * may use a tool; this says whether it CAN run. It is read from the same
 * toolCatalogue the customer surfaces read, in customer mode (a test key is
 * not "ready" for a customer), and refined with the provider row and the
 * credential metadata (never the secret) so "no key" and "a key on a provider
 * that is switched off" are told apart. Admin session only: the credentials
 * table is admin-only under RLS. Nothing here changes a status, a price or a
 * provider.
 */

/** The admin switch that owns a tool: a photo tool its own key; any other
 *  the one the run API uses (`format` → Zmień rozmiar). Tools that only ride
 *  on the hub's switch, or on the editor's (its shadow step), are skipped —
 *  one tool's provider must not speak for a switch that governs many. The
 *  editor itself still speaks for its own switch. */
function featureOfTool(slug: string): FeatureKey | null {
  if (isPhotoTool(slug)) return featureForPhotoTool(slug);
  const key = featureForToolSlug(slug);
  return key === "tools" || (key === "editor" && slug !== "editor") ? null : key;
}

export async function readToolReadiness(supabase: Client): Promise<Partial<Record<FeatureKey, ToolReadiness>>> {
  try {
    return await readinessOf(supabase);
  } catch {
    // A diagnostic, not a gate: when it cannot be read the panel shows the
    // statuses without it rather than failing the whole page.
    return {};
  }
}

async function readinessOf(supabase: Client): Promise<Partial<Record<FeatureKey, ToolReadiness>>> {
  const [catalogue, providers, credentials] = await Promise.all([
    toolCatalogue(supabase),
    supabase.from("ai_providers").select("id, slug, name, active"),
    supabase.from("ai_provider_credentials").select("provider_id, active"),
  ]);
  const rows = (providers.data ?? []) as { id: string; slug: string; name: string | null; active: boolean }[];
  const withKey = new Set((credentials.data ?? []).filter((c) => c.active).map((c) => c.provider_id));

  const out: Partial<Record<FeatureKey, ToolReadiness>> = {};
  for (const tool of TOOLS) {
    const key = featureOfTool(tool.slug);
    if (!key) continue;
    const entry = catalogue.find((c) => c.slug === tool.slug);
    if (!entry) continue;
    const pinned = toolBySlug(tool.slug)?.provider ?? null;
    const row = pinned ? rows.find((r) => r.slug === pinned) : undefined;
    const nameOf = (slug: string, r?: { name: string | null }) => r?.name?.trim() || slug.charAt(0).toUpperCase() + slug.slice(1);
    const provider = pinned ? nameOf(pinned, row) : null;
    let vendor: string | null = null;
    const providerActive = row ? row.active : null;

    let state: ToolReadiness["state"] = "ready";
    if (!entry.available) {
      state = entry.reason === "disabled" ? "service_disabled"
        : entry.reason === "maintenance" ? "service_maintenance"
          : entry.reason === "sandbox" ? "sandbox"
            // A key that exists on a provider switched off is one click away;
            // no key at all is the bigger job, so it is named first.
            : row && withKey.has(row.id) && !row.active ? "provider_inactive"
              // Provider on and a key saved, yet the runner found none: it was
              // saved under a minute ago (the key cache), or it cannot be read.
              : row && withKey.has(row.id) && row.active ? "key_pending"
                : "no_key";
      // Only a Photoroom key is ever a test key (isSandbox), so an unpinned
      // tool held back by one still has a vendor to name — for the cause
      // only: `provider` stays "the vendor it is pinned to".
      if (state === "sandbox" && !provider) vendor = nameOf("photoroom", rows.find((r) => r.slug === "photoroom"));
    }
    // One switch, several tools: the first one that cannot run is what the operator needs to know.
    const prev = out[key];
    if (!prev || prev.state === "ready") out[key] = { state, provider, providerActive, ...(vendor ? { vendor } : {}) };
  }
  return out;
}
