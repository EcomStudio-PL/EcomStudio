/**
 * LEDGER SECURITY — the regression guard for the free-generation hole.
 *
 * WHAT WENT WRONG. usage_events is readable by its own workspace, so a customer
 * could read the id of the generation running for them at that moment and POST
 * it to /rest/v1/rpc/fail_usage_event. That RPC asked only "are you a member of
 * this workspace" — which the customer is — flipped the event from pending to
 * failed, and refunded the charge. The images still arrived, because the
 * provider call had already been made and the assets are written by the
 * application, not by that function. Generate, refund yourself, keep the
 * pictures, repeat: unlimited free generation for any account, and registration
 * is open.
 *
 * The fix is migration 0077: the ledger RPCs now require a token that only the
 * server can derive, and EXECUTE on the ungated originals is revoked from anon
 * and authenticated. These tests pin BOTH halves of that fix in the codebase,
 * because both are easy to undo by accident:
 *
 *   1. the ledger entry points must refuse to act without proof-of-server, and
 *      must refuse BEFORE the event row is written — a pending row created by a
 *      caller that cannot then complete or refund it is a stuck charge;
 *   2. no source file may call the revoked RPC names again. That is a grep, and
 *      it is deliberately a grep: someone reintroducing `fail_usage_event` in a
 *      new file would typecheck perfectly and fail only in production, months
 *      later, as money.
 *
 * Run: npm run test:ledger
 */
process.env.APP_ENCRYPTION_KEY = "c".repeat(64); // throwaway key, never a real one

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { startUsage, completeUsage, failUsage } from "../lib/services/usage";
import type { Client } from "../lib/services/workspace";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/* ── A. The ledger refuses to move without proof-of-server ─────────────────
 * A recording client: every call it receives is remembered, so the test can
 * assert not just the return value but that NOTHING was written. */
type Call = { kind: string; name?: string };
function recorder() {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      calls.push({ kind: "from", name: table });
      const chain = {
        select: () => chain, eq: () => chain, insert: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: { id: "evt-1" }, error: null }),
      };
      return chain as never;
    },
    rpc(name: string) {
      calls.push({ kind: "rpc", name });
      return Promise.resolve({ data: null, error: null }) as never;
    },
  };
  return { calls, client: client as unknown as Client };
}

async function main() {
console.log("A. NO TOKEN, NO LEDGER");

const a = recorder();
const started = await startUsage(a.client, {
  serverToken: null,
  userId: "u1", workspaceId: "w1", walletId: "wal1", serviceSlug: "tool_remove_bg",
});
check("startUsage refuses when the server cannot prove itself",
  started.ok === false && started.error === "server_unconfigured",
  JSON.stringify(started));
check("and it refuses BEFORE touching the database — no stuck pending row",
  a.calls.length === 0, JSON.stringify(a.calls));

const b = recorder();
await completeUsage(b.client, null, "evt-1", 1, { apiCostUsdMicros: 5 });
check("completeUsage writes nothing without a token", b.calls.length === 0, JSON.stringify(b.calls));

const c = recorder();
await failUsage(c.client, { serverToken: null, eventId: "evt-1", walletId: "wal1", error: "x" });
check("failUsage refunds nothing without a token", c.calls.length === 0, JSON.stringify(c.calls));

/* ── B. With a token, the gated RPC names are the ones used ───────────────── */
console.log("\nB. WITH A TOKEN, THE GATED RPCs ARE THE ONES CALLED");

const d = recorder();
await completeUsage(d.client, "tok", "evt-1", 2, { apiCostUsdMicros: 7 });
check("completeUsage calls usage_event_complete",
  d.calls.some((x) => x.kind === "rpc" && x.name === "usage_event_complete"), JSON.stringify(d.calls));

const e = recorder();
await failUsage(e.client, { serverToken: "tok", eventId: "evt-1", walletId: "wal1", error: "provider_down" });
check("failUsage calls usage_event_fail",
  e.calls.some((x) => x.kind === "rpc" && x.name === "usage_event_fail"), JSON.stringify(e.calls));

/* ── C. The revoked RPC names must not reappear anywhere in the source ───── */
console.log("\nC. THE UNGATED RPC NAMES STAY OUT OF THE SOURCE");

/** Every RPC whose EXECUTE was revoked in 0077. Calling one from application
 *  code now fails at the database — but silently, at runtime, on a money path,
 *  so it is caught here instead. */
const REVOKED = [
  "fail_usage_event", "complete_usage_event", "charge_usage_credits",
  "refund_usage_event", "refund_usage_partial",
  "get_active_provider_credential", "get_engine_rules", "match_knowledge_examples",
  "set_provider_health",
] as const;

const ROOTS = ["app", "lib", "components"];
/** database.types.ts still DECLARES the revoked functions, because they still
 *  exist in the database. Declaring them is not calling them. */
const SKIP = new Set(["lib/database.types.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(r)).filter((f) => !SKIP.has(f));
const offenders: string[] = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const name of REVOKED) {
    // Only an actual rpc("name") call counts. A mention in a comment explaining
    // the history — of which this codebase now has several — is not a call.
    if (new RegExp(`\\.rpc\\(\\s*["'\`]${name}["'\`]`).test(src)) offenders.push(`${f} -> ${name}`);
  }
}
check(`no source file calls a revoked ledger/credential RPC (${files.length} files scanned)`,
  offenders.length === 0, offenders.join(", "));

/* ── D. Every gated RPC call passes a token ───────────────────────────────── */
console.log("\nD. EVERY GATED RPC CALL PASSES A TOKEN");

const GATED = [
  "usage_event_fail", "usage_event_complete", "usage_event_charge",
  "usage_event_refund_partial", "provider_credential_read", "engine_rules_read",
  "knowledge_match", "provider_health_set",
] as const;

const tokenless: string[] = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const name of GATED) {
    const call = new RegExp(`\\.rpc\\(\\s*["'\`]${name}["'\`]\\s*,\\s*\\{([\\s\\S]{0,400}?)\\}`, "g");
    let m: RegExpExecArray | null;
    while ((m = call.exec(src)) !== null) {
      if (!/p_token\s*:/.test(m[1]!)) tokenless.push(`${f} -> ${name}`);
    }
  }
}
check("no gated RPC is called without p_token", tokenless.length === 0, tokenless.join(", "));
}

function report() {
  console.log(failures === 0 ? "\nAll ledger security tests passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().then(report).catch((e) => {
  console.error("ledger tests crashed:", e);
  process.exit(1);
});
