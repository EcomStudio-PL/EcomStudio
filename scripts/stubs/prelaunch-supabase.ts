/**
 * Test-only fake Supabase clients (scripts/prelaunch-server-tests.ts).
 *
 * One small query builder answers every `from(...)` chain the code under test
 * uses (select / insert / update / upsert / delete, eq / in / order / limit,
 * maybeSingle / single / plain await) and `rpc(name, args)`. Every call is
 * logged in order, and the answer comes from the handlers the suite installs —
 * so a test states the database's reply and then reads back exactly what the
 * route asked for, in what order.
 *
 * Aliased twice: as @/lib/supabase/server (the session client — async
 * createClient) via ./prelaunch-supabase-server.ts, and as @supabase/supabase-js
 * (the anonymous client the cached readers build — sync createClient).
 */

export type DbResult = { data: unknown; error: { message: string; code?: string } | null };
export type FromCall = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
  filters: [string, string, unknown][];
  mode: "many" | "maybeSingle" | "single";
};
export type RpcCall = { fn: string; args: Record<string, unknown> | undefined };
export type LogEntry = { kind: "from"; call: FromCall } | { kind: "rpc"; call: RpcCall };

export type FakeHandlers = {
  user?: { id: string; email?: string } | null;
  from?: (call: FromCall) => DbResult | undefined;
  rpc?: (fn: string, args: Record<string, unknown> | undefined) => DbResult | undefined | Promise<DbResult | undefined>;
};

export type FakeDb = {
  log: LogEntry[];
  rpcs: (fn?: string) => RpcCall[];
  froms: (table?: string) => FromCall[];
  handlers: FakeHandlers;
  client: Record<string, unknown>;
};

export function makeFakeDb(handlers: FakeHandlers = {}): FakeDb {
  const log: LogEntry[] = [];
  const db: FakeDb = {
    log,
    handlers,
    rpcs: (fn) => log.filter((e): e is { kind: "rpc"; call: RpcCall } => e.kind === "rpc")
      .map((e) => e.call).filter((c) => !fn || c.fn === fn),
    froms: (table) => log.filter((e): e is { kind: "from"; call: FromCall } => e.kind === "from")
      .map((e) => e.call).filter((c) => !table || c.table === table),
    client: {},
  };

  const from = (table: string) => {
    const call: FromCall = { table, op: "select", filters: [], mode: "many" };
    const exec = async (mode: FromCall["mode"]): Promise<DbResult> => {
      call.mode = mode;
      log.push({ kind: "from", call: { ...call, filters: [...call.filters] } });
      const r = db.handlers.from?.(call);
      if (r) return r;
      return { data: mode === "many" && call.op === "select" ? [] : null, error: null };
    };
    const b = {
      select(_cols?: string) { return b; },
      insert(payload: unknown) { call.op = "insert"; call.payload = payload; return b; },
      update(payload: unknown) { call.op = "update"; call.payload = payload; return b; },
      upsert(payload: unknown) { call.op = "upsert"; call.payload = payload; return b; },
      delete() { call.op = "delete"; return b; },
      eq(col: string, val: unknown) { call.filters.push(["eq", col, val]); return b; },
      neq(col: string, val: unknown) { call.filters.push(["neq", col, val]); return b; },
      in(col: string, val: unknown) { call.filters.push(["in", col, val]); return b; },
      is(col: string, val: unknown) { call.filters.push(["is", col, val]); return b; },
      gte(col: string, val: unknown) { call.filters.push(["gte", col, val]); return b; },
      lte(col: string, val: unknown) { call.filters.push(["lte", col, val]); return b; },
      not() { return b; },
      order() { return b; },
      limit() { return b; },
      range() { return b; },
      maybeSingle() { return exec("maybeSingle"); },
      single() { return exec("single"); },
      then<T1 = DbResult, T2 = never>(
        ok?: ((v: DbResult) => T1 | PromiseLike<T1>) | null,
        bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) {
        return exec("many").then(ok, bad);
      },
    };
    return b;
  };

  db.client = {
    auth: {
      getUser: async () => ({ data: { user: db.handlers.user ?? null }, error: null }),
    },
    from,
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      log.push({ kind: "rpc", call: { fn, args } });
      const r = await db.handlers.rpc?.(fn, args);
      return r ?? { data: null, error: null };
    },
  };
  return db;
}

const g = globalThis as unknown as { __prelaunchSession?: FakeDb; __prelaunchAnon?: FakeDb };

export function installSession(db: FakeDb): void { g.__prelaunchSession = db; }
export function installAnon(db: FakeDb): void { g.__prelaunchAnon = db; }

/** @supabase/supabase-js — the anonymous client the cached readers build. */
export function createClient(_url?: string, _key?: string, _opts?: unknown) {
  if (!g.__prelaunchAnon) throw new Error("no anon fake installed");
  return g.__prelaunchAnon.client;
}
