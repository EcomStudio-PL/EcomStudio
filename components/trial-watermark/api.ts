"use client";
import type { TrialBulkResult, TrialStatusResult, TrialUnlockResult, TrialUnlockSurface } from "@/lib/trial-watermark/types";
import { parseBulk, parseStatus, parseUnlock } from "./model";

/**
 * The three trial-originals routes, as the dialogs call them. Every answer is
 * read through the parsers in ./model — a body that is not the documented
 * shape is an error, never a guess — and nothing is cached: these replies
 * carry signed links and entitlement, both of which go stale on purpose.
 */

async function readJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

/** One asset's state, entitlement and (once unlocked) a fresh download link. Null = could not ask. */
export async function fetchTrialStatus(assetId: string): Promise<TrialStatusResult | null> {
  try {
    const res = await fetch(`/api/trial-originals/status?assetId=${encodeURIComponent(assetId)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return parseStatus(await readJson(res));
  } catch { return null; }
}

/** Unlock one image. Idempotent on the server: an already-unlocked image answers with fresh links. */
export async function postTrialUnlock(assetId: string, surface: TrialUnlockSurface): Promise<TrialUnlockResult> {
  try {
    const res = await fetch("/api/trial-originals/unlock", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ assetId, surface }),
    });
    return parseUnlock(await readJson(res), res.status);
  } catch { return { state: "error", error: "network" }; }
}

/** One batch of "unlock everything". The first call sends no bulkId; the server mints one. */
export async function postTrialUnlockAll(bulkId: string | null, skip: string[]): Promise<TrialBulkResult> {
  try {
    const res = await fetch("/api/trial-originals/unlock-all", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify(bulkId ? { bulkId, skip } : { skip }),
    });
    return parseBulk(await readJson(res), res.status);
  } catch { return { state: "error", error: "network" }; }
}

/** A wait that a closed dialog can walk away from. */
export function pause(ms: number, alive: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(alive()), ms);
  });
}
