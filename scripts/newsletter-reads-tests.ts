/**
 * HOW MANY TIMES ONE ADMIN SCREEN READS THE SAME TABLE (P1-34).
 *
 * The finding says the Newsletter analytics screen does duplicate work. The
 * brief says measure it before removing anything, so this counts it instead of
 * asserting it: a stub client records every `.from(table)` the three readers
 * issue, and the numbers below are printed on every run.
 *
 * WHY A STUB AND NOT A REAL RENDER. Counting against the real database needs
 * an authenticated admin session, and this project has no test account — see
 * docs/tooling/playwright.md. Pointing a harness at a real operator account
 * would put a customer's data in an artifact. The read PATTERN, which is what
 * the finding is about, is a property of the code and is fully visible here;
 * what a stub cannot tell you is latency, and no claim about latency is made.
 *
 * WHAT THE COUNT IS FOR. It is a recorded number, not a threshold — with one
 * exception. Section C pins the shape that a future change must not worsen,
 * because the realistic failure is not "this is slow today", it is a fourth
 * reader being added to the same screen and nobody noticing.
 *
 * Run: npm run test:newsletterreads
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  dashboardTotals, campaignPerformance, sourcePerformance,
  contactsForExport, listContacts, prelaunchContact, prelaunchSummary,
} from "../lib/services/newsletter";

const ROOT = process.cwd();

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

type Read = { table: string; columns: string; filters: string[]; headOnly: boolean };

/**
 * A stand-in for the PostgREST builder: every chainable method returns itself,
 * and awaiting it yields an empty result. It records what was asked for, which
 * is the entire point.
 */
function stubClient() {
  const reads: Read[] = [];
  // Function calls are recorded apart from table reads: an rpc is one round
  // trip that returns one answer, and counting it as a "read" of some table
  // would hide what the screen actually asks the database for.
  const rpcs: { fn: string; args: unknown }[] = [];
  const rpc = (fn: string, args?: unknown) => {
    rpcs.push({ fn, args });
    return Promise.resolve({ data: null, error: null });
  };
  const from = (table: string) => {
    const read: Read = { table, columns: "", filters: [], headOnly: false };
    reads.push(read);
    const builder: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      if (name === "select") {
        read.columns = String(args[0] ?? "");
        // `select("id", { count: "exact", head: true })` returns NO ROWS — it
        // asks Postgres for a number. The options object has to be recorded or
        // section E reads a bounded count as an unbounded table scan, which is
        // how a harness invents findings. It did, on the first run.
        const opts = args[1] as { head?: boolean; count?: string } | undefined;
        read.headOnly = Boolean(opts?.head);
      } else {
        read.filters.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      }
      return builder;
    };
    for (const m of ["select", "eq", "neq", "in", "gte", "lte", "lt", "gt", "is", "not",
      "order", "limit", "range", "maybeSingle", "single", "filter", "or", "contains"]) {
      builder[m] = chain(m);
    }
    // Awaiting the builder is what actually runs the query.
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
    return builder;
  };
  return { client: { from, rpc } as never, reads, rpcs };
}

const SINCE = "2026-08-01T00:00:00.000Z";
const UNTIL = "2026-09-01T00:00:00.000Z";

async function main() {
  console.log("A. WHAT ONE RENDER OF /admin/newsletter/analityka ACTUALLY READS");
  const { client, reads } = stubClient();
  // The same three calls the page makes, in the same Promise.all.
  await Promise.all([
    dashboardTotals(client, SINCE, UNTIL),
    campaignPerformance(client, SINCE, UNTIL),
    sourcePerformance(client, SINCE, UNTIL),
  ]);

  const byTable = new Map<string, number>();
  for (const r of reads) byTable.set(r.table, (byTable.get(r.table) ?? 0) + 1);
  const total = reads.length;
  console.log(`  ${total} read(s) in one render:`);
  for (const [table, n] of [...byTable.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(2)}x  ${table}${n > 1 ? "   <- same table, more than once" : ""}`);
  }

  console.log("\n  the repeated ones, and what each asked for:");
  for (const [table, n] of byTable) {
    if (n < 2) continue;
    for (const r of reads.filter((x) => x.table === table)) {
      console.log(`    ${table}: select(${r.columns})`);
    }
  }

  console.log("\nB. WHY react cache() WOULD NOT HAVE HELPED HERE");
  /*
    Worth stating plainly, because it was the proposed fix.

    cache() deduplicates repeat calls to the SAME function with the SAME
    arguments inside one render. This screen calls three DIFFERENT functions
    once each, so there is nothing for it to collapse. The overlap is one
    level down: three different projections of newsletter_events over one
    window are three different queries, and no call-level memo can merge them.

    Collapsing them for real means one reader fetching a superset of columns
    and the three functions deriving from it — a change that alters what every
    number on the analytics screen is computed from. That is not a smallest
    safe change, it is a rewrite of the admin's reporting, and it is recorded
    as deferred with this measurement attached rather than attempted here.

    ONE CORRECTION TO THE ABOVE, and it narrows the claim.

    "Three different projections no memo can merge" is too strong. Two of the
    three newsletter_events reads have the IDENTICAL projection
    `event_type, contact_id` over the identical window; sourcePerformance's
    differs only by `.in("event_type", ["sent","clicked"])`, so its rows are a
    strict SUBSET of dashboardTotals' (modulo the 500 000 limit). That one is
    genuinely removable — sourcePerformance could derive from the wider read.

    It is still not a cache() fix and still not done here, because the two
    functions are also called separately (dashboardTotals runs alone on
    /admin/newsletter), so merging them means restructuring who fetches what
    rather than memoising a repeat call. But the honest disposition is "one
    removable read, deferred", not "nothing to remove". Flagged by an
    independent review after the first version of this file overstated it.
  */
  /*
    ASKED OF THE PAGE, not of a literal.

    This used to build a 3-element Set of function names and assert its size
    was 3 — a statement about the literal, never about the screen. Two
    independent reviews flagged it. It now reads the page and counts the call
    sites, so deleting a reader or adding a fourth changes the answer.
  */
  const pageSrc = readFileSync(join(ROOT, "app/admin/newsletter/analityka/page.tsx"), "utf8");
  // The fourth, prelaunchSummary, is ONE rpc and no table read at all — so it
  // is counted here as a call site and measured on its own in section F, where
  // it cannot hide inside the table-read ceiling of section C.
  const READERS = ["dashboardTotals", "campaignPerformance", "sourcePerformance", "prelaunchSummary"];
  const callCounts = READERS.map((fn) => ({
    fn, n: (pageSrc.match(new RegExp(`\\b${fn}\\(supabase`, "g")) ?? []).length,
  }));
  check("the analytics page calls exactly these four readers, once each",
    callCounts.every((c) => c.n === 1),
    callCounts.map((c) => `${c.fn} x${c.n}`).join(", ") +
      " — if one were ever called twice, cache() would become the right tool");
  const eventReads = reads.filter((r) => r.table === "newsletter_events");
  check("the overlap is different PROJECTIONS of one table, not repeat calls",
    eventReads.length > 1 && new Set(eventReads.map((r) => r.columns)).size > 1,
    `newsletter_events read ${eventReads.length}x with ${new Set(eventReads.map((r) => r.columns)).size} distinct column list(s)`);

  /*
    AND THE DISTINCTION THAT DECIDES WHETHER THERE IS ANYTHING TO REMOVE.

    Two reads of one table are only a DUPLICATE when table, columns and
    filters all match — then one of them is free to delete. When any of the
    three differs they are two different questions, and merging them means
    changing what the answers are computed from.

    Printed rather than assumed, because "same table twice" was the finding
    and it is not the same claim.
  */
  const signature = (r: Read) => `${r.table}|${r.columns}|${[...r.filters].sort().join("&")}|${r.headOnly}`;
  const seen = new Map<string, number>();
  for (const r of reads) seen.set(signature(r), (seen.get(signature(r)) ?? 0) + 1);
  const trueDupes = [...seen.entries()].filter(([, n]) => n > 1);
  console.log(`  identical reads (same table, columns AND filters): ${trueDupes.length}`);
  for (const [sig, n] of trueDupes) console.log(`    x${n}  ${sig}`);
  check("no read is issued twice identically",
    trueDupes.length === 0,
    "an identical repeat is free to remove; these are not that");

  console.log("\nC. THE SHAPE A FUTURE CHANGE MUST NOT WORSEN");
  /*
    A HARDCODED ceiling. The previous line read `const CEILING = total`, i.e.
    `total <= total`, and its comment claimed a fourth reader would have to be
    a conscious edit here. It would not: the ceiling was recomputed from the
    measurement on every run, so it could never fail. Proven by adding three
    readers — reads went 13 -> 20 and the check still printed a tick.

    THE NUMBER BELOW IS A FLOOR, NOT PRODUCTION'S COUNT. campaignPerformance
    returns early on `ids.length === 0`, and the stub yields an empty result
    set for every query, so its chunked newsletter_campaigns name lookup never
    runs here. With N campaigns in the window the real figure is
    13 + ceil(N / 200) >= 14. Quote it as "13 against an empty result set".
  */
  const CEILING = 13;
  check(`one render stays at ${CEILING} reads or fewer (empty result set)`,
    total <= CEILING, `measured ${total}`);
  check("newsletter_events is not read more than 3 times",
    eventReads.length <= 3, `read ${eventReads.length}x`);

  console.log("\nD. THE WINDOW IS APPLIED IN THE DATABASE, NOT IN JAVASCRIPT");
  /*
    The cheapest correctness property on this screen, and the one a "just cache
    it" fix would have quietly broken: every windowed read must carry its own
    gte/lte. A reader that fetched everything and filtered in memory would look
    identical on screen, return identical numbers today, and fall over the
    moment the table is large — which is exactly when an operator needs it.
  */
  const windowed = reads.filter((r) =>
    ["newsletter_events", "newsletter_recipients", "newsletter_attributions"].includes(r.table)
    && !r.headOnly);
  for (const r of windowed) {
    check(`${r.table} (${r.columns.slice(0, 32)}…) filters by time in SQL`,
      r.filters.some((f) => f.startsWith("gte(") || f.startsWith("lte(")),
      "no gte/lte — this read would pull the whole table and filter in memory");
  }

  /*
    ONE FRAGILITY THIS MEASUREMENT EXPOSED, pinned before it becomes a bug.

    sourcePerformance narrows newsletter_events to ["sent", "clicked"] IN THE
    QUERY, and then its loop treats "sent" as sent and EVERYTHING ELSE as a
    click. That is correct only because the database already removed
    everything else. Delete the .in(...) — to widen a report, say — and every
    open, reply and unsubscribe silently becomes a click, on a screen whose
    entire job is telling an operator which sign-up route produces engagement.
    The numbers would still look plausible, which is what makes it worth a
    test rather than a comment.
  */
  const sourceEventRead = reads.find((r) =>
    r.table === "newsletter_events" && r.filters.some((f) => f.startsWith("in(")));
  check("sourcePerformance still narrows events to sent+clicked in SQL",
    Boolean(sourceEventRead)
      && /"sent"/.test(sourceEventRead!.filters.join(""))
      && /"clicked"/.test(sourceEventRead!.filters.join("")),
    "its loop counts every non-sent row as a click, so this filter is load-bearing");

  console.log("\nE. AND EVERY UNBOUNDED READ STILL HAS A CEILING");
  /*
    A missing limit() is how one popular campaign turns an admin page into an
    outage. Two shapes are legitimately exempt, and both are named rather than
    silently skipped:

      - a head/count read returns no rows at all, so there is nothing to cap;
      - a small lookup table whose row count is bounded by the product, not by
        customer activity. newsletter_sources holds one row per sign-up route
        (the forms an admin has configured), so it cannot grow with traffic.
  */
  const LOOKUP_TABLES = new Set(["newsletter_sources"]);
  for (const r of reads) {
    if (r.headOnly) { console.log(`  · ${r.table} (${r.columns}) is a count, not a row read`); continue; }
    if (LOOKUP_TABLES.has(r.table)) { console.log(`  · ${r.table} is a lookup table, bounded by configuration`); continue; }
    check(`${r.table} (${r.columns.slice(0, 28)}…) is bounded`,
      r.filters.some((f) => f.startsWith("limit(") || f.startsWith("maybeSingle") || f.startsWith("single")),
      "an unbounded select is unbounded in production too");
  }

  console.log("\nF. THE PRE-LAUNCH LIST ADDS ONE QUESTION PER SCREEN, AND IT IS BOUNDED");
  /*
    The pre-launch list (migration 0144) reaches three newsletter screens.
    Each gets exactly one new round trip, and the shape is pinned here for the
    same reason as C: the realistic failure is somebody "just counting the
    signups" with a select over prelaunch_signups next to the SQL summary that
    already defines what a signup is.

      - Analityka: prelaunchSummary — one rpc, ZERO table reads;
      - the contact screen: prelaunchContact — one rpc, zero table reads;
      - Kontakty with `prelaunch=`: one bounded read of contact ids, the same
        shape as the group filter, on the screen and in the export alike.
  */
  {
    const { client, reads, rpcs } = stubClient();
    await prelaunchSummary(client, SINCE, UNTIL);
    check("Analityka's pre-launch section is one rpc", rpcs.length === 1 && rpcs[0].fn === "prelaunch_admin_summary",
      rpcs.map((r) => r.fn).join(", "));
    check("…over the page's own window", JSON.stringify(rpcs[0]?.args) === JSON.stringify({ p_from: SINCE, p_to: UNTIL }),
      JSON.stringify(rpcs[0]?.args));
    check("…and reads no table to count anything itself", reads.length === 0,
      reads.map((r) => r.table).join(", "));
  }
  {
    const { client, reads, rpcs } = stubClient();
    await prelaunchSummary(client, null, UNTIL);
    const from = (rpcs[0]?.args as { p_from?: string } | undefined)?.p_from;
    check("'Cały okres' sends the epoch as its start, not an invented date", from === "1970-01-01T00:00:00.000Z",
      String(from));
    check("…still with no table read", reads.length === 0);
  }
  {
    const { client, reads, rpcs } = stubClient();
    await prelaunchContact(client, "11111111-1111-4111-8111-111111111111");
    check("the contact screen's pre-launch card is one rpc",
      rpcs.length === 1 && rpcs[0].fn === "prelaunch_admin_contact", rpcs.map((r) => r.fn).join(", "));
    check("…and no table read", reads.length === 0, reads.map((r) => r.table).join(", "));
    const { client: c2, rpcs: rpcs2 } = stubClient();
    await prelaunchContact(c2, "not-a-uuid");
    check("a malformed contact id never reaches the database", rpcs2.length === 0);
  }
  for (const [label, run] of [
    ["the contact list", (c: never) => listContacts(c, { prelaunch: "confirmed" })],
    ["the CSV export", (c: never) => contactsForExport(c, { prelaunch: "pending" })],
  ] as const) {
    const { client, reads, rpcs } = stubClient();
    await run(client);
    const signupReads = reads.filter((r) => r.table === "prelaunch_signups");
    check(`${label}: the pre-launch filter is ONE read of prelaunch_signups`, signupReads.length === 1,
      `${signupReads.length} read(s)`);
    check(`${label}: …of contact ids only`, signupReads[0]?.columns === "contact_id", signupReads[0]?.columns);
    check(`${label}: …bounded`, Boolean(signupReads[0]?.filters.some((f) => f.startsWith("limit("))),
      signupReads[0]?.filters.join(" "));
    check(`${label}: …with no rpc`, rpcs.length === 0);
  }
  {
    // An unknown value is somebody editing the URL; it must not become a
    // query (and certainly not an empty list with no explanation).
    const { client, reads } = stubClient();
    await listContacts(client, { prelaunch: "expired' or 1=1" });
    check("an unknown prelaunch= value reads nothing extra",
      reads.every((r) => r.table !== "prelaunch_signups"), reads.map((r) => r.table).join(", "));
  }

  console.log(failures === 0 ? "\nAll newsletter read tests passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("newsletter read tests crashed:", e); process.exit(1); });
