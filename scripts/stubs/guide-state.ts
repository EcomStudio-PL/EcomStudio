/**
 * Shared, mutable state for the tool-guide suite's own stubs (npm run
 * test:guides). The ice stubs it reuses read-only keep theirs in ice-state.ts
 * (who is signed in, cookies, revalidations, audit rows, the anonymous rpc);
 * this file holds only what the guide code asks beyond that: the availability
 * switchboard and the per-tool "can it run" answers behind toolIsLive.
 */

export type GuideLiveState = {
  /** getAvailabilityMap() answer, by feature key. */
  availability: Record<string, { status: string }>;
  /** getAvailabilityMap() throws when set. */
  availabilityThrow: boolean;
  /** toolCatalogue() answer (lib/server/image-tools). */
  catalogue: { slug: string; available: boolean }[];
  /** getUsableModels' answer (lib/ai/router), for the generator's gate. */
  usableModels: { id: string; visible_custom?: boolean }[];
  /** The `admin` flag every toolCatalogue() call was given. */
  catalogueAdmin: boolean[];
  /** retouchModel() answer (lib/server/retouch). */
  retouchModel: { id: string } | null;
  /** engineToolConfigured() answer (lib/server/engine/tool-run). */
  retouchConfigured: boolean;
  /** readThumbnailState().ready (lib/server/thumbnail/settings). */
  thumbnailReady: boolean;
  /** readThumbnailState() throws when set. */
  thumbnailThrow: boolean;
  /** fashionModel() answer (lib/server/fashion). */
  fashionModel: { id: string } | null;
  /** fashionToolAvailable() answer per tool key. */
  fashionAvailable: Record<string, boolean>;
  /** Every live-check helper that was asked, in order. */
  liveCalls: string[];
};

function fresh(): GuideLiveState {
  return {
    availability: {},
    availabilityThrow: false,
    catalogue: [],
    usableModels: [{ id: "m-gen" }],
    catalogueAdmin: [],
    retouchModel: null,
    retouchConfigured: false,
    thumbnailReady: false,
    thumbnailThrow: false,
    fashionModel: null,
    fashionAvailable: {},
    liveCalls: [],
  };
}

export const guideState: GuideLiveState = fresh();

/** Back to "nothing is switched on, nothing was asked". */
export function resetGuideState(): void {
  Object.assign(guideState, fresh());
}
