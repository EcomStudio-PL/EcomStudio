"use client";
import { useSyncExternalStore } from "react";
import { awaitEngineRun } from "@/lib/engine-run-client";
import type {
  InflightEntry, InflightKind, InflightLimit, InflightResolved, InflightSnapshot, InflightStage,
} from "@/lib/inflight/types";

/**
 * GENERACJE W TOKU V2 — THE BROWSER'S ONE COPY OF WHAT IS IN PROGRESS.
 *
 * Module state, like the bell's: one per browser tab, shared by every page of
 * the app (a tool's gallery, the library, the tab title), surviving
 * client-side navigation untouched. It holds NOTHING the server has not
 * confirmed: a tile is added when a route ACCEPTS a click (or when the server
 * lists a job the page did not know about — a refresh, another tab), and it
 * changes only from the server's answers.
 *
 * ONE MECHANISM, NO SECOND ONE. A single timer asks
 * /api/generations/active, and only while something is in progress: every
 * 3 s on a visible tab, every 15 s on a hidden one, never when nothing runs.
 * A page that mounts asks once (that is how a refresh finds its jobs again).
 *
 * What the page remembers itself (sessionStorage, this tab only): which
 * tiles it is showing, the local preview, and each job's RETRY SNAPSHOT — a
 * frozen copy of the request it was started with, so "Spróbuj ponownie"
 * repeats exactly that and never reads the panel's current settings.
 */

export type RetryEndpoint = "/api/generate" | "/api/retouch" | "/api/fashion" | "/api/concepts/generate" | "/api/thumbnail" | "/api/grovshot/runs";

export type RetrySnapshot = {
  endpoint: RetryEndpoint;
  /** The request body exactly as first sent (ids for the request are renewed). */
  body: Record<string, unknown>;
  /** What it cost when it was clicked — shown in the confirmation. */
  credits: number;
};

/** An immutable copy of a click's request: later edits of the panel's
 *  state (or of the arrays it holds) can never reach a job's retry. */
export function frozenSnapshot(snapshot: RetrySnapshot): RetrySnapshot {
  return Object.freeze(JSON.parse(JSON.stringify(snapshot)) as RetrySnapshot);
}

export type InflightTile = {
  id: string;
  kind: InflightKind;
  tool: string;
  operation: string | null;
  status: "queued" | "running";
  stage: InflightStage | null;
  step: { index: number; count: number } | null;
  /** GrovShot V2: shots finished of shots planned (server fact). */
  shots?: { done: number; total: number } | null;
  startedAt: string;
  expected: number;
  ratio: string | null;
  batch: string | null;
  estimateMs: number | null;
  cancellable: boolean;
  /** A local object URL of the first input photo — never uploaded for this. */
  preview: string | null;
  snapshot: RetrySnapshot | null;
  resolved: InflightResolved | null;
  /** When this tab first showed it. */
  addedAt: number;
  /** When this tab learned how it ended (the "unclaimed" / failure clocks). */
  resolvedAt: number | null;
};

type State = {
  tiles: InflightTile[];
  limit: InflightLimit | null;
  balance: number | null;
  /** When the server last reported the balance — a refund that brings it
   *  back to the very number it was must still reach a panel that had
   *  already taken the charge off. */
  balanceAt: number;
  /** server clock − this clock, so the timer counts from the SERVER start. */
  offsetMs: number;
  seeded: boolean;
};

const EMPTY: State = { tiles: [], limit: null, balance: null, balanceAt: 0, offsetMs: 0, seeded: false };
const STORAGE_KEY = "gb.inflight.v1";
const POLL_VISIBLE_MS = 3_000;
const POLL_HIDDEN_MS = 15_000;
/** A finished tile nobody displayed (no gallery on screen) leaves after this. */
const UNCLAIMED_DONE_MS = 8_000;
/** A failed tile the customer never dismissed leaves after this. */
const FAILED_TTL_MS = 30 * 60_000;

let state: State = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
/** Polls in a row a tracked tile was absent from every answer. */
const misses = new Map<string, number>();
let restored = false;

function emit() { for (const l of listeners) l(); }

function setState(next: State) {
  state = next;
  persist();
  emit();
}

function browser(): boolean {
  return typeof window !== "undefined";
}

/* ── persistence (this tab only) ──────────────────────────────────────── */

type Saved = Omit<InflightTile, "preview"> & { preview?: null };

function persist() {
  if (!browser()) return;
  try {
    const keep: Saved[] = state.tiles
      .filter((t) => !t.resolved || t.resolved.outcome === "failed" || t.resolved.outcome === "cancelled")
      .map((t) => ({ ...t, preview: null }));
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
  } catch { /* private mode: the server still knows every active job */ }
}

function restore() {
  if (restored || !browser()) return;
  restored = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as Saved[]) : [];
    const now = Date.now();
    const tiles = (Array.isArray(saved) ? saved : [])
      .filter((t) => t && typeof t.id === "string" && (t.kind === "job" || t.kind === "run"))
      .filter((t) => !t.resolved || now - (t.resolvedAt ?? now) < FAILED_TTL_MS)
      .map((t) => ({ ...t, preview: null }));
    if (tiles.length > 0) state = { ...state, tiles };
  } catch { /* nothing usable saved */ }
}

/* ── the server's answer, merged ──────────────────────────────────────── */

function fromEntry(e: InflightEntry, prev: InflightTile | undefined): InflightTile {
  return {
    id: e.id, kind: e.kind, tool: e.tool, operation: e.operation, status: e.status,
    stage: e.stage, step: e.step, shots: e.shots ?? null, startedAt: e.startedAt, expected: e.expected, ratio: e.ratio ?? prev?.ratio ?? null,
    batch: e.batch, estimateMs: e.estimateMs, cancellable: e.cancellable,
    preview: prev?.preview ?? null, snapshot: prev?.snapshot ?? null, resolved: null,
    addedAt: prev?.addedAt ?? Date.now(), resolvedAt: null,
  };
}

export function mergeSnapshot(prev: State, snap: InflightSnapshot, localNow: number): State {
  const byId = new Map(prev.tiles.map((t) => [t.id, t]));
  const activeIds = new Set(snap.active.map((a) => a.id));
  const resolvedById = new Map(snap.resolved.map((r) => [r.id, r]));
  const next: InflightTile[] = [];
  for (const e of snap.active) next.push(fromEntry(e, byId.get(e.id)));
  for (const t of prev.tiles) {
    if (activeIds.has(t.id)) continue;
    const r = resolvedById.get(t.id);
    if (r) {
      misses.delete(t.id);
      next.push({ ...t, resolved: t.resolved ?? r, resolvedAt: t.resolvedAt ?? localNow, cancellable: false });
      continue;
    }
    if (t.resolved) { next.push(t); continue; }
    // Absent from both lists: the job is gone (deleted, another workspace).
    // A few answers in a row before it is dropped — never on one.
    const n = (misses.get(t.id) ?? 0) + 1;
    misses.set(t.id, n);
    if (n < 3) next.push(t);
    else misses.delete(t.id);
  }
  // Finished tiles nobody claimed (no gallery on screen) leave quietly: the
  // result is in every list the customer opens next. Failures stay a while.
  const kept = next.filter((t) => {
    if (!t.resolved) return true;
    const age = localNow - (t.resolvedAt ?? localNow);
    if (t.resolved.outcome === "done" || t.resolved.outcome === "partial") return age < UNCLAIMED_DONE_MS;
    return age < FAILED_TTL_MS;
  });
  return {
    tiles: kept,
    limit: snap.limit ?? prev.limit,
    balance: snap.balance ?? prev.balance,
    balanceAt: snap.balance !== null && snap.balance !== undefined ? localNow : prev.balanceAt,
    offsetMs: Date.parse(snap.serverNow) - localNow,
    seeded: true,
  };
}

/* ── polling ──────────────────────────────────────────────────────────── */

function hasActive(): boolean {
  return state.tiles.some((t) => !t.resolved);
}

function schedule() {
  if (!browser()) return;
  if (timer) { clearTimeout(timer); timer = null; }
  if (!hasActive()) return;
  const hidden = document.visibilityState === "hidden";
  timer = setTimeout(() => { timer = null; void refreshInflight(); }, hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
}

export function refreshInflight(): Promise<void> {
  if (!browser()) return Promise.resolve();
  restore();
  if (inFlight) return inFlight;
  const track = state.tiles.filter((t) => !t.resolved).map((t) => `${t.kind}:${t.id}`).slice(0, 30).join(",");
  inFlight = (async () => {
    try {
      const res = await fetch(`/api/generations/active${track ? `?track=${encodeURIComponent(track)}` : ""}`, { cache: "no-store" });
      if (!res.ok) return;
      const snap = await res.json() as InflightSnapshot;
      if (!snap?.ok) return;
      setState(mergeSnapshot(state, snap, Date.now()));
    } catch { /* offline for a moment: the next tick asks again */ }
    finally {
      inFlight = null;
      schedule();
    }
  })();
  return inFlight;
}

let wired = false;
function wire() {
  if (wired || !browser()) return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && hasActive()) void refreshInflight();
    else schedule();
  });
}

/**
 * Called by every consumer on mount. A gallery or the library asks the
 * server once (`discover`: that is how a refresh, or a new tab, finds its
 * jobs again); anything else — the tab title — asks only when this tab
 * already knows of something in progress, so an idle page costs nothing.
 */
export function seedInflight(opts: { discover?: boolean } = {}) {
  if (!browser()) return;
  wire();
  restore();
  if (state.seeded) return;
  if (opts.discover || state.tiles.some((t) => !t.resolved)) void refreshInflight();
}

/* ── what the panels and tiles do ─────────────────────────────────────── */

export type AcceptedTile = {
  id: string; kind: InflightKind; tool: string; operation: string | null;
  expected: number; ratio: string | null; startedAt?: string; batch?: string | null;
  preview?: string | null; snapshot?: RetrySnapshot | null;
};

/** A route accepted a click: the tile exists from now on. */
export function adoptAccepted(a: AcceptedTile) {
  if (!browser()) return;
  restore();
  wire();
  if (state.tiles.some((t) => t.id === a.id)) return;
  const tile: InflightTile = {
    id: a.id, kind: a.kind, tool: a.tool, operation: a.operation, status: "running",
    stage: a.kind === "job" ? "generate" : null, step: null,
    startedAt: a.startedAt ?? new Date(Date.now() + state.offsetMs).toISOString(),
    expected: Math.max(1, a.expected), ratio: a.ratio, batch: a.batch ?? null,
    estimateMs: null, cancellable: false,
    preview: a.preview ?? null, snapshot: a.snapshot ?? null, resolved: null, addedAt: Date.now(), resolvedAt: null,
  };
  setState({ ...state, tiles: [tile, ...state.tiles] });
  // The first real answer (estimate, stage, server start) right away.
  void refreshInflight();
}

/** The balance the server reported after a charge or a refund. */
export function noteBalance(balance: number | null) {
  if (balance === null) return;
  setState({ ...state, balance, balanceAt: Date.now() });
}

/** A gallery on screen takes a finished tile's results — exactly once. */
export function takeSettled(id: string): InflightResolved | null {
  const tile = state.tiles.find((t) => t.id === id);
  if (!tile?.resolved) return null;
  setState({ ...state, tiles: state.tiles.filter((t) => t.id !== id) });
  return tile.resolved;
}

export function dismissTile(id: string) {
  setState({ ...state, tiles: state.tiles.filter((t) => t.id !== id) });
}

/** Cancel — only what the server listed as cancellable (a queued run). */
export async function cancelTile(id: string): Promise<boolean> {
  const tile = state.tiles.find((t) => t.id === id);
  if (!tile?.cancellable || tile.kind !== "run") return false;
  try {
    const res = await fetch(`/api/thumbnail/runs/${id}/cancel`, { method: "POST" });
    const json = await res.json() as { ok?: boolean; state?: string };
    await refreshInflight();
    return Boolean(json.ok && (json.state === "cancelled" || json.state === "requested"));
  } catch {
    return false;
  }
}

export type SubmitOutcome =
  | { ok: true; id: string; kind: InflightKind; credits: number; workflow?: boolean }
  | { ok: false; error: string; limit?: number; missingCredits?: number; quotedTotal?: number };

type Answer = {
  ok?: boolean; accepted?: boolean; jobId?: string; credits?: number; startedAt?: string; expected?: number;
  runId?: string; created?: boolean; pending?: boolean; error?: string; limit?: number; missingCredits?: number;
  quote?: { total?: number };
};

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * SEND ONE CLICK and adopt what the server accepts. The body is the panel's
 * (or the snapshot's) — this adds only the request's own ids: a fresh
 * `requestId` (and `attempt` for Miniaturka), and `batch` when the caller
 * groups several photos of one click.
 */
export async function submitTracked(input: {
  snapshot: RetrySnapshot;
  tool: string; operation: string | null; expected: number; ratio: string | null;
  batch?: string; preview?: string | null;
}): Promise<SubmitOutcome> {
  const requestId = uuid();
  const body: Record<string, unknown> = { ...input.snapshot.body, requestId };
  if (input.batch) body.batch = input.batch;
  if (input.snapshot.endpoint === "/api/thumbnail") body.attempt = requestId;
  let json: Answer;
  try {
    const res = await fetch(input.snapshot.endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    json = await res.json() as Answer;
  } catch {
    // The answer was lost: the job may exist all the same — the next read
    // lists it (by the server's own record), never a second one from here.
    void refreshInflight();
    return { ok: false, error: "network" };
  }
  if (json.ok && json.accepted && json.jobId) {
    adoptAccepted({
      id: json.jobId, kind: "job", tool: input.tool, operation: input.operation,
      expected: json.expected ?? input.expected, ratio: input.ratio, startedAt: json.startedAt,
      batch: input.batch ?? null, preview: input.preview, snapshot: input.snapshot,
    });
    return { ok: true, id: json.jobId, kind: "job", credits: json.credits ?? 0 };
  }
  if (json.ok && json.pending && json.runId) {
    // A tool running a published WORKFLOW (Admin → Workflow ON): started and
    // charged as one run, driven by its own status endpoint. It has no tile
    // of its own; this keeps its status read going (which keeps the run
    // moving) until it ends, wherever the customer goes in the app, and the
    // result is in the gallery after that.
    void awaitEngineRun(json.runId);
    return { ok: true, id: json.runId, kind: "run", credits: json.credits ?? 0, workflow: true };
  }
  if (json.ok && json.runId && input.snapshot.endpoint === "/api/grovshot/runs") {
    // GrovShot V2: one order, analysed and planned before anything is
    // charged — each shot is charged when it is delivered.
    adoptAccepted({
      id: json.runId, kind: "run", tool: input.tool, operation: input.operation, expected: input.expected, ratio: input.ratio,
      preview: input.preview, snapshot: input.snapshot,
    });
    return { ok: true, id: json.runId, kind: "run", credits: 0 };
  }
  if (json.ok && json.runId && input.snapshot.endpoint === "/api/thumbnail") {
    adoptAccepted({
      id: json.runId, kind: "run", tool: input.tool, operation: input.operation, expected: 1, ratio: "1:1",
      preview: input.preview, snapshot: input.snapshot,
    });
    return { ok: true, id: json.runId, kind: "run", credits: json.quote?.total ?? 0 };
  }
  if (json.ok) return { ok: false, error: "unexpected_answer" };
  return {
    ok: false, error: json.error ?? "common_error", limit: json.limit, missingCredits: json.missingCredits,
    // Miniaturka answers `price_changed` with the price it WOULD charge now.
    quotedTotal: typeof json.quote?.total === "number" ? json.quote.total : undefined,
  };
}

/**
 * "SPRÓBUJ PONOWNIE": the SAME request again (its snapshot), as a NEW paid
 * operation the customer confirmed. The failed tile is replaced only once the
 * server accepts the new one.
 */
export async function retryTile(id: string, confirmedTotal?: number): Promise<SubmitOutcome> {
  const tile = state.tiles.find((t) => t.id === id);
  if (!tile?.snapshot) return { ok: false, error: "retry_unavailable" };
  // A Miniaturka retry is a NEW run of the same photos that reuses every
  // Retusz pass the failed one already paid for — so its price may be lower,
  // and the server says which (`price_changed` + the price) before anything
  // is created; the customer confirms that price and it is sent again.
  const snapshot: RetrySnapshot = tile.snapshot.endpoint === "/api/thumbnail" && tile.kind === "run"
    ? {
        ...tile.snapshot,
        body: { ...tile.snapshot.body, reuseFrom: tile.id, ...(confirmedTotal !== undefined ? { quotedTotal: confirmedTotal } : {}) },
        credits: confirmedTotal ?? tile.snapshot.credits,
      }
    : tile.snapshot;
  const out = await submitTracked({
    snapshot, tool: tile.tool, operation: tile.operation, expected: tile.expected,
    ratio: tile.ratio, preview: tile.preview,
    // A Retusz / Moda photo was one of a click's batch; its retry is a click
    // of its own.
    batch: tile.snapshot.endpoint === "/api/retouch" || tile.snapshot.endpoint === "/api/fashion" ? uuid() : undefined,
  });
  if (out.ok) dismissTile(id);
  return out;
}

/* ── reading it ───────────────────────────────────────────────────────── */

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
const getSnapshot = () => state;
/** The current state, outside React (the batch queue counts from it). */
export const getInflightState = () => state;
const getServerSnapshot = () => EMPTY;

export function useInflight(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Operations in progress, the way the plan's limit counts them: the photos
 *  of one click once, every other job and run on its own. */
export function activeOperations(tiles: InflightTile[]): number {
  const keys = new Set<string>();
  for (const t of tiles) if (!t.resolved) keys.add(t.batch ?? t.id);
  return keys.size;
}

/** For tests: start from nothing. */
export function resetInflightForTests() {
  state = EMPTY;
  misses.clear();
  if (timer) { clearTimeout(timer); timer = null; }
}
