/**
 * TRIAL WATERMARK — UNLOCK, ITS API AND ITS READERS. npm run test:trialwm:unlock
 *
 *   U  one unlock against a database that behaves like 0143: the clean file
 *      at the SQL target is byte-for-byte the sealed original, derivatives
 *      beside it, the asset repointed, the marked file and the blob gone, the
 *      key destroyed, one event; a second call; two concurrent calls
 *   G  the gate (R11): not entitled, Stripe says no, Stripe fails (nothing
 *      changes), the 60 s answer cache
 *   F  every non-committed outcome removes the target (R3): expired with a
 *      leftover, lease lost, finish failing, a tampered hash, a pre-planted
 *      target (R25)
 *   B  bulk: batches of 4, skip, the wall-clock budget, server-side counts,
 *      one bulk event
 *   R  the three routes: 401, a paused account, a bad id, rate limit, no-store
 *   P  the paywall and plan actions (R16), the paywall's plan cards
 *   L  the gallery projection: one state read per page, null on failure
 *   C  the checkout return (R17): only a fresh, own, still-locked asset
 *   X  the cron purge (R6): order, what is marked, isolation
 *   S  the structural pins
 *
 * Mocks only — no network, no database, no provider.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { previewPathFor, thumbPathFor } from "@/lib/thumbs";
import { newOriginalKey, sealOriginal } from "@/lib/server/trial-watermark/crypto";
import { wrapOriginalKey } from "@/lib/server/trial-watermark/keys";
import {
  BULK_BATCH, paywallPlansFrom, purgeTrialOriginals, resetLiveSubscriptionCache, trialReturnAssetId, trialStatus,
  unlockNextBatch, unlockTrialAsset,
} from "@/lib/server/trial-watermark/unlock";
import { listGalleryItems } from "@/lib/server/gallery";
import { buildPricingPage, type PlanRow } from "@/lib/server/pricing-page";
import { trialPaywallAction, trialPlanSelectedAction } from "@/app/actions/trial-watermark";
import { GET as statusRoute } from "@/app/api/trial-originals/status/route";
import { POST as unlockRoute } from "@/app/api/trial-originals/unlock/route";
import { POST as unlockAllRoute } from "@/app/api/trial-originals/unlock-all/route";
import type { Client } from "@/lib/services/workspace";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrialBulkResult, TrialUnlockResult } from "@/lib/trial-watermark/types";

let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log(`  ✓ ${name}`); }
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const read = (p: string) => readFileSync(p, "utf8");
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/* ── a database that behaves like 0143 ───────────────────────────────── */

type Row = Record<string, unknown>;
type Orig = {
  id: string; workspace_id: string; job_id: string | null; asset_id: string | null; operation: string;
  marked_path: string; object_path: string; status: string; clean_sha256: string; clean_mime: string;
  created_at: number; expires_at: number; lease_until: number | null; lease_id: string | null; target_path: string | null;
  unlocked_path: string | null;
};
type World = {
  user: { id: string } | null;
  members: Set<string>;
  tables: Record<string, Row[]>;
  storage: Record<string, Map<string, Buffer>>;
  uploads: { bucket: string; path: string; upsert: boolean }[];
  removes: { bucket: string; paths: string[] }[];
  signs: { bucket: string; paths: string[]; ttl: number }[];
  rpcCalls: { fn: string; args: Row }[];
  rpcFaults: Set<string>;
  tableFaults: Set<string>;
  originals: Orig[];
  keys: Map<string, { wrapped: string; fp: string }>;
  entitlement: Row;
  config: Row;
  beforeFinish: (() => void) | null;
  /** Per abort call: was the row's target still in storage when it came? */
  targetAtAbort: boolean[];
  order: string[];
};

const TOKEN = "server-token";
const MIN = 60_000;

function freshWorld(): World {
  const userId = randomUUID();
  return {
    user: { id: userId },
    members: new Set(),
    tables: { generation_assets: [], activity_logs: [], profiles: [], workspace_members: [], subscription_plans: [], credit_packages: [], subscriptions: [], ai_models: [], generations: [] },
    storage: { "generation-assets": new Map(), "trial-originals": new Map() },
    uploads: [], removes: [], signs: [], rpcCalls: [],
    rpcFaults: new Set(), tableFaults: new Set(),
    originals: [], keys: new Map(),
    entitlement: { entitled: true, pending: false, has_live_subscription: true, plan_slug: "pro", status: "active", provider: "manual", provider_subscription_id: null },
    config: { signed_url_ttl_seconds: 45 },
    beforeFinish: null,
    targetAtAbort: [],
    order: [],
  };
}

function getCol(r: Row, col: string): unknown {
  if (col.includes("->>")) {
    const [c, k] = col.split("->>");
    const obj = r[c!] as Row | null | undefined;
    const v = obj?.[k!];
    return v === undefined || v === null ? null : String(v);
  }
  return r[col];
}

class Query implements PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  private filters: ((r: Row) => boolean)[] = [];
  private sort: { col: string; asc: boolean }[] = [];
  private max: number | null = null;
  private head = false;
  constructor(private w: World, private table: string) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (opts?.head) this.head = true; return this; }
  eq(col: string, v: unknown) { this.filters.push((r) => getCol(r, col) === v); return this; }
  in(col: string, vs: unknown[]) { this.filters.push((r) => vs.includes(getCol(r, col))); return this; }
  gte(col: string, v: string) { this.filters.push((r) => String(getCol(r, col)) >= v); return this; }
  is(_c: string, _v: unknown) { return this; }
  or(_e: string) { return this; }
  lt(_c: string, _v: unknown) { return this; }
  gt(_c: string, _v: unknown) { return this; }
  order(col: string, o?: { ascending?: boolean }) { this.sort.push({ col, asc: o?.ascending !== false }); return this; }
  limit(n: number) { this.max = n; return this; }
  private run() {
    if (this.w.tableFaults.has(`${this.table}:select`)) return { data: null, error: { message: "boom", code: "08006" }, count: null };
    let rows = (this.w.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    for (const s of [...this.sort].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = String(getCol(a, s.col) ?? ""), y = String(getCol(b, s.col) ?? "");
        return (x < y ? -1 : x > y ? 1 : 0) * (s.asc ? 1 : -1);
      });
    }
    const count = rows.length;
    if (this.max !== null) rows = rows.slice(0, this.max);
    return { data: this.head ? null : rows, error: null, count };
  }
  async maybeSingle() {
    const r = this.run();
    if (r.error) return { data: null, error: r.error };
    return { data: (r.data as Row[])[0] ?? null, error: null };
  }
  then<A, B>(ok?: ((v: { data: unknown; error: unknown; count?: number | null }) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, no);
  }
}

const iso = (ms: number) => new Date(ms).toISOString();
const extOf = (mime: string) => (mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp");
const derivPath = (p: string, s: string) => p.replace(/\.[^./]*$/, "") + s;

function assetRow(w: World, id: string): Row | undefined {
  return w.tables.generation_assets.find((a) => a.id === id);
}
function assetWs(a: Row | undefined): string | null {
  return ((a?.generations as Row | undefined)?.workspace_id as string | undefined) ?? null;
}

function emit(w: World, ws: string, action: string, entity: string | null, meta: Row, dedupe: string | null): boolean {
  if (dedupe && w.tables.activity_logs.some((l) => l.workspace_id === ws && l.action === action && (l.metadata as Row).dedupe === dedupe)) return false;
  w.tables.activity_logs.push({
    id: randomUUID(), workspace_id: ws, actor_id: w.user?.id ?? null, action, entity_type: "trial_watermark", entity_id: entity,
    metadata: dedupe ? { ...meta, dedupe } : { ...meta }, created_at: iso(Date.now()),
  });
  return true;
}

/** The 0143 functions this module calls, with their SQL semantics. */
function rpcImpl(w: World, fn: string, a: Row): unknown {
  const now = Date.now();
  const tokenOk = a.p_token === TOKEN;
  const forbid = () => { throw new Error("forbidden"); };
  switch (fn) {
    case "trial_watermark_entitlement":
      if (!tokenOk || !w.members.has(a.p_workspace_id as string)) forbid();
      return w.entitlement;
    case "trial_watermark_config_read":
      if (!tokenOk) forbid();
      return w.config;
    case "trial_original_states": {
      const out: Row[] = [];
      for (const id of (a.p_asset_ids as string[]).slice(0, 200)) {
        const asset = assetRow(w, id);
        const ws = assetWs(asset);
        if (!asset || !ws || !w.members.has(ws)) continue;
        const o = w.originals.find((x) => x.workspace_id === ws && (x.asset_id === id || (x.asset_id === null && x.marked_path === asset.storage_path)) && x.status !== "pending");
        if (!o) continue;
        const state = o.status === "unlocked" ? "unlocked"
          : (o.status === "locked" || o.status === "unlocking") && (o.expires_at > now || (o.status === "unlocking" && (o.lease_until ?? 0) > now)) ? "locked"
            : ["locked", "unlocking", "expired"].includes(o.status) ? "expired" : "unavailable";
        out.push({
          asset_id: id, state,
          expires_at: state === "locked" ? iso(o.expires_at) : null,
          days_left: state === "locked" ? Math.max(0, Math.ceil((o.expires_at - now) / 86_400_000)) : null,
        });
      }
      return out;
    }
    case "trial_original_summary": {
      if (!w.members.has(a.p_workspace_id as string)) forbid();
      const live = w.originals.filter((o) => o.workspace_id === a.p_workspace_id && ["locked", "unlocking"].includes(o.status) && o.expires_at > now);
      return { locked: live.length, nearest_expires_at: live.length ? iso(Math.min(...live.map((o) => o.expires_at))) : null };
    }
    case "trial_original_unlock_begin": {
      if (!tokenOk) forbid();
      if (!w.user) return { state: "not_found" };
      const o = w.originals.find((x) => x.asset_id === a.p_asset_id);
      if (!o) return { state: "not_found" };
      if (!w.members.has(o.workspace_id)) return { state: "not_found" };
      const asset = assetRow(w, a.p_asset_id as string);
      const path = asset && assetWs(asset) === o.workspace_id ? asset.storage_path as string : null;
      if (o.status === "unlocked") return { state: "unlocked", storage_path: path ?? o.unlocked_path };
      if (["deleted", "orphaned", "pending"].includes(o.status) || !path) return { state: "unavailable" };
      if (o.status === "expired") return { state: "expired" };
      if (path !== o.marked_path) return { state: "unavailable" };
      // 0143: one request at a time — a live lease answers busy, never a shared target.
      if (o.status === "unlocking" && (o.lease_until ?? 0) > now) return { state: "busy" };
      if (o.expires_at <= now) return { state: "expired" };
      if (a.p_live_ok !== true || w.entitlement.entitled !== true) return { state: "not_entitled" };
      const k = w.keys.get(o.id);
      if (!k) return { state: "unavailable" };
      o.status = "unlocking";
      o.lease_until = now + 3 * MIN;
      o.lease_id = randomUUID();
      o.target_path = `${o.workspace_id}/${o.job_id ?? o.id}/u-${o.id}.${extOf(o.clean_mime)}`;
      return {
        state: "ready", original_id: o.id, workspace_id: o.workspace_id, job_id: o.job_id, object_path: o.object_path,
        wrapped_key: k.wrapped, kek_fp: k.fp, clean_sha256: o.clean_sha256, clean_mime: o.clean_mime, target_path: o.target_path,
        lease_id: o.lease_id,
      };
    }
    case "trial_original_unlock_finish": {
      if (!tokenOk) forbid();
      if (a.p_via !== "single" && a.p_via !== "bulk") throw new Error("invalid_via");
      w.beforeFinish?.();
      const o = w.originals.find((x) => x.asset_id === a.p_asset_id);
      if (!o || !w.members.has(o.workspace_id)) return { state: "not_found" };
      const asset = assetRow(w, a.p_asset_id as string);
      const path = asset && assetWs(asset) === o.workspace_id ? asset.storage_path as string : null;
      const old = [o.marked_path, derivPath(o.marked_path, "_t.webp"), derivPath(o.marked_path, "_p.webp")];
      if (o.status === "unlocked") return { state: "unlocked", already: true, storage_path: path ?? o.unlocked_path, old_paths: old, object_path: o.object_path };
      if (o.status === "deleted" || !path) return { state: "deleted" };
      if (o.status === "pending") return { state: "not_found" };
      if (o.status !== "unlocking" || o.lease_id !== a.p_lease_id || (o.lease_until ?? 0) <= Date.now() || path !== o.marked_path) return { state: "lease_lost" };
      const target = o.target_path!;
      if (a.p_thumb_path !== null && a.p_thumb_path !== derivPath(target, "_t.webp")) throw new Error("invalid_thumb_path");
      if (a.p_preview_path !== null && a.p_preview_path !== derivPath(target, "_p.webp")) throw new Error("invalid_preview_path");
      const meta = { ...(asset!.metadata as Row) };
      delete meta.thumb; delete meta.preview;
      if (a.p_thumb_path) meta.thumb = a.p_thumb_path;
      if (a.p_preview_path) meta.preview = a.p_preview_path;
      asset!.storage_path = target;
      asset!.metadata = meta;
      o.status = "unlocked"; o.unlocked_path = target; o.lease_until = null; o.lease_id = null;
      w.keys.delete(o.id);
      emit(w, o.workspace_id, "watermark_unlocked", a.p_asset_id as string,
        { asset_id: a.p_asset_id, original_id: o.id, via: a.p_via, bulk_id: a.p_bulk_id, tool: o.operation, age_days: 0 }, `unlocked:${o.id}`);
      return { state: "unlocked", already: false, storage_path: target, old_paths: old, object_path: o.object_path };
    }
    case "trial_original_unlock_abort": {
      if (!tokenOk) forbid();
      const o = w.originals.find((x) => x.asset_id === a.p_asset_id);
      if (!o || !w.members.has(o.workspace_id)) return { target_path: null, state: "not_found" };
      // What was in storage when the abort came: the holder removes first (0143).
      w.targetAtAbort.push(o.target_path ? w.storage["generation-assets"]!.has(o.target_path) : false);
      if (o.status === "unlocking" && a.p_lease_id && a.p_lease_id === o.lease_id) {
        o.status = "locked"; o.lease_until = null; o.lease_id = null;
        return { target_path: null, state: "locked" };
      }
      // Dead: never unlockable again — no request can write or commit the target.
      const dead = ["expired", "deleted", "orphaned"].includes(o.status)
        || (["locked", "unlocking"].includes(o.status) && o.expires_at <= now && !(o.status === "unlocking" && (o.lease_until ?? 0) > now));
      if (!a.p_lease_id && dead) return { target_path: o.target_path, state: o.status };
      if (o.status === "unlocking") return { target_path: null, state: "busy" };
      return { target_path: null, state: o.status };
    }
    case "trial_original_next_batch": {
      if (!tokenOk || !w.members.has(a.p_workspace_id as string)) forbid();
      const limit = Math.min(Math.max((a.p_limit as number) ?? 4, 1), 10);
      const skip = (a.p_skip as string[]) ?? [];
      const elig = w.originals
        .filter((o) => o.workspace_id === a.p_workspace_id && o.asset_id && o.expires_at > now
          && (o.status === "locked" || (o.status === "unlocking" && (o.lease_until ?? 0) <= now)) && !skip.includes(o.asset_id))
        .sort((x, y) => x.created_at - y.created_at || (x.id < y.id ? -1 : 1));
      const batch = elig.slice(0, limit);
      return { asset_ids: batch.map((o) => o.asset_id), remaining: elig.length - batch.length };
    }
    case "trial_watermark_log": {
      if (!tokenOk || !w.user || !w.members.has(a.p_workspace_id as string)) forbid();
      return emit(w, a.p_workspace_id as string, a.p_action as string, (a.p_entity_id as string | null) ?? null,
        (a.p_metadata as Row) ?? {}, (a.p_dedupe as string | null) ?? null);
    }
    case "trial_originals_mark_purged": {
      if (!tokenOk) forbid();
      w.order.push("mark_purged");
      const paths = a.p_paths as string[];
      return paths.filter((p) => !w.storage["trial-originals"]!.has(p)).length;
    }
    case "trial_originals_sweep_now":
      if (!tokenOk) forbid();
      w.order.push("sweep_now");
      return { healed: 0, orphaned: 0, released: 0, expired: 1, confirmed: 0 };
    case "trial_originals_purge_list":
      if (!tokenOk) forbid();
      w.order.push("purge_list");
      // 0143: a row whose blob is already gone is marked purged by the list
      // itself (named once here, never again); at most p_limit paths.
      return [...w.storage["trial-originals"]!.keys(), ...(w.order.filter((x) => x === "purge_list").length === 1 ? ["ws-gone/never-written.bin"] : [])]
        .slice(0, Number(a.p_limit ?? 200));
    case "trial_originals_purge_heartbeat":
      if (!tokenOk) forbid();
      w.order.push("heartbeat");
      w.tables.heartbeat = [{ report: a.p_report }];
      return true;
    default:
      throw new Error(`unexpected rpc ${fn}`);
  }
}

function fakeClient(w: World) {
  const storage = {
    from(bucket: string) {
      const store = w.storage[bucket] ??= new Map();
      return {
        async upload(path: string, bytes: Buffer, opts?: { upsert?: boolean }) {
          w.uploads.push({ bucket, path, upsert: opts?.upsert === true });
          // The clean target is stored, but its answer is lost (a 500 after the write).
          if (w.tableFaults.has(`${bucket}:upload-stored-then-500`) && /\/u-[^/]+\.(png|jpg|webp)$/.test(path)) {
            store.set(path, Buffer.from(bytes));
            return { data: null, error: { message: "gateway timeout", statusCode: "500" } };
          }
          if (w.tableFaults.has(`${bucket}:upload`)) return { data: null, error: { message: "upload failed", statusCode: "500" } };
          if (store.has(path) && opts?.upsert !== true) return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
          store.set(path, Buffer.from(bytes));
          return { data: { path }, error: null };
        },
        async download(path: string) {
          const b = store.get(path);
          return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "Object not found", statusCode: "404" } };
        },
        async remove(paths: string[]) {
          w.removes.push({ bucket, paths: [...paths] });
          if (bucket === "trial-originals") w.order.push("remove");
          if (w.tableFaults.has(`${bucket}:remove`)) return { data: null, error: { message: "remove failed" } };
          const gone = paths.filter((p) => store.delete(p));
          return { data: gone.map((name) => ({ name })), error: null };
        },
        async createSignedUrls(paths: string[], ttl: number) {
          w.signs.push({ bucket, paths: [...paths], ttl });
          return { data: paths.map((p) => ({ path: p, signedUrl: store.has(p) ? `https://signed.test/${bucket}/${p}?ttl=${ttl}` : null, error: null })), error: null };
        },
        async createSignedUrl(path: string, ttl: number) {
          w.signs.push({ bucket, paths: [path], ttl });
          return store.has(path)
            ? { data: { signedUrl: `https://signed.test/${bucket}/${path}?ttl=${ttl}&dl=1` }, error: null }
            : { data: null, error: { message: "not found" } };
        },
      };
    },
  };
  return {
    auth: { async getUser() { return { data: { user: w.user }, error: null }; } },
    from(table: string) { return new Query(w, table); },
    async rpc(fn: string, args: Row = {}) {
      w.rpcCalls.push({ fn, args });
      if (w.rpcFaults.has(fn)) return { data: null, error: { message: "connection lost", code: "08006" } };
      try {
        return { data: rpcImpl(w, fn, args), error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : "error", code: "P0001" } };
      }
    },
    storage,
  };
}

const g = globalThis as unknown as { __apiFakeDb?: unknown };
function install(w: World): Client {
  const c = fakeClient(w) as unknown as Client;
  g.__apiFakeDb = c;
  return c;
}

/** A workspace the caller belongs to (and the rows getCurrentWorkspace reads). */
function addWorkspace(w: World, member = true): string {
  const ws = randomUUID();
  if (member) {
    w.members.add(ws);
    w.tables.workspace_members.push({
      user_id: w.user!.id, workspace_id: ws, role: "owner", created_at: iso(Date.now() - w.tables.workspace_members.length),
      workspaces: { id: ws, name: "Sklep", owner_id: w.user!.id, logo_url: null, brand_color: null, company_name: null },
    });
  }
  return ws;
}

let CLEAN: Buffer;
let MARKED: Buffer;

/** A marked library asset with its sealed clean original, exactly as the pipeline leaves it. */
function addTrialAsset(w: World, ws: string, opts: { createdAgo?: number; expiresIn?: number; status?: string; clean?: Buffer } = {}) {
  const clean = opts.clean ?? CLEAN;
  const assetId = randomUUID();
  const jobId = randomUUID();
  const originalId = randomUUID();
  const markedPath = `${ws}/${jobId}/0.png`;
  const assets = w.storage["generation-assets"]!;
  assets.set(markedPath, MARKED);
  assets.set(derivPath(markedPath, "_t.webp"), Buffer.from("marked-thumb"));
  assets.set(derivPath(markedPath, "_p.webp"), Buffer.from("marked-preview"));
  const dek = newOriginalKey();
  const wrapped = wrapOriginalKey(dek, originalId);
  const blob = sealOriginal(clean, dek, ws, originalId);
  const objectPath = `${ws}/${originalId}.bin`;
  w.storage["trial-originals"]!.set(objectPath, blob);
  w.keys.set(originalId, { wrapped: wrapped.wrapped, fp: wrapped.fingerprint });
  const created = Date.now() - (opts.createdAgo ?? 60_000);
  const o: Orig = {
    id: originalId, workspace_id: ws, job_id: jobId, asset_id: assetId, operation: "generator", marked_path: markedPath,
    object_path: objectPath, status: opts.status ?? "locked", clean_sha256: sha(clean), clean_mime: "image/png",
    created_at: created, expires_at: Date.now() + (opts.expiresIn ?? 29 * 86_400_000), lease_until: null, lease_id: null, target_path: null, unlocked_path: null,
  };
  w.originals.push(o);
  w.tables.generation_assets.push({
    id: assetId, storage_path: markedPath,
    metadata: { thumb: derivPath(markedPath, "_t.webp"), preview: derivPath(markedPath, "_p.webp") },
    generations: { workspace_id: ws, generation_jobs: { settings: { operation: "image_retouch" } } },
  });
  return { assetId, jobId, originalId, markedPath, objectPath, o, target: `${ws}/${jobId}/u-${originalId}.png` };
}

/** An ordinary (never trial) library asset. */
function addPlainAsset(w: World, ws: string): string {
  const id = randomUUID();
  const p = `${ws}/${randomUUID()}/0.png`;
  w.storage["generation-assets"]!.set(p, MARKED);
  w.tables.generation_assets.push({ id, storage_path: p, metadata: {}, generations: { workspace_id: ws, generation_jobs: { settings: {} } } });
  return id;
}

const calls = (w: World, fn: string) => w.rpcCalls.filter((c) => c.fn === fn);
const events = (w: World, action: string) => w.tables.activity_logs.filter((l) => l.action === action);

/* ── Stripe, at the fetch boundary ────────────────────────────────────── */

const stripeCalls: string[] = [];
let stripeReply: { status: number; body: Row } = { status: 200, body: { id: "sub_x", status: "active" } };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.startsWith("https://api.stripe.com/")) {
    stripeCalls.push(url);
    return new Response(JSON.stringify(stripeReply.body), { status: stripeReply.status, headers: { "content-type": "application/json" } });
  }
  return realFetch(input);
}) as typeof fetch;
process.env.STRIPE_SECRET_KEY = "sk_test_unlocktests";

async function main() {
  CLEAN = await sharp({ create: { width: 96, height: 64, channels: 3, background: { r: 200, g: 40, b: 30 } } }).png().toBuffer();
  MARKED = await sharp({ create: { width: 96, height: 64, channels: 3, background: { r: 90, g: 90, b: 90 } } }).png().toBuffer();

  console.log("U. ONE UNLOCK, END TO END AGAINST 0143 SEMANTICS");
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws);
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("the answer is unlocked", r.state === "unlocked", JSON.stringify(r));
    const ok = r as Extract<TrialUnlockResult, { state: "unlocked" }>;
    check("its path is the SQL-derived target", ok.path === t.target, ok.path);
    const stored = w.storage["generation-assets"]!.get(t.target);
    check("the stored clean file is byte-for-byte the sealed original", Boolean(stored && stored.equals(CLEAN)) && sha(stored!) === t.o.clean_sha256);
    check("derivatives sit beside it, as webp",
      (await sharp(w.storage["generation-assets"]!.get(thumbPathFor(t.target))!).metadata()).format === "webp"
      && (await sharp(w.storage["generation-assets"]!.get(previewPathFor(t.target))!).metadata()).format === "webp");
    check("every write was upsert:false", w.uploads.length === 3 && w.uploads.every((u) => !u.upsert && u.bucket === "generation-assets"));
    const asset = assetRow(w, t.assetId)!;
    check("the asset points at the clean file and its derivatives",
      asset.storage_path === t.target && (asset.metadata as Row).thumb === thumbPathFor(t.target) && (asset.metadata as Row).preview === previewPathFor(t.target));
    check("the marked file and its derivatives are gone",
      ![t.markedPath, derivPath(t.markedPath, "_t.webp"), derivPath(t.markedPath, "_p.webp")].some((p) => w.storage["generation-assets"]!.has(p)));
    check("the blob is gone and marked purged",
      !w.storage["trial-originals"]!.has(t.objectPath)
      && calls(w, "trial_originals_mark_purged").some((c) => (c.args.p_paths as string[]).includes(t.objectPath)));
    check("the key is destroyed", !w.keys.has(t.originalId));
    check("begin was told live_ok=true (non-Stripe provider)", calls(w, "trial_original_unlock_begin")[0]?.args.p_live_ok === true);
    check("finish: via single, no bulk id", calls(w, "trial_original_unlock_finish")[0]?.args.p_via === "single" && calls(w, "trial_original_unlock_finish")[0]?.args.p_bulk_id === null);
    check("exactly one watermark_unlocked", events(w, "watermark_unlocked").length === 1);
    check("gallery links are 1 h, the download link the config TTL (45 s)",
      ok.url.includes("ttl=3600") && ok.thumbUrl.includes("_t.webp") && ok.previewUrl.includes("_p.webp") && ok.hasThumb
      && ok.downloadUrl.includes("ttl=45") && ok.downloadUrl.includes(t.target));
    check("no Stripe call for a non-Stripe subscription", stripeCalls.length === 0);

    const uploadsBefore = w.uploads.length;
    const again = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("a second call answers unlocked with the same file", again.state === "unlocked" && (again as typeof ok).path === t.target);
    check("…and writes nothing", w.uploads.length === uploadsBefore && events(w, "watermark_unlocked").length === 1);

    const st = await trialStatus(db, { workspaceId: ws, assetId: t.assetId });
    check("status of an unlocked asset carries a short download link",
      st.state === "unlocked" && "downloadUrl" in st && typeof st.downloadUrl === "string" && st.downloadUrl.includes("ttl=45"));
  }
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws);
    const [a, b] = await Promise.all([
      unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId }),
      unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId }),
    ]);
    check("two concurrent unlocks both answer unlocked", a.state === "unlocked" && b.state === "unlocked", `${a.state}/${b.state}`);
    check("…naming the same clean file", (a as { path?: string }).path === t.target && (b as { path?: string }).path === t.target);
    check("…which holds the original's bytes", w.storage["generation-assets"]!.get(t.target)?.equals(CLEAN) === true);
    check("…with one event and one commit", events(w, "watermark_unlocked").length === 1 && t.o.status === "unlocked");
    check("…ONE request worked on it: the other was told busy, asked again, and found it unlocked (one write, one finish)",
      w.uploads.filter((u) => u.path === t.target).length === 1 && calls(w, "trial_original_unlock_finish").length === 1
      && calls(w, "trial_original_unlock_begin").length >= 3,
      `${w.uploads.filter((u) => u.path === t.target).length} writes, ${calls(w, "trial_original_unlock_finish").length} finishes, ${calls(w, "trial_original_unlock_begin").length} begins`);
    const left = [...w.storage["generation-assets"]!.keys()].filter((p) => p.startsWith(`${ws}/`));
    check("…and nothing left behind but the clean file and its derivatives",
      left.sort().join() === [t.target, thumbPathFor(t.target), previewPathFor(t.target)].sort().join(), left.join(", "));
  }
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const other = addWorkspace(w);
    const t = addTrialAsset(w, other);
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("an asset of another of the caller's workspaces is not_found here", r.state === "not_found" && calls(w, "trial_original_unlock_begin").length === 0);
  }

  console.log("\nG. THE GATE: DATABASE, THEN STRIPE (R11)");
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws);
    w.entitlement = { entitled: false, pending: true, has_live_subscription: false, plan_slug: null, status: "incomplete", provider: "stripe", provider_subscription_id: "sub_pending" };
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("not entitled → not_entitled with the pending flag", r.state === "not_entitled" && (r as { pending: boolean }).pending === true && (r as { hasLiveSubscription: boolean }).hasLiveSubscription === false);
    check("…begin was asked with live_ok=false and refused", calls(w, "trial_original_unlock_begin")[0]?.args.p_live_ok === false && t.o.status === "locked");
    check("…Stripe was never asked", stripeCalls.length === 0);
    check("…nothing was written", w.uploads.length === 0 && assetRow(w, t.assetId)!.storage_path === t.markedPath);
  }
  {
    resetLiveSubscriptionCache();
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws);
    w.entitlement = { entitled: true, pending: false, has_live_subscription: true, plan_slug: "pro", status: "active", provider: "stripe", provider_subscription_id: "sub_canceled1" };
    stripeReply = { status: 200, body: { id: "sub_canceled1", status: "canceled" } };
    const before = stripeCalls.length;
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("a stale active row Stripe calls canceled is refused", r.state === "not_entitled", r.state);
    check("…Stripe was asked about exactly that subscription", stripeCalls.length === before + 1 && stripeCalls.at(-1)!.endsWith("/v1/subscriptions/sub_canceled1"));
    check("…and SQL was told live_ok=false", calls(w, "trial_original_unlock_begin")[0]?.args.p_live_ok === false && t.o.status === "locked");
    await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("the answer is remembered for 60 s (no second Stripe call)", stripeCalls.length === before + 1);

    stripeReply = { status: 200, body: { id: "sub_live1", status: "active" } };
    w.entitlement = { ...w.entitlement, provider_subscription_id: "sub_live1" };
    const r2 = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("Stripe active → unlocked", r2.state === "unlocked" && stripeCalls.at(-1)!.endsWith("/sub_live1"));
  }
  {
    resetLiveSubscriptionCache();
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws);
    w.entitlement = { entitled: true, pending: false, has_live_subscription: true, plan_slug: "pro", status: "active", provider: "stripe", provider_subscription_id: "sub_err1" };
    stripeReply = { status: 500, body: { error: { message: "api down", type: "api_error" } } };
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("a Stripe error → stripe_unavailable", r.state === "error" && (r as { error: string }).error === "stripe_unavailable");
    check("…and nothing changed: no begin, no write", calls(w, "trial_original_unlock_begin").length === 0 && w.uploads.length === 0 && t.o.status === "locked");
    const again = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("a failure is not remembered (asked again)", again.state === "error" && stripeCalls.filter((u) => u.endsWith("/sub_err1")).length === 2);
    w.entitlement = { ...w.entitlement, provider_subscription_id: null };
    const noId = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("a Stripe row without an id is not taken on trust", noId.state === "not_entitled");
    stripeReply = { status: 200, body: { id: "sub_x", status: "active" } };
  }
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    w.rpcFaults.add("trial_watermark_entitlement");
    const t = addTrialAsset(w, ws);
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("an entitlement read error fails closed", r.state === "error" && (r as { error: string }).error === "trial_check_failed" && calls(w, "trial_original_unlock_begin").length === 0);
  }

  console.log("\nF. EVERY UNCOMMITTED OUTCOME REMOVES THE TARGET (R3, R25)");
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws, { expiresIn: -1000 });
    // An earlier request died after writing the clean file (crash after upload).
    t.o.target_path = t.target;
    w.storage["generation-assets"]!.set(t.target, CLEAN);
    w.storage["generation-assets"]!.set(thumbPathFor(t.target), Buffer.from("t"));
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("expired → expired", r.state === "expired");
    check("…and the leftover clean target is removed", ![t.target, thumbPathFor(t.target), previewPathFor(t.target)].some((p) => w.storage["generation-assets"]!.has(p)));
    const st = await trialStatus(db, { workspaceId: ws, assetId: t.assetId });
    check("status says expired, no download", st.state === "expired" && "downloadUrl" in st && st.downloadUrl === null);
  }
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws);
    w.beforeFinish = () => { t.o.lease_until = Date.now() - 1; };
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("lease lost → unlock_failed", r.state === "error" && (r as { error: string }).error === "unlock_failed", JSON.stringify(r));
    check("…NOTHING of the target is touched (another request may own it now) and no abort is sent with the lost lease",
      w.storage["generation-assets"]!.has(t.target) && calls(w, "trial_original_unlock_abort").length === 0
      && !w.removes.some((x) => x.paths.includes(t.target)));
    check("…the asset is still the marked file", assetRow(w, t.assetId)!.storage_path === t.markedPath);
    check("…the blob and key survive", w.storage["trial-originals"]!.has(t.objectPath) && w.keys.has(t.originalId));
    w.beforeFinish = null;
    const retry = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("…and a retry (a NEW lease) then succeeds, reusing the identical target file", retry.state === "unlocked"
      && w.storage["generation-assets"]!.get(t.target)?.equals(CLEAN) === true && events(w, "watermark_unlocked").length === 1);
  }
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws);
    w.rpcFaults.add("trial_original_unlock_finish");
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("finish failing → unlock_failed", r.state === "error");
    check("…abort with OUR lease: back to locked; the target is kept (it may have committed — never removed blind)",
      calls(w, "trial_original_unlock_abort").length === 1 && calls(w, "trial_original_unlock_abort")[0]?.args.p_lease_id === calls(w, "trial_original_unlock_finish")[0]?.args.p_lease_id
      && t.o.status === "locked" && w.storage["generation-assets"]!.has(t.target));
    w.rpcFaults.delete("trial_original_unlock_finish");
    const again = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("…a retry commits that same identical file", again.state === "unlocked" && (again as { path?: string }).path === t.target
      && w.storage["generation-assets"]!.get(t.target)?.equals(CLEAN) === true);
  }
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws);
    t.o.clean_sha256 = "0".repeat(64);
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("a hash that does not match → unlock_failed, nothing written",
      r.state === "error" && !w.storage["generation-assets"]!.has(t.target) && w.uploads.length === 0 && t.o.status === "locked");
  }
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws);
    w.storage["trial-originals"]!.delete(t.objectPath);
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("a missing blob → unlock_failed, row back to locked", r.state === "error" && t.o.status === "locked" && w.uploads.length === 0);
    check("…given back with OUR lease id", typeof calls(w, "trial_original_unlock_abort")[0]?.args.p_lease_id === "string");
  }
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws);
    w.tableFaults.add("generation-assets:upload-stored-then-500");
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("the clean target stored but its answer lost → unlock_failed, row back to locked", r.state === "error" && t.o.status === "locked");
    check("…the target was removed BEFORE the abort (while our lease kept everyone else out), not after",
      w.targetAtAbort.length === 1 && w.targetAtAbort[0] === false && !w.storage["generation-assets"]!.has(t.target));
    check("…and the abort named OUR lease", typeof calls(w, "trial_original_unlock_abort")[0]?.args.p_lease_id === "string");
  }
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws);
    w.storage["generation-assets"]!.set(t.target, Buffer.from("planted by a member"));
    const r = await unlockTrialAsset(db, { workspaceId: ws, assetId: t.assetId });
    check("a pre-planted target with other bytes is removed and replaced (R25)",
      r.state === "unlocked" && w.storage["generation-assets"]!.get(t.target)!.equals(CLEAN));
  }

  console.log("\nB. BULK — BATCHES, SKIP, BUDGET, SERVER COUNTS");
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const items = Array.from({ length: 6 }, (_, i) => addTrialAsset(w, ws, { createdAgo: (10 - i) * 60_000 }));
    // The second-oldest has lost its blob: it fails and must be skipped.
    w.storage["trial-originals"]!.delete(items[1]!.objectPath);
    const bulkId = randomUUID();
    const far = Date.now() + 60_000;
    const b1 = await unlockNextBatch(db, { workspaceId: ws, bulkId, skip: [], deadline: far }) as Extract<TrialBulkResult, { state: "ok" }>;
    check(`batch 1 tries ${BULK_BATCH}: 3 unlocked, 1 failed, 2 remaining`,
      b1.state === "ok" && b1.unlocked.length === 3 && b1.failed.length === 1 && b1.failed[0]!.assetId === items[1]!.assetId && b1.remaining === 2 && !b1.done,
      JSON.stringify({ u: b1.unlocked?.length, f: b1.failed, r: b1.remaining }));
    check("…its items carry 1 h links", b1.unlocked.every((u) => u.url.includes("ttl=3600") && u.path.includes("/u-")));
    check("…one gate per batch", calls(w, "trial_watermark_entitlement").length === 1);
    const b2 = await unlockNextBatch(db, { workspaceId: ws, bulkId, skip: b1.failed.map((f) => f.assetId), deadline: far }) as Extract<TrialBulkResult, { state: "ok" }>;
    check("batch 2 (skip the failure): 2 unlocked, done", b2.unlocked.length === 2 && b2.failed.length === 0 && b2.remaining === 0 && b2.done);
    const bulk = events(w, "watermark_bulk_unlocked");
    check("one watermark_bulk_unlocked with SERVER counts (5 unlocked, 1 still locked)",
      bulk.length === 1 && (bulk[0]!.metadata as Row).unlocked === 5 && (bulk[0]!.metadata as Row).failed === 1 && (bulk[0]!.metadata as Row).dedupe === bulkId,
      JSON.stringify(bulk.map((b) => b.metadata)));
    check("finish was told via bulk with the bulk id", calls(w, "trial_original_unlock_finish").every((c) => c.args.p_via === "bulk" && c.args.p_bulk_id === bulkId));
    const b3 = await unlockNextBatch(db, { workspaceId: ws, bulkId, skip: [items[1]!.assetId], deadline: far }) as Extract<TrialBulkResult, { state: "ok" }>;
    check("a call after the end: nothing, done, no second bulk event", b3.done && b3.unlocked.length === 0 && events(w, "watermark_bulk_unlocked").length === 1);
  }
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    for (let i = 0; i < 3; i++) addTrialAsset(w, ws);
    const r = await unlockNextBatch(db, { workspaceId: ws, bulkId: randomUUID(), skip: [], deadline: Date.now() - 1 }) as Extract<TrialBulkResult, { state: "ok" }>;
    check("past the budget nothing starts, and the untried count as remaining", r.unlocked.length === 0 && r.failed.length === 0 && r.remaining === 3 && !r.done);
    check("…no unlock began", calls(w, "trial_original_unlock_begin").length === 0);
    w.entitlement = { ...w.entitlement, entitled: false };
    const n = await unlockNextBatch(db, { workspaceId: ws, bulkId: randomUUID(), skip: [], deadline: Date.now() + 60_000 });
    check("bulk for a non-entitled workspace → not_entitled, no batch read", n.state === "not_entitled" && calls(w, "trial_original_next_batch").length === 1);
  }

  console.log("\nR. THE ROUTES");
  {
    const w = freshWorld();
    install(w);
    const ws = addWorkspace(w);
    const t = addTrialAsset(w, ws);
    const noStore = (res: Response) => res.headers.get("cache-control") === "no-store";
    const post = (path: string, body: unknown) => new Request(`https://app.test${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

    const user = w.user;
    w.user = null;
    for (const [name, res] of [
      ["status", await statusRoute(new Request(`https://app.test/api/trial-originals/status?assetId=${t.assetId}`))],
      ["unlock", await unlockRoute(post("/api/trial-originals/unlock", { assetId: t.assetId }))],
      ["unlock-all", await unlockAllRoute(post("/api/trial-originals/unlock-all", {}))],
    ] as const) check(`${name}: no session → 401, no-store`, res.status === 401 && noStore(res));
    w.user = user;

    w.tables.profiles.push({ id: user!.id, blocked: true, blocked_until: null, blocked_reason: "x" });
    for (const [name, res] of [
      ["status", await statusRoute(new Request(`https://app.test/api/trial-originals/status?assetId=${t.assetId}`))],
      ["unlock", await unlockRoute(post("/api/trial-originals/unlock", { assetId: t.assetId }))],
      ["unlock-all", await unlockAllRoute(post("/api/trial-originals/unlock-all", {}))],
    ] as const) check(`${name}: a paused account → 403, no-store`, res.status === 403 && noStore(res) && (await res.json()).error === "account_blocked");
    w.tables.profiles = [];

    for (const [name, res] of [
      ["status", await statusRoute(new Request("https://app.test/api/trial-originals/status?assetId=../../etc"))],
      ["unlock", await unlockRoute(post("/api/trial-originals/unlock", { assetId: "x' or 1=1" }))],
      ["unlock-all bulkId", await unlockAllRoute(post("/api/trial-originals/unlock-all", { bulkId: "nope" }))],
      ["unlock-all skip", await unlockAllRoute(post("/api/trial-originals/unlock-all", { skip: ["nope"] }))],
      ["unlock-all skip > 200", await unlockAllRoute(post("/api/trial-originals/unlock-all", { skip: Array.from({ length: 201 }, () => randomUUID()) }))],
    ] as const) check(`${name}: a bad id → 400, no-store`, res.status === 400 && noStore(res));

    const s = await statusRoute(new Request(`https://app.test/api/trial-originals/status?assetId=${t.assetId.toUpperCase()}`));
    const sj = await s.json();
    check("status: 200, no-store, locked with days left", s.status === 200 && noStore(s) && sj.state === "locked" && sj.daysLeft === 29 && sj.entitled === true && sj.downloadUrl === null);
    const u = await unlockRoute(post("/api/trial-originals/unlock", { assetId: t.assetId, path: "evil/path.png" }));
    const uj = await u.json();
    check("unlock: 200, no-store, unlocked at the SQL target (a client path is ignored)", u.status === 200 && noStore(u) && uj.state === "unlocked" && uj.path === t.target);
    const all = await unlockAllRoute(post("/api/trial-originals/unlock-all", {}));
    const aj = await all.json();
    check("unlock-all: a bulk id is minted on the first call", all.status === 200 && noStore(all) && aj.state === "ok" && /^[0-9a-f-]{36}$/.test(aj.bulkId) && aj.done === true);

    // A distinct caller, so the other checks never trip the brake.
    w.user = { id: randomUUID() };
    w.members.clear(); w.tables.workspace_members = [];
    const ws2 = addWorkspace(w);
    const t2 = addTrialAsset(w, ws2);
    let last = 0;
    for (let i = 0; i < 121; i++) {
      last = (await statusRoute(new Request(`https://app.test/api/trial-originals/status?assetId=${t2.assetId}`))).status;
    }
    check("status rate-limits a runaway loop (121st call → 429)", last === 429);
  }

  console.log("\nP. THE PAYWALL AND THE PLAN CHOICE (R16)");
  const planRow = (slug: string, cents: number, extra: Partial<PlanRow> = {}): PlanRow => ({
    id: randomUUID(), slug, name: slug === "agency" ? "Agency" : slug.toUpperCase(), description: null,
    price_cents: cents, annual_price_cents: null, currency: "PLN", monthly_credits: cents / 10, bonus_credits: 0,
    featured: slug === "pro", features: { products: 10, workspace_members: 1, priority_queue: slug !== "starter" },
    stripe_price_id_monthly: `price_${slug}`, stripe_price_id_annual: null, stripe_price_monthly_cents: cents,
    stripe_price_annual_cents: null, stripe_sync_status: "synced", ...extra,
  });
  {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_unlocktests";
    const w = freshWorld();
    install(w);
    const ws = addWorkspace(w);
    const plans = [planRow("agency", 99900), planRow("free", 0), planRow("pro", 29900), planRow("starter", 9900)];
    w.tables.subscription_plans = plans.map((p, i) => ({ ...p, active: true, sort_order: i }));
    const t = addTrialAsset(w, ws);
    const plain = addPlainAsset(w, ws);
    const unlocked = addTrialAsset(w, ws);
    unlocked.o.status = "unlocked";

    check("bad input → error", (await trialPaywallAction({ assetId: "x", surface: "gallery" })).kind === "error"
      && (await trialPaywallAction({ assetId: t.assetId, surface: "nowhere" as "gallery" })).kind === "error");
    const nl = await trialPaywallAction({ assetId: unlocked.assetId, surface: "gallery" });
    check("an unlocked asset → not_locked/unlocked, no events", nl.kind === "not_locked" && nl.state === "unlocked" && w.tables.activity_logs.length === 0);
    const pl = await trialPaywallAction({ assetId: plain, surface: "lightbox" });
    check("an ordinary image → not_locked/not_found, no events", pl.kind === "not_locked" && pl.state === "not_found" && w.tables.activity_logs.length === 0);

    const ent = await trialPaywallAction({ assetId: t.assetId, surface: "lightbox" });
    check("entitled → entitled; only the click is logged",
      ent.kind === "entitled" && events(w, "watermark_unlock_clicked").length === 1 && events(w, "watermark_paywall_opened").length === 0);
    const click = events(w, "watermark_unlock_clicked")[0]!.metadata as Row;
    check("…the click carries asset, surface and tool", click.asset_id === t.assetId && click.surface === "lightbox" && click.tool === "image_retouch");

    resetLiveSubscriptionCache();
    w.entitlement = { entitled: true, pending: false, has_live_subscription: true, plan_slug: "pro", status: "active", provider: "stripe", provider_subscription_id: "sub_gone_pw" };
    stripeReply = { status: 200, body: { id: "sub_gone_pw", status: "canceled" } };
    const stale = await trialPaywallAction({ assetId: t.assetId, surface: "gallery" });
    check("a row Stripe already cancelled opens the paywall (same verdict as the unlock)",
      stale.kind === "paywall" && stale.hasLiveSubscription === true);
    stripeReply = { status: 200, body: { id: "sub_x", status: "active" } };
    w.tables.activity_logs = [];

    w.entitlement = { entitled: false, pending: false, has_live_subscription: false, plan_slug: null, status: null, provider: null, provider_subscription_id: null };
    const pw = await trialPaywallAction({ assetId: t.assetId, surface: "gallery" });
    check("not entitled → a paywall with a fresh id and the days left",
      pw.kind === "paywall" && /^[0-9a-f-]{36}$/.test(pw.paywallId) && pw.daysLeft === 29 && pw.pending === false);
    const paywall = pw as Extract<typeof pw, { kind: "paywall" }>;
    check("…the catalogue's paid plans, in card order", paywall.plans.map((p) => p.slug).join() === "starter,pro,agency", paywall.plans.map((p) => p.slug).join());
    check("…named as /plany names them (Agency → plans.tier.business)", paywall.plans.find((p) => p.slug === "agency")?.nameKey === "plans.tier.business");
    check("…with real prices and checkout links",
      paywall.plans.find((p) => p.slug === "pro")?.priceCents === 29900
      && paywall.plans.every((p) => p.payable && p.checkoutHref === `/checkout?kind=subscription&plan=${p.id}&period=monthly`),
      JSON.stringify(paywall.plans.map((p) => [p.slug, p.payable])));
    const opened = events(w, "watermark_paywall_opened");
    check("…paywall_opened logged once, deduplicated by the paywall id",
      opened.length === 1 && (opened[0]!.metadata as Row).dedupe === paywall.paywallId && (opened[0]!.metadata as Row).paywall_id === paywall.paywallId);

    w.tableFaults.add("subscription_plans:select");
    const noCat = await trialPaywallAction({ assetId: t.assetId, surface: "gallery" });
    check("an unreadable catalogue still opens the paywall, with no plans", noCat.kind === "paywall" && noCat.plans.length === 0);
    w.tableFaults.delete("subscription_plans:select");
    w.rpcFaults.add("trial_watermark_entitlement");
    check("an entitlement error → error", (await trialPaywallAction({ assetId: t.assetId, surface: "gallery" })).kind === "error");
    w.rpcFaults.delete("trial_watermark_entitlement");

    const pro = w.tables.subscription_plans.find((p) => p.slug === "pro")!;
    const free = w.tables.subscription_plans.find((p) => p.slug === "free")!;
    check("plan: a bad id → invalid", (await trialPlanSelectedAction({ paywallId: "x", assetId: t.assetId, planId: pro.id as string })).ok === false);
    const fr = await trialPlanSelectedAction({ paywallId: paywall.paywallId, assetId: t.assetId, planId: free.id as string });
    check("plan: the free plan → invalid", !fr.ok && fr.error === "invalid");
    const inactive = { ...planRow("legacy", 5000), active: false };
    w.tables.subscription_plans.push(inactive);
    const ia = await trialPlanSelectedAction({ paywallId: paywall.paywallId, assetId: t.assetId, planId: inactive.id });
    check("plan: an inactive plan → invalid", !ia.ok && ia.error === "invalid");
    const ok = await trialPlanSelectedAction({ paywallId: paywall.paywallId, assetId: t.assetId, planId: pro.id as string });
    check("plan: PRO → the /plany checkout link", ok.ok && ok.href === `/checkout?kind=subscription&plan=${pro.id}&period=monthly`);
    const sel = events(w, "watermark_plan_selected");
    check("…watermark_plan_selected {paywall_id, plan_slug, asset_id}, dedupe paywall|plan",
      sel.length === 1 && (sel[0]!.metadata as Row).plan_slug === "pro" && (sel[0]!.metadata as Row).asset_id === t.assetId
      && (sel[0]!.metadata as Row).paywall_id === paywall.paywallId && (sel[0]!.metadata as Row).dedupe === `${paywall.paywallId}|pro`);
    await trialPlanSelectedAction({ paywallId: paywall.paywallId, assetId: t.assetId, planId: pro.id as string });
    check("…a repeated choice writes no second event", events(w, "watermark_plan_selected").length === 1);
    const ghost = await trialPlanSelectedAction({ paywallId: randomUUID(), assetId: t.assetId, planId: pro.id as string });
    check("a paywall that was never opened: the link, but no event", ghost.ok && events(w, "watermark_plan_selected").length === 1);
  }
  {
    const base = buildPricingPage({
      plans: [planRow("starter", 9900), planRow("pro", 29900, { stripe_sync_status: "unknown" }), planRow("agency", 99900)],
      packs: [], now: Date.now(), payments: true,
      viewer: { signedIn: true, live: null, gate: null, plan: { slug: null, centsPerCredit: null }, cost: null },
    });
    const cards = paywallPlansFrom(base);
    check("cards: an unsynced Stripe price is not buyable", cards.find((c) => c.slug === "pro")?.payable === false && cards.find((c) => c.slug === "pro")?.checkoutHref === null);
    check("cards: capabilities are only what is available today (no 'soon')",
      cards.every((c) => c.capabilities.length > 0 && !c.capabilities.includes("priority") && !c.capabilities.includes("operator")),
      JSON.stringify(cards.map((c) => c.capabilities)));
    const live = paywallPlansFrom({ ...base, viewer: { ...base.viewer, hasLiveSubscription: true } });
    check("cards: a live subscription makes nothing buyable (no second plan)", live.every((c) => !c.payable && c.checkoutHref === null));
    const off = paywallPlansFrom(buildPricingPage({
      plans: [planRow("starter", 9900)], packs: [], now: Date.now(), payments: false,
      viewer: { signedIn: true, live: null, gate: null, plan: { slug: null, centsPerCredit: null }, cost: null },
    }));
    check("cards: payments off → nothing buyable", off.every((c) => !c.payable));
  }

  console.log("\nL. THE GALLERY PROJECTION");
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const t1 = addTrialAsset(w, ws);
    const t2 = addTrialAsset(w, ws, { expiresIn: -5 });
    const plain = addPlainAsset(w, ws);
    const job = { aspect_ratio: "1:1", resolution: "2K", prompt_origin: null, prompt_text: null, prompt_id: null, status: "completed", model_id: null, settings: {}, quantity: 1, credits_charged: 7, reference_image_ids: [], latency_ms: 10, ai_models: null, prompt_sessions: null, generated_prompts: null };
    w.tables.generations = [t1.assetId, t2.assetId, plain].map((aid, i) => {
      const a = assetRow(w, aid)!;
      return {
        id: randomUUID(), workspace_id: ws, favorite: false, user_note: null, created_at: iso(Date.now() - i * 1000), products: null,
        generation_jobs: job,
        generation_assets: [{ id: aid, storage_path: a.storage_path, width: 96, height: 64, asset_type: "image", metadata: a.metadata }],
      };
    });
    const page = await listGalleryItems(db, ws, { limit: 24 });
    const by = new Map(page.items.map((i) => [i.assetId, i]));
    check("three tiles", page.items.length === 3);
    check("a locked tile carries its state and days", by.get(t1.assetId)?.trial?.state === "locked" && by.get(t1.assetId)?.trial?.daysLeft === 29);
    check("an expired tile says expired", by.get(t2.assetId)?.trial?.state === "expired");
    check("an ordinary tile is trial: null", by.get(plain)?.trial === null);
    check("ONE state read for the whole page", calls(w, "trial_original_states").length === 1
      && (calls(w, "trial_original_states")[0]!.args.p_asset_ids as string[]).length === 3);
    w.rpcFaults.add("trial_original_states");
    const failed = await listGalleryItems(db, ws, { limit: 24 });
    check("a failed state read: every tile trial: null, the page still served", failed.items.length === 3 && failed.items.every((i) => i.trial === null));
  }

  console.log("\nC. THE CHECKOUT RETURN (R17)");
  {
    const w = freshWorld();
    const db = install(w);
    const ws = addWorkspace(w);
    const other = randomUUID();
    const t = addTrialAsset(w, ws);
    const foreign = addTrialAsset(w, other);
    const row = (asset: string, wsId: string, ago: number) => w.tables.activity_logs.push({
      id: randomUUID(), workspace_id: wsId, actor_id: w.user!.id, action: "watermark_plan_selected", entity_type: "trial_watermark",
      metadata: { asset_id: asset, plan_slug: "pro", paywall_id: randomUUID() }, created_at: iso(Date.now() - ago),
    });
    const ask = () => trialReturnAssetId(db, { userId: w.user!.id, workspaceId: ws });
    check("no plan chosen → no CTA", (await ask()) === null);
    row(t.assetId, ws, 25 * 3600_000);
    check("a choice older than 24 h → no CTA", (await ask()) === null);
    row(t.assetId, ws, 60_000);
    check("a fresh choice of an own locked asset → that asset", (await ask()) === t.assetId);
    row(foreign.assetId, ws, 30_000);
    check("a forged row naming another workspace's asset → no CTA", (await ask()) === null);
    row(t.assetId, other, 20_000);
    check("the latest row in another workspace → no CTA", (await ask()) === null);
    row(t.assetId, ws, 10_000);
    t.o.status = "expired";
    check("an asset that is no longer locked → no CTA", (await ask()) === null);
    const page = codeOnly(read("app/(app)/checkout/status/page.tsx"));
    check("the page passes the server's answer to StatusView",
      /trialReturnAssetId\(/.test(page) && /unlockAssetId=\{unlockAssetId\}/.test(page) && !/redirect_status\s*===/.test(page));
    const view = codeOnly(read("components/checkout/status-view.tsx"));
    check("StatusView: 'Wróć do zdjęcia' → /library?unlock=<uuid>, i18n, validated",
      view.includes("/library?unlock=${unlockAssetId}") && view.includes('t("checkout.wmReturnCta")') && /UUID\.test\(unlockAssetId\)/.test(view));
    const fails = view.slice(view.indexOf('if (state === "failed")'), view.indexOf('if (state === "paid")'));
    check("…offered in every state but a failed one", (view.match(/secondary=\{planBack\}/g) ?? []).length === 4 && !fails.includes("secondary"));
    check("…and only for a PLAN purchase (or while the kind is unknown): a credit pack or GrovNews unlocks nothing",
      /const planBack = !status\?\.kind \|\| status\.kind === "subscription" \? back : undefined;/.test(view) && !/secondary=\{back\}/.test(view));
    check("…and still only asks (checkoutStatusAction, never beginCheckout)", /checkoutStatusAction/.test(view) && !/beginCheckout/.test(view));
  }

  console.log("\nX. THE CRON PURGE (R6)");
  {
    const w = freshWorld();
    const anon = fakeClient(w) as unknown as SupabaseClient;
    w.user = null;
    w.storage["trial-originals"]!.set("ws-a/1.bin", Buffer.from("x"));
    w.storage["trial-originals"]!.set("ws-a/2.bin", Buffer.from("y"));
    const rep = await purgeTrialOriginals(anon, { budgetMs: 15_000 });
    check("order: sweep → list → remove → mark → list again (empty) → heartbeat", w.order.join(",") === "sweep_now,purge_list,remove,mark_purged,purge_list,heartbeat", w.order.join(","));
    const marked = calls(w, "trial_originals_mark_purged")[0]?.args.p_paths as string[];
    check("only what storage confirmed is marked", marked.sort().join() === "ws-a/1.bin,ws-a/2.bin" && !marked.includes("ws-gone/never-written.bin"));
    check("the report counts it, drained", rep.listed === 3 && rep.removed === 2 && rep.marked === 2 && rep.drained && rep.error === null, JSON.stringify(rep));
    check("the heartbeat carries the report", ((w.tables.heartbeat?.[0]?.report) as Row | undefined)?.removed === 2);
  }
  {
    // A day with more expiries than one list holds: round after round.
    const w = freshWorld();
    const anon = fakeClient(w) as unknown as SupabaseClient;
    w.user = null;
    for (let i = 0; i < 600; i++) w.storage["trial-originals"]!.set(`ws-c/${i}.bin`, Buffer.from("z"));
    const rep = await purgeTrialOriginals(anon, { budgetMs: 15_000 });
    check("a backlog bigger than one list (600) is drained in rounds of 500 inside the budget",
      w.storage["trial-originals"]!.size === 0 && rep.removed === 600 && rep.drained
      && calls(w, "trial_originals_purge_list").every((c) => c.args.p_limit === 500)
      && w.order.filter((x) => x === "purge_list").length === 3, JSON.stringify(rep));
    const beat = (w.tables.heartbeat?.[0]?.report ?? {}) as Row;
    check("…and the heartbeat says so (drained: true)", beat.drained === true && beat.removed === 600);
  }
  {
    const w = freshWorld();
    const anon = fakeClient(w) as unknown as SupabaseClient;
    w.rpcFaults.add("trial_originals_purge_list");
    const rep = await purgeTrialOriginals(anon, { budgetMs: 15_000 });
    check("a failed list: nothing removed, the heartbeat still written with the error",
      rep.error === "list_failed" && w.removes.length === 0 && w.order.includes("heartbeat"));
    const w2 = freshWorld();
    const anon2 = fakeClient(w2) as unknown as SupabaseClient;
    w2.rpcFaults.add("trial_originals_sweep_now");
    w2.storage["trial-originals"]!.set("ws-b/1.bin", Buffer.from("x"));
    const rep2 = await purgeTrialOriginals(anon2, { budgetMs: 15_000 });
    check("a failed sweep does not stop the purge", rep2.error === "sweep_failed" && rep2.removed === 1);
  }
  {
    const cron = codeOnly(read("app/api/cron/mail/route.ts"));
    const at = cron.indexOf("purgeTrialOriginalsNow()");
    check("the purge runs ABOVE the mailbox's early return", at > 0 && at < cron.indexOf("if (!result.ok)"));
    check("…with its own catch", /purgeTrialOriginalsNow\(\)\.catch\(/.test(cron));
    check("…through a session-less anon client", /createAnonClient\(SUPABASE_URL, SUPABASE_ANON_KEY, \{\s*auth: \{ persistSession: false/.test(cron));
    check("…inside a ~15 s budget", /budgetMs: 15_000/.test(cron));
    check("…reported in both answers", (cron.match(/trialPurge,/g) ?? []).length === 2);
  }

  console.log("\nS. STRUCTURAL PINS");
  {
    const src = codeOnly(read("lib/server/trial-watermark/unlock.ts"));
    check("unlock.ts never overwrites (no upsert:true)", !/upsert:\s*true/.test(src) && /upsert:\s*false/.test(src));
    check("every non-commit after ready gives back OUR lease through unlock_abort (lease id passed)",
      (src.match(/abortUnlock\(supabase, a\.workspaceId, a\.assetId, \{ \.\.\.lease/g) ?? []).length >= 3
      && /rpcUnlockAbort\(supabase, assetId, lease\.id\)/.test(src));
    const abortFn = src.slice(src.indexOf("async function abortUnlock("), src.indexOf("async function clearDeadTarget("));
    check("…removing our own target BEFORE the abort, while our lease keeps everyone else out",
      abortFn.indexOf("removeTarget(") > 0 && abortFn.indexOf("removeTarget(") < abortFn.indexOf("rpcUnlockAbort("));
    const fin = src.slice(src.indexOf("const finish = await rpcUnlockFinish("), src.indexOf("const f = finish.data;"));
    check("…and a lost lease touches nothing (no removal, no abort with the lost lease)",
      /finish\.ok \? null : await abortUnlock\(supabase, a\.workspaceId, a\.assetId, \{ \.\.\.lease, removeOwn: false \}\)/.test(fin)
      && !/removeOwn: true/.test(fin));
    check("a dead row's leftover target is cleared only through the lease-less cleanup",
      (src.match(/clearDeadTarget\(supabase/g) ?? []).length >= 3 && /rpcUnlockAbort\(supabase, assetId, null\)/.test(src));
    check("the removal path comes from abort's answer, not begin's", /r\.data\.targetPath/.test(src));
    check("the key is zeroed after use", /dek\.fill\(0\)/.test(src));
    check("no service role, no admin client", !/service_role|SERVICE_ROLE/.test(src));
    const gallery = codeOnly(read("lib/server/gallery.ts"));
    check("gallery: the state read sits after the projection loop, once", (gallery.match(/rpcStates\(/g) ?? []).length === 1
      && gallery.indexOf("rpcStates(") > gallery.indexOf("items.push("));
    const lib = codeOnly(read("app/(app)/library/page.tsx"));
    check("library: summary + validated ?unlock= handed to the browser",
      /rpcSummary\(supabase, workspace\.id\)/.test(lib) && /isTrialUuid\(unlockRaw\)/.test(lib) && /trialLocked=\{trialLocked\}/.test(lib) && /unlockAssetId=\{unlockAssetId\}/.test(lib));
    const act = codeOnly(read("app/actions/trial-watermark.ts"));
    check("actions: thin, catalogue from loadPricingPage, everything in try/catch",
      act.startsWith('"use server"') && /loadPricingPage\(supabase\)/.test(act) && (act.match(/try \{/g) ?? []).length === 2);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("trialwm unlock tests crashed:", e); process.exit(1); });
