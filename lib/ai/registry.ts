import "server-only";
import type { ImageProviderAdapter } from "./types";

/**
 * Provider registry. Adapters register themselves here.
 * No adapter is registered yet on purpose: no API keys are connected,
 * and EcomStudio never fakes generations. Adding a provider later means:
 *  1. implement ImageProviderAdapter in lib/ai/providers/<slug>.ts
 *  2. register it below
 *  3. activate the matching ai_models rows from the admin panel
 */
const adapters = new Map<string, ImageProviderAdapter>();

export function registerAdapter(adapter: ImageProviderAdapter) {
  adapters.set(adapter.slug, adapter);
}

export function getAdapter(slug: string): ImageProviderAdapter | undefined {
  return adapters.get(slug);
}

export function configuredAdapterSlugs(): string[] {
  return [...adapters.values()].filter((a) => a.isConfigured()).map((a) => a.slug);
}
