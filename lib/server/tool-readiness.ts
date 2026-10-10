import "server-only";
import type { Client } from "@/lib/services/workspace";
import { featureDescriptor, featureForHref, featureForPhotoTool, type FeatureKey } from "@/lib/features";
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
 *  tool the registry entry whose route is exactly `/tools/<slug>`, if any. */
function featureOfTool(slug: string): FeatureKey | null {
  if (isPhotoTool(slug)) return featureForPhotoTool(slug);
  const href = `/tools/${slug}`;
  const key = featureForHref(href);
  return key && featureDescriptor(key)?.path === href ? key : null;
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
    const provider = pinned ? (row?.name?.trim() || pinned.charAt(0).toUpperCase() + pinned.slice(1)) : null;
    const providerActive = row ? row.active : null;

    let state: ToolReadiness["state"] = "ready";
    if (!entry.available) {
      state = entry.reason === "disabled" ? "service_disabled"
        : entry.reason === "maintenance" ? "service_maintenance"
          : entry.reason === "sandbox" ? "sandbox"
            // A key that exists on a provider switched off is one click away;
            // no key at all is the bigger job, so it is named first.
            : row && withKey.has(row.id) && !row.active ? "provider_inactive"
              : "no_key";
    }
    // One switch, several tools: the first one that cannot run is what the operator needs to know.
    const prev = out[key];
    if (!prev || prev.state === "ready") out[key] = { state, provider, providerActive };
  }
  return out;
}
