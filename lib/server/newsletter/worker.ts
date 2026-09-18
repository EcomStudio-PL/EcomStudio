import "server-only";
import type { Client } from "@/lib/services/workspace";
import { escapeHtml } from "@/lib/server/email-template";
import { readIntegrationSecrets, type MailConfig } from "@/lib/server/integrations";
import {
  bulkMailer, verifySmtp,
  type BulkMailer, type MailIdentity, type SmtpConfig,
} from "@/lib/server/mailer";
import { renderCampaign } from "@/lib/server/newsletter/render";
import { paceMs, readSettings, writeSettings } from "@/lib/server/newsletter/settings";
import { dispatchToken } from "@/lib/server/server-token";
import { getCampaign, getContact, listSteps, ensureLinks } from "@/lib/services/newsletter";
import {
  toBlocks, toUtm, usedMergeFields,
  type MailBlock, type MergeValues, type Utm,
} from "@/lib/newsletter";
import { SITE_URL } from "@/lib/site";

/**
 * THE SENDER. One invocation, one bounded batch, no opinions of its own.
 *
 * Everything that decides WHAT goes out happened before this file ran: an
 * operator wrote the campaign, the confirm screen froze the audience into
 * newsletter_recipients, and — when AI personalisation is on — the subjects and
 * intros were generated and written onto those rows. This module's whole job is
 * to take rows the database hands it, turn each into an email, and report back
 * what the mail server said. It generates nothing.
 *
 * THAT IS A HARD RULE, NOT A PREFERENCE. NEVER CALL AN AI PROVIDER FROM HERE.
 * A generation inside the send loop would put a third-party API on the critical
 * path of every message: its latency lands inside the function's timeout, its
 * outage becomes a failed send, and its cost becomes a per-recipient cost
 * incurred while an SMTP connection sits open. Personalisation is read from
 * `newsletter_recipients.personalization` — a column written before the send —
 * and if it is absent the step is sent as written.
 *
 * WHY THE BATCH SIZE IS NOT THE OPERATOR'S BATCH SIZE.
 *
 * The rate limit decides how many messages fit in one invocation, not the
 * `batchSize` dial. At the default 360/hour a message leaves every ten seconds,
 * so a serverless function with sixty seconds to live can honestly attempt
 * about four — claiming twenty would mean sixteen rows sitting in 'sending'
 * when the function is killed, waiting five minutes for the reaper, with an
 * attempt spent on each. So the claim is capped by the time budget, and
 * `batchSize` is the ceiling rather than the target. See `batchLimit`.
 *
 * WHY EVERY DATABASE READ HAS TWO PATHS.
 *
 * The queue's own doors (claim/finish/start_due, migration 0094) authenticate
 * with the dispatch token, so the scheduled path can run with the anonymous key
 * and no session. But rendering a message needs the campaign, its step and its
 * links, and those three tables are admin-only under RLS — an anonymous client
 * reads them as empty, not as an error. Migration 0095 therefore opens one
 * token-gated read door, `newsletter_worker_context`.
 *
 * Both paths stay live on purpose. An admin pressing "wyślij teraz" calls this
 * with their own session and the ordinary service functions answer; the cron
 * calls it with the anonymous client and the RPC answers. That is what keeps
 * the product working if 0095 is never applied: the button still sends, and
 * only minute-precision scheduling is missing.
 */

/* ── WHAT ONE INVOCATION REPORTS ─────────────────────────────────────────── */

export type WorkerRun = {
  /** Rows this invocation took ownership of. Each one cost an attempt. */
  claimed: number;
  /** Rows the mail server accepted at least one address for. */
  sent: number;
  /** Rows the mail server refused, or that threw. Below five attempts these
   *  return to the queue with a backoff; the fifth one stays failed. */
  failed: number;
  /**
   * Claimed but never attempted: either the step behind the row no longer
   * exists (finished 'skipped', which is terminal — there is nothing to send)
   * or the invocation ran out of time before its turn, in which case the row is
   * deliberately left in 'sending' for the five-minute reaper rather than
   * marked failed. A timeout is not a rejection and must not read like one.
   */
  skipped: number;
  /** True only when the kill switch is on. Nothing was claimed. */
  paused: boolean;
  /**
   * Why this run did nothing, as a machine code the settings screen maps to its
   * own copy: "paused", "no_server_token", "smtp_not_configured",
   * "smtp_unavailable", "claim_failed". Absent on a run that reached the queue.
   */
  reason?: string;
};

/** Sixty seconds is what the platform allows the route (maxDuration = 60); ten
 *  of them are left for the claim, the reads, the finishes and the stamp. */
const RUN_BUDGET_MS = 50_000;

/** What one message costs beyond the pacing delay: connect (pooled, so usually
 *  free), DATA, and the server's answer. Deliberately pessimistic — it is the
 *  divisor that keeps a batch inside the budget. */
const MIN_SLOT_MS = 1_500;

const EMPTY: WorkerRun = { claimed: 0, sent: 0, failed: 0, skipped: 0, paused: false };

/* ── THE ONE TYPED HOLE ──────────────────────────────────────────────────── */

/**
 * `lib/database.types.ts` is generated from the schema that is APPLIED, and
 * 0095 is not applied yet — by design, it ships as a file an operator runs.
 * Until it is, `supabase.rpc("newsletter_worker_context")` cannot type-check
 * against the generated union, and regenerating that file here would claim a
 * migration has been applied when it has not.
 *
 * So the three 0095 functions are reached through this structural view of the
 * client. It is a cast through `unknown`, not an `any` and not a suppressed
 * error: everything that comes back is still `unknown` and is parsed by the
 * readers below before a single field of it is used.
 */
type ServerRpc = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const serverRpc = (supabase: Client): ServerRpc => supabase as unknown as ServerRpc;

/* ── PARSING WHAT COMES BACK ─────────────────────────────────────────────── */

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The AI-written subject and opening paragraph for ONE recipient, generated
 * before the send and stored on the row.
 *
 * `cta` and `body` exist in the column's documented shape and are deliberately
 * NOT read here. Nothing generates them yet, and a half-implemented override
 * that silently replaces an operator's call to action the day something starts
 * writing that key is a worse outcome than not supporting it at all.
 */
type Personalization = { subject: string; intro: string };

function toPersonalization(value: unknown): Personalization | null {
  const raw = asRecord(value);
  const subject = asString(raw.subject).trim();
  const intro = asString(raw.intro).trim();
  if (!subject && !intro) return null;
  return { subject, intro };
}

/* ── ONE CLAIMED ROW ─────────────────────────────────────────────────────── */

/** Exactly the columns `newsletter_queue_claim` returns. Nothing is read from
 *  the recipient row that the claim did not already hand over — a second read
 *  would be a second chance for the row to have changed under us. */
type ClaimedRow = {
  id: string;
  campaignId: string;
  stepIndex: number;
  variant: string;
  contactId: string;
  email: string;
  firstName: string;
  locale: string;
  unsubscribeToken: string;
  personalization: Personalization | null;
};

/* ── ONE STEP, RENDERED ONCE PER BATCH ───────────────────────────────────── */

/**
 * Everything needed to render a message, resolved once per
 * campaign+step+variant. Twenty recipients of one campaign read the campaign
 * row, the step row and the link table ONCE between them; only
 * `renderCampaign` runs per person, because merge values and the tracking ids
 * genuinely differ per person.
 */
type StepDefinition = {
  trackOpens: boolean;
  trackClicks: boolean;
  utm: Utm;
  subject: string;
  preheader: string;
  editor: "builder" | "html";
  blocks: MailBlock[];
  bodyHtml: string;
  /** Destination URL → newsletter_links.id, registered at snapshot time. */
  links: Map<string, string>;
  /**
   * Whether this body uses `{{last_name}}` or `{{source}}`. The queue hands
   * over first name, locale and address; those two live on the contact. Asking
   * for them on every batch would be a round trip per send for a tag almost no
   * campaign uses, so the body is asked first.
   */
  needsContactExtras: boolean;
};

/** Contact fields the queue does not carry, keyed by contact id. */
type ContactExtras = Map<string, { lastName: string; source: string }>;

type StepLoad =
  | { ok: true; definition: StepDefinition }
  /** The step is genuinely gone — deleted, or the variant was renamed. Nothing
   *  to send, ever; the row is closed rather than retried forever. */
  | { ok: false; kind: "missing" }
  /** The step could not be READ — 0095 is not applied and this is the anonymous
   *  path, or the RPC errored. Transient, so the row goes back to the queue. */
  | { ok: false; kind: "unreadable" };

/** Which merge tags a step's own words use. Built from the source the author
 *  typed, not from the rendered HTML, so a tag inside an attribute counts. */
function mergeFieldsUsed(
  subject: string, preheader: string, editor: string, blocks: MailBlock[], bodyHtml: string,
): string[] {
  const source = editor === "html"
    ? `${subject} ${preheader} ${bodyHtml}`
    : [subject, preheader, ...blocks.flatMap((b) => [b.text, b.text2, b.label, b.alt, b.url])]
      .filter((v): v is string => typeof v === "string").join(" ");
  return usedMergeFields(source);
}

/**
 * The admin path: the ordinary service functions, under the caller's own
 * session. `ensureLinks` with an empty list is a pure read — it registers
 * nothing, which is exactly right here, because registering a link mid-send
 * would hand different recipients of one campaign different link ids.
 */
async function loadStepDirect(
  supabase: Client, campaignId: string, stepIndex: number, variant: string,
): Promise<StepLoad> {
  const campaign = await getCampaign(supabase, campaignId);
  if (!campaign) return { ok: false, kind: "unreadable" };

  const steps = await listSteps(supabase, campaignId);
  const step = steps.find((s) => s.stepIndex === stepIndex && s.variant === variant)
    // A campaign that was authored without variants still has to send when a
    // row asks for one: fall back to the step at this index, whatever it is.
    ?? steps.find((s) => s.stepIndex === stepIndex);
  if (!step) return { ok: false, kind: "missing" };

  const used = mergeFieldsUsed(step.subject, step.preheader, step.editor, step.blocks, step.bodyHtml);
  return {
    ok: true,
    definition: {
      trackOpens: campaign.trackOpens,
      trackClicks: campaign.trackClicks,
      utm: campaign.utm,
      subject: step.subject,
      preheader: step.preheader,
      editor: step.editor,
      blocks: step.blocks,
      bodyHtml: step.bodyHtml,
      links: await ensureLinks(supabase, campaignId, []),
      needsContactExtras: used.includes("last_name") || used.includes("source"),
    },
  };
}

/**
 * The scheduled path: one token-gated RPC, added by 0095, that answers with the
 * campaign's tracking settings, the step's words and the campaign's links in a
 * single round trip. The contact ids travel with it so the extras come back in
 * the same answer rather than costing a second call.
 */
async function loadStepViaRpc(
  supabase: Client, token: string,
  campaignId: string, stepIndex: number, variant: string, contactIds: string[],
): Promise<{ load: StepLoad; extras: ContactExtras }> {
  const extras: ContactExtras = new Map();
  const { data, error } = await serverRpc(supabase).rpc("newsletter_worker_context", {
    p_token: token,
    p_campaign: campaignId,
    p_step: stepIndex,
    p_variant: variant,
    p_contacts: contactIds,
  });
  if (error) {
    // The message only. A Postgres error can echo the arguments that produced
    // it, and one of those is the dispatch token.
    console.error("newsletter.worker.context", error.message.slice(0, 120));
    return { load: { ok: false, kind: "unreadable" }, extras };
  }

  const payload = asRecord(data);
  const step = asRecord(payload.step);
  // An answer with no step is the function saying the step is gone. An answer
  // with nothing at all is the function refusing the token — those two must not
  // look the same, because one is terminal and the other is not.
  if (Object.keys(payload).length === 0) return { load: { ok: false, kind: "unreadable" }, extras };
  if (Object.keys(step).length === 0) return { load: { ok: false, kind: "missing" }, extras };

  const campaign = asRecord(payload.campaign);
  const links = new Map<string, string>();
  for (const entry of Array.isArray(payload.links) ? payload.links : []) {
    const link = asRecord(entry);
    const url = asString(link.url);
    const id = asString(link.id);
    if (url && id) links.set(url, id);
  }
  for (const entry of Array.isArray(payload.contacts) ? payload.contacts : []) {
    const contact = asRecord(entry);
    const id = asString(contact.id);
    if (id) extras.set(id, { lastName: asString(contact.last_name), source: asString(contact.source_key) });
  }

  const editor = step.editor === "html" ? "html" : "builder";
  const blocks = toBlocks(step.blocks);
  const subject = asString(step.subject);
  const preheader = asString(step.preheader);
  const bodyHtml = asString(step.body_html);
  const used = mergeFieldsUsed(subject, preheader, editor, blocks, bodyHtml);

  return {
    load: {
      ok: true,
      definition: {
        trackOpens: campaign.track_opens !== false,
        trackClicks: campaign.track_clicks !== false,
        utm: toUtm(campaign.utm),
        subject, preheader, editor, blocks, bodyHtml, links,
        needsContactExtras: used.includes("last_name") || used.includes("source"),
      },
    },
    extras,
  };
}

/* ── PERSONALISATION ─────────────────────────────────────────────────────── */

/**
 * Put the generated opening paragraph where an opening paragraph goes.
 *
 * It is inserted AFTER any leading logo and heading, not at the very top: a
 * personal greeting above the masthead reads like a bug, and below the heading
 * it reads like the letter it is meant to be. Everything the author wrote
 * survives — the intro is added, never a replacement for a block.
 *
 * On the HTML path the document is the author's and cannot be parsed with any
 * confidence, so the paragraph is prepended and the sanitiser sees it like the
 * rest of the body.
 */
function withIntro(
  definition: StepDefinition, intro: string,
): { blocks: MailBlock[]; bodyHtml: string } {
  if (!intro) return { blocks: definition.blocks, bodyHtml: definition.bodyHtml };

  if (definition.editor === "html") {
    return {
      blocks: definition.blocks,
      bodyHtml: `<p>${escapeHtml(intro)}</p>${definition.bodyHtml}`,
    };
  }

  let at = 0;
  while (at < definition.blocks.length
    && (definition.blocks[at].type === "logo" || definition.blocks[at].type === "heading")) {
    at += 1;
  }
  const blocks = [...definition.blocks];
  blocks.splice(at, 0, { id: "personalised-intro", type: "text", text: intro });
  return { blocks, bodyHtml: definition.bodyHtml };
}

/* ── THE RUN ─────────────────────────────────────────────────────────────── */

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * How many rows this invocation may honestly take.
 *
 * One message costs its pacing delay plus a round trip, and the platform gives
 * the route sixty seconds. Claiming more than fits is not optimism, it is
 * damage: every surplus row has its attempt spent, sits in 'sending' until the
 * five-minute reaper, and arrives five minutes late for no reason. `batchSize`
 * is the operator's ceiling; this is the floor the clock imposes on it.
 */
function batchLimit(batchSize: number, pace: number): number {
  const perMessage = Math.max(1, pace + MIN_SLOT_MS);
  return Math.max(1, Math.min(batchSize, Math.floor(RUN_BUDGET_MS / perMessage)));
}

/** The mailbox, as the newsletter needs it: the same one every other GrovBase
 *  message goes out on. There is deliberately no second transport — a marketing
 *  mail from a different identity than the one a customer trusts is worse than
 *  no marketing mail. */
async function resolveMailbox(
  supabase: Client,
): Promise<{ smtp: SmtpConfig; identity: MailIdentity } | null> {
  const { config, secrets } = await readIntegrationSecrets<MailConfig>(supabase, "mail");
  const password = secrets.smtp_password
    ?? (config.smtp_same_as_imap ? secrets.imap_password : undefined);
  if (!config.smtp_host.trim() || !config.smtp_user.trim() || !password) return null;
  return {
    smtp: {
      host: config.smtp_host,
      port: config.smtp_port,
      user: config.smtp_user,
      encryption: config.smtp_encryption === "starttls" ? "tls"
        : config.smtp_encryption === "ssl" ? "ssl" : "auto",
      password,
    },
    identity: {
      from_name: config.from_name || "GrovBase",
      from_email: config.email,
      reply_to: config.email,
    },
  };
}

/**
 * Send one batch.
 *
 * The order of the first four steps is the whole safety argument and must not
 * be rearranged: read the kill switch, prove we are the server, start what is
 * due, then prove the mailbox answers — and only then claim. Claiming before
 * the preflight would spend an attempt on every row in the batch to discover
 * something that could have been discovered for free, and five of those in a
 * row retire a recipient permanently.
 */
export async function runWorkerBatch(supabase: Client): Promise<WorkerRun> {
  /* a. THE KILL SWITCH, FIRST AND CHEAPEST.
        §74's pause is marketing-only and has to take effect within one batch,
        so it is read before anything is claimed and before the mailbox is even
        opened. Auth mail, login codes and admin notifications are a different
        transport path entirely and are never affected by it. */
  const settings = await readSettings(supabase);
  if (settings.paused) return { ...EMPTY, paused: true, reason: "paused" };

  /* b. PROOF OF SERVER.
        The queue's functions check sha256(token) against a published hash.
        There is no session fallback by design: the alternative would be a mass
        mailing that any request carrying an admin cookie could trigger. */
  const token = dispatchToken();
  if (!token) return { ...EMPTY, reason: "no_server_token" };

  /* c. WHAT THE CLOCK SAYS IS DUE.
        Cheap, bounded, and separate from the claim so a scheduled campaign
        becomes 'sending' even on an invocation that then finds no mailbox. */
  const { error: dueError } = await supabase.rpc("newsletter_start_due", { p_token: token });
  if (dueError) console.error("newsletter.worker.startDue", dueError.message.slice(0, 120));

  /* d. THE MAILBOX, PROVEN BEFORE ANYTHING IS CLAIMED. */
  const mailbox = await resolveMailbox(supabase);
  if (!mailbox) return { ...EMPTY, reason: "smtp_not_configured" };

  const verified = await verifySmtp(mailbox.smtp);
  if (!verified.ok) {
    await stampRun(supabase, token, EMPTY, verified.error ?? "smtp_unavailable");
    return { ...EMPTY, reason: "smtp_unavailable" };
  }

  const pace = paceMs(settings.ratePerHour);
  const mailer = bulkMailer(mailbox.smtp, mailbox.identity, {
    // One connection. The mailbox is shared hosting and the SMTP password is
    // the same credential the admin inbox polls IMAP with — a throttle here
    // takes the inbox down with it.
    connections: 1,
    messagesPerConnection: 50,
    // nodemailer's own governor, expressed per MINUTE rather than per hour so a
    // burst cannot spend the whole hour's allowance in the first sixty seconds.
    // The explicit sleep below is the real pacing; this is the backstop for a
    // future caller that forgets it.
    limit: Math.max(1, Math.round(settings.ratePerHour / 60)),
    deltaMs: 60_000,
  });
  if (!mailer) return { ...EMPTY, reason: "smtp_not_configured" };

  try {
    return await drainQueue(supabase, token, mailer, settings.batchSize, pace);
  } finally {
    // A pooled transport keeps its sockets open. Leaving one behind on a
    // serverless platform means a connection the mailbox counts against us
    // until it times out server-side.
    mailer.close();
  }
}

async function drainQueue(
  supabase: Client, token: string, mailer: BulkMailer, batchSize: number, pace: number,
): Promise<WorkerRun> {
  const limit = batchLimit(batchSize, pace);
  const { data, error } = await supabase.rpc("newsletter_queue_claim", {
    p_token: token, p_limit: limit,
  });
  if (error) {
    console.error("newsletter.worker.claim", error.message.slice(0, 120));
    return { ...EMPTY, reason: "claim_failed" };
  }

  const rows: ClaimedRow[] = (data ?? []).map((r) => ({
    id: r.id,
    campaignId: r.campaign_id,
    stepIndex: r.step_index,
    variant: r.variant,
    contactId: r.contact_id,
    email: r.email,
    firstName: r.first_name ?? "",
    locale: r.locale ?? "pl",
    unsubscribeToken: r.unsubscribe_token,
    personalization: toPersonalization(r.personalization),
  }));

  const run: WorkerRun = { ...EMPTY, claimed: rows.length };
  if (rows.length === 0) {
    await stampRun(supabase, token, run, null);
    return run;
  }

  /*
    GROUP BEFORE SENDING. Twenty recipients of one campaign share one campaign
    row, one step row and one link table; resolving that per recipient would be
    sixty round trips to answer the same question twenty times, inside a
    sixty-second budget that is already mostly pacing delay.
  */
  const groups = new Map<string, { campaignId: string; stepIndex: number; variant: string; contactIds: string[] }>();
  for (const row of rows) {
    const key = `${row.campaignId}|${row.stepIndex}|${row.variant}`;
    const group = groups.get(key);
    if (group) group.contactIds.push(row.contactId);
    else {
      groups.set(key, {
        campaignId: row.campaignId, stepIndex: row.stepIndex, variant: row.variant,
        contactIds: [row.contactId],
      });
    }
  }

  const definitions = new Map<string, StepLoad>();
  const extras: ContactExtras = new Map();
  /*
    WHICH DOOR ANSWERS, DECIDED ONCE PER RUN.

    An anonymous client reads an admin-only table as EMPTY rather than as an
    error, so the direct read cannot tell "no such campaign" from "not allowed
    to look". Trying it once and remembering the answer costs one wasted query
    per invocation on the scheduled path and none at all on the admin path.
  */
  let directReads = true;
  for (const [key, group] of groups) {
    if (directReads) {
      const load = await loadStepDirect(supabase, group.campaignId, group.stepIndex, group.variant);
      if (load.ok || load.kind === "missing") {
        definitions.set(key, load);
        if (load.ok && load.definition.needsContactExtras) {
          await fillExtrasDirect(supabase, group.contactIds, extras);
        }
        continue;
      }
      directReads = false;
    }
    const viaRpc = await loadStepViaRpc(
      supabase, token, group.campaignId, group.stepIndex, group.variant, group.contactIds,
    );
    definitions.set(key, viaRpc.load);
    for (const [id, value] of viaRpc.extras) extras.set(id, value);
  }

  const deadline = Date.now() + RUN_BUDGET_MS;
  let lastError: string | null = null;
  let first = true;

  for (const [index, row] of rows.entries()) {
    /*
      OUT OF TIME. The remaining rows are left exactly as the claim left
      them — 'sending', with claimed_at set — so the five-minute reaper offers
      them again. Marking them failed would write a rejection that never
      happened into last_error_safe and spend a second attempt on a row whose
      only problem was arriving last in a queue.
    */
    if (Date.now() >= deadline) {
      run.skipped += rows.length - index;
      break;
    }

    const load = definitions.get(`${row.campaignId}|${row.stepIndex}|${row.variant}`);
    if (!load || !load.ok) {
      const missing = load?.kind === "missing";
      await finish(
        supabase, token, row.id,
        // A deleted step is terminal: retrying cannot make it exist. A step we
        // were not able to READ is transient and goes back to the queue, where
        // the ordinary backoff and the five-attempt ceiling apply.
        missing ? "skipped" : "failed",
        missing ? "step_missing" : "campaign_unreadable",
      );
      if (missing) run.skipped += 1;
      else { run.failed += 1; lastError = "campaign_unreadable"; }
      continue;
    }

    // The pacing delay, before the message rather than after it, so a batch
    // that stops early has not already paid for a message it never sent.
    if (!first) await sleep(pace);
    first = false;

    const result = await sendOne(mailer, row, load.definition, extras.get(row.contactId));
    if (result.sent) {
      await finish(supabase, token, row.id, "sent", null, result.messageId, result.response);
      // The 'accepted' event, and the reason it is separate from 'sent'.
      // `newsletter_queue_finish` records that WE sent; this records that the
      // server took responsibility for the address. They are different facts,
      // and conflating them is how a report ends up claiming "delivered".
      await recordAccepted(supabase, token, row.id);
      run.sent += 1;
    } else {
      await finish(supabase, token, row.id, "failed", result.error, result.messageId, result.response);
      run.failed += 1;
      lastError = result.error ?? null;
    }
  }

  await stampRun(supabase, token, run, lastError);
  return run;
}

/** Everything the extras map needs, through the service function that already
 *  knows how to read a contact. Only reached on the admin path, and only when
 *  the body actually uses one of the two tags the queue does not carry. */
async function fillExtrasDirect(
  supabase: Client, contactIds: string[], into: ContactExtras,
): Promise<void> {
  for (const id of contactIds) {
    if (into.has(id)) continue;
    const contact = await getContact(supabase, id);
    if (contact) into.set(id, { lastName: contact.lastName ?? "", source: contact.sourceKey });
  }
}

/* ── ONE MESSAGE ─────────────────────────────────────────────────────────── */

async function sendOne(
  mailer: BulkMailer,
  row: ClaimedRow,
  definition: StepDefinition,
  extras: { lastName: string; source: string } | undefined,
): Promise<{ sent: boolean; messageId?: string; response?: string; error?: string }> {
  /*
    THE UNSUBSCRIBE LINK IS THE REAL ONE, and it is built here from the token
    the claim handed over. It is the same URL in three places — the footer, the
    List-Unsubscribe header and the one-click POST — because a recipient whose
    exit does not work reaches for the spam button instead, and that costs the
    whole sending domain.
  */
  const unsubscribeUrl = `${SITE_URL}/wypisz-sie/${row.unsubscribeToken}`;

  const merge: MergeValues = {
    first_name: row.firstName,
    last_name: extras?.lastName ?? "",
    email: row.email,
    locale: row.locale,
    source: extras?.source ?? "",
  };

  const body = withIntro(definition, row.personalization?.intro ?? "");
  const rendered = renderCampaign({
    editor: definition.editor,
    blocks: body.blocks,
    bodyHtml: body.bodyHtml,
    // The generated subject wins when there is one; otherwise the step's own.
    subject: row.personalization?.subject || definition.subject,
    preheader: definition.preheader,
    merge,
    unsubscribeUrl,
    locale: row.locale,
    tracking: {
      origin: SITE_URL,
      recipientId: row.id,
      /*
        The link map and the utm tags MUST be the pair the snapshot used. The
        renderer looks a destination up by its FINAL, utm-tagged form, so
        tagging differently here would miss every lookup, quietly fall back to
        the untagged href and turn click tracking off for the whole campaign
        while the settings screen still said it was on. Both sides read the
        campaign row; neither invents a default.
      */
      links: definition.links,
      trackOpens: definition.trackOpens,
      trackClicks: definition.trackClicks,
      utm: definition.utm,
    },
  });

  // Minted here, not left to the server, because a reply is correlated by
  // matching an incoming In-Reply-To against the id we stored — and the id has
  // to be stored whether or not the send succeeds.
  const messageId = mailer.newMessageId();
  const result = await mailer.send({
    to: row.email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    unsubscribeUrl,
    messageId,
  });

  return {
    sent: result.sent,
    messageId: result.messageId ?? messageId,
    response: result.response,
    error: result.sent
      ? undefined
      // A rejected address with no thrown error still has to say something: an
      // empty last_error_safe on a failed row tells an operator nothing.
      : result.error ?? (result.rejected.length > 0 ? "rejected_by_server" : "not_sent"),
  };
}

/* ── CLOSING A ROW ───────────────────────────────────────────────────────── */

async function finish(
  supabase: Client, token: string, id: string,
  status: "sent" | "failed" | "skipped",
  error: string | null | undefined,
  messageId?: string,
  smtpResponse?: string,
): Promise<void> {
  const { error: rpcError } = await supabase.rpc("newsletter_queue_finish", {
    p_token: token,
    p_id: id,
    p_status: status,
    p_error: error ?? undefined,
    p_message_id: messageId,
    p_smtp_response: smtpResponse,
  });
  if (rpcError) console.error("newsletter.worker.finish", rpcError.message.slice(0, 120));
}

/**
 * The 'accepted' event, written through 0095's token-gated door because
 * newsletter_events is admin-only under RLS.
 *
 * It is best-effort and deliberately never fails the send: the message has
 * already left. A missing event costs one number on a report; a throw here
 * would abort a batch that is mid-flight.
 */
async function recordAccepted(supabase: Client, token: string, recipientId: string): Promise<void> {
  const { error } = await serverRpc(supabase).rpc("newsletter_worker_accept", {
    p_token: token, p_recipient: recipientId,
  });
  if (error) console.error("newsletter.worker.accept", error.message.slice(0, 120));
}

/**
 * The run stamps, so the settings screen can say when the worker last ran and
 * what it did.
 *
 * `app_settings` is world-readable and admin-writable, which means the
 * scheduled path — anonymous key, no session — cannot write it at all: the
 * upsert is refused by RLS and the operator's "ostatni przebieg" would say
 * "jeszcze nie działał" forever while thousands of messages went out. 0095's
 * stamp function is the door for that path; `writeSettings` remains the writer
 * for the admin path and the fallback for a deployment where 0095 has not been
 * applied yet.
 */
async function stampRun(
  supabase: Client, token: string, run: WorkerRun, lastError: string | null,
): Promise<void> {
  const { error } = await serverRpc(supabase).rpc("newsletter_worker_stamp", {
    p_token: token,
    p_sent: run.sent,
    p_failed: run.failed,
    p_error: lastError,
  });
  if (!error) return;

  await writeSettings(supabase, {
    lastRunAt: new Date().toISOString(),
    lastRunSent: run.sent,
    lastRunFailed: run.failed,
    lastError,
  });
}
