import "server-only";
import type { ImageProviderAdapter } from "./types";
import { googleAdapter } from "./providers/google";
import { falAdapter } from "./providers/fal";
import { openaiAdapter } from "./providers/openai";

/**
 * Provider registry. An adapter alone does not make a model usable — the
 * router additionally requires an active, admin-saved credential in the
 * encrypted credential store. No key, no model, no fake generations.
 */
const adapters = new Map<string, ImageProviderAdapter>(
  [googleAdapter, falAdapter, openaiAdapter].map((a) => [a.slug, a])
);

export function getAdapter(slug: string): ImageProviderAdapter | undefined {
  return adapters.get(slug);
}

export function registeredAdapterSlugs(): string[] {
  return [...adapters.keys()];
}
