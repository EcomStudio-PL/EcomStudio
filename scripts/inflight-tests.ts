/**
 * GENERACJE W TOKU V2 + DRAG & DROP ZDJĘĆ V2 — the rules, checked without a
 * browser (the browser side: scripts in the report's Playwright run; the
 * database side: scripts/inflight-sql-tests.sh).
 *
 *   A. the photo order: one move, nearest slot, keys; the spec's example
 *   B. acceptance: the route answers at acceptance and finishes after it
 *   C. the limit refusal and the tracked ids, as the server reads them
 *   D. the server's view: what a tile may know, when the credits "came back"
 *   E. the browser's store: merge, server clock, misses, unclaimed results
 *   F. one click of many photos: two at a time, a limit waits, a refusal stops
 *   G. the retry: the frozen request, never the panel's current one
 *   H. the tile's words: stages, estimate, slow, the plan's limit (PL/EN/DE)
 *   I. the wiring: which panels and pools reorder, which surfaces show tiles
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keyTarget, nearestSlot, reorder } from "../components/genv3/sortable-photos";
import { slotRefusal } from "../lib/server/slot-refusal";
import { estimateParts, formatElapsed, isSlow, jobEstimateKey, runEstimateKey, thumbnailStep } from "../lib/inflight/types";
import type { InflightSnapshot } from "../lib/inflight/types";
import pl from "../lib/i18n/dictionaries/pl.json";
import en from "../lib/i18n/dictionaries/en.json";
import de from "../lib/i18n/dictionaries/de.json";

let failed = 0;
let passed = 0;
function section(title: string) { console.log(`\n${title}`); }
function check(name: string, ok: boolean, detail: unknown = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== "" ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`); }
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── a browser, as little of it as the store needs ──────────────────────── */
type Fetch = (url: string, init?: { method?: string; body?: string }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
const g = globalThis as unknown as Record<string, unknown> & { __fetch?: Fetch };
const session = new Map<string, string>();
g.window = globalThis;
g.sessionStorage = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => { session.set(k, v); }, removeItem: (k: string) => { session.delete(k); } };
g.document = {
  visibilityState: "visible",
  addEventListener: () => undefined,
  documentElement: { dataset: {} },
};
g.fetch = ((url: string, init?: { method?: string; body?: string }) => g.__fetch!(url, init)) as unknown;

async function main() {
  /* ══ A ═══════════════════════════════════════════════════════════════ */
  section("A. THE PHOTO ORDER — one move, applied to the customer's own array");
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  check("the spec's example: 1..10, photo 4 to position 8 → 1,2,3,5,6,7,8,4,9,10",
    reorder(ten, 3, 7).join(",") === "1,2,3,5,6,7,8,4,9,10", reorder(ten, 3, 7).join(","));
  check("forward and back is the identity", reorder(reorder(ten, 3, 7), 7, 3).join(",") === ten.join(","));
  check("to the front and to the end", reorder(ten, 9, 0)[0] === 10 && reorder(ten, 0, 9)[9] === 1);
  check("no move, out of range: a copy, never the same array", reorder(ten, 2, 2) !== ten && reorder(ten, 2, 2).join() === ten.join()
    && reorder(ten, 20, 1).join() === ten.join());
  const objs = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
  const moved = reorder(objs, 0, 3);
  check("stable identities: the same objects, only their order changes", moved[3] === objs[0] && moved.map((o) => o.key).join("") === "bcda");
  // A 4-column grid of 10 slots, 100 px cells.
  const centres = Array.from({ length: 10 }, (_, i) => ({ x: 50 + (i % 4) * 100, y: 50 + Math.floor(i / 4) * 100 }));
  check("nearest slot across rows (the pointer over row 3, column 2 → slot 9)", nearestSlot(centres, 160, 240) === 9);
  check("just past the last tile (in the gap after it) resolves to the last slot", nearestSlot(centres, 235, 262) === 9);
  check("keys: ←/→ by one, ↑/↓ by a row, clamped", keyTarget(5, "ArrowLeft", 4, 10) === 4 && keyTarget(5, "ArrowDown", 4, 10) === 9
    && keyTarget(1, "ArrowUp", 4, 10) === 0 && keyTarget(9, "ArrowRight", 4, 10) === 9);

  /* ══ B ═══════════════════════════════════════════════════════════════ */
  section("B. ACCEPTANCE — answered when accepted, the same call finished after the response");
  const { answerAtAcceptance } = await import("../lib/server/inflight-accept");
  const queue = (globalThis as unknown as { __afterQueue?: ((() => unknown) | Promise<unknown>)[] }).__afterQueue ??= [];
  const drain = async () => { while (queue.length) { const t = queue.shift()!; await (typeof t === "function" ? t() : t); } };
  let finished = false;
  let finishedWith: unknown = null;
  const accepted = await answerAtAcceptance("t", async (onAccepted) => {
    onAccepted({ jobId: "job-1", credits: 7, startedAt: "2026-10-25T10:00:00.000Z", quantity: 1 });
    await sleep(20);
    finished = true;
    return { ok: true as const, images: 1 };
  }, (r) => { finishedWith = r; });
  check("the answer arrives at acceptance, before the work ends", "accepted" in accepted && accepted.accepted.jobId === "job-1" && !finished);
  await drain();
  check("…and the work (and its closing step) runs to the end after the response", finished && JSON.stringify(finishedWith) === '{"ok":true,"images":1}');
  const refused = await answerAtAcceptance("t", async () => ({ ok: false as const, error: "insufficient_credits" }));
  check("a refusal before acceptance answers with the refusal itself", "result" in refused && refused.result.error === "insufficient_credits");
  await drain();
  let threw = false;
  try { await answerAtAcceptance("t", async () => { throw new Error("boom"); }); } catch { threw = true; }
  await drain();
  check("a crash before acceptance is the route's error, as before", threw);
  const late = await answerAtAcceptance("t", async (onAccepted) => {
    onAccepted({ jobId: "job-2", credits: 7, startedAt: "x", quantity: 1 });
    throw new Error("after");
  });
  let lateThrown = false;
  try { await drain(); } catch { lateThrown = true; }
  check("a crash after acceptance does not undo the answer (the job is the reconciler's)", "accepted" in late && !lateThrown);
  const routes = ["app/api/generate/route.ts", "app/api/retouch/route.ts", "app/api/fashion/route.ts", "app/api/concepts/generate/route.ts"];
  check("every generation route answers 202 at acceptance through the one helper",
    routes.every((r) => /answerAtAcceptance\(/.test(read(r)) && /status: 202/.test(read(r))), routes.filter((r) => !/answerAtAcceptance\(/.test(read(r))));
  const gen = read("lib/server/generation.ts");
  const iAccept = gen.indexOf("input.onAccepted?.(");
  check("runGeneration reports acceptance only after the charge, before any reference download or provider call",
    iAccept > gen.indexOf("const usage = await startUsage(") && iAccept < gen.indexOf("REFERENCE IMAGES — downloaded once")
    && iAccept < gen.indexOf("PROVIDER LOOP"));
  check("…and the job row (with the slot) is written before the charge — so the limit refuses before money moves",
    gen.indexOf('from("generation_jobs").insert(') < gen.indexOf("const usage = await startUsage(") && /slot: input\.slot \?\? undefined/.test(gen));
  check("Miniaturka is driven by the server after the start and after each status read (not by its page)",
    /driveThumbnailAfterResponse\(/.test(read("app/api/thumbnail/route.ts")) && /driveThumbnailAfterResponse\(/.test(read("app/api/thumbnail/runs/[id]/route.ts")));

  /* ══ C ═══════════════════════════════════════════════════════════════ */
  section("C. THE LIMIT REFUSAL AND THE TRACKED IDS");
  check("the database's refusal → concurrency_limit with the limit", JSON.stringify(slotRefusal('new row: generation_limit_reached:3')) === '{"ok":false,"error":"concurrency_limit","limit":3}');
  check("a too-big batch → concurrency_limit", slotRefusal("generation_batch_full")?.error === "concurrency_limit");
  check("anything else is not a limit", slotRefusal("duplicate key value") === null && slotRefusal(null) === null);
  const { parseTrack } = await import("../lib/server/inflight");
  const tr = parseTrack("job:11111111-1111-4111-8111-111111111111,run:22222222-2222-4222-8222-222222222222,evil:x,job:not-a-uuid");
  check("track=…: only job:/run: with a real uuid", tr.length === 2 && tr[0]!.kind === "job" && tr[1]!.kind === "run");
  check("at most 30 tracked ids", parseTrack(Array.from({ length: 40 }, () => "job:11111111-1111-4111-8111-111111111111").join(",")).length === 30);

  /* ══ D ═══════════════════════════════════════════════════════════════ */
  section("D. THE SERVER'S VIEW — what a tile may know, when the credits came back");
  const { readInflight } = await import("../lib/server/inflight");
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const JOB = (id: string) => `${id}0000000-0000-4000-8000-000000000000`.slice(0, 36);
  const fake = fakeSupabase({
    generation_jobs: [
      { id: JOB("a"), status: "processing", created_at: iso(20_000), started_at: iso(20_000), quantity: 2, aspect_ratio: "4:5",
        error_class: null, error_message: null, settings: { slot: { tool: "generator", batch: "b1", request: "r1" } } },
      { id: JOB("b"), status: "completed", created_at: iso(90_000), started_at: iso(90_000), quantity: 1, aspect_ratio: "1:1",
        error_class: null, error_message: null, settings: { operation: "image_retouch", slot: { tool: "retouch", batch: "b2" } } },
      { id: JOB("c"), status: "failed", created_at: iso(90_000), started_at: iso(90_000), quantity: 1, aspect_ratio: "1:1",
        error_class: "provider_error", error_message: "Your prepayment credits are depleted", settings: { operation: "image_retouch", slot: { tool: "retouch" } } },
      { id: JOB("d"), status: "processing", created_at: iso(20 * 60_000), started_at: iso(20 * 60_000), quantity: 1, aspect_ratio: "1:1",
        error_class: null, error_message: null, settings: { slot: { tool: "generator" } } },
      { id: JOB("e"), status: "failed", created_at: iso(60_000), started_at: iso(60_000), quantity: 1, aspect_ratio: "1:1",
        error_class: "provider_error", error_message: null, settings: { slot: { tool: "generator" } } },
    ],
    usage_events: [
      { generation_job_id: JOB("c"), status: "refunded", credits_charged: 7, refund_tx_id: "tx", created_at: iso(1) },
      { generation_job_id: JOB("d"), status: "pending", credits_charged: 7, refund_tx_id: null, created_at: iso(1) },
      { generation_job_id: JOB("e"), status: "failed", credits_charged: 7, refund_tx_id: null, created_at: iso(1) },
    ],
    credit_wallets: [{ workspace_id: "ws", balance: 93 }],
  }, {
    thumbnail_runs_active: [{ id: "run-1", status: "running", stage: "compose", retouch: true, photos: 3, driving: true, cancelling: false, created_at: iso(30_000) },
      { id: "run-2", status: "queued", stage: null, retouch: false, photos: 1, driving: false, cancelling: false, created_at: iso(1_000) }],
    generation_limit_state: { limit: 3, active: 2, plan: "pro" },
    generation_duration_estimates: { medians: { "generator:2": 42_000, "ecommerce_thumbnail:retouch": 100_000 } },
  });
  const snap = await readInflight(fake as never, "u", "ws", [
    { kind: "job", id: JOB("b") }, { kind: "job", id: JOB("c") }, { kind: "job", id: JOB("d") }, { kind: "job", id: JOB("e") },
  ]);
  const a = snap.active.find((x) => x.id === JOB("a"));
  check("an active job: tool, server start, images, format, batch, the median for its bucket",
    !!a && a.tool === "generator" && a.startedAt === iso(20_000) && a.expected === 2 && a.ratio === "4:5" && a.batch === "b1"
    && a.request === "r1" && a.estimateMs === 42_000 && a.stage === "generate" && !a.cancellable, a);
  const r1 = snap.active.find((x) => x.id === "run-1");
  const r2 = snap.active.find((x) => x.id === "run-2");
  check("a Miniaturka run: the server's stage with its step (Retusz on: 2/3), never cancellable once driven",
    r1?.stage === "compose" && r1.step?.index === 2 && r1.step.count === 3 && !r1.cancellable && r1.estimateMs === 100_000, r1);
  check("a queued run nobody drives yet: cancellable, no estimate without samples", r2?.cancellable === true && r2.estimateMs === null && r2.stage === null, r2);
  const res = (id: string) => snap.resolved.find((x) => x.id === id);
  check("a refunded failure: 'came back' with the ledger's amount", res(JOB("c"))?.refund === "refunded" && res(JOB("c"))?.refundedCredits === 7);
  check("…and the provider's message never leaves the server (a safe code only)", res(JOB("c"))?.error === "provider_error" && !JSON.stringify(snap).includes("prepayment"));
  check("an invocation that died mid-call (processing for 20 min): 'interrupted', refund still PENDING", res(JOB("d"))?.error === "interrupted" && res(JOB("d"))?.refund === "pending");
  check("a failure without a refund receipt is never called refunded", res(JOB("e"))?.refund === "unknown");
  check("the limit and the balance come with it", snap.limit?.max === 3 && snap.limit.plan === "pro" && snap.balance === 93);
  check("an open run nobody drives is handed to the route to resume (and never to the browser)",
    JSON.stringify(snap.undrivenRuns) === '["run-2"]' && /const \{ undrivenRuns, \.\.\.snapshot \}/.test(read("app/api/generations/active/route.ts")));

  /* ══ E ═══════════════════════════════════════════════════════════════ */
  section("E. THE BROWSER'S STORE — only what the server confirmed");
  const store = await import("../lib/inflight/store");
  store.resetInflightForTests();
  const empty = { tiles: [], limit: null, balance: null, balanceAt: 0, offsetMs: 0, seeded: false };
  const t0 = Date.now();
  const entry = (id: string, extra: Partial<InflightSnapshot["active"][number]> = {}): InflightSnapshot["active"][number] => ({
    id, kind: "job", tool: "generator", operation: null, status: "running", stage: "generate", step: null,
    startedAt: new Date(t0 - 5_000).toISOString(), expected: 1, ratio: "1:1", batch: null, request: null, estimateMs: null, cancellable: false, ...extra,
  });
  const base: InflightSnapshot = { ok: true, active: [], resolved: [], limit: null, balance: null, serverNow: new Date(t0 + 2_000).toISOString() };
  let st = store.mergeSnapshot(empty, { ...base, active: [entry("j1")] }, t0);
  check("a job the page did not know (a refresh, another tab) appears from the server's list", st.tiles.length === 1 && st.tiles[0]!.id === "j1");
  check("the timer counts from the SERVER's clock (its offset is kept)", st.offsetMs === 2_000);
  st = { ...st, tiles: st.tiles.map((t) => ({ ...t, preview: "blob:local", snapshot: { endpoint: "/api/generate" as const, body: { prompt: "x" }, credits: 7 } })) };
  st = store.mergeSnapshot(st, { ...base, active: [entry("j1", { stage: "generate", estimateMs: 40_000 })] }, t0 + 3_000);
  check("an update keeps the tab's own preview and retry snapshot", st.tiles[0]!.preview === "blob:local" && st.tiles[0]!.snapshot?.credits === 7 && st.tiles[0]!.estimateMs === 40_000);
  const done = { id: "j1", kind: "job" as const, tool: "generator", operation: null, outcome: "done" as const, items: [], delivered: 1, expected: 1, error: null, refund: "not_charged" as const, refundedCredits: null };
  st = store.mergeSnapshot(st, { ...base, resolved: [done] }, t0 + 4_000);
  check("finished: the tile turns into its result (resolved), it does not vanish", st.tiles[0]!.resolved?.outcome === "done" && st.tiles[0]!.resolvedAt === t0 + 4_000);
  st = store.mergeSnapshot(st, { ...base }, t0 + 4_000 + 9_000);
  check("a finished tile nobody claimed (no gallery on screen) leaves after a few seconds", st.tiles.length === 0);
  st = store.mergeSnapshot(empty, { ...base, active: [entry("j2")] }, t0);
  st = store.mergeSnapshot(st, base, t0 + 1);
  st = store.mergeSnapshot(st, base, t0 + 2);
  check("absent from one answer: kept (never dropped on a single miss)", st.tiles.length === 1);
  st = store.mergeSnapshot(st, base, t0 + 3);
  check("absent from three answers in a row: dropped", st.tiles.length === 0);
  const failedR = { ...done, id: "j3", outcome: "failed" as const, error: "provider_error", refund: "pending" as const };
  st = store.mergeSnapshot(store.mergeSnapshot(empty, { ...base, active: [entry("j3")] }, t0), { ...base, resolved: [failedR] }, t0 + 1);
  st = store.mergeSnapshot(st, base, t0 + 10 * 60_000);
  check("a failure stays (with retry/remove) — not swept like a success", st.tiles.length === 1 && st.tiles[0]!.resolved?.outcome === "failed");
  const b1 = store.mergeSnapshot(empty, { ...base, balance: 480 }, t0 + 1);
  const b2 = store.mergeSnapshot(b1, { ...base, balance: 480 }, t0 + 2);
  check("the balance is re-announced on every answer, even unchanged (a refund back to the same number)",
    b1.balance === 480 && b2.balanceAt === t0 + 2 && b2.balanceAt !== b1.balanceAt);
  check("operations count the photos of one click once", store.activeOperations([
    { ...st.tiles[0]!, resolved: null, batch: "x", id: "1" }, { ...st.tiles[0]!, resolved: null, batch: "x", id: "2" }, { ...st.tiles[0]!, resolved: null, batch: null, id: "3" },
  ]) === 2);

  /* ══ F ═══════════════════════════════════════════════════════════════ */
  section("F. ONE CLICK, SEVERAL PHOTOS — two at a time, a limit waits, a refusal stops");
  store.resetInflightForTests();
  const { enqueueBatch, pumpAll } = await import("../lib/inflight/queue");
  const posts: Record<string, unknown>[] = [];
  let answerFor: (body: Record<string, unknown>) => unknown = (b) => ({ ok: true, accepted: true, jobId: `job-${String(b.sourcePath)}`, credits: 7, startedAt: new Date().toISOString(), expected: 1 });
  let activeList: InflightSnapshot["active"] = [];
  let resolvedList: InflightSnapshot["resolved"] = [];
  g.__fetch = async (url, init) => {
    if (url.startsWith("/api/generations/active")) {
      return { ok: true, json: async () => ({ ok: true, active: activeList, resolved: resolvedList, limit: { max: 1, active: 1, plan: "free" }, balance: 50, serverNow: new Date().toISOString() }) };
    }
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    posts.push(body);
    return { ok: true, json: async () => answerFor(body) };
  };
  const snapshotOf = (p: string) => store.frozenSnapshot({ endpoint: "/api/retouch", credits: 7, body: { sourcePath: p, resolution: "2K", format: "original", expectedOutputs: 1 } });
  let refusedWith = "";
  const batchId = enqueueBatch({
    maxInFlight: 2,
    items: ["p1", "p2", "p3", "p4"].map((p) => ({ snapshot: snapshotOf(p), tool: "retouch", operation: "image_retouch", expected: 1, ratio: null, preview: null })),
    onRefused: (o) => { refusedWith = o.error; },
  });
  await sleep(30);
  check("two photos sent at once, the rest wait (nothing charged for them)", posts.length === 2 && posts.map((b) => b.sourcePath).join() === "p1,p2", posts.map((b) => b.sourcePath));
  check("…each with the click's batch and its own request id", posts.every((b) => b.batch === batchId && typeof b.requestId === "string") && posts[0]!.requestId !== posts[1]!.requestId);
  check("the tiles exist only for the accepted photos", store.getInflightState().tiles.length === 2);
  // Photo 1 finishes on the server: the next one goes.
  resolvedList = [{ id: "job-p1", kind: "job", tool: "retouch", operation: "image_retouch", outcome: "done", items: [], delivered: 1, expected: 1, error: null, refund: "not_charged", refundedCredits: null }];
  activeList = [entry("job-p2", { tool: "retouch", batch: batchId })];
  await store.refreshInflight();
  pumpAll();
  await sleep(30);
  check("one finished → the third goes, in order", posts.length === 3 && posts[2]!.sourcePath === "p3", posts.map((b) => b.sourcePath));
  // The plan's limit refuses the fourth: it waits (not lost, not charged).
  answerFor = () => ({ ok: false, error: "concurrency_limit", limit: 1 });
  resolvedList = [{ ...resolvedList[0]!, id: "job-p2" }];
  activeList = [entry("job-p3", { tool: "retouch", batch: batchId })];
  await store.refreshInflight();
  pumpAll();
  await sleep(30);
  check("a limit refusal: the photo waits for the next change, the batch is not abandoned", posts.length === 4 && refusedWith === "");
  answerFor = (b) => ({ ok: true, accepted: true, jobId: `job-${String(b.sourcePath)}-again`, credits: 7, startedAt: new Date().toISOString(), expected: 1 });
  pumpAll();
  await sleep(30);
  check("…and goes once the server accepts it", posts.length === 5 && posts[4]!.sourcePath === "p4");
  // A real refusal stops the rest of a click.
  store.resetInflightForTests();
  posts.length = 0;
  answerFor = () => ({ ok: false, error: "insufficient_credits" });
  enqueueBatch({
    items: ["q1", "q2", "q3"].map((p) => ({ snapshot: snapshotOf(p), tool: "retouch", operation: "image_retouch", expected: 1, ratio: null, preview: null })),
    onRefused: (o) => { refusedWith = o.error; },
  });
  await sleep(30);
  check("no credits: the batch stops at the first refusal and says so once", posts.length === 1 && refusedWith === "insufficient_credits");

  /* ══ G ═══════════════════════════════════════════════════════════════ */
  section("G. THE RETRY — the frozen request, never the panel's current one");
  const paths = ["a.jpg", "b.jpg"];
  const frozen = store.frozenSnapshot({ endpoint: "/api/generate", credits: 14, body: { prompt: "kubek", referencePaths: paths, quantity: 2 } });
  paths.reverse();
  paths.push("c.jpg");
  check("a snapshot is a copy: changing the panel's arrays later changes nothing in it",
    JSON.stringify((frozen.body as { referencePaths: string[] }).referencePaths) === '["a.jpg","b.jpg"]' && Object.isFrozen(frozen));
  store.resetInflightForTests();
  posts.length = 0;
  answerFor = () => ({ ok: true, accepted: true, jobId: "job-first", credits: 14, startedAt: new Date().toISOString(), expected: 2 });
  await store.submitTracked({ snapshot: frozen, tool: "generator", operation: null, expected: 2, ratio: "1:1" });
  const failedTile = { id: "job-first", kind: "job" as const, tool: "generator", operation: null, outcome: "failed" as const, items: [], delivered: 0, expected: 2, error: "provider_error", refund: "refunded" as const, refundedCredits: 14 };
  activeList = []; resolvedList = [failedTile];
  await store.refreshInflight();
  answerFor = () => ({ ok: true, accepted: true, jobId: "job-retry", credits: 14, startedAt: new Date().toISOString(), expected: 2 });
  const out = await store.retryTile("job-first");
  const retried = posts[posts.length - 1]!;
  check("the retry sends the ORIGINAL request (photos in their order, prompt, count) with a new request id",
    out.ok && retried.prompt === "kubek" && JSON.stringify(retried.referencePaths) === '["a.jpg","b.jpg"]' && retried.quantity === 2
    && retried.requestId !== posts[0]!.requestId, retried);
  check("the failed tile is replaced only after the server accepted the new one", !store.getInflightState().tiles.some((t) => t.id === "job-first")
    && store.getInflightState().tiles.some((t) => t.id === "job-retry"));
  const repricedTile = { ...failedTile, id: "run-x", kind: "run" as const, tool: "ecommerce_thumbnail" };
  store.resetInflightForTests();
  answerFor = () => ({ ok: true, runId: "run-x", created: true, quote: { total: 41 } });
  await store.submitTracked({ snapshot: store.frozenSnapshot({ endpoint: "/api/thumbnail", credits: 41, body: { photos: ["p1", "p2"], retouch: true, quotedTotal: 41 } }), tool: "ecommerce_thumbnail", operation: "ecommerce_thumbnail", expected: 1, ratio: "1:1" });
  activeList = []; resolvedList = [repricedTile];
  await store.refreshInflight();
  answerFor = () => ({ ok: false, error: "price_changed", quote: { total: 27 } });
  const rp = await store.retryTile("run-x");
  const sentRetry = posts[posts.length - 1]!;
  check("a Miniaturka retry reuses the paid Retusz passes (reuseFrom) and asks for the new price before anything starts",
    !rp.ok && rp.error === "price_changed" && rp.quotedTotal === 27 && sentRetry.reuseFrom === "run-x" && JSON.stringify(sentRetry.photos) === '["p1","p2"]');

  /* ══ H ═══════════════════════════════════════════════════════════════ */
  section("H. THE TILE'S WORDS");
  check("Schemat Miniaturki: Retusz on = 3 steps, off = 2; a simple job has none", JSON.stringify(thumbnailStep("retouch", true)) === '{"index":1,"count":3}'
    && JSON.stringify(thumbnailStep("finish", true)) === '{"index":3,"count":3}' && JSON.stringify(thumbnailStep("compose", false)) === '{"index":1,"count":2}'
    && thumbnailStep("generate", false) === null && thumbnailStep(null, true) === null);
  check("estimate buckets match 0161's", jobEstimateKey("image_retouch", null, 1) === "image_retouch:1" && jobEstimateKey(null, "c", 9) === "concept:4"
    && jobEstimateKey(null, null, 2) === "generator:2" && runEstimateKey(true) === "ecommerce_thumbnail:retouch");
  check("0:23 / 1:05 / 12:40", formatElapsed(23_400) === "0:23" && formatElapsed(65_000) === "1:05" && formatElapsed(760_000) === "12:40");
  check("ok. 40 s, ok. 2 min", JSON.stringify(estimateParts(41_000)) === '{"unit":"s","n":40}' && JSON.stringify(estimateParts(130_000)) === '{"unit":"min","n":2}');
  check("'longer than usual' only past twice the median, never without one", isSlow(81_000, 40_000) && !isSlow(79_000, 40_000) && !isSlow(10 * 60_000, null));
  const P = pl as unknown as { inflight: Record<string, unknown>; dnd: Record<string, string>; studio: { err: Record<string, string> } };
  check("PL: the spec's sentences", (P.inflight.limit as Record<string, string>).few === "Masz {n} generacje w toku. To limit Twojego planu. Kolejną uruchomisz, gdy któraś się zakończy."
    && P.inflight.slow === "Trwa dłużej niż zwykle. Możesz zamknąć stronę, damy znać, gdy będzie gotowe."
    && P.inflight.refunded === "Kredyty wróciły na Twoje konto." && P.dnd.hint === "Przeciągnij, aby zmienić kolejność."
    && P.dnd.dropped === "Zdjęcie {n} przeniesione na pozycję {m}." && P.dnd.primary === "Główne"
    && (P.inflight.stage as Record<string, string>).retouch === "Retusz zdjęć" && (P.inflight.stage as Record<string, string>).compose === "Układanie kompozycji"
    && (P.inflight.stage as Record<string, string>).finish === "Finalny render" && (P.inflight.stage as Record<string, string>).generate === "Generowanie…");
  const keysOf = (o: unknown, pre = ""): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === "object" ? keysOf(v, `${pre}${k}.`) : [`${pre}${k}`]));
  for (const [name, dict] of [["EN", en], ["DE", de]] as const) {
    const d = dict as unknown as { inflight: unknown; dnd: unknown };
    const want = keysOf(P.inflight).filter((k) => !/^limit\.(few|many)$/.test(k));
    const have = new Set(keysOf(d.inflight));
    check(`${name}: every tile and drag string exists`, want.every((k) => have.has(k)) && keysOf(P.dnd).every((k) => keysOf(d.dnd).includes(k)), want.filter((k) => !have.has(k)));
  }
  check("no provider name, model or code in any customer string", !/gemini|openai|sunburst|provider_|nano banana/i.test(JSON.stringify([P.inflight, P.dnd])));

  /* ══ I ═══════════════════════════════════════════════════════════════ */
  section("I. THE WIRING");
  check("Miniaturka's order arrows are gone (no ChevronLeft/Right, no 'moveEarlier')",
    !/ChevronLeft|ChevronRight|moveEarlier|moveLater/.test(read("components/genv3/uploader.tsx") + read("components/genv3/sortable-grid.tsx")));
  check("every multi-photo field reorders: generator photos + inspiration, Retusz, Miniaturka, Moda pools, photo tools",
    /onMove=\{moveRef\}/.test(read("components/genv3/workspace.tsx")) && /onMove=\{\(from, to\) => setInsp/.test(read("components/genv3/workspace.tsx"))
    && /onMove=\{\(from, to\) => setPhotos/.test(read("components/retouch/workspace.tsx")) && /onMove=\{move\}/.test(read("components/thumbnail/workspace.tsx"))
    && /onMove=\{slot\.max > 1/.test(read("components/fashion/tool-workspace.tsx")) && /onMove=\{\(from, to\) => setPhotos/.test(read("components/tools/photo-tool.tsx")));
  check("'Główne' only on the generator's product photos — never inspiration",
    /primaryLabel\n/.test(read("components/genv3/sections.tsx")) && !/primaryLabel/.test(read("components/genv3/sections.tsx").slice(read("components/genv3/sections.tsx").indexOf("export function InspirationSection"))));
  check("no `touch-action: none` on a panel (only the held gesture stops the scroll)",
    !/touch-action:\s*none/.test(read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, ""))
    && !/touch-action:\s*none|touchAction: "none"/.test(read("components/genv3/sortable-grid.tsx") + read("components/genv3/sortable-photos.ts").replace(/\/\*[\s\S]*?\*\//g, "")));
  check("tiles lead every tool gallery and the library",
    ["components/genv3/workspace.tsx", "components/retouch/workspace.tsx", "components/thumbnail/workspace.tsx", "components/fashion/tool-workspace.tsx"].every((f) => /inflight=\{\{ tools: (both \? )?\[/.test(read(f)))
    && /useInflightTiles\(shelf === "image" \? "all"/.test(read("components/library/library-browser.tsx")));
  check("the tab title is the live document's only — never metadata", /document\.title = want/.test(read("components/inflight/inflight-section.tsx")) && !/metadata/.test(read("components/inflight/inflight-section.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
  check("no toast on top of a visible tile (the tool's panel, the library)", /pathname === "\/library"/.test(read("components/layout/generation-toast.tsx")));
  check("the store polls only while something runs", /if \(!hasActive\(\)\) return;/.test(read("lib/inflight/store.ts")));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

/* ── a supabase-js stand-in: tables answered from rows, filters applied ── */
function fakeSupabase(tables: Record<string, Record<string, unknown>[]>, rpcs: Record<string, unknown>) {
  const getPath = (row: Record<string, unknown>, col: string): unknown => {
    const m = /^(\w+)->>?(\w+)$/.exec(col);
    if (m) { const o = row[m[1]!] as Record<string, unknown> | null; return o ? o[m[2]!] ?? null : null; }
    return row[col];
  };
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let single = false;
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => { if (c !== "workspace_id" && c !== "user_id") rows = rows.filter((r) => getPath(r, c) === v); return b; },
      in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(getPath(r, c))); return b; },
      gte: (c: string, v: string) => { rows = rows.filter((r) => String(getPath(r, c)) >= v); return b; },
      not: (c: string, _op: string, _v: null) => { rows = rows.filter((r) => getPath(r, c) !== null && getPath(r, c) !== undefined); return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: () => { single = true; return b; },
      then: (ok: (v: { data: unknown; error: null }) => unknown) => ok({ data: single ? rows[0] ?? null : rows, error: null }),
    };
    return b;
  };
  return {
    from,
    rpc: async (name: string) => ({ data: rpcs[name] ?? null, error: null }),
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
  };
}

void main();
