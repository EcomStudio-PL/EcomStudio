import { randomUUID } from "node:crypto";

/**
 * A FAKE SUPABASE CLIENT for the tool-guide suite (npm run test:guides).
 *
 * Modelled on scripts/stubs/ice-fake-db.ts, plus what the guide code needs on
 * top of it:
 *   · filters on an EMBEDDED resource and a JSON field — PostgREST's
 *     `generation_jobs.status` and `generation_jobs.settings->>operation`
 *     (lib/services/tool-guides.ts hasToolResults);
 *   · per-table, per-operation errors (a read that fails, an insert that hits
 *     a unique violation) and per-table CHECK constraints;
 *   · PostgREST's timestamp FORMAT on write (`…+00:00`, trailing zeros of the
 *     fraction dropped), so a test can see what a client reading the row back
 *     really receives;
 *   · a hook run before an UPDATE matches, to stage a concurrent writer;
 *   · the payload of every insert/update in the call log.
 */

export type Row = Record<string, unknown>;
export type DbError = { message: string; code?: string };
export type RpcResult = { data: unknown; error: DbError | null };
type Op = "select" | "insert" | "update" | "delete";

export type DbCall =
  | { kind: "auth" }
  | { kind: "from"; table: string; op: Op; ops: string[]; payload?: unknown }
  | { kind: "rpc"; name: string; args: Record<string, unknown> };

/** How PostgREST prints a timestamptz in UTC: `2026-10-16T12:00:00.12+00:00`. */
export function pgTimestamp(value: string): string {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return value;
  const iso = new Date(t).toISOString();
  const [main, frac = ""] = iso.slice(0, -1).split(".");
  const f = frac.replace(/0+$/, "");
  return `${main}${f ? `.${f}` : ""}+00:00`;
}

/** `a.b->>c` → row.a.b.c (as text, like ->> does). */
export function valueAt(row: Row, col: string): unknown {
  const [path, jsonKey] = col.split("->>");
  let v: unknown = row;
  for (const part of path.split(".")) v = v && typeof v === "object" ? (v as Row)[part] : undefined;
  if (jsonKey !== undefined) {
    v = v && typeof v === "object" ? (v as Row)[jsonKey] : undefined;
    return v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v);
  }
  return v;
}

type Filter = (r: Row) => boolean;

class Query implements PromiseLike<{ data: unknown; error: DbError | null }> {
  private filters: Filter[] = [];
  private op: Op = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private returning = false;
  private one: "single" | "maybe" | null = null;
  private sorts: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;

  constructor(private db: FakeDb, private table: string, private call: Extract<DbCall, { kind: "from" }>) {}

  private log(s: string) { this.call.ops.push(s); return this; }

  select(cols?: string) {
    if (this.op !== "select") this.returning = true;
    return this.log(`select(${cols ?? "*"})`);
  }
  insert(rows: Row | Row[]) {
    this.op = "insert"; this.call.op = "insert";
    this.payload = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r }));
    this.call.payload = this.payload.map((r) => ({ ...r }));
    return this.log("insert");
  }
  update(patch: Row) {
    this.op = "update"; this.call.op = "update"; this.patch = { ...patch };
    this.call.payload = { ...patch };
    return this.log("update");
  }
  delete() {
    this.op = "delete"; this.call.op = "delete";
    return this.log("delete");
  }
  eq(col: string, v: unknown) { this.filters.push((r) => valueAt(r, col) === v); return this.log(`eq(${col},${String(v)})`); }
  neq(col: string, v: unknown) { this.filters.push((r) => valueAt(r, col) !== v); return this.log(`neq(${col},${String(v)})`); }
  is(col: string, v: unknown) { this.filters.push((r) => (valueAt(r, col) ?? null) === v); return this.log(`is(${col},${String(v)})`); }
  in(col: string, vs: unknown[]) { this.filters.push((r) => vs.includes(valueAt(r, col))); return this.log(`in(${col},${vs.length})`); }
  order(col: string, opts?: { ascending?: boolean }) { this.sorts.push({ col, asc: opts?.ascending !== false }); return this.log(`order(${col})`); }
  limit(n: number) { this.lim = n; return this.log(`limit(${n})`); }
  maybeSingle() { this.one = "maybe"; return this.log("maybeSingle"); }
  single() { this.one = "single"; return this.log("single"); }

  then<A = { data: unknown; error: DbError | null }, B = never>(
    onF?: ((v: { data: unknown; error: DbError | null }) => A | PromiseLike<A>) | null,
    onR?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.exec()).then(onF, onR);
  }

  private stamp(r: Row): Row {
    if (!this.db.pgTimestamps) return r;
    const out = { ...r };
    for (const k of ["updated_at", "created_at"]) if (typeof out[k] === "string") out[k] = pgTimestamp(out[k] as string);
    return out;
  }

  private exec(): { data: unknown; error: DbError | null } {
    const err = this.db.tableErrors[this.table] ?? this.db.opErrors[`${this.table}:${this.op}`];
    if (err) return { data: null, error: err };
    const rows = this.db.rows(this.table);
    const check = this.db.checks[this.table];
    if (this.op === "insert") {
      const inserted = this.payload.map((r) => this.stamp({ ...r }));
      for (const r of inserted) {
        const problem = check?.(r);
        if (problem) return { data: null, error: { message: problem, code: "23514" } };
        const pk = this.db.primaryKeys[this.table];
        if (pk && rows.some((x) => x[pk] === r[pk])) {
          return { data: null, error: { message: `duplicate key value violates unique constraint "${this.table}_pkey"`, code: "23505" } };
        }
      }
      rows.push(...inserted);
      if (!this.returning) return { data: null, error: null };
      return { data: this.one ? inserted[0] ?? null : inserted.map((r) => ({ ...r })), error: null };
    }
    if (this.op === "update") {
      this.db.beforeUpdate?.(this.table, rows);
      const hit = rows.filter((r) => this.filters.every((f) => f(r)));
      const patch = this.stamp(this.patch);
      for (const r of hit) {
        const problem = check?.({ ...r, ...patch });
        if (problem) return { data: null, error: { message: problem, code: "23514" } };
      }
      for (const r of hit) Object.assign(r, patch);
      return { data: this.returning ? hit.map((r) => ({ ...r })) : null, error: null };
    }
    if (this.op === "delete") {
      const hit = rows.filter((r) => this.filters.every((f) => f(r)));
      this.db.tables[this.table] = rows.filter((r) => !hit.includes(r));
      return { data: null, error: null };
    }
    let hit = rows.filter((r) => this.filters.every((f) => f(r)));
    for (const s of [...this.sorts].reverse()) {
      hit = [...hit].sort((a, b) => {
        const x = String(valueAt(a, s.col) ?? ""); const y = String(valueAt(b, s.col) ?? "");
        return (x < y ? -1 : x > y ? 1 : 0) * (s.asc ? 1 : -1);
      });
    }
    if (this.lim !== null) hit = hit.slice(0, this.lim);
    const copy = hit.map((r) => structuredClone(r));
    if (this.one === "maybe") {
      if (copy.length > 1) return { data: null, error: { message: "multiple rows", code: "PGRST116" } };
      return { data: copy[0] ?? null, error: null };
    }
    if (this.one === "single") {
      if (copy.length !== 1) return { data: null, error: { message: "not exactly one row", code: "PGRST116" } };
      return { data: copy[0], error: null };
    }
    return { data: copy, error: null };
  }
}

export class FakeDb {
  user: { id: string } | null = null;
  tables: Record<string, Row[]> = {};
  /** Every operation on the table fails with this error. */
  tableErrors: Record<string, DbError> = {};
  /** `"<table>:<op>"` → that operation fails with this error. */
  opErrors: Record<string, DbError> = {};
  /** Per-table CHECK: a message when the row would be refused (code 23514). */
  checks: Record<string, (row: Row) => string | null> = {};
  /** Per-table primary key, for the unique violation (code 23505). */
  primaryKeys: Record<string, string> = { tool_guides: "tool_key" };
  /** Store updated_at / created_at the way PostgREST hands them back. */
  pgTimestamps = false;
  /** Runs before an UPDATE filters its rows — a concurrent writer. */
  beforeUpdate?: (table: string, rows: Row[]) => void;
  rpcs: Record<string, (args: Record<string, unknown>) => RpcResult> = {};
  calls: DbCall[] = [];

  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table];
  }

  rpcCalls(name?: string): Extract<DbCall, { kind: "rpc" }>[] {
    return this.calls.filter((c): c is Extract<DbCall, { kind: "rpc" }> => c.kind === "rpc" && (!name || c.name === name));
  }

  fromCalls(table?: string, op?: Op): Extract<DbCall, { kind: "from" }>[] {
    return this.calls.filter((c): c is Extract<DbCall, { kind: "from" }> =>
      c.kind === "from" && (!table || c.table === table) && (!op || c.op === op));
  }

  tablesTouched(): string[] {
    return [...new Set(this.calls.flatMap((c) => (c.kind === "from" ? [c.table] : [])))];
  }

  /** Calls that WRITE: an insert/update/delete, or any rpc. */
  writes(): DbCall[] {
    return this.calls.filter((c) => (c.kind === "from" && c.op !== "select") || c.kind === "rpc");
  }

  client() {
    return fakeClient(this);
  }
}

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
      db.calls.push({ kind: "rpc", name, args: structuredClone(args) });
      const fn = db.rpcs[name];
      if (!fn) return { data: null, error: { message: `function ${name} not scripted`, code: "PGRST202" } };
      return fn(args);
    },
  };
}

export const newId = (): string => randomUUID();
