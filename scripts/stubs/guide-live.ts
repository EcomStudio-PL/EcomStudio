import { guideState } from "./guide-state";

/**
 * Test-only stand-in (tool-guide suite) for the five modules toolIsLive asks
 * "can this tool run?": lib/server/image-tools, lib/server/retouch,
 * lib/server/engine/tool-run, lib/server/thumbnail/settings and
 * lib/server/fashion — one file behind five aliases. Each answer comes from
 * guideState and each call is recorded, so a test can prove which check a
 * tool's liveness really depends on. Nothing here reaches a provider, a price
 * or the network.
 */

export async function toolCatalogue(_supabase: unknown, opts: { admin: boolean }): Promise<{ slug: string; available: boolean }[]> {
  guideState.liveCalls.push("toolCatalogue");
  guideState.catalogueAdmin.push(opts.admin);
  return guideState.catalogue;
}

export async function retouchModel(_supabase: unknown): Promise<{ id: string } | null> {
  guideState.liveCalls.push("retouchModel");
  return guideState.retouchModel;
}

export async function engineToolConfigured(_supabase: unknown, tool: string, _strict?: boolean): Promise<boolean> {
  guideState.liveCalls.push(`engineToolConfigured:${tool}`);
  return guideState.retouchConfigured;
}

export async function readThumbnailState(_supabase: unknown): Promise<{ ready: boolean }> {
  guideState.liveCalls.push("readThumbnailState");
  if (guideState.thumbnailThrow) throw new Error("thumbnail settings unreadable");
  return { ready: guideState.thumbnailReady };
}

export async function fashionModel(_supabase: unknown): Promise<{ id: string } | null> {
  guideState.liveCalls.push("fashionModel");
  return guideState.fashionModel;
}

export async function fashionToolAvailable(_supabase: unknown, tool: string): Promise<boolean> {
  guideState.liveCalls.push(`fashionToolAvailable:${tool}`);
  return guideState.fashionAvailable[tool] ?? false;
}
