import { randomUUID } from "node:crypto";

/**
 * A FAKE SUPABASE CLIENT for the ice suite (npm run test:ice): in-memory
 * tables with the handful of PostgREST filters the visual editor's server
 * code uses, scripted RPCs that answer like the 0141 functions (including
 * their raised messages — 'conflict', 'conflict:<key>', 'noop', 'not_admin'),
 * a storage bucket that only knows public URLs and removals, and a log of
 * every call so a test can prove that a refused caller reached nothing.
 */

export type Row = Record<string, unknown>;
export type DbError = { message: string; code?: string };
export type RpcResult = { data: unknown; error: DbError | null };

export type DbCall =
  | { kind: "auth" }
  | { kind: "from"; table: string; op: "select" | "insert" | "update" | "delete"; ops: string[] }
  | { kind: "rpc"; name: string; args: Record<string, unknown> }
  | { kind: "storage"; bucket: string; op: "getPublicUrl" | "remove"; arg: unknown };

export const STORAGE_PUBLIC = "https://fake.supabase.test/storage/v1/object/public";

type Filter = (r: Row) => boolean;

function likeToRegex(pattern: string, flags = ""): RegExp {
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${esc}$`, flags);
}

class Query implements PromiseLike<{ data: unknown; error: DbError | null }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private returning = false;
  private one: "single" | "maybe" | null = null;
  private sorts: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private from0 = 0;
  private to0: number | null = null;

  constructor(private db: FakeDb, private table: string, private call: Extract<DbCall, { kind: "from" }>) {}

  private log(s: string) { this.call.ops.push(s); return this; }

  select(cols?: string) {
    if (this.op !== "select") this.returning = true;
    return this.log(`select(${cols ?? "*"})`);
  }
  insert(rows: Row | Row[]) {
    this.op = "insert"; this.call.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this.log("insert");
  }
  update(patch: Row) {
    this.op = "update"; this.call.op = "update"; this.patch = patch;
    return this.log("update");
  }
  delete() {
    this.op = "delete"; this.call.op = "delete";
    return this.log("delete");
  }
  eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this.log(`eq(${col},${String(v)})`); }
  neq(col: string, v: unknown) { this.filters.push((r) => r[col] !== v); return this.log(`neq(${col},${String(v)})`); }
  in(col: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[col])); return this.log(`in(${col},${vs.length})`); }
  like(col: string, p: string) { const re = likeToRegex(p); this.filters.push((r) => typeof r[col] === "string" && re.test(r[col] as string)); return this.log(`like(${col},${p})`); }
  ilike(col: string, p: string) { const re = likeToRegex(p, "i"); this.filters.push((r) => typeof r[col] === "string" && re.test(r[col] as string)); return this.log(`ilike(${col},${p})`); }
  or(expr: string) { return this.log(`or(${expr})`); }
  order(col: string, opts?: { ascending?: boolean }) { this.sorts.push({ col, asc: opts?.ascending !== false }); return this.log(`order(${col})`); }
  limit(n: number) { this.lim = n; return this.log(`limit(${n})`); }
  range(a: number, b: number) { this.from0 = a; this.to0 = b; return this.log(`range(${a},${b})`); }
  maybeSingle() { this.one = "maybe"; return this.log("maybeSingle"); }
  single() { this.one = "single"; return this.log("single"); }

  then<A = { data: unknown; error: DbError | null }, B = never>(
    onF?: ((v: { data: unknown; error: DbError | null }) => A | PromiseLike<A>) | null,
    onR?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.exec()).then(onF, onR);
  }

  private exec(): { data: unknown; error: DbError | null } {
    const err = this.db.tableErrors[this.table];
    if (err) return { data: null, error: { message: err } };
    const rows = this.db.rows(this.table);
    if (this.op === "insert") {
      const inserted = this.payload.map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }));
      rows.push(...inserted);
      if (!this.returning) return { data: null, error: null };
      return { data: this.one ? inserted[0] ?? null : inserted, error: null };
    }
    let hit = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      for (const r of hit) Object.assign(r, this.patch);
      return { data: this.returning ? hit : null, error: null };
    }
    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((r) => !hit.includes(r));
      return { data: null, error: null };
    }
    for (const s of [...this.sorts].reverse()) {
      hit = [...hit].sort((a, b) => {
        const x = String(a[s.col] ?? ""); const y = String(b[s.col] ?? "");
        return (x < y ? -1 : x > y ? 1 : 0) * (s.asc ? 1 : -1);
      });
    }
    if (this.to0 !== null) hit = hit.slice(this.from0, this.to0 + 1);
    if (this.lim !== null) hit = hit.slice(0, this.lim);
    const copy = hit.map((r) => ({ ...r }));
    if (this.one === "maybe") {
      if (copy.length > 1) return { data: null, error: { message: "multiple rows" } };
      return { data: copy[0] ?? null, error: null };
    }
    if (this.one === "single") {
      if (copy.length !== 1) return { data: null, error: { message: "not exactly one row" } };
      return { data: copy[0], error: null };
    }
    return { data: copy, error: null };
  }
}

export class FakeDb {
  user: { id: string } | null = null;
  tables: Record<string, Row[]> = {};
  tableErrors: Record<string, string> = {};
  rpcs: Record<string, (args: Record<string, unknown>) => RpcResult> = {};
  calls: DbCall[] = [];

  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table];
  }

  rpcCalls(name?: string): Extract<DbCall, { kind: "rpc" }>[] {
    return this.calls.filter((c): c is Extract<DbCall, { kind: "rpc" }> => c.kind === "rpc" && (!name || c.name === name));
  }

  tablesTouched(): string[] {
    return this.calls.flatMap((c) => (c.kind === "from" ? [c.table] : []));
  }

  removed(): unknown[] {
    return this.calls.flatMap((c) => (c.kind === "storage" && c.op === "remove" ? [c.arg] : []));
  }

  client() {
    return fakeClient(this);
  }
}

/** The client object over one FakeDb (what createClient() hands out). */
function fakeClient(db: FakeDb) {
  return {
    get user() { return db.user; },
    auth: {
      async getUser() {
        db.calls.push({ kind: "auth" });
        return { data: { user: db.user }, error: null };
      },
    },
    from(table: string) {
      const call: Extract<DbCall, { kind: "from" }> = { kind: "from", table, op: "select", ops: [] };
      db.calls.push(call);
      return new Query(db, table, call);
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      db.calls.push({ kind: "rpc", name, args });
      const fn = db.rpcs[name];
      if (!fn) return { data: null, error: { message: `function ${name} not scripted`, code: "PGRST202" } };
      return fn(args);
    },
    storage: {
      from(bucket: string) {
        return {
          getPublicUrl(path: string) {
            db.calls.push({ kind: "storage", bucket, op: "getPublicUrl", arg: path });
            return { data: { publicUrl: encodeURI(`${STORAGE_PUBLIC}/${bucket}/${path.replace(/^\/+/, "")}`) } };
          },
          async remove(paths: string[]) {
            db.calls.push({ kind: "storage", bucket, op: "remove", arg: paths });
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };
}
