/**
 * GROVNEWS — STAGE 2.1: ACCESS IS CHECKED AT THE MOMENT OF SENDING.
 *
 *   npm run test:grovnews21
 *
 * The blocker this guards: a GrovNews reader who lost access (revoked, run
 * out, account blocked) AFTER the edition was queued still got it, because
 * only the queue-time group sync ever asked about access.
 *
 * BEHAVIOUR, run for real: the newsletter worker's own send loop
 * (`drainQueue`, lib/server/newsletter/worker.ts) is driven against an
 * in-memory queue behind a fake `rpc`, with a fake mailer that records every
 * SMTP attempt. The fake guard answers from a live model of entitlements, so
 * access can be taken away BETWEEN the batch check and the final per-row check
 * — the in-batch window this stage exists to close.
 *
 * SHAPE, read from the source: migration 0122's single access predicate, its
 * grants, group sync delegating to it, and the worker's ordering (pacing delay,
 * then the final guard, then the SMTP call). The SQL functions themselves are
 * executed against a real Postgres by scripts/grovnews21-sql-tests.sh and, with
 * the real claim/finish, on PROD inside a rolled-back transaction.
 */
import fs from "node:fs";
import path from "node:path";
import type { Client } from "@/lib/services/workspace";
import type { BulkMailer, BulkMessage, BulkResult } from "@/lib/server/mailer";
import { drainQueue, GROVNEWS_ACCESS_INACTIVE } from "@/lib/server/newsletter/worker";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
}
const section = (s: string) => console.log(`\n${s}`);
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (s: string) => s.replace(/--.*$/gm, "");

/* ── THE MODEL ───────────────────────────────────────────────────────────── */

type User = { id: string; email: string; confirmed: boolean; blocked: boolean };
type Ent = { userId: string; status: "ACTIVE" | "REVOKED" | "EXPIRED"; startsAt: number; expiresAt: number | null };
type Contact = { id: string; userId: string | null; email: string; consent: boolean; unsubscribed: boolean };
type Campaign = { id: string; grovnews: boolean; status: "sending" | "sent" };
type Recipient = {
  id: string; campaignId: string; contactId: string; email: string;
  status: "pending" | "sending" | "sent" | "failed" | "skipped" | "cancelled";
  attempts: number; claimedAt: number | null; nextAttemptAt: number | null; lastError: string | null;
};

class World {
  users = new Map<string, User>();
  ents: Ent[] = [];
  contacts = new Map<string, Contact>();
  suppressed = new Set<string>();
  campaigns = new Map<string, Campaign>();
  recipients = new Map<string, Recipient>();
  order: string[] = [];
  log: string[] = [];
  guardCalls: { ids: string[]; answer: Record<string, { grovnews: boolean; allowed: boolean }> }[] = [];
  /** Fail the guard when asked about exactly this many ids (1 = the per-row check). */
  failGuardWhenAsked: number | null = null;
  /** Leave these ids out of the guard's answer (a row deleted mid-batch). */
  vanish = new Set<string>();
  smtpFailFor = new Set<string>();
  /** Runs inside the fake SMTP send, i.e. between two rows of one batch. */
  onSend: ((email: string) => void) | null = null;

  user(id: string, over: Partial<User> = {}) {
    this.users.set(id, { id, email: `${id}@example.test`, confirmed: true, blocked: false, ...over });
    return this;
  }
  grant(userId: string, over: Partial<Ent> = {}) {
    this.ents.push({ userId, status: "ACTIVE", startsAt: Date.now() - 60_000, expiresAt: null, ...over });
    return this;
  }
  contact(id: string, userId: string | null, over: Partial<Contact> = {}) {
    const email = userId ? this.users.get(userId)!.email : `${id}@example.test`;
    this.contacts.set(id, { id, userId, email, consent: true, unsubscribed: false, ...over });
    return this;
  }
  campaign(id: string, grovnews: boolean) {
    this.campaigns.set(id, { id, grovnews, status: "sending" });
    return this;
  }
  queue(id: string, campaignId: string, contactId: string) {
    const c = this.contacts.get(contactId)!;
    this.recipients.set(id, {
      id, campaignId, contactId, email: c.email, status: "pending",
      attempts: 0, claimedAt: null, nextAttemptAt: null, lastError: null,
    });
    this.order.push(id);
    return this;
  }
  revoke(userId: string) { for (const e of this.ents) if (e.userId === userId) e.status = "REVOKED"; }
  expire(userId: string, at = Date.now() - 1_000) { for (const e of this.ents) if (e.userId === userId) e.expiresAt = at; }
  block(userId: string) { this.users.get(userId)!.blocked = true; }

  /** 0122's grovnews_user_has_access, restated for the fake. */
  hasAccess(userId: string, now: number): boolean {
    const u = this.users.get(userId);
    if (!u || u.blocked) return false;
    return this.ents.some((e) => e.userId === userId && e.status === "ACTIVE"
      && e.startsAt <= now && (e.expiresAt === null || e.expiresAt > now));
  }
  /** 0122's grovnews_eligible_contacts, restated for the fake. */
  eligible(contactId: string, now: number): boolean {
    const c = this.contacts.get(contactId);
    if (!c) return false;
    const u = c.userId ? this.users.get(c.userId)
      : [...this.users.values()].find((x) => x.email === c.email);
    return !!u && u.confirmed && this.hasAccess(u.id, now);
  }
  sentTo(email: string) { return this.log.filter((l) => l === `send:${email}`).length; }
}

type RpcResult = { data: unknown; error: { message: string } | null };

function fakeClient(w: World): Client {
  const rpc = async (fn: string, args: Record<string, unknown>): Promise<RpcResult> => {
    const now = Date.now();
    switch (fn) {
      case "newsletter_queue_claim": {
        // The real claim's predicate (0094), restated — consent/suppression are
        // proven on the real function by the SQL harness, not here.
        const limit = Number(args.p_limit ?? 25);
        const rows: Record<string, unknown>[] = [];
        for (const id of w.order) {
          if (rows.length >= limit) break;
          const r = w.recipients.get(id)!;
          const c = w.contacts.get(r.contactId)!;
          const k = w.campaigns.get(r.campaignId)!;
          const claimable = (r.status === "pending" || r.status === "sending")
            && (r.nextAttemptAt === null || r.nextAttemptAt <= now)
            && c.consent && !c.unsubscribed && !w.suppressed.has(r.email)
            && (r.claimedAt === null || r.claimedAt < now - 5 * 60_000)
            && r.attempts < 5 && k.status === "sending";
          if (!claimable) continue;
          r.attempts += 1; r.claimedAt = now; r.status = "sending";
          rows.push({
            id: r.id, campaign_id: r.campaignId, step_index: 0, variant: "A", contact_id: r.contactId,
            email: r.email, attempts: r.attempts, personalization: null, first_name: "", locale: "pl",
            unsubscribe_token: `tok-${r.id}`,
          });
        }
        w.log.push(`claim:${rows.map((r) => r.id).join(",")}`);
        return { data: rows, error: null };
      }
      case "grovnews_send_guard": {
        const ids = (args.p_recipient_ids as string[]) ?? [];
        w.log.push(`guard:${ids.join(",")}`);
        if (w.failGuardWhenAsked !== null && ids.length === w.failGuardWhenAsked) {
          return { data: null, error: { message: "guard unavailable (injected)" } };
        }
        const answer: Record<string, { grovnews: boolean; allowed: boolean }> = {};
        const data = ids.filter((id) => w.recipients.has(id) && !w.vanish.has(id)).map((id) => {
          const r = w.recipients.get(id)!;
          const grovnews = w.campaigns.get(r.campaignId)!.grovnews;
          const allowed = !grovnews || w.eligible(r.contactId, Date.now());
          answer[id] = { grovnews, allowed };
          return { recipient_id: id, grovnews, allowed };
        });
        w.guardCalls.push({ ids, answer });
        return { data, error: null };
      }
      case "newsletter_queue_finish": {
        const r = w.recipients.get(String(args.p_id));
        if (!r) return { data: null, error: null };
        const status = String(args.p_status);
        w.log.push(`finish:${r.id}:${status}:${String(args.p_error ?? "")}`);
        if (status === "failed" && r.attempts < 5) {
          r.status = "pending"; r.nextAttemptAt = now + 3 ** r.attempts * 60_000;
        } else {
          r.status = status as Recipient["status"]; r.nextAttemptAt = null;
        }
        r.claimedAt = null;
        r.lastError = (args.p_error as string | undefined) ?? null;
        return { data: null, error: null };
      }
      case "newsletter_worker_context":
        return {
          data: {
            campaign: { track_opens: false, track_clicks: false, utm: {} },
            step: { editor: "html", subject: "GrovNews", preheader: "", body_html: "<p>Dzisiejsze wydanie</p>", blocks: [] },
            links: [], contacts: [],
          },
          error: null,
        };
      case "newsletter_worker_accept":
      case "newsletter_worker_stamp":
        return { data: null, error: null };
      default:
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
    }
  };
  // The admin-path direct reads answer "nothing", which is what an anonymous
  // client sees; the worker then takes the token-gated RPC path, as on cron.
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: RpcResult) => unknown) => resolve({ data: null, error: null });
      }
      return () => self;
    },
  });
  return { rpc, from: () => self } as unknown as Client;
}

function fakeMailer(w: World): BulkMailer {
  let n = 0;
  return {
    async send(message: BulkMessage): Promise<BulkResult> {
      w.log.push(`send:${message.to}`);
      w.onSend?.(message.to);
      if (w.smtpFailFor.has(message.to)) {
        return { sent: false, accepted: [], rejected: [message.to], error: "451 try later" };
      }
      return { sent: true, accepted: [message.to], rejected: [], response: "250 OK", messageId: `<m${++n}@t>` };
    },
    close() {},
    newMessageId: () => `<m${++n}@t>`,
  };
}

const TOKEN = "dispatch-token-under-test";
const drain = (w: World, pace = 5) =>
  drainQueue(fakeClient(w), TOKEN, fakeMailer(w), 20, pace, Date.now() + 60_000);

/** The log line right before the SMTP call to `email` — must be that row's own guard. */
function guardedRightBeforeSend(w: World, recipientId: string, email: string): boolean {
  const at = w.log.indexOf(`send:${email}`);
  return at > 0 && w.log[at - 1] === `guard:${recipientId}`;
}

async function main() {
  const worker = read("lib/server/newsletter/worker.ts");
  const mig = read("supabase/migrations/0122_grovnews_send_time_access.sql");

  /* ── T1–T4 ─────────────────────────────────────────────────────────────── */
  section("T1–T4. ACCESS LOST AFTER QUEUEING → NO MAIL; ACTIVE → MAIL");
  {
    // T1: revoked between queueing and the run.
    const w = new World().user("u1").grant("u1").contact("c1", "u1").campaign("g", true).queue("r1", "g", "c1");
    w.revoke("u1");
    const run = await drain(w);
    const r = w.recipients.get("r1")!;
    check("T1 revoked after enqueue → no SMTP attempt", w.sentTo("u1@example.test") === 0);
    check("T1 → row finished 'skipped' with reason grovnews_access_inactive",
      r.status === "skipped" && r.lastError === GROVNEWS_ACCESS_INACTIVE && GROVNEWS_ACCESS_INACTIVE === "grovnews_access_inactive",
      JSON.stringify(r));
    check("T1 → counted as skipped, not sent/failed", run.skipped === 1 && run.sent === 0 && run.failed === 0, JSON.stringify(run));
  }
  {
    // T2: the entitlement's own expiry passed before the send.
    const w = new World().user("u2").grant("u2", { expiresAt: Date.now() + 60_000 })
      .contact("c2", "u2").campaign("g", true).queue("r2", "g", "c2");
    w.expire("u2");
    await drain(w);
    const r = w.recipients.get("r2")!;
    check("T2 expired after enqueue → no SMTP attempt, row skipped",
      w.sentTo("u2@example.test") === 0 && r.status === "skipped" && r.lastError === GROVNEWS_ACCESS_INACTIVE);
  }
  {
    // T3: account blocked after queueing (entitlement itself still ACTIVE).
    const w = new World().user("u3").grant("u3").contact("c3", "u3").campaign("g", true).queue("r3", "g", "c3");
    w.block("u3");
    await drain(w);
    const r = w.recipients.get("r3")!;
    check("T3 account blocked after enqueue → no SMTP attempt, row skipped",
      w.sentTo("u3@example.test") === 0 && r.status === "skipped" && r.lastError === GROVNEWS_ACCESS_INACTIVE);
  }
  {
    // T4: still entitled → sent normally, and the guard spoke last.
    const w = new World().user("u4").grant("u4").contact("c4", "u4").campaign("g", true).queue("r4", "g", "c4");
    const run = await drain(w);
    const r = w.recipients.get("r4")!;
    check("T4 active reader → exactly one SMTP send, row 'sent'",
      w.sentTo("u4@example.test") === 1 && r.status === "sent" && run.sent === 1, JSON.stringify({ r, run }));
    check("T4 → the row's own guard call is the last thing before its SMTP call",
      guardedRightBeforeSend(w, "r4", "u4@example.test"), w.log.join(" | "));
  }

  /* ── IN-BATCH: THE WINDOW THE BATCH CHECK ALONE WOULD LEAVE ─────────────── */
  section("IN-BATCH. ACCESS LOST WHILE THE BATCH IS BEING PACED");
  for (const [label, take] of [
    ["revoked", (w: World) => w.revoke("ub")],
    ["expired", (w: World) => w.expire("ub")],
    ["blocked", (w: World) => w.block("ub")],
  ] as const) {
    const w = new World().user("ua").grant("ua").user("ub").grant("ub")
      .contact("ca", "ua").contact("cb", "ub").campaign("g", true)
      .queue("ra", "g", "ca").queue("rb", "g", "cb");
    // Access is taken away WHILE row A is on the wire — after the batch check
    // said yes to row B, before B's turn.
    w.onSend = (email) => { if (email === "ua@example.test") take(w); };
    await drain(w, 20);
    const batch = w.guardCalls.find((g) => g.ids.length === 2);
    check(`${label} mid-batch: the batch check had allowed row B`, batch?.answer.rb?.allowed === true, JSON.stringify(batch));
    check(`${label} mid-batch: B is NOT sent — the final per-row check refused it`,
      w.sentTo("ub@example.test") === 0 && w.recipients.get("rb")!.status === "skipped"
      && w.recipients.get("rb")!.lastError === GROVNEWS_ACCESS_INACTIVE, w.log.join(" | "));
    check(`${label} mid-batch: A (still entitled) was sent`, w.sentTo("ua@example.test") === 1);
  }
  {
    // The clock alone: B's expiry lands between the batch check and B's turn.
    const w = new World().user("ua").grant("ua").user("ub").grant("ub", { expiresAt: Date.now() + 40 })
      .contact("ca", "ua").contact("cb", "ub").campaign("g", true)
      .queue("ra", "g", "ca").queue("rb", "g", "cb");
    await drain(w, 150);
    const batch = w.guardCalls.find((g) => g.ids.length === 2);
    check("expiry by the clock alone mid-batch: batch said yes, B still not sent",
      batch?.answer.rb?.allowed === true && w.sentTo("ub@example.test") === 0
      && w.recipients.get("rb")!.status === "skipped", JSON.stringify({ batch, log: w.log }));
  }

  /* ── T5 ───────────────────────────────────────────────────────────────── */
  section("T5. AN ORDINARY NEWSLETTER CAMPAIGN IS UNCHANGED");
  {
    // A contact with NO GrovNews access at all, on an ordinary campaign.
    const w = new World().user("un").contact("cn", "un").campaign("n", false).queue("rn", "n", "cn")
      .contact("cw", null).queue("rw", "n", "cw");
    const run = await drain(w);
    check("T5 ordinary campaign → sent to a contact without GrovNews access",
      w.sentTo("un@example.test") === 1 && w.recipients.get("rn")!.status === "sent");
    check("T5 ordinary campaign → sent to a waitlist contact with no account",
      w.sentTo("cw@example.test") === 1 && w.recipients.get("rw")!.status === "sent");
    check("T5 → no per-row guard call for ordinary rows (the pre-claim probe + one batch call only)",
      w.guardCalls.length === 2 && w.guardCalls[0].ids.length === 0 && w.guardCalls[1].ids.length === 2,
      JSON.stringify(w.guardCalls));
    check("T5 → run totals exactly as before (2 sent, 0 skipped, 0 failed)",
      run.sent === 2 && run.skipped === 0 && run.failed === 0, JSON.stringify(run));
  }

  /* ── T6/T7 (the claim still decides first) ─────────────────────────────── */
  section("T6/T7. SUPPRESSION AND UNSUBSCRIBE STILL WIN (worker side)");
  {
    // Entitled readers — but suppressed / unsubscribed. The claim never hands
    // these rows over, so no guard verdict can bring them back. (The real
    // claim is executed in the SQL harness and on PROD; this proves the
    // worker adds no path around it.)
    const w = new World().user("us").grant("us").user("uu").grant("uu")
      .contact("cs", "us").contact("cu", "uu", { unsubscribed: true }).campaign("g", true)
      .queue("rs", "g", "cs").queue("ru", "g", "cu");
    w.suppressed.add("us@example.test");
    await drain(w);
    check("T6 suppressed + entitled → never sent", w.sentTo("us@example.test") === 0);
    check("T7 unsubscribed + entitled → never sent", w.sentTo("uu@example.test") === 0);
    check("T6/T7 → the guard was not even asked about them (only the empty pre-claim probe ran)",
      w.guardCalls.length === 1 && w.guardCalls[0].ids.length === 0, JSON.stringify(w.guardCalls));
  }

  /* ── T8 ───────────────────────────────────────────────────────────────── */
  section("T8. AN SMTP RETRY DOES NOT BYPASS THE GUARD");
  {
    const w = new World().user("u8").grant("u8").contact("c8", "u8").campaign("g", true).queue("r8", "g", "c8");
    w.smtpFailFor.add("u8@example.test");
    await drain(w);
    const afterFirst = { ...w.recipients.get("r8")! };
    check("T8 first attempt failed at SMTP → back to 'pending' with a backoff",
      afterFirst.status === "pending" && afterFirst.nextAttemptAt !== null, JSON.stringify(afterFirst));
    // Access is lost while the row waits for its retry; the retry comes due.
    w.revoke("u8");
    w.smtpFailFor.clear();
    w.recipients.get("r8")!.nextAttemptAt = Date.now() - 1;
    await drain(w);
    const r = w.recipients.get("r8")!;
    check("T8 retry after access was lost → no second SMTP attempt",
      w.sentTo("u8@example.test") === 1, w.log.join(" | "));
    check("T8 → row closed 'skipped' with grovnews_access_inactive",
      r.status === "skipped" && r.lastError === GROVNEWS_ACCESS_INACTIVE, JSON.stringify(r));
  }
  {
    const w = new World().user("u8b").grant("u8b").contact("c8b", "u8b").campaign("g", true).queue("r8b", "g", "c8b");
    w.smtpFailFor.add("u8b@example.test");
    await drain(w);
    w.smtpFailFor.clear();
    w.recipients.get("r8b")!.nextAttemptAt = Date.now() - 1;
    await drain(w);
    check("T8 retry while still entitled → delivered on the retry, guard asked right before it",
      w.recipients.get("r8b")!.status === "sent" && guardedRightBeforeSend(w, "r8b", "u8b@example.test"));
  }

  /* ── T9 ───────────────────────────────────────────────────────────────── */
  section("T9. ONE BATCH, MIXED READERS");
  {
    const w = new World()
      .user("ok1").grant("ok1").user("ok2").grant("ok2", { expiresAt: Date.now() + 86_400_000 })
      .user("rev").grant("rev").user("exp").grant("exp").user("blk").grant("blk")
      .user("nog")
      .campaign("g", true).campaign("n", false);
    for (const u of ["ok1", "rev", "ok2", "exp", "blk", "nog"]) w.contact(`c-${u}`, u).queue(`r-${u}`, "g", `c-${u}`);
    w.contact("c-plain", null).queue("r-plain", "n", "c-plain");
    w.revoke("rev"); w.expire("exp"); w.block("blk");
    const run = await drain(w);
    const status = (id: string) => w.recipients.get(id)!.status;
    check("T9 active readers → sent", status("r-ok1") === "sent" && status("r-ok2") === "sent");
    check("T9 revoked → skipped", status("r-rev") === "skipped");
    check("T9 expired → skipped", status("r-exp") === "skipped");
    check("T9 blocked → skipped", status("r-blk") === "skipped");
    check("T9 never entitled (stale group member) → skipped", status("r-nog") === "skipped");
    check("T9 ordinary row in the same batch → sent", status("r-plain") === "sent");
    check("T9 → SMTP attempted for exactly the 3 allowed rows",
      w.log.filter((l) => l.startsWith("send:")).length === 3, w.log.join(" | "));
    check("T9 → probe, one batch guard call, then one final call per allowed GrovNews row only",
      w.guardCalls.length === 4 && w.guardCalls[0].ids.length === 0 && w.guardCalls[1].ids.length === 7
      && w.guardCalls.slice(2).every((g) => g.ids.length === 1), JSON.stringify(w.guardCalls.map((g) => g.ids)));
    check("T9 → run totals", run.sent === 3 && run.skipped === 4 && run.failed === 0, JSON.stringify(run));
  }

  /* ── FAIL CLOSED ──────────────────────────────────────────────────────── */
  section("FAIL CLOSED. A GUARD THAT CANNOT ANSWER SENDS NOTHING UNVERIFIED");
  {
    const w = new World().user("f1").grant("f1").contact("cf1", "f1").campaign("g", true).queue("rf1", "g", "cf1")
      .contact("cf2", null).campaign("n", false).queue("rf2", "n", "cf2");
    w.failGuardWhenAsked = 0;
    const run = await drain(w);
    check("guard unreachable BEFORE the claim → nothing claimed, no attempt spent, nothing sent",
      w.log.every((l) => !l.startsWith("claim:") && !l.startsWith("send:"))
      && w.recipients.get("rf1")!.attempts === 0 && w.recipients.get("rf2")!.status === "pending", w.log.join(" | "));
    check("→ the run says why", run.reason === "grovnews_guard_unavailable" && run.claimed === 0, JSON.stringify(run));
    // Five such runs in a row still strand nothing: the rows are untouched.
    for (let i = 0; i < 5; i++) await drain(w);
    check("→ five failing runs later the rows are still pending with 0 attempts (nothing stranded)",
      w.recipients.get("rf1")!.attempts === 0 && w.recipients.get("rf1")!.status === "pending");
  }
  {
    const w = new World().user("f1").grant("f1").contact("cf1", "f1").campaign("g", true).queue("rf1", "g", "cf1")
      .contact("cf2", null).campaign("n", false).queue("rf2", "n", "cf2");
    w.failGuardWhenAsked = 2;
    const run = await drain(w);
    check("batch guard fails AFTER the claim → no SMTP attempt at all", w.log.every((l) => !l.startsWith("send:")), w.log.join(" | "));
    check("→ every claimed row (ordinary too) back to 'pending' with a backoff, never left 'sending'",
      ["rf1", "rf2"].every((id) => w.recipients.get(id)!.status === "pending" && w.recipients.get(id)!.nextAttemptAt !== null
        && w.recipients.get(id)!.lastError === "grovnews_guard_unavailable"), JSON.stringify([...w.recipients.values()]));
    check("→ the run says why", run.reason === "grovnews_guard_unavailable" && run.sent === 0 && run.failed === 2, JSON.stringify(run));
    // At the attempt ceiling the newsletter's own finish turns it terminal.
    for (let i = 0; i < 6; i++) { for (const r of w.recipients.values()) r.nextAttemptAt = Date.now() - 1; await drain(w); }
    check("→ a guard that never recovers ends in a terminal 'failed' at the 5-attempt ceiling, not a stuck 'sending'",
      ["rf1", "rf2"].every((id) => w.recipients.get(id)!.status === "failed" && w.recipients.get(id)!.attempts === 5),
      JSON.stringify([...w.recipients.values()]));
  }
  {
    const w = new World().user("f3").grant("f3").contact("cf3", "f3").campaign("g", true).queue("rf3", "g", "cf3")
      .contact("cf4", null).campaign("n", false).queue("rf4", "n", "cf4");
    w.failGuardWhenAsked = 1;
    const run = await drain(w);
    const r = w.recipients.get("rf3")!;
    check("final per-row guard unavailable → that GrovNews row is not sent",
      w.sentTo("f3@example.test") === 0);
    check("→ it goes back through the ordinary backoff with a clear reason",
      r.status === "pending" && r.lastError === "grovnews_guard_unavailable", JSON.stringify(r));
    check("→ the ordinary row in the same batch is still sent", w.recipients.get("rf4")!.status === "sent" && run.sent === 1);
  }
  {
    const w = new World().user("f5").grant("f5").contact("cf5", "f5").campaign("g", true).queue("rf5", "g", "cf5");
    w.vanish.add("rf5");
    await drain(w);
    check("a row missing from the guard's answer (deleted mid-batch) → not sent, nothing written",
      w.sentTo("f5@example.test") === 0 && w.log.every((l) => !l.startsWith("finish:")));
  }

  /* ── SHAPE: THE WORKER ─────────────────────────────────────────────────── */
  section("SHAPE. THE WORKER CHANGE IS MINIMAL AND ORDERED");
  {
    const src = code(worker);
    const loop = src.slice(src.indexOf("export async function drainQueue"), src.indexOf("async function fillExtrasDirect"));
    const sleepAt = loop.indexOf("await sleep(pace)");
    const finalAt = loop.indexOf("grovnewsGuard(supabase, token, [row.id])");
    const sendAt = loop.indexOf("await sendOne(");
    check("final guard sits AFTER the pacing delay and BEFORE the SMTP call",
      sleepAt > 0 && finalAt > sleepAt && sendAt > finalAt, `${sleepAt} ${finalAt} ${sendAt}`);
    check("the final guard is asked only for GrovNews rows", /if \(verdict\.grovnews\) \{\s*const now = await grovnewsGuard/.test(loop));
    check("an empty guard probe runs BEFORE the claim (no attempt is spent when the guard is down)",
      loop.indexOf("grovnewsGuard(supabase, token, [])") > 0
      && loop.indexOf("grovnewsGuard(supabase, token, [])") < loop.indexOf('rpc("newsletter_queue_claim"'));
    check("batch guard runs after the claim and before the first send",
      loop.indexOf("grovnewsGuard(supabase, token, rows.map") > loop.indexOf('rpc("newsletter_queue_claim"')
      && loop.indexOf("grovnewsGuard(supabase, token, rows.map") < sendAt);
    check("a refused row is closed through the newsletter's own finish, as 'skipped'",
      (loop.match(/finish\(supabase, token, row\.id, "skipped", GROVNEWS_ACCESS_INACTIVE\)/g) ?? []).length === 2);
    check("the only new RPC is grovnews_send_guard, through the token-gated door",
      /serverRpc\(supabase\)\.rpc\("grovnews_send_guard", \{\s*p_token: token, p_recipient_ids: ids,/.test(src));
    check("no AI, no entitlement table read, no direct SQL from the worker",
      !/grovnews_entitlements|from\("grovnews/.test(src));
    check("claim/finish/start_due calls are unchanged in the worker",
      /rpc\("newsletter_queue_claim", \{\s*p_token: token, p_limit: limit,/.test(src)
      && /rpc\("newsletter_start_due", \{ p_token: token \}\)/.test(src));
  }

  /* ── SHAPE: MIGRATION 0122 ─────────────────────────────────────────────── */
  section("SHAPE. MIGRATION 0122 — ONE SOURCE OF TRUTH, CLOSED DOORS");
  {
    const sql = sqlCode(mig);
    const body = (name: string) => {
      const m = sql.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\n(?:end \\$\\$|\\$\\$);`));
      return m ? m[0] : "";
    };
    const resolver = body("grovnews_user_has_access");
    check("the access predicate (status ACTIVE + window) exists exactly once, in grovnews_user_has_access",
      (sql.match(/e\.status = 'ACTIVE'/g) ?? []).length === 1 && /e\.status = 'ACTIVE'/.test(resolver)
      && /e\.starts_at <= now\(\)/.test(resolver) && /e\.expires_at is null or e\.expires_at > now\(\)/.test(resolver));
    check("resolver refuses a blocked account and a NULL user",
      /not public\.account_blocked\(p_user_id\)/.test(resolver) && /p_user_id is not null/.test(resolver));
    check("grovnews_has_access() delegates to the resolver (reader, RLS, current edition)",
      /select public\.grovnews_user_has_access\(auth\.uid\(\)\)/.test(body("grovnews_has_access")));
    const elig = body("grovnews_eligible_contacts");
    check("contact eligibility asks the resolver, with 0121's linking rules (user_id, else CONFIRMED auth address)",
      (elig.match(/public\.grovnews_user_has_access\(u\.id\)/g) ?? []).length === 2
      && (elig.match(/u\.email_confirmed_at is not null/g) ?? []).length === 2
      && /join auth\.users u on u\.id = c\.user_id/.test(elig)
      && /join auth\.users u on lower\(u\.email\) = c\.email/.test(elig) && /c\.user_id is null/.test(elig));
    check("contact eligibility is set-based (one pass), not a per-contact lookup", /language sql/.test(elig) && /\bunion\b/.test(elig));
    const sync = body("grovnews_group_sync_core");
    check("group sync uses the same resolver (via contact eligibility) and carries no copy of the predicate",
      /public\.grovnews_eligible_contacts\(null\)/.test(sync) && !/grovnews_entitlements|e\.status|expires_at|auth\.users/.test(sync));
    check("group sync still refuses a dynamic group", /raise exception 'grovnews_group_dynamic'/.test(sync));
    const guard = body("grovnews_send_guard");
    check("send guard: dispatch token first, then a bounded batch",
      guard.indexOf("server_call_ok(p_token)") > 0 && guard.indexOf("server_call_ok(p_token)") < guard.indexOf("return query")
      && /cardinality\(p_recipient_ids\) > 200/.test(guard));
    check("send guard is read-only (decides; the worker closes the row via newsletter_queue_finish)",
      !/\b(update|insert|delete)\b/i.test(guard.replace(/p_recipient_ids/g, "")));
    check("send guard: ordinary campaigns always allowed; GrovNews = edition's campaign or audience exactly [grovnews]",
      /case when t\.is_grovnews then t\.contact_id in \(select e\.id from eligible e\) else true end/.test(guard)
      && /public\.grovnews_eligible_contacts\(\s*coalesce\(\(select array_agg\(t\.contact_id\) from target t where t\.is_grovnews\), '\{\}'\)\)/.test(guard)
      && /e\.campaign_id = r\.campaign_id/.test(guard)
      && /k\.audience->'include' = jsonb_build_array\(g\.id::text\)/.test(guard));
    check("resolver + eligibility are internal: revoked from public, anon, authenticated; never granted",
      /revoke all on function public\.grovnews_user_has_access\(uuid\) from public, anon, authenticated;/.test(sql)
      && /revoke all on function public\.grovnews_eligible_contacts\(uuid\[\]\) from public, anon, authenticated;/.test(sql)
      && !/grant execute on function public\.grovnews_(user_has_access|eligible_contacts)/.test(sql));
    check("guard reachable by the worker's clients only through the token (anon/authenticated + server_call_ok)",
      /revoke all on function public\.grovnews_send_guard\(text, uuid\[\]\) from public, anon, authenticated;\s*grant execute on function public\.grovnews_send_guard\(text, uuid\[\]\) to anon, authenticated;/.test(sql));
    check("every new function is SECURITY DEFINER with a pinned search_path",
      ["grovnews_user_has_access", "grovnews_eligible_contacts", "grovnews_send_guard", "grovnews_has_access", "grovnews_group_sync_core"]
        .every((n) => /security definer\s+set search_path = public/.test(body(n))));
    check("0122 does not touch the newsletter core (claim/finish/start_due/worker_context)",
      !/newsletter_queue_claim|newsletter_queue_finish|newsletter_start_due|newsletter_worker_context/.test(sql));
    check("0122 is one transaction", /^\s*begin;/m.test(sql) && /^\s*commit;\s*$/m.test(sql));
    // The latest definition wins: nothing after 0122 re-defines these.
    const later = fs.readdirSync(path.join(process.cwd(), "supabase/migrations"))
      .filter((f) => f > "0122_grovnews_send_time_access.sql" && f.endsWith(".sql"))
      .some((f) => /function public\.grovnews_(has_access|group_sync_core)\b/.test(read(`supabase/migrations/${f}`)));
    check("no later migration re-defines grovnews_has_access / grovnews_group_sync_core", !later);
  }

  console.log(failed ? `\n${failed} FAILED` : "\nAll GrovNews Stage 2.1 tests passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
