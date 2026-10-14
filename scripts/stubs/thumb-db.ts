/**
 * MINIATURKA TEST DATABASE — one in-memory world shared by the stubs of
 * scripts/thumbnail-tests.ts (run store, ledger, settings, provider trace) and
 * the fake Supabase client the test builds. Semantics mirror the SQL they
 * stand in for (0129 run/step functions, 0100/0101 ledger) closely enough to
 * test billing, leases and idempotency — never a real database or network.
 */
export type Row = Record<string, unknown>;

export type ThumbDb = {
  now: number;
  seq: number;
  runs: Map<string, Row>;
  steps: Row[];
  tables: Record<string, Row[]>;
  storage: Map<string, Buffer>;
  wallet: { id: string; workspace_id: string; balance: number };
  events: Row[];
  usageCalls: { kind: "start" | "complete" | "fail"; args: Row }[];
  providerCalls: Row[];
  env: {
    ready: boolean;
    blockers: string[];
    thumbnailCredits: number | null;
    retouch: { available: true; unit: number; resolution: string } | { available: false; reason: string };
    promptText: string;
    promptVersion: number;
    promptDigest: string;
    approved: boolean;
    credential: { apiKey: string; baseUrl: string | null } | null;
    config: Row;
  };
};

const g = globalThis as unknown as { __THUMB_DB?: ThumbDb };

export function freshDb(): ThumbDb {
  g.__THUMB_DB = {
    now: Date.parse("2026-10-14T12:00:00Z"),
    seq: 0,
    runs: new Map(),
    steps: [],
    tables: { generation_jobs: [], generations: [], generation_assets: [], notifications: [], credit_wallets: [] },
    storage: new Map(),
    wallet: { id: "wallet-1", workspace_id: "ws-1", balance: 1000 },
    events: [],
    usageCalls: [],
    providerCalls: [],
    env: {
      ready: true, blockers: [], thumbnailCredits: 20,
      retouch: { available: true, unit: 7, resolution: "2K" },
      promptText: "P", promptVersion: 1, promptDigest: "d".repeat(64), approved: true,
      credential: { apiKey: "sk-test-key", baseUrl: null },
      config: {},
    },
  };
  return g.__THUMB_DB;
}

export function db(): ThumbDb {
  if (!g.__THUMB_DB) freshDb();
  return g.__THUMB_DB!;
}

export function id(prefix: string): string {
  const d = db();
  d.seq += 1;
  const hex = d.seq.toString(16).padStart(12, "0");
  // A real UUID shape (hex only) — the routes validate ids as UUIDs.
  const tag = Buffer.from(prefix).toString("hex").padEnd(8, "0").slice(0, 8);
  return `${tag}-0000-4000-8000-${hex}`;
}

export const iso = (ms: number) => new Date(ms).toISOString();
