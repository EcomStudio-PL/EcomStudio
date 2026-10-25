"use client";
import { useEffect } from "react";
import { getInflightState, refreshInflight, submitTracked, useInflight, type RetrySnapshot, type SubmitOutcome } from "@/lib/inflight/store";

/**
 * GENERACJE W TOKU V2 — ONE CLICK, SEVERAL PHOTOS: the batch's own pace.
 *
 * Retusz of ten photos, a GrovBase session of five shots, a Moda batch: each
 * photo is its own job (one failure refunds only itself), and the panels have
 * always sent them two at a time. They still do — but the pacing lives here,
 * at module level, not in the panel: leaving the page (client navigation)
 * does not stop a batch, and a refresh of this tab picks up what was not yet
 * sent (sessionStorage). A photo gets its tile only when the server accepts
 * it; nothing waiting here is charged, and anything that never gets sent is
 * never charged either.
 *
 * The next photo goes when one of the batch's tiles is no longer in
 * progress. A refusal for the plan's limit waits and tries again on the next
 * change; any other refusal (no credits, a closed tool) stops the batch and
 * is reported once.
 */

export type QueuedItem = {
  snapshot: RetrySnapshot;
  tool: string; operation: string | null; expected: number; ratio: string | null;
  preview: string | null;
};

type Batch = {
  id: string;
  items: QueuedItem[];
  /** Photos of this batch in flight right now (accepted, not finished). */
  maxInFlight: number;
  onRefused?: (out: Extract<SubmitOutcome, { ok: false }>) => void;
  onAccepted?: (out: Extract<SubmitOutcome, { ok: true }>) => void;
};

const STORAGE_KEY = "gb.inflight.queue.v1";
const batches = new Map<string, Batch>();
const sending = new Set<string>();
let restored = false;

function persist() {
  try {
    const out = [...batches.values()].filter((b) => b.items.length > 0)
      .map((b) => ({ id: b.id, maxInFlight: b.maxInFlight, items: b.items.map((i) => ({ ...i, preview: null })) }));
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch { /* the batch still runs in this page */ }
}

function restore() {
  if (restored || typeof window === "undefined") return;
  restored = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) as { id: string; maxInFlight: number; items: QueuedItem[] }[] : [];
    for (const b of Array.isArray(saved) ? saved : []) {
      if (b && typeof b.id === "string" && Array.isArray(b.items) && b.items.length > 0) {
        batches.set(b.id, { id: b.id, items: b.items, maxInFlight: Math.max(1, Math.min(3, b.maxInFlight || 2)) });
      }
    }
  } catch { /* nothing to resume */ }
}

/** The batch's photos the server is working on — read from the store itself,
 *  so a photo accepted a moment ago already counts. */
function countInFlight(batchId: string): number {
  return getInflightState().tiles.filter((t) => !t.resolved && t.batch === batchId).length;
}

async function pump(batchId: string) {
  const batch = batches.get(batchId);
  if (!batch || sending.has(batchId)) return;
  sending.add(batchId);
  try {
    while (batch.items.length > 0 && countInFlight(batchId) < batch.maxInFlight) {
      const item = batch.items[0];
      const out = await submitTracked({ ...item, batch: batchId });
      if (out.ok) {
        batch.items.shift();
        persist();
        batch.onAccepted?.(out);
        continue;
      }
      if (out.error === "concurrency_limit" || out.error === "network") {
        // Not charged, not lost: tried again on the next change of the store
        // — or in a while, if nothing of ours is running to change it.
        if (countInFlight(batchId) === 0) setTimeout(() => void pump(batchId), 10_000);
        break;
      }
      // A real refusal: the rest of this click is not sent.
      batches.delete(batchId);
      persist();
      batch.onRefused?.(out);
      break;
    }
    if (batch.items.length === 0) { batches.delete(batchId); persist(); }
  } finally {
    sending.delete(batchId);
  }
}

/** Every change of the store gives each waiting batch a chance to send more. */
export function pumpAll() {
  restore();
  for (const id of [...batches.keys()]) void pump(id);
}

/**
 * Queue one click's photos. Two go at once; the rest follow as those finish.
 * Returns the batch id the photos share (the plan's limit counts the click
 * once).
 */
export function enqueueBatch(input: {
  items: QueuedItem[];
  batchId?: string;
  maxInFlight?: number;
  onAccepted?: Batch["onAccepted"];
  onRefused?: Batch["onRefused"];
}): string {
  restore();
  const id = input.batchId ?? crypto.randomUUID();
  batches.set(id, {
    id, items: [...input.items], maxInFlight: Math.max(1, Math.min(3, input.maxInFlight ?? 2)),
    onAccepted: input.onAccepted, onRefused: input.onRefused,
  });
  persist();
  void pump(id);
  return id;
}

/** Photos of a click still waiting to be sent (never charged). */
export function waitingCount(): number {
  restore();
  let n = 0;
  for (const b of batches.values()) n += b.items.length;
  return n;
}

/**
 * The store's view, wired once (by the layout's in-progress title): counts the
 * batch's photos in progress and pumps every waiting batch whenever a tile
 * changes — and once at load, which is how a refreshed tab resumes.
 */
export function useBatchPump() {
  const { tiles, seeded } = useInflight();
  useEffect(() => { resumeBatches(); }, []);
  useEffect(() => { if (seeded) pumpAll(); }, [tiles, seeded]);
}

/** A resumed batch needs the store's first answer before it can count. */
export function resumeBatches() {
  restore();
  if (batches.size > 0) void refreshInflight();
}
