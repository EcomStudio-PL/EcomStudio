"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban, ChevronLeft, ChevronRight, Loader2, Pause, Play, Plus, Save, Send, Trash2,
} from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { formatInstant } from "@/lib/utils";
import {
  AB_METRICS,
  type Audience, type AudienceBreakdown, type CampaignStatus, type Utm,
} from "@/lib/newsletter";
import type { CampaignRow, CampaignStats, StepRow } from "@/lib/services/newsletter";
import {
  audiencePreviewAction, cancelCampaignAction, deleteStepAction, pauseCampaignAction,
  resumeCampaignAction, saveCampaignAction, saveStepAction, scheduleCampaignAction,
  sendTestCampaignAction,
} from "@/app/actions/newsletter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip, ChipRow } from "@/components/ui/chip";
import { Input, Label, Select } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { RowAction, Switch } from "@/components/ui/record";
import { Segmented } from "@/components/ui/segmented";
import { Stat } from "@/components/ui/stat";
import { StepPanel } from "@/components/ui/step-panel";
import { AiPanel } from "@/components/admin/newsletter/ai-panel";
import { AudiencePicker, type AudienceGroup } from "@/components/admin/newsletter/audience-picker";
import { MailBuilder, type StepDraft } from "@/components/admin/newsletter/mail-builder";
import { MailPreview, type PreviewContact } from "@/components/admin/newsletter/mail-preview";

/**
 * ONE CAMPAIGN, SIX DECISIONS, IN THE ORDER THEY HAVE TO BE MADE.
 *
 * WHY THIS IS A STEPPER AND NOT ONE LONG FORM. A campaign is the only screen
 * in this product where pressing the wrong button writes to several thousand
 * strangers, and there is no undo — `cancelCampaignAction` stops the queue, it
 * cannot recall what the mail server already accepted. So the screen is built
 * to be walked: pick who, write it, look at it, post one to yourself, and only
 * then schedule it. Each step is one panel with one question in it, which is
 * also the only shape that survives a 320px phone.
 *
 * THE ORDER IS LOAD-BEARING. Audience comes first because it is what decides
 * whether the rest is worth writing; preview comes after content and before
 * test, because the cheap check should catch the mistake the expensive one
 * would; and the schedule is last, behind a confirm screen that states the
 * seven things §73 asks for.
 *
 * WHAT IS SAVED, AND WHEN. Every move between steps persists — settings
 * through `saveCampaignAction`, every message through `saveStepAction`. That
 * is not autosave for its own sake: the preview and the test send RENDER FROM
 * THE DATABASE (they have to, because `renderCampaign` is server-only), so an
 * unsaved edit would produce a preview of the previous draft. Saving on
 * navigation is what makes "podgląd" mean "this is what goes out".
 *
 * EVERY message is written on each save, not only the one on screen. A
 * sequence's third mail and an A/B variant are edited in the same place as the
 * first, and saving only the active one would silently lose the other two the
 * moment the operator switched between them. `saveStepAction` upserts on
 * (campaign, step, variant), so re-writing an unchanged message is free and
 * safe.
 *
 * A CAMPAIGN THAT IS SENDING IS FROZEN, here as well as in the action. Every
 * content write goes through `editableCampaign`, which refuses status
 * 'sending' — editing a subject halfway through a send does not change the
 * messages already accepted, it only makes the report describe a mail half the
 * list never received. The editor greys out rather than pretending, and says
 * why, because a form that silently discards what was typed into it is worse
 * than one that refuses to take it.
 */

/** A message of this campaign, as the editor holds it: its place in the
 *  sequence, its variant, and the part the operator types. */
type Draft = StepDraft & {
  /** Absent until the first save — a variant the operator has just added. */
  id?: string;
  stepIndex: number;
  variant: string;
  delayMinutes: number;
};

const STEPS = ["audience", "content", "ai", "preview", "test", "schedule"] as const;
const TOTAL = STEPS.length;

const WARSAW = "Europe/Warsaw";

/**
 * HOW MANY MINUTES EUROPE/WARSAW IS AHEAD OF UTC AT A GIVEN INSTANT.
 *
 * Asked of `Intl` rather than hard-coded, because the answer is +60 for half
 * the year and +120 for the other half, and the two changeover nights are
 * exactly when somebody schedules a Sunday-morning mailing.
 */
function zoneOffsetMinutes(instant: Date): number {
  const parts: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: WARSAW, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  // Some engines answer "24" for midnight under hour12:false.
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
  return (asIfUtc - instant.getTime()) / 60_000;
}

/**
 * "2026-04-19T09:00" as the operator meant it — nine in the morning IN WARSAW
 * — turned into the absolute instant the database stores.
 *
 * THIS CONVERSION IS NOT OPTIONAL AND IT CANNOT BE LEFT TO `new Date()`.
 * `<input type="datetime-local">` hands back a wall-clock string with no zone
 * in it. Parsing that on the server resolves it against the SERVER's zone,
 * which on Vercel is UTC — so a campaign an operator scheduled for 09:00 would
 * go out at 11:00 Polish time in summer. Parsing it in the browser is no
 * better: it resolves against whatever zone the operator's laptop is set to,
 * so the same campaign would be scheduled differently by somebody working from
 * Lisbon. The product's clock is Warsaw (it is what `formatInstant` prints and
 * what `schedule.tz` promises the operator), so Warsaw is what this reads.
 *
 * The two-pass offset lookup is for the two nights a year when the offset
 * changes: the first pass guesses using the offset at the naive instant, and
 * the second re-asks at the instant that guess produced. When a clock change
 * falls between them the second answer is the right one. A 02:30 that does not
 * exist on the spring-forward night lands on the next real minute rather than
 * being rejected — the campaign goes out, one hour is not worth an error
 * message the operator cannot act on.
 */
function warsawToIso(local: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!match) return null;
  const naive = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]),
  );
  if (!Number.isFinite(naive)) return null;

  const guessed = zoneOffsetMinutes(new Date(naive));
  let instant = naive - guessed * 60_000;
  const settled = zoneOffsetMinutes(new Date(instant));
  if (settled !== guessed) instant = naive - settled * 60_000;

  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A step's stable identity. `id` is absent until the first save, so the
 *  position in the sequence is what the selector keys on. */
const draftKey = (draft: Draft) => `${draft.stepIndex}:${draft.variant}`;

export function CampaignWizard({
  campaign, steps, groups, breakdown, stats, contacts,
  personalizedCount, statusTone, aiAvailable,
}: {
  campaign: CampaignRow;
  steps: StepRow[];
  groups: AudienceGroup[];
  /** Resolved by `campaignStatusTone` on the server. It arrives as a prop
   *  rather than being computed here because that helper lives beside
   *  `getDictionary`, which reads cookies — a client component importing it
   *  would pull `next/headers` into the browser bundle. Passing the answer in
   *  keeps ONE mapping from status to colour for the whole module, which is
   *  the point of that helper existing at all. */
  statusTone: "neutral" | "success" | "warning" | "danger" | "info" | "accent";
  /** Whether any text-capable AI backend is configured, answered on the server
   *  by `newsletterAiAvailable`. Step 3 passes it straight to the AI panel,
   *  which is what turns "AI is not set up" into a stated fact rather than a
   *  set of buttons that fail when pressed. */
  aiAvailable: boolean;
  /** Computed on the server for the SAVED audience, so step 1 opens with real
   *  numbers instead of a spinner. */
  breakdown: AudienceBreakdown;
  stats: CampaignStats;
  contacts: PreviewContact[];
  /** Queued messages that already carry AI-written copy. The confirm screen's
   *  only honest answer to "is personalisation on" — see
   *  `personalizedRecipientCount`. */
  personalizedCount: number;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [step, setStep] = useState(0);
  const [name, setName] = useState(campaign.name);
  const [audience, setAudience] = useState<Audience>(campaign.audience);
  const [trackOpens, setTrackOpens] = useState(campaign.trackOpens);
  const [trackClicks, setTrackClicks] = useState(campaign.trackClicks);
  const [utm, setUtm] = useState<Utm>(campaign.utm);
  const [abEnabled, setAbEnabled] = useState(campaign.abEnabled);
  const [abSharePct, setAbSharePct] = useState(campaign.abSharePct);
  const [abHours, setAbHours] = useState(campaign.abDecideAfterHours);
  const [abMetric, setAbMetric] = useState(campaign.abMetric);
  const [stopOnConversion, setStopOnConversion] = useState(campaign.stopOnConversion);

  const [drafts, setDrafts] = useState<Draft[]>(() => (steps.length > 0
    ? steps.map((s) => ({
      id: s.id, stepIndex: s.stepIndex, variant: s.variant, delayMinutes: s.delayMinutes,
      subject: s.subject, preheader: s.preheader,
      editor: s.editor, blocks: s.blocks, bodyHtml: s.bodyHtml,
    }))
    // `createCampaignAction` always inserts step 0, so this is the recovery
    // path for a campaign whose step insert lost a race — the editor still
    // opens, and the first save creates the row through the same upsert.
    : [{
      stepIndex: 0, variant: "A", delayMinutes: 0,
      subject: "", preheader: "", editor: "builder", blocks: [], bodyHtml: "",
    }]));
  const [active, setActive] = useState(0);

  const [addresses, setAddresses] = useState<string[]>([""]);
  const [when, setWhen] = useState<"now" | "at">("now");
  const [at, setAt] = useState("");
  const [confirm, setConfirm] = useState<{ recipients: number } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [removingStep, setRemovingStep] = useState<Draft | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);

  /** Every error a newsletter action returns is a key under `newsletter.err.*`;
   *  an untranslated string reaching the operator as raw English is how a
   *  finished module stops looking finished. */
  const fail = (error: string) => toast.error(t(`newsletter.err.${error}`));

  const readOnly = campaign.status === "sending";
  const current = drafts[Math.min(active, drafts.length - 1)];
  const hasVariantB = drafts.some((d) => d.stepIndex === 0 && d.variant !== "A");
  const isSequence = campaign.kind !== "one_off";

  const patchDraft = (patch: Partial<StepDraft>) => setDrafts((list) =>
    list.map((d, i) => (i === active ? { ...d, ...patch } : d)));

  /**
   * Write everything the operator has touched, and report whether it landed.
   *
   * The settings first, then every message: `scheduleCampaignAction` checks
   * that EVERY step has a subject and a body before it queues anything, so a
   * half-written variant has to be in the database for that check to see it.
   */
  async function persist(): Promise<boolean> {
    if (readOnly) return true;

    const settings = await saveCampaignAction({
      id: campaign.id,
      name,
      audience,
      trackOpens,
      trackClicks,
      utm,
      abEnabled,
      abSharePct,
      abDecideAfterHours: abHours,
      abMetric,
      stopOnConversion,
    });
    if (!settings.ok) { fail(settings.error); return false; }

    const saved: Draft[] = [];
    for (const draft of drafts) {
      const res = await saveStepAction({
        campaignId: campaign.id,
        stepIndex: draft.stepIndex,
        variant: draft.variant,
        subject: draft.subject,
        preheader: draft.preheader,
        editor: draft.editor,
        blocks: draft.blocks,
        bodyHtml: draft.bodyHtml,
        delayMinutes: draft.delayMinutes,
      });
      if (!res.ok) { fail(res.error); return false; }
      saved.push({ ...draft, id: res.data?.id ?? draft.id });
    }
    setDrafts(saved);
    // The preview renders from the database, so a save is the only moment it
    // can meaningfully be re-rendered.
    setPreviewVersion((v) => v + 1);
    return true;
  }

  const go = (next: number) => start(async () => {
    if (next < 0 || next >= TOTAL) return;
    if (await persist()) setStep(next);
  });

  const saveNow = () => start(async () => {
    if (await persist()) toast.success(t("common.saved"));
  });

  /* ── MESSAGES ─────────────────────────────────────────────────────────── */

  function addMessage() {
    const highest = Math.max(...drafts.map((d) => d.stepIndex));
    setDrafts((list) => [...list, {
      stepIndex: highest + 1,
      variant: "A",
      // A day is the default a sequence is usually written around, and step 0
      // ignores delays entirely (the schedule already says when it starts).
      delayMinutes: 1440,
      subject: "", preheader: "", editor: "builder", blocks: [], bodyHtml: "",
    }]);
    setActive(drafts.length);
  }

  /** The second half of an A/B test. It is a STEP at index 0 with a different
   *  variant letter, because that is what `snapshotRecipients` counts when it
   *  decides whether a campaign is actually split. */
  function addVariant() {
    const first = drafts.find((d) => d.stepIndex === 0) ?? drafts[0];
    setDrafts((list) => [...list, {
      stepIndex: 0,
      variant: "B",
      delayMinutes: 0,
      // Copied from A rather than started blank: an A/B test is two versions
      // of one message, and retyping the whole mail to change a subject line
      // is how a test ends up comparing two unrelated emails.
      subject: first.subject,
      preheader: first.preheader,
      editor: first.editor,
      blocks: first.blocks.map((b) => ({ ...b })),
      bodyHtml: first.bodyHtml,
    }]);
    setActive(drafts.length);
  }

  function removeMessage() {
    const target = removingStep;
    if (!target) return;
    start(async () => {
      if (target.id) {
        const res = await deleteStepAction({ campaignId: campaign.id, stepId: target.id });
        if (!res.ok) { fail(res.error); return; }
      }
      setDrafts((list) => list.filter((d) => draftKey(d) !== draftKey(target)));
      setActive(0);
      setRemovingStep(null);
      toast.success(t("common.deleted"));
    });
  }

  /* ── TEST ─────────────────────────────────────────────────────────────── */

  function sendTest() {
    const list = addresses.map((a) => a.trim()).filter(Boolean);
    if (list.length === 0) { fail("email"); return; }
    start(async () => {
      // The test renders from the stored step, so what is on screen has to be
      // what is stored — otherwise an operator tests the previous draft and
      // concludes the fix worked.
      if (!(await persist())) return;
      const res = await sendTestCampaignAction({
        campaignId: campaign.id,
        stepId: current.id,
        addresses: list,
      });
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("newsletter.test.sent"));
    });
  }

  /* ── SCHEDULING ───────────────────────────────────────────────────────── */

  const scheduledIso = when === "at" ? warsawToIso(at) : null;

  /**
   * Everything that has to be true before the confirm screen may be shown.
   *
   * THE RECIPIENT COUNT IS MEASURED HERE, not carried over from step 1. The
   * confirm screen's whole purpose is to state what is about to happen, and a
   * count cached from a panel the operator visited twenty minutes ago is a
   * number about a different list — somebody may have unsubscribed, or another
   * operator may have emptied the group.
   */
  function openConfirm() {
    if (when === "at" && !scheduledIso) { fail("date"); return; }
    start(async () => {
      if (!(await persist())) return;
      const res = await audiencePreviewAction(audience);
      if (!res.ok) { fail(res.error); return; }
      const recipients = res.data?.mailable ?? 0;
      if (recipients === 0) { fail("noRecipients"); return; }
      setConfirm({ recipients });
    });
  }

  function schedule() {
    start(async () => {
      const res = await scheduleCampaignAction({
        campaignId: campaign.id,
        when,
        at: scheduledIso ?? undefined,
      });
      if (!res.ok) { fail(res.error); return; }
      setConfirm(null);
      toast.success(when === "at"
        ? t("newsletter.schedule.scheduled") : t("newsletter.schedule.started"));
      router.refresh();
    });
  }

  /* ── LIVE CONTROLS ────────────────────────────────────────────────────── */

  const control = (
    promise: Promise<{ ok: boolean; error?: string }>, ok: string,
  ) => start(async () => {
    const res = await promise;
    if (!res.ok) { fail(res.error ?? "generic"); return; }
    toast.success(ok);
    setCancelling(false);
    router.refresh();
  });

  /* ── PROGRESS ─────────────────────────────────────────────────────────── */

  const finished = stats.sent + stats.failed;
  const progress = stats.recipients > 0 ? finished / stats.recipients : 0;
  const live: CampaignStatus[] = ["scheduled", "sending", "paused", "sent", "cancelled", "failed"];
  const showProgress = live.includes(campaign.status);

  const stepTitles = useMemo(() => STEPS.map((key) => t(`newsletter.step.${key}`)), [t]);

  return (
    <div className="space-y-4" data-campaign-wizard={campaign.id}>
      {/* ── WHICH CAMPAIGN ────────────────────────────────────────────────
          The module's own header belongs to the layout and names the module,
          not the campaign, so this row is what tells an operator which of
          forty drafts they are editing. The name is editable in place: it is
          one field, and a modal to change one field is a modal too many. */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/newsletter/kampanie" data-campaign-back
          className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-line px-2.5 py-2 text-[12.5px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
          <ChevronLeft size={14} aria-hidden />{t("newsletter.campaigns.title")}
        </Link>
        <div className="min-w-0 flex-1">
          <Input value={name} maxLength={160} disabled={readOnly} data-campaign-title
            aria-label={t("newsletter.campaigns.name")}
            onChange={(e) => setName(e.target.value)} />
        </div>
        <Badge tone={statusTone}>{t(`newsletter.status.${campaign.status}`)}</Badge>
      </div>

      {readOnly && (
        <p className="rounded-xl border border-[rgb(var(--warning)/0.4)] bg-[rgb(var(--warning)/0.08)] px-3.5 py-3 text-[12.5px] leading-relaxed text-ink"
          data-campaign-frozen>
          {t("newsletter.err.sending")}
        </p>
      )}

      {/* ── THE SEND, WHILE IT IS HAPPENING ──────────────────────────────── */}
      {showProgress && (
        <section className="panel rounded-2xl p-4" data-campaign-progress>
          <h2 className="mb-3 font-display text-sm font-semibold">
            {t("newsletter.campaign.progress")}
          </h2>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label={t("newsletter.funnel.recipients")} value={stats.recipients} tone="accent"
              meter={progress} />
            <Stat label={t("newsletter.kpi.sent")} value={stats.sent} tone="indigo" />
            {/* "Przyjęte przez serwer", never "Dostarczone": SMTP answering
                250 OK has taken responsibility for a message, not told us a
                human received it. This transport gives back no delivery
                receipt at all. */}
            <Stat label={t("newsletter.kpi.accepted")} value={stats.accepted} tone="success"
              hint={t("newsletter.acceptedNote")} />
            <Stat label={t("newsletter.kpi.failed")} value={stats.failed} />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(campaign.status === "sending" || campaign.status === "scheduled") && (
              <Button size="sm" variant="secondary" disabled={pending} data-campaign-pause
                onClick={() => control(pauseCampaignAction(campaign.id), t("newsletter.campaign.paused"))}>
                <Pause size={14} aria-hidden />{t("newsletter.campaign.pause")}
              </Button>
            )}
            {campaign.status === "paused" && (
              <Button size="sm" disabled={pending} data-campaign-resume
                onClick={() => control(resumeCampaignAction(campaign.id), t("newsletter.campaign.resumed"))}>
                <Play size={14} aria-hidden />{t("newsletter.campaign.resume")}
              </Button>
            )}
            {["scheduled", "sending", "paused"].includes(campaign.status) && (
              <Button size="sm" variant="danger" disabled={pending} data-campaign-cancel
                onClick={() => setCancelling(true)}>
                <Ban size={14} aria-hidden />{t("newsletter.campaign.cancel")}
              </Button>
            )}
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
            {t("newsletter.openRateNote")}
          </p>
        </section>
      )}

      {/* ── THE STEPPER, IN THE TWO SHAPES THAT FIT ──────────────────────────
          Six segments in one track is legible on a desktop and is six
          truncated words at 320px. On phones the same six steps become a
          scrollable chip row instead — the same control this panel's
          navigation uses for the same reason. */}
      <div className="hidden sm:block">
        <Segmented
          label={t("newsletter.wizard.steps")}
          value={String(step)}
          onChange={(next) => go(Number(next))}
          options={STEPS.map((_, i) => ({ value: String(i), label: stepTitles[i] }))}
        />
      </div>
      <div className="sm:hidden">
        <ChipRow>
          {STEPS.map((key, i) => (
            <Chip key={key} active={i === step} onClick={() => go(i)} data-wizard-step={key}>
              {`${i + 1}. ${stepTitles[i]}`}
            </Chip>
          ))}
        </ChipRow>
      </div>

      <StepPanel
        n={step + 1}
        last
        overline={t("newsletter.wizard.step", { n: step + 1, total: TOTAL })}
        title={stepTitles[step]}
      >
        {/* ── 1. ODBIORCY ─────────────────────────────────────────────── */}
        {step === 0 && (
          <AudiencePicker
            groups={groups}
            value={audience}
            initial={breakdown}
            disabled={readOnly}
            onChange={setAudience}
          />
        )}

        {/* ── 2. TREŚĆ ────────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-4">
            {/* The message selector only appears when there is more than one
                message to choose between. A campaign with a single mail does
                not need a tab strip explaining that it has one. */}
            {(drafts.length > 1 || isSequence || abEnabled) && (
              <div>
                <p className="mb-2 text-[13px] font-semibold tracking-tight">
                  {t("newsletter.sequence.steps")}
                </p>
                <ChipRow>
                  {drafts.map((draft, i) => (
                    <Chip key={draftKey(draft)} active={i === active}
                      data-message={draftKey(draft)}
                      onClick={() => setActive(i)}>
                      {draft.stepIndex === 0 && drafts.filter((d) => d.stepIndex === 0).length > 1
                        ? `${t("newsletter.ab.variant")} ${draft.variant}`
                        : t("newsletter.wizard.message", { n: draft.stepIndex + 1 })}
                    </Chip>
                  ))}
                </ChipRow>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {isSequence && (
                    <RowAction icon={Plus} label={t("newsletter.sequence.addStep")}
                      disabled={readOnly} data-add-message onClick={addMessage} />
                  )}
                  {abEnabled && !hasVariantB && (
                    <RowAction icon={Plus} label={`${t("newsletter.ab.variant")} B`}
                      disabled={readOnly} data-add-variant onClick={addVariant} />
                  )}
                  {drafts.length > 1 && (
                    <RowAction icon={Trash2} tone="danger" label={t("common.delete")}
                      disabled={readOnly} data-remove-message
                      onClick={() => setRemovingStep(current)} />
                  )}
                </div>
              </div>
            )}

            {/* Step 0 goes out when the campaign starts, so a delay on it
                would be a schedule pretending to be a step — and the schedule
                already exists, one step further on. */}
            {current.stepIndex > 0 && (
              <div className="max-w-[12rem]">
                <Label htmlFor="step-delay">{t("newsletter.sequence.delay")}</Label>
                <Input id="step-delay" inputMode="numeric" disabled={readOnly} data-step-delay
                  value={String(Math.round(current.delayMinutes / 1440))}
                  onChange={(e) => {
                    const days = Number.parseInt(e.target.value.replace(/\D/g, ""), 10) || 0;
                    setDrafts((list) => list.map((d, i) =>
                      (i === active ? { ...d, delayMinutes: days * 1440 } : d)));
                  }} />
              </div>
            )}

            <MailBuilder value={current} onChange={patchDraft} disabled={readOnly} />
          </div>
        )}

        {/* ── 3. AI I PERSONALIZACJA ──────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-6">
            {/* The AI half of this step belongs to the AI panel, which owns
                the provider check, the prompts and the personalisation batch.

                IT IS HANDED A ONE-CAMPAIGN LIST, which is how the panel is
                pinned to the campaign being edited. On its own screen the same
                component offers a picker over every campaign; embedded here
                there is nothing to pick — the operator is already inside one,
                and a dropdown that could retarget the AI at a different
                campaign from the middle of this wizard is a way to write
                generated copy into the wrong mailing. */}
            <AiPanel
              available={aiAvailable}
              campaigns={[{ id: campaign.id, name }]}
            />

            {/* ── A/B ─────────────────────────────────────────────────── */}
            <section className="space-y-3 border-t border-line pt-5" data-ab-controls>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold tracking-tight">
                  {t("newsletter.ab.enable")}
                </span>
                <Switch checked={abEnabled} disabled={readOnly}
                  label={t("newsletter.ab.enable")} onChange={setAbEnabled} />
              </div>

              {abEnabled && (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label htmlFor="ab-share">{t("newsletter.ab.share")}</Label>
                      <Input id="ab-share" inputMode="numeric" disabled={readOnly} data-ab-share
                        value={String(abSharePct)}
                        onChange={(e) => setAbSharePct(
                          Number.parseInt(e.target.value.replace(/\D/g, ""), 10) || 0)} />
                    </div>
                    <div>
                      <Label htmlFor="ab-hours" hint={t("newsletter.ab.hours")}>
                        {t("newsletter.ab.decideAfter")}
                      </Label>
                      <Input id="ab-hours" inputMode="numeric" disabled={readOnly} data-ab-hours
                        value={String(abHours)}
                        onChange={(e) => setAbHours(
                          Number.parseInt(e.target.value.replace(/\D/g, ""), 10) || 0)} />
                    </div>
                    <div>
                      <Label htmlFor="ab-metric">{t("newsletter.ab.metric")}</Label>
                      <Select id="ab-metric" value={abMetric} disabled={readOnly} data-ab-metric
                        onChange={(e) => setAbMetric(e.target.value)}>
                        {AB_METRICS.map((metric) => (
                          <option key={metric} value={metric}>
                            {t(`newsletter.ab.metric.${metric}`)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>

                  {/* ═══════════════════════════════════════════════════════
                      THE HALF OF A/B THAT DOES NOT EXIST YET, SAID BEFORE THE
                      CAMPAIGN GOES OUT RATHER THAN DISCOVERED AFTERWARDS.

                      `snapshotRecipients` queues only `ab_share_pct` of the
                      audience for the first message, because the rest is meant
                      to wait for a winner. NOTHING PICKS A WINNER. There is an
                      `ab_winner` column, there is a "decyduj po N godzinach"
                      field above, and there is no code anywhere in the product
                      that reads either or queues the remainder — verified
                      across app/, lib/ and the migrations.

                      So with this switch on, a campaign aimed at 4 281 people
                      reaches 856 of them and stops, permanently and silently.
                      That is the single most expensive thing this module can do
                      by accident, and the automations screen already sets the
                      house standard for it: it says "Nie uruchamia się" in
                      plain words rather than letting a working-looking switch
                      imply a feature. This is the same admission, in the same
                      place the decision is made, with the recovery named —
                      rescheduling with A/B off queues everyone who was left
                      out, because the rows that already went are held by the
                      unique index and are skipped.
                      ═══════════════════════════════════════════════════════ */}
                  <p className="rounded-xl border border-[rgb(var(--warning)/0.4)] bg-[rgb(var(--warning)/0.08)] px-3.5 py-3 text-[12px] leading-relaxed text-ink"
                    data-ab-no-winner>
                    {t("newsletter.ab.noWinnerYet")}
                  </p>

                  {/* Deciding a test on opens is frequently a measurement of
                      iPhone share rather than of the subject line. */}
                  {abMetric === "open" && (
                    <p className="rounded-xl border border-[rgb(var(--warning)/0.4)] bg-[rgb(var(--warning)/0.08)] px-3.5 py-3 text-[12px] leading-relaxed text-ink"
                      data-ab-open-warning>
                      {t("newsletter.ab.openWarning")}
                    </p>
                  )}

                  {/* A/B is ON and there is only one version of the first
                      message: `snapshotRecipients` splits across the variants
                      that EXIST, so this campaign would go out unsplit while
                      the switch said otherwise. */}
                  {!hasVariantB && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3.5 py-3 text-[12px] leading-relaxed text-muted"
                      data-ab-needs-variant>
                      <span className="min-w-0">{t("newsletter.ab.needsVariant")}</span>
                      <Button size="sm" variant="secondary" disabled={readOnly}
                        onClick={() => { addVariant(); setStep(1); }}>
                        <Plus size={14} aria-hidden />{`${t("newsletter.ab.variant")} B`}
                      </Button>
                    </div>
                  )}
                </>
              )}

              {isSequence && (
                <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold tracking-tight">
                      {t("newsletter.automations.stopOnConversion")}
                    </p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">
                      {t("newsletter.automations.stopHint")}
                    </p>
                  </div>
                  <Switch checked={stopOnConversion} disabled={readOnly}
                    label={t("newsletter.automations.stopOnConversion")}
                    onChange={setStopOnConversion} />
                </div>
              )}
            </section>
          </div>
        )}

        {/* ── 4. PODGLĄD ──────────────────────────────────────────────── */}
        {step === 3 && (
          <MailPreview
            campaignId={campaign.id}
            stepId={current.id}
            contacts={contacts}
            version={previewVersion}
          />
        )}

        {/* ── 5. TEST ─────────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-3" data-test-step>
            <p className="text-[12.5px] leading-relaxed text-muted" data-test-hint>
              {t("newsletter.test.hint")}
            </p>
            <div>
              <Label htmlFor="test-0">{t("newsletter.test.addresses")}</Label>
              <div className="space-y-2">
                {addresses.map((address, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input id={`test-${i}`} type="email" inputMode="email" value={address}
                      autoComplete="off" data-test-address={i}
                      onChange={(e) => setAddresses((list) =>
                        list.map((a, j) => (j === i ? e.target.value : a)))} />
                    {addresses.length > 1 && (
                      <RowAction icon={Trash2} label={t("common.remove")}
                        onClick={() => setAddresses((list) => list.filter((_, j) => j !== i))} />
                    )}
                  </div>
                ))}
              </div>
              {/* Five is the action's own limit, so the button disappears at
                  five rather than offering a sixth field that would be
                  refused after the operator had typed into it. */}
              {addresses.length < 5 && (
                <div className="mt-2">
                  <RowAction icon={Plus} label={t("newsletter.test.addAddress")}
                    data-test-add onClick={() => setAddresses((list) => [...list, ""])} />
                </div>
              )}
            </div>
            <Button size="sm" disabled={pending} data-test-send onClick={sendTest}>
              {pending
                ? <Loader2 size={14} aria-hidden className="animate-spin" />
                : <Send size={14} aria-hidden />}
              {t("newsletter.test.send")}
            </Button>
          </div>
        )}

        {/* ── 6. HARMONOGRAM ──────────────────────────────────────────── */}
        {step === 5 && (
          <div className="space-y-5" data-schedule-step>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold tracking-tight">
                  {t("newsletter.tracking.opens")}
                </span>
                <Switch checked={trackOpens} disabled={readOnly}
                  label={t("newsletter.tracking.opens")} onChange={setTrackOpens} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold tracking-tight">
                  {t("newsletter.tracking.clicks")}
                </span>
                <Switch checked={trackClicks} disabled={readOnly}
                  label={t("newsletter.tracking.clicks")} onChange={setTrackClicks} />
              </div>

              {/* UTM parameter names are not copy — they are the literal keys
                  that end up in the destination URL and in the shop's own
                  analytics, and translating them would break the report they
                  are read in. */}
              <div>
                <Label htmlFor="utm-campaign">{t("newsletter.tracking.utm")}</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["source", "medium", "campaign", "content"] as const).map((key) => (
                    <Input key={key} id={`utm-${key}`} placeholder={`utm_${key}`}
                      aria-label={`utm_${key}`} disabled={readOnly} data-utm={key}
                      value={utm[key] ?? ""}
                      onChange={(e) => setUtm((prev) => ({ ...prev, [key]: e.target.value }))} />
                  ))}
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t border-line pt-4">
              <Segmented
                label={t("newsletter.step.schedule")}
                value={when}
                onChange={(next) => setWhen(next === "at" ? "at" : "now")}
                options={[
                  { value: "now", label: t("newsletter.schedule.now"), disabled: readOnly },
                  { value: "at", label: t("newsletter.schedule.later"), disabled: readOnly },
                ]}
              />

              {when === "at" && (
                <div className="max-w-xs">
                  <Label htmlFor="schedule-at">{t("newsletter.schedule.at")}</Label>
                  <Input id="schedule-at" type="datetime-local" value={at} disabled={readOnly}
                    data-schedule-at onChange={(e) => setAt(e.target.value)} />
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint" data-schedule-tz>
                    {t("newsletter.schedule.tz")}
                  </p>
                </div>
              )}

              <Button disabled={pending || readOnly} data-schedule-open onClick={openConfirm}>
                {pending
                  ? <Loader2 size={14} aria-hidden className="animate-spin" />
                  : <Send size={14} aria-hidden />}
                {when === "at" ? t("newsletter.schedule.later") : t("newsletter.schedule.now")}
              </Button>
            </section>
          </div>
        )}
      </StepPanel>

      {/* ── MOVING BETWEEN STEPS ───────────────────────────────────────────
          Every move saves first (see the note at the top), so "Dalej" is also
          the save button and an operator cannot lose a paragraph by clicking
          a step they were curious about. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={pending || step === 0}
          data-wizard-back onClick={() => go(step - 1)}>
          <ChevronLeft size={14} aria-hidden />{t("newsletter.wizard.back")}
        </Button>
        <Button size="sm" disabled={pending || step === TOTAL - 1}
          data-wizard-next onClick={() => go(step + 1)}>
          {t("newsletter.wizard.next")}<ChevronRight size={14} aria-hidden />
        </Button>
        <Button size="sm" variant="ghost" disabled={pending || readOnly} className="sm:ml-auto"
          data-wizard-save onClick={saveNow}>
          {pending
            ? <Loader2 size={14} aria-hidden className="animate-spin" />
            : <Save size={14} aria-hidden />}
          {t("common.save")}
        </Button>
      </div>

      {/* ── THE CONFIRM SCREEN (§73) ───────────────────────────────────────
          The last thing between a draft and several thousand strangers, and
          the only screen in the module that states all of it at once: who,
          what, when, and which of the two things that quietly change the mail
          — tracking and AI personalisation — are on. Nothing here is fetched
          lazily: the recipient count was measured a moment ago, against the
          audience as it stands now. */}
      <Modal open={confirm !== null} onClose={() => setConfirm(null)}
        title={t("newsletter.schedule.confirmTitle")}>
        <dl className="space-y-2.5 text-[13px]" data-schedule-confirm>
          {[
            [t("common.name"), name],
            [t("newsletter.schedule.confirmRecipients"), String(confirm?.recipients ?? 0)],
            [t("newsletter.schedule.confirmSubject"), drafts[0]?.subject || "—"],
            [t("newsletter.schedule.confirmWhen"), when === "at" && scheduledIso
              ? formatInstant(scheduledIso, locale)
              : t("newsletter.schedule.now")],
            [t("newsletter.schedule.confirmTracking"),
              `${t("newsletter.tracking.opens")}: ${trackOpens ? t("newsletter.tracking.on") : t("newsletter.tracking.off")} · ${t("newsletter.tracking.clicks")}: ${trackClicks ? t("newsletter.tracking.on") : t("newsletter.tracking.off")}`],
            // Measured, not asserted: a non-zero count means individual copy
            // genuinely exists for this campaign's queue.
            [t("newsletter.schedule.confirmAi"), personalizedCount > 0
              ? t("newsletter.tracking.on") : t("newsletter.tracking.off")],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 last:border-0">
              <dt className="text-muted">{label}</dt>
              <dd className="min-w-0 break-words text-right font-semibold">{value}</dd>
            </div>
          ))}
        </dl>

        {/* The one sentence about this transport that an operator must have
            read before they press the button. */}
        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
          {t("newsletter.acceptedNote")}
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
          <Button disabled={pending} data-schedule-confirm-send onClick={schedule}>
            {pending && <Loader2 size={14} aria-hidden className="animate-spin" />}
            {t("newsletter.schedule.confirm")}
          </Button>
        </div>
      </Modal>

      <ConfirmModal
        open={cancelling}
        onClose={() => setCancelling(false)}
        onConfirm={() => control(
          cancelCampaignAction(campaign.id), t("newsletter.campaign.cancelled"),
        )}
        title={t("newsletter.campaign.cancelTitle")}
        body={t("newsletter.campaign.cancelBody")}
        confirmLabel={t("newsletter.campaign.cancel")}
        danger
        pending={pending}
      />

      <ConfirmModal
        open={removingStep !== null}
        onClose={() => setRemovingStep(null)}
        onConfirm={removeMessage}
        title={t("common.delete")}
        body={t("common.confirmDelete")}
        confirmLabel={t("common.delete")}
        danger
        pending={pending}
      />
    </div>
  );
}
