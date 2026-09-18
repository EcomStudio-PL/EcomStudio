"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import type { Client } from "@/lib/services/workspace";
import { LOCALES, type Locale } from "@/lib/newsletter";
import {
  audienceBreakdown, contactsByIds, getCampaign, listSteps,
  personalizationProgress, recipientsAwaitingPersonalization,
  type PersonalizationTarget, type StepRow,
} from "@/lib/services/newsletter";
import {
  abVariants, aiErrorKey, analyzeCampaign, bodyToText, campaignForAi, contactForAi,
  improveEmail, personalizeFor, preheaderIdeas, subjectIdeas, textEngine, textModelCost,
  writeEmail, asImproveAction, asTone,
  type AbVariantDraft, type AiCampaign, type CampaignAnalysis,
  type EmailDraft, type ImprovedEmail, type TextEngine,
} from "@/lib/server/newsletter/ai";

/**
 * THE AI DOORS — thin, admin-only, and identical in shape to
 * app/actions/newsletter.ts, because an operator should never be able to tell
 * which file answered them.
 *
 * Same `Result`, same `requireAdmin`, same closed `newsletter.err.*` vocabulary.
 * `requireAdmin` is written out again rather than imported: a "use server"
 * module may only export async functions, so exporting the guard from the other
 * actions file would publish an authentication helper as a callable endpoint.
 * Six lines duplicated beats that trade every time.
 *
 * NOTHING HERE CARRIES A PROMPT ACROSS THE BOUNDARY. Every system prompt lives
 * in lib/server/newsletter/ai.ts, which is `server-only`; these actions return
 * the model's answer and nothing about how it was asked.
 *
 * ── AND THE WORKER STILL NEVER CALLS AI ─────────────────────────────────────
 *
 * This file is the ONLY place personalisation is generated, and it runs while
 * an operator is watching — before the campaign is handed to the queue.
 * `lib/server/newsletter/worker.ts` reads `newsletter_recipients.personalization`
 * and nothing else; it does not import this module, this module's engine, or any
 * provider. That is not tidiness: a model call inside the send loop would put a
 * third-party API on the critical path of every message, where its latency
 * lands inside the function's timeout, its outage becomes a failed send, and its
 * bill is charged while an SMTP connection sits open. Generation happens here,
 * once, in advance, and the send stays a send.
 */

/**
 * The result shapes, re-exported so the panel can name them WITHOUT importing
 * `lib/server/newsletter/ai`. That module is `server-only` and holds every
 * system prompt in the feature; a client component that names it is one
 * refactor away from turning a type import into a value import and shipping
 * them. These are type-only re-exports, erased at compile time, so nothing is
 * added to the bundle by this line either.
 */
export type {
  AbVariantDraft, AnalysisArea, AnalysisFinding, AnalysisVerdict,
  CampaignAnalysis, EmailDraft, ImprovedEmail,
} from "@/lib/server/newsletter/ai";

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

function message(e: unknown): string {
  const text = e instanceof Error ? e.message : "";
  return text === "not_admin" || text === "unauthenticated" ? text : "generic";
}

const NL = "/admin/newsletter";

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((value ?? "").trim());

const localeOf = (value: unknown): Locale =>
  (LOCALES as readonly string[]).includes(String(value ?? "")) ? (String(value) as Locale) : "pl";

/**
 * Resolve the engine once, or say why there is none.
 *
 * "Not configured" and "did not answer" are different sentences to an operator
 * and the dictionary has both (`err.aiUnavailable`, `err.aiFailed`). Every
 * action below starts here so neither is ever reported as the other.
 */
async function engineOrError(
  supabase: Client,
): Promise<{ ok: true; engine: TextEngine } | { ok: false; error: string }> {
  const engine = await textEngine(supabase);
  if (!engine) return { ok: false, error: "aiUnavailable" };
  return { ok: true, engine };
}

/* ── CAMPAIGN COPY ───────────────────────────────────────────────────────── */

/** A step, flattened into the four fields the allowlist lets a model read. */
function stepCopy(campaignName: string, step: StepRow): AiCampaign {
  return campaignForAi({
    name: campaignName,
    subject: step.subject,
    preheader: step.preheader,
    body: bodyToText({ editor: step.editor, blocks: step.blocks, bodyHtml: step.bodyHtml }),
  });
}

/**
 * One campaign's copy, indexed by the message each recipient will receive.
 *
 * A SEQUENCE'S THIRD MAIL IS NOT ITS FIRST, and variant B is not variant A.
 * Personalising every recipient against step 0 variant A would write an opener
 * that leads into a body half of them are never sent — which reads, in the
 * inbox, as a mail that starts talking about something else.
 */
function copyIndex(campaignName: string, steps: StepRow[]): Map<string, AiCampaign> {
  const out = new Map<string, AiCampaign>();
  for (const step of steps) out.set(`${step.stepIndex}|${step.variant}`, stepCopy(campaignName, step));
  return out;
}

/** The campaign plus its steps, or the reason there is nothing to work on. */
async function loadCampaign(supabase: Client, campaignId: string): Promise<
  { ok: true; name: string; steps: StepRow[] } | { ok: false; error: string }
> {
  if (!isUuid(campaignId)) return { ok: false, error: "missing" };
  const campaign = await getCampaign(supabase, campaignId);
  if (!campaign) return { ok: false, error: "missing" };
  const steps = await listSteps(supabase, campaignId);
  if (steps.length === 0) return { ok: false, error: "body" };
  return { ok: true, name: campaign.name, steps };
}

/* ── 1. WRITE ────────────────────────────────────────────────────────────── */

export async function writeEmailAction(input: {
  goal: string;
  offer: string;
  audience: string;
  tone: string;
  locale?: string;
}): Promise<Result<EmailDraft>> {
  try {
    const { supabase } = await requireAdmin();
    // A brief with nothing in it produces a mail about nothing, which the
    // operator then has to read before discovering that. Refuse early.
    if (!(input.goal ?? "").trim() && !(input.offer ?? "").trim()) {
      return { ok: false, error: "body" };
    }
    const resolved = await engineOrError(supabase);
    if (!resolved.ok) return resolved;

    const draft = await writeEmail(resolved.engine, {
      goal: input.goal ?? "",
      offer: input.offer ?? "",
      audience: input.audience ?? "",
      tone: asTone(input.tone),
      locale: localeOf(input.locale),
    });
    return { ok: true, data: draft };
  } catch (e) {
    return { ok: false, error: isAuth(e) ? message(e) : aiErrorKey(e) };
  }
}

/* ── 2. IMPROVE ──────────────────────────────────────────────────────────── */

export async function improveEmailAction(input: {
  body: string;
  action: string;
  locale?: string;
}): Promise<Result<ImprovedEmail>> {
  try {
    const { supabase } = await requireAdmin();
    if (!(input.body ?? "").trim()) return { ok: false, error: "body" };
    const resolved = await engineOrError(supabase);
    if (!resolved.ok) return resolved;

    const improved = await improveEmail(
      resolved.engine, input.body, asImproveAction(input.action), localeOf(input.locale),
    );
    return { ok: true, data: improved };
  } catch (e) {
    return { ok: false, error: isAuth(e) ? message(e) : aiErrorKey(e) };
  }
}

/* ── 3. SUBJECTS AND PREHEADERS ──────────────────────────────────────────── */

export async function subjectIdeasAction(input: {
  context: string;
  n?: number;
  locale?: string;
}): Promise<Result<string[]>> {
  try {
    const { supabase } = await requireAdmin();
    if (!(input.context ?? "").trim()) return { ok: false, error: "body" };
    const resolved = await engineOrError(supabase);
    if (!resolved.ok) return resolved;
    return { ok: true, data: await subjectIdeas(resolved.engine, input.context, input.n ?? 5, localeOf(input.locale)) };
  } catch (e) {
    return { ok: false, error: isAuth(e) ? message(e) : aiErrorKey(e) };
  }
}

export async function preheaderIdeasAction(input: {
  context: string;
  n?: number;
  locale?: string;
}): Promise<Result<string[]>> {
  try {
    const { supabase } = await requireAdmin();
    if (!(input.context ?? "").trim()) return { ok: false, error: "body" };
    const resolved = await engineOrError(supabase);
    if (!resolved.ok) return resolved;
    return { ok: true, data: await preheaderIdeas(resolved.engine, input.context, input.n ?? 5, localeOf(input.locale)) };
  } catch (e) {
    return { ok: false, error: isAuth(e) ? message(e) : aiErrorKey(e) };
  }
}

/* ── 4. ANALYSE ──────────────────────────────────────────────────────────── */

/**
 * Review a campaign, or a body pasted into the studio.
 *
 * WHEN `campaignId` IS GIVEN, THE SERVER READS THE COPY. The studio can analyse
 * text that is not a campaign yet, but a campaign is analysed from the database
 * rather than from whatever the browser posted — an analysis of a body the
 * operator edited and did not save is an analysis of a mail that will not be
 * sent, and the operator has no way to tell the two apart afterwards.
 */
export async function analyzeCampaignAction(input: {
  campaignId?: string;
  subject?: string;
  preheader?: string;
  body?: string;
  locale?: string;
}): Promise<Result<CampaignAnalysis>> {
  try {
    const { supabase } = await requireAdmin();
    const resolved = await engineOrError(supabase);
    if (!resolved.ok) return resolved;

    let subject = (input.subject ?? "").trim();
    let preheader = (input.preheader ?? "").trim();
    let body = (input.body ?? "").trim();

    if (input.campaignId) {
      const loaded = await loadCampaign(supabase, input.campaignId);
      if (!loaded.ok) return loaded;
      const first = loaded.steps[0];
      const copy = stepCopy(loaded.name, first);
      subject = copy.subject;
      preheader = copy.preheader;
      body = copy.body;
    }

    if (!body) return { ok: false, error: "body" };
    return {
      ok: true,
      data: await analyzeCampaign(resolved.engine, subject, preheader, body, localeOf(input.locale)),
    };
  } catch (e) {
    return { ok: false, error: isAuth(e) ? message(e) : aiErrorKey(e) };
  }
}

/* ── 5. A/B VARIANTS ─────────────────────────────────────────────────────── */

export async function abVariantsAction(input: {
  campaignId?: string;
  name?: string;
  subject?: string;
  preheader?: string;
  body?: string;
  n?: number;
  locale?: string;
}): Promise<Result<AbVariantDraft[]>> {
  try {
    const { supabase } = await requireAdmin();
    const resolved = await engineOrError(supabase);
    if (!resolved.ok) return resolved;

    let copy: AiCampaign;
    if (input.campaignId) {
      const loaded = await loadCampaign(supabase, input.campaignId);
      if (!loaded.ok) return loaded;
      copy = stepCopy(loaded.name, loaded.steps[0]);
    } else {
      copy = campaignForAi({
        name: input.name ?? "",
        subject: input.subject ?? "",
        preheader: input.preheader ?? "",
        body: input.body ?? "",
      });
    }
    if (!copy.body.trim()) return { ok: false, error: "body" };

    return { ok: true, data: await abVariants(resolved.engine, copy, input.n ?? 2, localeOf(input.locale)) };
  } catch (e) {
    return { ok: false, error: isAuth(e) ? message(e) : aiErrorKey(e) };
  }
}

/* ── 6. PERSONALISATION ──────────────────────────────────────────────────────
 *
 * Three doors, in the order an operator is allowed to walk through them:
 * look at ten, see what the whole thing costs, then run it. There is
 * deliberately no single button that spends the whole audience's worth of
 * model calls on one click.
 */

/** How many contacts the sample previews. Ten is enough to see whether the
 *  openers are worth sending and few enough that the operator waits seconds. */
const SAMPLE_SIZE = 10;

/** One personalised message, previewed and stored nowhere. */
export type PersonalizationPreview = {
  contactId: string;
  /** The three things the model was given, echoed back so an operator can see
   *  WHY an opener says what it says — and see, at a glance, that nothing else
   *  was sent. */
  firstName: string;
  sourceKey: string;
  locale: string;
  subject: string;
  intro: string;
};

/**
 * Ten previews. NOTHING IS WRITTEN — not a recipient row, not an audit entry.
 *
 * This is the step that makes the batch safe to offer at all. An operator who
 * has read ten real openers knows whether the eleventh is worth paying for;
 * one who has only read the feature's name does not, and finds out after the
 * send.
 *
 * IT WORKS ON A DRAFT, which is the whole point of previewing: the contacts
 * come from the campaign's audience rather than from queued rows, so the
 * question "what would this look like?" can be answered before anything is
 * committed to a queue.
 */
export async function generatePersonalizationSampleAction(
  campaignId: string,
): Promise<Result<{ previews: PersonalizationPreview[] }>> {
  try {
    const { supabase } = await requireAdmin();
    const loaded = await loadCampaign(supabase, campaignId);
    if (!loaded.ok) return loaded;
    const campaign = await getCampaign(supabase, campaignId);
    if (!campaign) return { ok: false, error: "missing" };

    const resolved = await engineOrError(supabase);
    if (!resolved.ok) return resolved;

    const breakdown = await audienceBreakdown(supabase, campaign.audience);
    if (breakdown.ids.length === 0) return { ok: false, error: "noRecipients" };

    const contacts = await contactsByIds(supabase, breakdown.ids.slice(0, SAMPLE_SIZE));
    if (contacts.length === 0) return { ok: false, error: "noRecipients" };

    // The first message is what a sample shows: it is the one every recipient
    // gets, and previewing step 3 of a sequence would preview a mail most of
    // this audience has not been sent yet.
    const copy = stepCopy(loaded.name, loaded.steps[0]);

    const previews = await pooled(contacts, SAMPLE_CONCURRENCY, async (contact) => {
      const projected = contactForAi(contact as unknown as Record<string, unknown>);
      const result = await personalizeFor(resolved.engine, projected, copy);
      return {
        contactId: contact.id,
        firstName: projected.firstName,
        sourceKey: projected.sourceKey,
        locale: projected.locale,
        subject: result.subject,
        intro: result.intro,
      };
    });

    return { ok: true, data: { previews: previews.filter((p): p is PersonalizationPreview => p !== null) } };
  } catch (e) {
    return { ok: false, error: isAuth(e) ? message(e) : aiErrorKey(e) };
  }
}

/**
 * What the whole batch would cost, in contacts and — when the deployment can
 * honestly say — in money.
 *
 * `estimatedCost` IS NULLABLE AND THE NULL IS LOAD-BEARING. Text models are
 * billed per token and this repository counts no tokens anywhere; the only
 * price it knows is the per-call figure an operator typed into Modele AI. When
 * that is missing, this returns null and the panel says the cost is not known
 * — because an invented "≈ 20 zł" next to a button that spends real money is
 * the one place in this module where a plausible number does actual damage.
 *
 * The CONTACT COUNT, by contrast, is always real: queued messages when the
 * campaign has been queued, and the mailable audience when it has not.
 */
export type PersonalizationEstimate = {
  /** Model calls this batch would make — one per message. */
  contacts: number;
  /** Already personalised, and therefore not paid for again. */
  alreadyDone: number;
  estimatedCost: {
    usdMicrosPerCall: number;
    usdMicrosTotal: number;
    model: string;
    provider: string;
  } | null;
  /** Shown when the cost is null, so the panel can name what it cannot price. */
  model: string | null;
};

export async function estimatePersonalizationAction(
  campaignId: string,
): Promise<Result<PersonalizationEstimate>> {
  try {
    const { supabase } = await requireAdmin();
    if (!isUuid(campaignId)) return { ok: false, error: "missing" };
    const campaign = await getCampaign(supabase, campaignId);
    if (!campaign) return { ok: false, error: "missing" };

    const [progress, breakdown, cost] = await Promise.all([
      personalizationProgress(supabase, campaignId),
      audienceBreakdown(supabase, campaign.audience),
      textModelCost(supabase),
    ]);

    // Queued rows are the truth once they exist — they are what the batch will
    // actually walk. Before that, the mailable audience is the honest estimate
    // of the same number, and it is the number the confirm screen will show.
    const outstanding = progress.queued > 0
      ? progress.queued - progress.written
      : breakdown.mailable;

    const perCall = cost?.usdMicrosPerCall ?? null;
    return {
      ok: true,
      data: {
        contacts: Math.max(0, outstanding),
        alreadyDone: progress.written,
        estimatedCost: perCall !== null && cost
          ? {
            usdMicrosPerCall: perCall,
            usdMicrosTotal: perCall * Math.max(0, outstanding),
            model: cost.model,
            provider: cost.provider,
          }
          : null,
        model: cost?.model ?? null,
      },
    };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * THE BATCH. Generates a subject and an opener for queued messages and writes
 * them onto `newsletter_recipients.personalization`, before any of them is sent.
 *
 * IT DOES NOT CREATE THE QUEUE, and refusing to is a deliberate limit rather
 * than a missing feature. `snapshotRecipients` is where an audience is frozen
 * and where every step's `send_after` is computed from the campaign's start,
 * and it is owned by `scheduleCampaignAction`. If this action snapshotted a
 * draft to have rows to write to, a sequence scheduled a week later would carry
 * step delays measured from the afternoon somebody pressed "Personalizuj" —
 * because the re-snapshot at schedule time inserts with `ignoreDuplicates` and
 * cannot move a `send_after` that already exists. So a campaign with no queued
 * messages is answered with `aiNoQueue`, and the panel says to schedule it
 * first. Scheduling for a future time leaves the queue closed
 * (`newsletter_queue_claim` only serves campaigns whose status is 'sending'),
 * which is exactly the window this pass is meant to run in.
 *
 * IT IS BOUNDED BY TIME, NOT BY AUDIENCE, for the same reason the worker is:
 * one model call takes seconds and a serverless invocation does not live long
 * enough to make four thousand of them. The action returns what it wrote and
 * what is left, the panel shows both, and pressing again continues — a pattern
 * this module already uses for sending. A run that silently died at row 900 of
 * 4000 would leave an operator believing the whole list was personalised.
 *
 * AND IT IS SAFE TO RUN TWICE: `recipientsAwaitingPersonalization` only returns
 * rows whose `personalization` is still null, so a second press picks up where
 * the first stopped and never pays for the same contact twice.
 */
export type PersonalizationRun = {
  written: number;
  remaining: number;
  /** Why this invocation stopped, so the panel can offer the right next step. */
  stopped: "done" | "budget" | "error";
};

/** Model calls in flight at once. Four keeps a batch moving without tripping
 *  the provider's own rate limits, which would cost the whole run. */
const BATCH_CONCURRENCY = 4;
const SAMPLE_CONCURRENCY = 5;

/** Rows pulled per round. Small enough that a round finishes inside the budget,
 *  large enough that the queue read is not the expensive part. */
const BATCH_PAGE = 40;

/**
 * The invocation's own deadline. Deliberately short of the platform ceiling:
 * the panel that calls this is also embedded in the campaign editor, whose
 * route may carry a shorter `maxDuration` than the AI page does, and a run
 * killed mid-write reports nothing at all.
 */
const BATCH_BUDGET_MS = 45_000;

export async function generatePersonalizationAction(
  campaignId: string,
): Promise<Result<PersonalizationRun>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const loaded = await loadCampaign(supabase, campaignId);
    if (!loaded.ok) return loaded;
    const campaign = await getCampaign(supabase, campaignId);
    if (!campaign) return { ok: false, error: "missing" };

    // A campaign already handing messages to the mail server is past the point
    // where generated copy can honestly be added: some recipients would get a
    // personalised mail and some the plain one, decided by which side of the
    // batch they happened to fall on.
    if (campaign.status === "sending") return { ok: false, error: "sending" };
    if (campaign.status === "sent" || campaign.status === "cancelled") {
      return { ok: false, error: "state" };
    }

    const resolved = await engineOrError(supabase);
    if (!resolved.ok) return resolved;

    const before = await personalizationProgress(supabase, campaignId);
    if (before.queued === 0) return { ok: false, error: "aiNoQueue" };

    const copies = copyIndex(loaded.name, loaded.steps);
    const deadline = Date.now() + BATCH_BUDGET_MS;
    let written = 0;
    let stopped: PersonalizationRun["stopped"] = "done";

    while (Date.now() < deadline) {
      const targets = await recipientsAwaitingPersonalization(supabase, campaignId, BATCH_PAGE);
      if (targets.length === 0) break;

      const contacts = await contactsByIds(supabase, targets.map((r) => r.contactId));
      const byId = new Map(contacts.map((c) => [c.id, c]));

      const results = await pooled(targets, BATCH_CONCURRENCY, async (target) => {
        const contact = byId.get(target.contactId);
        const copy = copies.get(`${target.stepIndex}|${target.variant}`);
        // A recipient whose step or contact has been deleted under us is not a
        // failure worth stopping the batch for; it is a row the queue will skip
        // anyway. Personalising it is the only thing that has to not happen.
        if (!contact || !copy) return { target, skipped: true as const };
        const result = await personalizeFor(
          resolved.engine, contactForAi(contact as unknown as Record<string, unknown>), copy,
        );
        return { target, result };
      });

      // A hard failure means the provider is not serving us. Continuing would
      // spend the rest of the budget collecting the same error, so the run
      // stops and reports honestly.
      const failed = results.filter((r) => r === null).length;
      if (failed > 0) stopped = "error";

      const updates = results.filter((r): r is { target: PersonalizationTarget; result: { subject: string; intro: string } } =>
        r !== null && !("skipped" in r) && Boolean(r.result.subject || r.result.intro));

      for (const update of updates) {
        const { error } = await supabase
          .from("newsletter_recipients")
          .update({ personalization: update.result } as never)
          // Still pending, still unwritten: the row must not have been claimed
          // or personalised between the read above and this write.
          .eq("id", update.target.id)
          .eq("status", "pending")
          .is("personalization", null);
        if (!error) written += 1;
      }

      if (stopped === "error") break;

      /*
        NOTHING LANDED. The page comes back from the same query next round, so
        a round that writes nothing MUST stop or the loop spins until the
        deadline. The two reasons are told apart because they mean opposite
        things to the operator: every row was skipped (its contact or its step
        has been deleted under us) is a finished run with nothing left to do,
        while rows that were neither skipped nor written is the model returning
        empty answers — a failure.
      */
      if (updates.length === 0) {
        const skipped = results.filter((r) => r !== null && "skipped" in r).length;
        stopped = skipped === results.length ? "done" : "error";
        break;
      }
    }

    if (stopped === "done" && Date.now() >= deadline) stopped = "budget";

    const after = await personalizationProgress(supabase, campaignId);
    const remaining = Math.max(0, after.queued - after.written);

    // Nothing at all was written and the provider was the reason: that is a
    // failure, not a run that did nothing.
    if (written === 0 && stopped === "error") return { ok: false, error: "aiFailed" };

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.personalization_generated",
      entityType: "newsletter_campaign", entityId: campaignId,
      // Counts and the model, never a generated subject: the audit log records
      // that four thousand messages were personalised, not four thousand
      // messages.
      after: { written, remaining, stopped },
    });
    revalidatePath(`${NL}/kampanie/${campaignId}`);
    revalidatePath(`${NL}/kampanie`);

    return { ok: true, data: { written, remaining, stopped } };
  } catch (e) {
    return { ok: false, error: isAuth(e) ? message(e) : aiErrorKey(e) };
  }
}

/* ── HELPERS ─────────────────────────────────────────────────────────────── */

/** Only the two `requireAdmin` throws keep their own names; everything else is
 *  a provider problem by the time it reaches a catch in this file. */
function isAuth(e: unknown): boolean {
  const text = e instanceof Error ? e.message : "";
  return text === "not_admin" || text === "unauthenticated";
}

/**
 * Run `task` over `items` with at most `limit` in flight, returning null in
 * place of anything that threw.
 *
 * WHY BOUNDED AND NOT `Promise.all`. Ten simultaneous requests to one provider
 * is how a sample of ten becomes a 429 and a sample of zero — the image path
 * learned this and put a limiter in `lib/server/provider-router.ts` for the
 * same reason. And why not sequential: ten sequential calls is a minute of an
 * operator watching a spinner for work that takes fifteen seconds.
 *
 * A FAILED ITEM IS NULL RATHER THAN A THROWN BATCH. One contact whose response
 * came back unparseable must not discard the thirty-nine that worked.
 */
async function pooled<T, R>(
  items: T[], limit: number, task: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try { out[index] = await task(items[index]); }
      catch { out[index] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}
