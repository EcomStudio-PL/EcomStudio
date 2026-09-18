"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Trash2, Workflow } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { AUTOMATION_TRIGGERS, type AutomationTrigger } from "@/lib/newsletter";
import type { AutomationRow, CampaignBrief, StepSummary } from "@/lib/services/newsletter";
import {
  deleteAutomationAction, saveAutomationAction, toggleAutomationAction,
} from "@/app/actions/newsletter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { RowAction, Switch } from "@/components/ui/record";
import { SectionHeader } from "@/components/ui/section-header";
import type { PickerOption } from "@/components/admin/newsletter/segment-builder";

/**
 * AUTOMATYZACJE — rules that are real, stored and enforced, and that nothing
 * currently listens to.
 *
 * THIS IS THE ONE THING THIS SCREEN MUST SAY OUT LOUD. `newsletter_automations`
 * exists in migration 0094 with its RLS, its trigger vocabulary and its
 * `trigger_config`; `saveAutomationAction` validates it and even refuses to
 * enable a rule whose sequence has nothing to send. What does not exist is the
 * half that fires: grep the repository and nothing outside this module's own
 * admin surface ever reads that table. `newsletter_start_due` starts SCHEDULED
 * campaigns and knows nothing about triggers.
 *
 * So a row here can be switched to "Włączona" and will stay switched, and no
 * group join will ever start the sequence. A screen that showed a green badge
 * and stopped there would be claiming a send that cannot happen — and the
 * operator would find out by watching a welcome sequence not arrive for a week.
 * Hence `LIVE_TRIGGERS` and the banner above the list.
 *
 * `LIVE_TRIGGERS` IS A LIST RATHER THAN A `false`, deliberately: when the first
 * dispatcher ships, adding its trigger to that array is the single edit that
 * makes this screen stop apologising for it — and the triggers that still do
 * not fire go on saying so, one by one, instead of the banner disappearing for
 * all six at once.
 *
 * STOP-ON-CONVERSION IS SHOWN, NOT EDITED. It lives on the CAMPAIGN
 * (`newsletter_campaigns.stop_on_conversion`), not on the rule, so its control
 * belongs on the campaign screen. A second switch here would either write to a
 * different row than the operator thinks, or write nothing at all.
 */

/** Trigger types the application actually dispatches today. Empty on purpose —
 *  see the note above. */
const LIVE_TRIGGERS: readonly AutomationTrigger[] = [];

const isLive = (trigger: string): boolean =>
  (LIVE_TRIGGERS as readonly string[]).includes(trigger);

/**
 * How each trigger is configured. `trigger_config` is free-form jsonb, so this
 * map is what stops the form and the reader from disagreeing about which key a
 * given trigger stores — the migration documents the three shapes
 * ({ group_id } | { source_key } | { campaign_id, within_days }) and this is
 * that comment made executable.
 */
type ConfigKind = "group" | "source" | "campaign" | "none";

const CONFIG_KIND: Record<AutomationTrigger, ConfigKind> = {
  group_joined: "group",
  form_submitted: "source",
  account_created: "none",
  no_click: "campaign",
  clicked: "campaign",
  converted: "campaign",
};

/** A step's own offset, written as a schedule offset rather than a sentence:
 *  "po 1 dniach" needs a plural rule per language that a delay of one would get
 *  wrong in all three, and this column is scanned, not read. */
function offsetLabel(minutes: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return t("newsletter.sequence.immediately");
  if (minutes % 1440 === 0) return t("newsletter.sequence.offsetDays", { n: minutes / 1440 });
  if (minutes % 60 === 0) return t("newsletter.sequence.offsetHours", { n: minutes / 60 });
  return t("newsletter.sequence.offsetMinutes", { n: minutes });
}

type Draft = {
  id?: string;
  name: string;
  triggerType: AutomationTrigger;
  /** The one id or key this trigger's config needs, whatever its shape. */
  configValue: string;
  withinDays: string;
  campaignId: string;
  enabled: boolean;
};

const emptyDraft = (campaignId: string): Draft => ({
  name: "", triggerType: "group_joined", configValue: "", withinDays: "7",
  campaignId, enabled: false,
});

export function AutomationList({ automations, campaigns, steps, groups, sources }: {
  automations: AutomationRow[];
  campaigns: CampaignBrief[];
  /** campaign id → its steps, in send order. Keyed rather than nested so a
   *  rule pointing at a deleted campaign renders as "no steps", not a crash. */
  steps: Record<string, StepSummary[]>;
  /** Static groups only: a dynamic segment has no membership rows, so
   *  "contact joined it" is not an event that can ever occur. */
  groups: PickerOption[];
  sources: PickerOption[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<AutomationRow | null>(null);

  const fail = (error: string) => toast.error(t(`newsletter.err.${error}`));
  const campaignOf = (id: string) => campaigns.find((c) => c.id === id) ?? null;

  function save() {
    if (!draft) return;
    const kind = CONFIG_KIND[draft.triggerType];
    const config: Record<string, unknown> =
      kind === "group" ? { group_id: draft.configValue }
        : kind === "source" ? { source_key: draft.configValue }
        : kind === "campaign" ? {
          campaign_id: draft.configValue,
          within_days: Math.max(1, Math.min(365, Number.parseInt(draft.withinDays, 10) || 7)),
        }
        : {};

    start(async () => {
      const res = await saveAutomationAction({
        id: draft.id,
        name: draft.name,
        triggerType: draft.triggerType,
        triggerConfig: config,
        campaignId: draft.campaignId,
        enabled: draft.enabled,
      });
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("common.saved"));
      setDraft(null);
      router.refresh();
    });
  }

  /** The row switch runs the same "has something to send" check the full save
   *  does, server-side. A refusal comes back as `err.body` and the switch stays
   *  where it was, because nothing optimistic is written here. */
  function toggle(automation: AutomationRow, enabled: boolean) {
    start(async () => {
      const res = await toggleAutomationAction({ id: automation.id, enabled });
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("common.saved"));
      router.refresh();
    });
  }

  function remove() {
    if (!deleting) return;
    const id = deleting.id;
    start(async () => {
      const res = await deleteAutomationAction(id);
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("common.deleted"));
      setDeleting(null);
      router.refresh();
    });
  }

  function openEdit(automation: AutomationRow) {
    const trigger = (AUTOMATION_TRIGGERS as readonly string[]).includes(automation.triggerType)
      ? (automation.triggerType as AutomationTrigger) : "group_joined";
    const config = automation.triggerConfig;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    setDraft({
      id: automation.id,
      name: automation.name,
      triggerType: trigger,
      configValue: str(config.group_id) || str(config.source_key) || str(config.campaign_id),
      withinDays: String(typeof config.within_days === "number" ? config.within_days : 7),
      campaignId: automation.campaignId,
      enabled: automation.enabled,
    });
  }

  /** What the rule's own configuration says, in words, for the list row. */
  function configSummary(automation: AutomationRow): string | null {
    const kind = CONFIG_KIND[automation.triggerType as AutomationTrigger] ?? "none";
    const config = automation.triggerConfig;
    if (kind === "group") {
      const id = typeof config.group_id === "string" ? config.group_id : "";
      return groups.find((g) => g.value === id)?.label ?? null;
    }
    if (kind === "source") {
      const key = typeof config.source_key === "string" ? config.source_key : "";
      return sources.find((s) => s.value === key)?.label ?? null;
    }
    if (kind === "campaign") {
      const id = typeof config.campaign_id === "string" ? config.campaign_id : "";
      return campaignOf(id)?.name ?? null;
    }
    return null;
  }

  const configOptions = (kind: ConfigKind): PickerOption[] =>
    kind === "group" ? groups
      : kind === "source" ? sources
      : kind === "campaign" ? campaigns.map((c) => ({ value: c.id, label: c.name }))
      : [];

  const draftKind = draft ? CONFIG_KIND[draft.triggerType] : "none";

  return (
    <div data-automation-list className="space-y-4">
      {/* ── WHAT ACTUALLY FIRES ────────────────────────────────────────────
          Above the list, not below it: this is the fact that decides whether
          anything on this screen is worth configuring today. */}
      {LIVE_TRIGGERS.length === 0 && (
        <div
          data-automations-not-live
          className="rounded-xl border border-[rgb(var(--warning)/0.4)] bg-[rgb(var(--warning)/0.08)] px-3.5 py-3"
        >
          <p className="flex items-start gap-2 text-[13px] font-semibold text-ink">
            <AlertTriangle size={15} className="mt-px shrink-0 text-warning" aria-hidden />
            <span className="min-w-0">{t("newsletter.automations.notLiveTitle")}</span>
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {t("newsletter.automations.notLiveBody")}
          </p>
        </div>
      )}

      <SectionHeader
        icon={Workflow}
        title={t("newsletter.automations.title")}
        sub={t("newsletter.automations.sub")}
        action={
          campaigns.length > 0 ? (
            <Button size="sm" data-automation-new
              onClick={() => setDraft(emptyDraft(campaigns[0].id))}>
              <Plus size={14} aria-hidden />{t("newsletter.automations.new")}
            </Button>
          ) : undefined
        }
      />

      {campaigns.length === 0 ? (
        // Without a campaign there is nothing for a rule to send, and
        // `saveAutomationAction` would refuse. Say that instead of opening a
        // form whose only required field cannot be filled.
        <EmptyState
          icon={Workflow}
          title={t("newsletter.automations.none")}
          body={t("newsletter.automations.noCampaigns")}
        />
      ) : automations.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title={t("newsletter.automations.none")}
          body={t("newsletter.automations.sub")}
          action={
            <Button size="sm" onClick={() => setDraft(emptyDraft(campaigns[0].id))}>
              <Plus size={14} aria-hidden />{t("newsletter.automations.new")}
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {automations.map((automation) => {
            const campaign = campaignOf(automation.campaignId);
            const sequence = steps[automation.campaignId] ?? [];
            const summary = configSummary(automation);
            const live = isLive(automation.triggerType);

            return (
              <li key={automation.id} className="panel rounded-2xl p-4"
                data-automation={automation.id}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-sm font-semibold">{automation.name}</h3>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone="info">
                        {t(`newsletter.trigger.${automation.triggerType}`)}
                      </Badge>
                      {summary && (
                        <span className="min-w-0 break-words text-[12px] text-muted">
                          {summary}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* The stored state, and separately whether it can do
                      anything. Both, because they are different facts. */}
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Switch
                      checked={automation.enabled}
                      disabled={pending}
                      label={t(`newsletter.automations.${automation.enabled ? "enabled" : "disabled"}`)}
                      onChange={(next) => toggle(automation, next)}
                    />
                    {!live && (
                      <Badge tone="warning">{t("newsletter.automations.notFiring")}</Badge>
                    )}
                  </div>
                </div>

                {/* ── THE SEQUENCE IT RUNS ──────────────────────────────── */}
                <div className="mt-3 border-t border-line pt-3">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px]">
                    <span className="font-semibold">{t("newsletter.automations.sequence")}:</span>
                    <span className="min-w-0 break-words text-muted">
                      {campaign?.name ?? automation.campaignName ?? "—"}
                    </span>
                    {campaign && (
                      <span className="text-faint">{t(`newsletter.kind.${campaign.kind}`)}</span>
                    )}
                  </p>

                  {sequence.length === 0 ? (
                    <p className="mt-1.5 text-[12px] text-muted">
                      {t("newsletter.automations.noSteps")}
                    </p>
                  ) : (
                    <ol className="mt-2 space-y-1.5">
                      {sequence.map((step) => (
                        <li key={step.id}
                          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
                          <span className="shrink-0 font-semibold tabular-nums">
                            {t("newsletter.sequence.stepN", { n: step.stepIndex + 1 })}
                            {step.variant !== "A" && ` ${step.variant}`}
                          </span>
                          <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted">
                            {offsetLabel(step.delayMinutes, t)}
                          </span>
                          <span className="min-w-0 break-words text-muted">
                            {step.subject.trim() || t("newsletter.templates.noSubject")}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}

                  {campaign && (
                    <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
                      {t("newsletter.automations.stopOnConversion")}:{" "}
                      {t(`newsletter.tracking.${campaign.stopOnConversion ? "on" : "off"}`)}
                      {campaign.stopOnConversion && ` — ${t("newsletter.automations.stopHint")}`}
                    </p>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <RowAction label={t("common.edit")} disabled={pending}
                    onClick={() => openEdit(automation)} data-automation-edit={automation.id} />
                  <RowAction label={t("common.delete")} icon={Trash2} tone="danger"
                    disabled={pending} onClick={() => setDeleting(automation)}
                    data-automation-delete={automation.id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── CREATE / EDIT ──────────────────────────────────────────────── */}
      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t("common.edit") : t("newsletter.automations.new")}
      >
        {draft && (
          <>
            <div className="space-y-3">
              <div>
                <Label htmlFor="aut-name">{t("common.name")}</Label>
                <Input id="aut-name" value={draft.name} autoFocus
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>

              <div>
                <Label htmlFor="aut-trigger">{t("newsletter.automations.trigger")}</Label>
                <Select id="aut-trigger" value={draft.triggerType}
                  onChange={(e) => setDraft({
                    ...draft,
                    triggerType: e.target.value as AutomationTrigger,
                    // The config belongs to the OLD trigger; keeping it would
                    // store a group id under `campaign_id`.
                    configValue: "",
                  })}>
                  {AUTOMATION_TRIGGERS.map((trigger) => (
                    <option key={trigger} value={trigger}>
                      {t(`newsletter.trigger.${trigger}`)}
                    </option>
                  ))}
                </Select>
                {!isLive(draft.triggerType) && (
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-warning">
                    {t("newsletter.automations.notLiveTitle")}
                  </p>
                )}
              </div>

              {draftKind !== "none" && (
                <div>
                  <Label htmlFor="aut-config">
                    {draftKind === "group" ? t("newsletter.automations.pickGroup")
                      : draftKind === "source" ? t("newsletter.automations.pickSource")
                      : t("newsletter.campaigns.title")}
                  </Label>
                  <Select id="aut-config" value={draft.configValue}
                    onChange={(e) => setDraft({ ...draft, configValue: e.target.value })}>
                    <option value="">
                      {draftKind === "group" ? t("newsletter.segment.pickGroup")
                        : draftKind === "source" ? t("newsletter.segment.pickSource")
                        : t("newsletter.segment.pickCampaign")}
                    </option>
                    {configOptions(draftKind).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </div>
              )}

              {draftKind === "campaign" && (
                <div>
                  <Label htmlFor="aut-days">{t("newsletter.automations.withinDays")}</Label>
                  <Input id="aut-days" type="number" inputMode="numeric" min={1} max={365}
                    value={draft.withinDays}
                    onChange={(e) => setDraft({ ...draft, withinDays: e.target.value })} />
                </div>
              )}

              <div>
                <Label htmlFor="aut-campaign">{t("newsletter.automations.pickCampaign")}</Label>
                <Select id="aut-campaign" value={draft.campaignId}
                  onChange={(e) => setDraft({ ...draft, campaignId: e.target.value })}>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {t(`newsletter.kind.${c.kind}`)}
                    </option>
                  ))}
                </Select>
              </div>

              {/* The sequence, as it will run, before the rule is saved. */}
              {(steps[draft.campaignId] ?? []).length === 0 ? (
                <p className="text-[11.5px] leading-relaxed text-muted">
                  {t("newsletter.automations.noSteps")}
                </p>
              ) : (
                <ol className="space-y-1">
                  {(steps[draft.campaignId] ?? []).map((step) => (
                    <li key={step.id} className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] text-muted">
                      <span className="font-semibold tabular-nums">
                        {t("newsletter.sequence.stepN", { n: step.stepIndex + 1 })}
                      </span>
                      <span className="tabular-nums">{offsetLabel(step.delayMinutes, t)}</span>
                      <span className="min-w-0 break-words">
                        {step.subject.trim() || t("newsletter.templates.noSubject")}
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="text-[13px] font-semibold">
                  {t(`newsletter.automations.${draft.enabled ? "enabled" : "disabled"}`)}
                </span>
                <Switch
                  checked={draft.enabled}
                  disabled={pending}
                  label={t("newsletter.automations.enabled")}
                  onChange={(next) => setDraft({ ...draft, enabled: next })}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
              <Button data-automation-save onClick={save}
                disabled={
                  pending || !draft.name.trim() || !draft.campaignId ||
                  (draftKind !== "none" && !draft.configValue)
                }>
                {pending ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={t("newsletter.automations.deleteTitle")}
        body={t("newsletter.automations.deleteBody")}
        confirmLabel={t("common.delete")}
        danger
        pending={pending}
      />
    </div>
  );
}
