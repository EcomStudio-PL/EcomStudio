"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { ArrowDown, ArrowUp, Eye, History, Plus, RotateCcw, ScanText, Trash2, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  compilePreviewAction, publishWorkflowAction, readWorkflowAction, restoreWorkflowAction,
  saveWorkflowAction, type CompilePreview, type WorkflowStepInput,
} from "@/app/actions/ai-engine";
import type { WorkflowVersionRow } from "@/lib/services/ai-tools";
import { workflowVariables } from "@/lib/ai/prompt-variables";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { RelativeTime } from "@/components/ui/relative-time";
import { VariableChips, insertAtCursor } from "@/components/admin/variable-chips";
import { CompilePreviewModal } from "@/components/admin/tool-prompt";
import { cn } from "@/lib/utils";

/**
 * WORKFLOW — 1..8 steps, one customer run, one charge.
 *
 * Analysis steps (text or structured analysis) come first, in the order shown;
 * the image step is always last and is the only one billed. What each step can
 * output is limited to what the adapters really do: a text model returns TEXT
 * or ANALYSIS, the image model returns the IMAGE. Chained image-to-image steps
 * are not offered, because nothing in the provider layer can run them without
 * billing twice.
 *
 * Drafts change nothing in production; publishing is one SQL transaction; a
 * rollback copies an old version forward as a new one.
 */

const STEP_PROMPT_MAX = 20000;

const imageStep = (name: string): WorkflowStepInput => ({
  name, enabled: true, operation: "generate_image", outputKind: "image",
  useImages: true, modelId: null, textProvider: null, timeoutMs: 120000, maxAttempts: 1,
  condition: "always", prompt: "",
});
const analyzeStep = (name: string): WorkflowStepInput => ({
  name, enabled: true, operation: "analyze", outputKind: "analysis",
  useImages: true, modelId: null, textProvider: null, timeoutMs: 60000, maxAttempts: 1,
  condition: "always", prompt: "",
});

export type ImageModelOption = { id: string; name: string };

function wfError(t: (k: string, v?: Record<string, string | number>) => string, error?: string, step?: number, names?: string[]): string {
  const where = step ? ` (${t("aicc.wf.step", { n: step })})` : "";
  switch (error) {
    case "reason_required": return t("aicc.err.reasonRequired");
    case "variable_unknown": return t("aicc.wf.err.variableUnknown", { names: (names ?? []).join(", ") }) + where;
    case "variable_malformed": return t("aicc.wf.err.variableMalformed") + where;
    case "empty_prompt": return t("aicc.wf.err.emptyPrompt") + where;
    case "step_name": return t("aicc.wf.err.stepName") + where;
    case "image_step_last": return t("aicc.wf.err.imageLast");
    case "image_step_disabled": return t("aicc.wf.err.imageDisabled");
    case "model_unusable": return t("aicc.wf.err.modelUnusable");
    case "too_long": return t("aicc.err.tooLong") + where;
    case "encryption_unavailable": return t("aicc.err.encryption");
    case "decrypt_failed": return t("aicc.err.decrypt");
    default: return t("common.error");
  }
}

export function WorkflowBuilder({ toolKey, versions, models, locale, active }: {
  toolKey: string;
  versions: WorkflowVersionRow[];
  models: ImageModelOption[];
  locale: string;
  /** Whether the tool currently RUNS its workflow (mode = workflow). */
  active: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const fresh = () => [imageStep(t("aicc.wf.defaultImage"))];
  const [steps, setSteps] = useState<WorkflowStepInput[]>(fresh);
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [preview, setPreview] = useState<CompilePreview | null>(null);
  const [viewing, setViewing] = useState<{ version: number; steps: WorkflowStepInput[] } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "publish" | "restore"; row: WorkflowVersionRow }>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const topRef = useRef<HTMLDivElement | null>(null);
  const published = versions.find((v) => v.status === "published");

  const update = (i: number, patch: Partial<WorkflowStepInput>) =>
    setSteps((list) => list.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) => setSteps((list) => {
    const j = i + dir;
    // The image step stays last; analysis steps move among themselves.
    if (j < 0 || j >= list.length - 1 || i >= list.length - 1) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (i: number) => setSteps((list) => list.filter((_, k) => k !== i));
  const add = () => setSteps((list) => list.length >= 8 ? list
    : [...list.slice(0, -1), analyzeStep(t("aicc.wf.defaultAnalyze", { n: list.length })), list[list.length - 1]]);

  function save(publish: boolean) {
    start(async () => {
      const res = await saveWorkflowAction({ toolKey, steps, summary: summary || null, reason: reason || null, publish });
      if (res.ok) {
        toast.success(publish ? t("aicc.wf.published", { n: res.version ?? 0 }) : t("aicc.wf.drafted", { n: res.version ?? 0 }));
        setSteps(fresh()); setSummary(""); setReason(""); setFromVersion(null);
        router.refresh();
      } else toast.error(wfError(t, res.error, res.step, res.names));
    });
  }

  function load(row: WorkflowVersionRow, mode: "view" | "edit") {
    start(async () => {
      const res = await readWorkflowAction(row.id);
      if (!res.ok || !res.steps) { toast.error(wfError(t, res.error)); return; }
      if (mode === "view") setViewing({ version: row.version, steps: res.steps });
      else {
        setSteps(res.steps); setSummary(res.summary ?? ""); setReason(""); setFromVersion(row.version);
        topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  function runConfirm() {
    if (!confirm) return;
    start(async () => {
      const res = confirm.kind === "publish"
        ? await publishWorkflowAction(confirm.row.id, confirmReason)
        : await restoreWorkflowAction(confirm.row.id, confirmReason);
      if (res.ok) { toast.success(t("common.saved")); setConfirm(null); setConfirmReason(""); router.refresh(); }
      else toast.error(wfError(t, res.error));
    });
  }

  return (
    <div className="space-y-4" data-workflow-builder>
      <div ref={topRef} className="scroll-mt-24 flex flex-wrap items-center gap-2 rounded-xl bg-raised px-4 py-3 text-[12.5px]">
        <span className="text-muted">{t("aicc.prompt.statusLabel")}</span>
        {published
          ? <Badge tone="success">{t("aicc.prompt.status.published")} · v{published.version}</Badge>
          : <Badge tone="neutral">{t("aicc.wf.nonePublished")}</Badge>}
        <Badge tone={active ? "accent" : "neutral"}>{active ? t("aicc.wf.runsNow") : t("aicc.wf.notActive")}</Badge>
        {fromVersion && <Badge tone="info">{t("aicc.prompt.fromVersion", { n: fromVersion })}</Badge>}
      </div>
      <p className="text-xs leading-relaxed text-muted">{t("aicc.wf.oneCharge")}</p>

      <ol className="space-y-3">
        {steps.map((s, i) => (
          <StepCard key={i} toolKey={toolKey} index={i} step={s} total={steps.length} models={models}
            onChange={(patch) => update(i, patch)} onMove={(dir) => move(i, dir)} onRemove={() => remove(i)}
            onPreview={(body) => start(async () => setPreview(await compilePreviewAction({ toolKey, body, workflowPosition: i + 1 })))}
            pending={pending} />
        ))}
      </ol>

      <Button variant="secondary" disabled={pending || steps.length >= 8} onClick={add}>
        <Plus size={14} aria-hidden /> {t("aicc.wf.addStep")}
      </Button>

      <div className="panel grid gap-3 rounded-2xl p-4 sm:grid-cols-2 sm:p-5">
        <div>
          <Label htmlFor="wf-summary">{t("aicc.prompt.summary")}</Label>
          <Input id="wf-summary" value={summary} maxLength={300} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="wf-reason">{t("aicc.prompt.reason")}</Label>
          <Input id="wf-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" disabled={pending} onClick={() => save(false)}>{t("aicc.prompt.saveDraft")}</Button>
          <Button disabled={pending || !reason.trim()} onClick={() => save(true)}>
            <Upload size={14} aria-hidden /> {pending ? t("common.saving") : t("aicc.prompt.publish")}
          </Button>
        </div>
      </div>

      <CompilePreviewModal preview={preview} onClose={() => setPreview(null)} />

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={t("aicc.wf.viewTitle", { n: viewing?.version ?? 0 })} wide>
        <ol className="space-y-3">
          {viewing?.steps.map((s, i) => (
            <li key={i} className="rounded-xl bg-sunken p-3">
              <p className="text-[13px] font-semibold">{i + 1}. {s.name} {!s.enabled && <Badge tone="neutral">{t("aicc.wf.disabled")}</Badge>}</p>
              <p className="mt-0.5 text-xs text-muted">{t(`aicc.wf.op.${s.operation}`)} · {t(`aicc.wf.out.${s.outputKind}`)}</p>
              <pre className="thin-scroll mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px]">{s.prompt}</pre>
            </li>
          ))}
        </ol>
      </Modal>

      <WorkflowHistory versions={versions} locale={locale} pending={pending} onLoad={load}
        onPublish={(row) => { setConfirmReason(row.reason ?? ""); setConfirm({ kind: "publish", row }); }}
        onRestore={(row) => { setConfirmReason(""); setConfirm({ kind: "restore", row }); }} />

      <Modal open={confirm !== null} onClose={() => setConfirm(null)}
        title={confirm?.kind === "restore" ? t("aicc.prompt.restore") : t("aicc.prompt.publish")}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {confirm?.kind === "restore"
              ? t("aicc.wf.restoreBody", { n: confirm.row.version })
              : t("aicc.wf.publishBody", { n: confirm?.row.version ?? 0 })}
          </p>
          <div>
            <Label htmlFor="wf-confirm-reason">{t("aicc.prompt.reason")}</Label>
            <Input id="wf-confirm-reason" value={confirmReason} onChange={(e) => setConfirmReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
            <Button disabled={pending || (confirm?.kind === "publish" && !confirmReason.trim())} onClick={runConfirm}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function StepCard({ toolKey, index, step, total, models, onChange, onMove, onRemove, onPreview, pending }: {
  toolKey: string; index: number; step: WorkflowStepInput; total: number; models: ImageModelOption[];
  onChange: (patch: Partial<WorkflowStepInput>) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
  onPreview: (body: string) => void; pending: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const isImage = step.operation === "generate_image";
  const n = index + 1;
  const insert = (token: string) => {
    const next = insertAtCursor(ref.current, step.prompt, token);
    onChange({ prompt: next.value });
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(next.cursor, next.cursor); });
  };
  return (
    <li className={cn("panel rounded-2xl p-4 sm:p-5", !step.enabled && "opacity-70")} data-step={n}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-bold">{n}</span>
        <Input aria-label={t("aicc.wf.stepName")} value={step.name} maxLength={80}
          onChange={(e) => onChange({ name: e.target.value })} className="min-w-0 flex-1 basis-40" />
        <Badge tone={isImage ? "accent" : "neutral"}>{t(`aicc.wf.op.${step.operation}`)}</Badge>
        {!isImage && (
          <span className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" disabled={pending || index === 0} onClick={() => onMove(-1)} aria-label={t("aicc.wf.moveUp")}>
              <ArrowUp size={14} aria-hidden />
            </Button>
            <Button size="sm" variant="ghost" disabled={pending || index >= total - 2} onClick={() => onMove(1)} aria-label={t("aicc.wf.moveDown")}>
              <ArrowDown size={14} aria-hidden />
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={onRemove} aria-label={t("aicc.wf.remove")}>
              <Trash2 size={14} aria-hidden />
            </Button>
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-[13px]">
          <input type="checkbox" checked={step.enabled} disabled={isImage}
            onChange={(e) => onChange({ enabled: e.target.checked })} className="size-4 accent-[rgb(var(--accent))]" />
          {t("aicc.wf.enabled")}
        </label>
        {!isImage && (
          <div>
            <Label htmlFor={`${id}-out`}>{t("aicc.wf.output")}</Label>
            <Select id={`${id}-out`} value={step.outputKind}
              onChange={(e) => onChange({ outputKind: e.target.value === "text" ? "text" : "analysis" })}>
              <option value="analysis">{t("aicc.wf.out.analysis")}</option>
              <option value="text">{t("aicc.wf.out.text")}</option>
            </Select>
          </div>
        )}
        {isImage && <p className="self-center text-xs text-muted">{t("aicc.wf.out.image")} · {t("aicc.wf.imageNote")}</p>}
        <div>
          <Label htmlFor={`${id}-model`}>{t("aicc.wf.model")}</Label>
          {isImage ? (
            <Select id={`${id}-model`} value={step.modelId ?? ""} onChange={(e) => onChange({ modelId: e.target.value || null })}>
              <option value="">{t("aicc.wf.byTool")}</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          ) : (
            <Select id={`${id}-model`} value={step.textProvider ?? ""}
              onChange={(e) => onChange({ textProvider: e.target.value === "openai" || e.target.value === "google" ? e.target.value : null })}>
              <option value="">{t("aicc.wf.byTool")}</option>
              <option value="openai">OpenAI</option>
              <option value="google">Google</option>
            </Select>
          )}
        </div>
        {!isImage && (
          <>
            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" checked={step.useImages} onChange={(e) => onChange({ useImages: e.target.checked })}
                className="size-4 accent-[rgb(var(--accent))]" />
              {t("aicc.wf.useImages")}
            </label>
            <div>
              <Label htmlFor={`${id}-cond`}>{t("aicc.wf.condition")}</Label>
              <Select id={`${id}-cond`} value={step.condition}
                onChange={(e) => onChange({ condition: e.target.value as WorkflowStepInput["condition"] })}>
                <option value="always">{t("aicc.wf.cond.always")}</option>
                <option value="if_hint">{t("aicc.wf.cond.if_hint")}</option>
                <option value="if_previous_nonempty">{t("aicc.wf.cond.if_previous_nonempty")}</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor={`${id}-timeout`}>{t("aicc.wf.timeout")}</Label>
                <Input id={`${id}-timeout`} type="number" min={5} max={300} value={Math.round(step.timeoutMs / 1000)}
                  onChange={(e) => onChange({ timeoutMs: (Number(e.target.value) || 60) * 1000 })} />
              </div>
              <div>
                <Label htmlFor={`${id}-retry`}>{t("aicc.wf.attempts")}</Label>
                <Input id={`${id}-retry`} type="number" min={1} max={3} value={step.maxAttempts}
                  onChange={(e) => onChange({ maxAttempts: Number(e.target.value) || 1 })} />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-3">
        <Label htmlFor={`${id}-prompt`}>{t("aicc.wf.prompt")}</Label>
        <Textarea ref={ref} id={`${id}-prompt`} value={step.prompt} spellCheck={false}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder={isImage ? t("aicc.wf.imagePlaceholder") : t("aicc.wf.analyzePlaceholder")}
          className="h-[30dvh] min-h-[10rem] resize-y scroll-mb-40 font-mono text-[12px] leading-relaxed sm:h-56" />
        <p className={cn("mt-1 text-right text-xs tabular-nums", step.prompt.length > STEP_PROMPT_MAX ? "text-danger" : "text-faint")}>
          {step.prompt.length.toLocaleString()} / {STEP_PROMPT_MAX.toLocaleString()}
        </p>
        <div className="mt-2">
          <VariableChips defs={workflowVariables(toolKey, n)} onInsert={insert} />
        </div>
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" disabled={pending || !step.prompt.trim()} onClick={() => onPreview(step.prompt)}>
            <ScanText size={14} aria-hidden /> {t("aicc.prompt.preview")}
          </Button>
        </div>
      </div>
    </li>
  );
}

export function WorkflowHistory({ versions, locale, pending, onLoad, onPublish, onRestore }: {
  versions: WorkflowVersionRow[]; locale: string; pending: boolean;
  onLoad: (row: WorkflowVersionRow, mode: "view" | "edit") => void;
  onPublish: (row: WorkflowVersionRow) => void;
  onRestore: (row: WorkflowVersionRow) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="panel rounded-2xl" data-workflow-history>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
        <History size={14} aria-hidden className="text-faint" />
        <p className="text-sm font-semibold">{t("aicc.wf.history")}</p>
      </div>
      {versions.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">{t("aicc.wf.noVersions")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:px-5">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="shrink-0 font-mono text-[13px] font-semibold">v{v.version}</span>
                <Badge tone={v.status === "published" ? "success" : v.status === "draft" ? "info" : "neutral"}>
                  {t(`aicc.prompt.status.${v.status}`)}
                </Badge>
                <span className="text-xs text-faint">{t("aicc.wf.steps", { n: v.stepCount })}</span>
                <span className="min-w-0 truncate text-xs text-muted">{v.summary || v.reason || "—"}</span>
              </span>
              <span className="shrink-0 text-xs text-faint">
                {v.authorName ? `${v.authorName} · ` : ""}
                <RelativeTime at={v.publishedAt ?? v.createdAt} locale={locale} t={t} />
              </span>
              <span className="flex shrink-0 flex-wrap gap-1">
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => onLoad(v, "view")}
                  aria-label={t("aicc.wf.viewTitle", { n: v.version })}>
                  <Eye size={14} aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => onLoad(v, "edit")}>{t("common.edit")}</Button>
                {v.status === "draft" && (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => onPublish(v)}>{t("aicc.prompt.publish")}</Button>
                )}
                {v.status === "superseded" && (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => onRestore(v)}>
                    <RotateCcw size={14} aria-hidden /> {t("aicc.prompt.restore")}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
