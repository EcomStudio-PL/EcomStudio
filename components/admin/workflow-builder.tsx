"use client";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import {
  ArrowDown, ArrowUp, Copy, Eye, History, ImageIcon, Plus, Power, RotateCcw, ScanText, Sparkles, Trash2, Upload, Wand2, Wrench,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  compilePreviewAction, publishWorkflowAction, readWorkflowAction, restoreWorkflowAction,
  saveWorkflowAction, setWorkflowEnabledAction, type CompilePreview, type WorkflowStepInput,
} from "@/app/actions/ai-engine";
import type { WorkflowVersionRow } from "@/lib/services/ai-tools";
import {
  MAX_ATTEMPTS, MAX_CONCURRENCY, MAX_ITEMS, MAX_STEPS, STEP_PROMPT_MAX, STEP_TIMEOUT_MAX_MS, STEP_TIMEOUT_MIN_MS,
  TOOL_STEP_SLUGS, blankStep, finalStepIndex, isCollection, maxOutputsOf, stepVariables, validateWorkflow,
  type StepOperation,
} from "@/lib/ai/workflow-def";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { RelativeTime } from "@/components/ui/relative-time";
import { VariableChips, insertAtCursor } from "@/components/admin/variable-chips";
import { CompilePreviewModal } from "@/components/admin/tool-prompt";
import { cn } from "@/lib/utils";

/**
 * WORKFLOW — a vertical list of steps, run as ONE customer run with ONE
 * charge. Each step does one thing (AI text, image edit, image generation or
 * an existing GrovBase tool), reads NAMED inputs and writes ONE named output
 * ({{clean_image}}, {{scene_prompts}}). FOR EACH turns a step into a parallel
 * fan-out over an earlier list.
 *
 * The switch at the top is the only thing that makes a workflow run for
 * customers: OFF, the tool behaves exactly as it does without workflows. A
 * draft never changes production; publishing is one SQL transaction; a
 * rollback copies an old version forward as a new one.
 *
 * The editor validates with the SAME code the server and the runtime use
 * (lib/ai/workflow-def.ts), so it cannot accept what a run would refuse.
 */

export type ImageModelOption = { id: string; name: string; refs: boolean };

type T = (k: string, v?: Record<string, string | number>) => string;

function wfError(t: T, error?: string, step?: number, names?: string[]): string {
  const where = step ? ` (${t("aicc.wf.step", { n: step })})` : "";
  const key = `aicc.wf2.err.${error ?? "generic"}`;
  const msg = t(key, { names: (names ?? []).join(", ") });
  if (msg !== key) return msg + where;
  switch (error) {
    case "reason_required": return t("aicc.err.reasonRequired");
    case "encryption_unavailable": return t("aicc.err.encryption");
    case "decrypt_failed": return t("aicc.err.decrypt");
    case "too_long": return t("aicc.err.tooLong") + where;
    default: return t("common.error");
  }
}

const OP_ICON: Record<StepOperation, typeof Sparkles> = {
  ai_text: Sparkles, image_edit: Wand2, image_generation: ImageIcon, tool: Wrench,
};

/** A fresh, unique output name for a new step. */
function freshName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
  return `${base}_${Date.now() % 1000}`;
}

export function WorkflowBuilder({ toolKey, versions, models, locale, enabled }: {
  toolKey: string;
  versions: WorkflowVersionRow[];
  models: ImageModelOption[];
  locale: string;
  /** The Workflow switch as stored (ON = customers run the published version). */
  enabled: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const fresh = (): WorkflowStepInput[] => [blankStep("image_edit", "wynik", t("aicc.wf2.default.image_edit"))];
  const [steps, setSteps] = useState<WorkflowStepInput[]>(fresh);
  const [concurrency, setConcurrency] = useState(3);
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [preview, setPreview] = useState<CompilePreview | null>(null);
  const [viewing, setViewing] = useState<{ version: number; steps: WorkflowStepInput[] } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "publish" | "restore"; row: WorkflowVersionRow }>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchReason, setSwitchReason] = useState("");
  const topRef = useRef<HTMLDivElement | null>(null);
  const published = versions.find((v) => v.status === "published");

  // Live validation with the runtime's own rules.
  const verdict = useMemo(() => validateWorkflow(toolKey, { steps, concurrency }), [toolKey, steps, concurrency]);
  const finalIdx = finalStepIndex(steps);
  const outputs = finalIdx >= 0 ? maxOutputsOf(steps[finalIdx]) : 0;

  const update = (i: number, patch: Partial<WorkflowStepInput>) =>
    setSteps((list) => list.map((s, k) => (k === i ? normalise({ ...s, ...patch }) : s)));
  const move = (i: number, dir: -1 | 1) => setSteps((list) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (i: number) => setSteps((list) => (list.length <= 1 ? list : list.filter((_, k) => k !== i)));
  const duplicate = (i: number) => setSteps((list) => {
    if (list.length >= MAX_STEPS) return list;
    const taken = new Set(list.flatMap((s) => [s.outputName, s.itemName ?? ""]));
    const copy = { ...list[i], outputName: freshName(list[i].outputName, taken), name: `${list[i].name} (2)`.slice(0, 80) };
    return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
  });
  const add = (op: StepOperation) => setSteps((list) => {
    if (list.length >= MAX_STEPS) return list;
    const taken = new Set(list.flatMap((s) => [s.outputName, s.itemName ?? ""]));
    const base = op === "ai_text" ? "analiza" : op === "tool" ? "obraz_narzedzia" : "obraz";
    return [...list, blankStep(op, freshName(base, taken), t(`aicc.wf2.default.${op}`))];
  });

  /** The flow from the brief as a STARTING POINT the admin edits — not a
   *  hardcoded pipeline: retouch → scene prompts → FOR EACH generation. */
  function insertExample() {
    const retouch = { ...blankStep("tool", "clean_image", t("aicc.wf2.example.s1")), toolSlug: "retouch" as const };
    const analysis = {
      ...blankStep("ai_text", "scene_prompts", t("aicc.wf2.example.s2")),
      outputKind: "list" as const, maxItems: 5, inputImage: "clean_image",
      prompt: t("aicc.wf2.example.p2"),
    };
    const scenes = {
      ...blankStep("image_generation", "scenes", t("aicc.wf2.example.s3")),
      inputImage: "clean_image", forEach: "scene_prompts", itemName: "scene_prompt", maxItems: 5,
      prompt: t("aicc.wf2.example.p3"),
    };
    setSteps([retouch, analysis, scenes]);
    setFromVersion(null);
  }

  function save(publish: boolean) {
    start(async () => {
      const res = await saveWorkflowAction({ toolKey, steps, concurrency, summary: summary || null, reason: reason || null, publish });
      if (res.ok) {
        toast.success(publish ? t("aicc.wf.published", { n: res.version ?? 0 }) : t("aicc.wf.drafted", { n: res.version ?? 0 }));
        setSummary(""); setReason(""); setFromVersion(res.version ?? null);
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
        setSteps(res.steps); setConcurrency(res.concurrency ?? 3);
        setSummary(res.summary ?? ""); setReason(""); setFromVersion(row.version);
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

  function toggle() {
    start(async () => {
      const res = await setWorkflowEnabledAction(toolKey, !enabled, switchReason || null);
      if (res.ok) {
        toast.success(!enabled ? t("aicc.wf2.switchedOn") : t("aicc.wf2.switchedOff"));
        setSwitchOpen(false); setSwitchReason(""); router.refresh();
      } else toast.error(wfError(t, res.error));
    });
  }

  return (
    <div className="space-y-4" data-workflow-builder>
      {/* ── ON / OFF ─────────────────────────────────────────────────── */}
      <div className="panel flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:p-5" data-workflow-switch={enabled ? "on" : "off"}>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {t("aicc.wf2.switchTitle")}
            <Badge tone={enabled ? "accent" : "neutral"} dot>{enabled ? t("aicc.wf2.on") : t("aicc.wf2.off")}</Badge>
            {published
              ? <Badge tone="success">{t("aicc.prompt.status.published")} · v{published.version}</Badge>
              : <Badge tone="neutral">{t("aicc.wf.nonePublished")}</Badge>}
            {published?.maxOutputs ? <Badge tone="info">{t("aicc.wf2.outputs", { n: published.maxOutputs })}</Badge> : null}
          </p>
          <p className="text-xs leading-relaxed text-muted">{enabled ? t("aicc.wf2.onHint") : t("aicc.wf2.offHint")}</p>
        </div>
        <Button variant={enabled ? "secondary" : "primary"} disabled={pending || (!enabled && !published)}
          onClick={() => setSwitchOpen(true)} className="shrink-0">
          <Power size={14} aria-hidden /> {enabled ? t("aicc.wf2.turnOff") : t("aicc.wf2.turnOn")}
        </Button>
      </div>

      {/* ── editor ───────────────────────────────────────────────────── */}
      <div ref={topRef} className="scroll-mt-24 flex flex-wrap items-center gap-2 rounded-xl bg-raised px-4 py-3 text-[12.5px]">
        <span className="font-semibold">{t("aicc.wf2.editor")}</span>
        {fromVersion ? <Badge tone="info">{t("aicc.prompt.fromVersion", { n: fromVersion })}</Badge> : <Badge tone="neutral">{t("aicc.wf2.newDraft")}</Badge>}
        <Badge tone="neutral">{t("aicc.wf.steps", { n: steps.length })}</Badge>
        {finalIdx >= 0 && <Badge tone="neutral">{t("aicc.wf2.outputs", { n: outputs })}</Badge>}
        <Button size="sm" variant="ghost" className="ml-auto" disabled={pending} onClick={insertExample}>
          <Sparkles size={14} aria-hidden /> {t("aicc.wf2.example.button")}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted">{t("aicc.wf2.oneCharge")}</p>

      <ol className="space-y-0">
        {steps.map((s, i) => (
          <li key={i} className="list-none">
            {i > 0 && (
              <div className="flex items-center gap-2 py-1.5 pl-4 text-[11px] text-faint" aria-hidden>
                <ArrowDown size={14} />
                <code className="font-mono">{`{{${steps[i - 1].outputName}}}`}</code>
              </div>
            )}
            <StepCard toolKey={toolKey} index={i} steps={steps} models={models} pending={pending}
              onChange={(patch) => update(i, patch)} onMove={(dir) => move(i, dir)}
              onRemove={() => remove(i)} onDuplicate={() => duplicate(i)}
              onPreview={(body) => start(async () => setPreview(await compilePreviewAction({ toolKey, body, workflow: { steps, index: i } })))} />
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2" data-add-step>
        {(["ai_text", "image_edit", "image_generation", "tool"] as const).map((op) => {
          const Icon = OP_ICON[op];
          return (
            <Button key={op} size="sm" variant="secondary" disabled={pending || steps.length >= MAX_STEPS} onClick={() => add(op)}>
              <Plus size={14} aria-hidden /><Icon size={14} aria-hidden /> {t(`aicc.wf2.op.${op}`)}
            </Button>
          );
        })}
      </div>

      {!verdict.ok && (
        <p role="status" className="rounded-xl bg-warning/10 px-4 py-3 text-[13px] text-warning" data-workflow-invalid={verdict.error}>
          {wfError(t, verdict.error, verdict.step, verdict.names)}
        </p>
      )}

      <div className="panel grid gap-3 rounded-2xl p-4 sm:grid-cols-2 sm:p-5">
        <div>
          <Label htmlFor="wf-concurrency">{t("aicc.wf2.concurrency")}</Label>
          <Input id="wf-concurrency" type="number" inputMode="numeric" min={1} max={MAX_CONCURRENCY} value={concurrency}
            onChange={(e) => setConcurrency(Math.min(MAX_CONCURRENCY, Math.max(1, Math.trunc(Number(e.target.value) || 1))))} />
          <p className="mt-1 text-xs text-faint">{t("aicc.wf2.concurrencyHint")}</p>
        </div>
        <div>
          <Label htmlFor="wf-summary">{t("aicc.prompt.summary")}</Label>
          <Input id="wf-summary" value={summary} maxLength={300} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="wf-reason">{t("aicc.prompt.reason")}</Label>
          <Input id="wf-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" disabled={pending || !verdict.ok} onClick={() => save(false)}>{t("aicc.prompt.saveDraft")}</Button>
          <Button disabled={pending || !verdict.ok || !reason.trim()} onClick={() => save(true)} data-publish>
            <Upload size={14} aria-hidden /> {pending ? t("common.saving") : t("aicc.prompt.publish")}
          </Button>
        </div>
        <p className="text-xs text-faint sm:col-span-2">{t("aicc.wf2.draftNote")}</p>
      </div>

      <CompilePreviewModal preview={preview} onClose={() => setPreview(null)} />

      <Modal portal open={viewing !== null} onClose={() => setViewing(null)} title={t("aicc.wf.viewTitle", { n: viewing?.version ?? 0 })} wide>
        <ol className="space-y-3">
          {viewing?.steps.map((s, i) => (
            <li key={i} className="rounded-xl bg-sunken p-3">
              <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
                {i + 1}. {s.name}
                <Badge tone="neutral">{t(`aicc.wf2.op.${s.operation}`)}</Badge>
                <code className="font-mono text-[11px] text-muted">{`→ {{${s.outputName}}}`}</code>
                {s.forEach && <Badge tone="info">{t("aicc.wf2.forEachShort", { n: s.maxItems ?? 1 })}</Badge>}
                {!s.enabled && <Badge tone="neutral">{t("aicc.wf.disabled")}</Badge>}
              </p>
              {s.prompt.trim() && (
                <pre className="thin-scroll mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px]">{s.prompt}</pre>
              )}
            </li>
          ))}
        </ol>
      </Modal>

      <WorkflowHistory versions={versions} locale={locale} pending={pending} onLoad={load}
        onPublish={(row) => { setConfirmReason(row.reason ?? ""); setConfirm({ kind: "publish", row }); }}
        onRestore={(row) => { setConfirmReason(""); setConfirm({ kind: "restore", row }); }} />

      <Modal portal open={confirm !== null} onClose={() => setConfirm(null)}
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

      <Modal portal open={switchOpen} onClose={() => setSwitchOpen(false)}
        title={enabled ? t("aicc.wf2.turnOff") : t("aicc.wf2.turnOn")}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {enabled ? t("aicc.wf2.turnOffBody") : t("aicc.wf2.turnOnBody", { n: published?.version ?? 0, outputs: published?.maxOutputs ?? 1 })}
          </p>
          <div>
            <Label htmlFor="wf-switch-reason">{t("aicc.prompt.reason")}</Label>
            <Input id="wf-switch-reason" value={switchReason} maxLength={500} onChange={(e) => setSwitchReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSwitchOpen(false)}>{t("common.cancel")}</Button>
            <Button disabled={pending} onClick={toggle}>{pending ? t("common.saving") : t("common.save")}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Keep a step internally consistent when its operation changes. */
function normalise(s: WorkflowStepInput): WorkflowStepInput {
  const isText = s.operation === "ai_text";
  return {
    ...s,
    outputKind: isText ? (s.outputKind === "image" ? "text" : s.outputKind) : "image",
    modelId: isText || s.operation === "tool" ? null : s.modelId,
    fallbackModelId: isText || s.operation === "tool" ? null : s.fallbackModelId,
    textProvider: isText ? s.textProvider : null,
    textModel: isText ? s.textModel : null,
    toolSlug: s.operation === "tool" ? (s.toolSlug ?? "retouch") : null,
    itemName: s.forEach ? s.itemName : null,
    maxItems: s.forEach || (isText && s.outputKind === "list") ? s.maxItems ?? 5 : null,
  };
}

function StepCard({ toolKey, index, steps, models, onChange, onMove, onRemove, onDuplicate, onPreview, pending }: {
  toolKey: string; index: number; steps: WorkflowStepInput[]; models: ImageModelOption[];
  onChange: (patch: Partial<WorkflowStepInput>) => void; onMove: (dir: -1 | 1) => void;
  onRemove: () => void; onDuplicate: () => void; onPreview: (body: string) => void; pending: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const step = steps[index];
  const n = index + 1;
  const earlier = steps.slice(0, index);
  const collections = earlier.filter(isCollection);
  const images = earlier.filter((s) => s.outputKind === "image");
  const iteratedImages = step.forEach !== null && earlier.find((s) => s.outputName === step.forEach)?.outputKind === "image";
  const isText = step.operation === "ai_text";
  const isImage = step.operation === "image_edit" || step.operation === "image_generation";
  const Icon = OP_ICON[step.operation];
  const insert = (token: string) => {
    const next = insertAtCursor(ref.current, step.prompt, token);
    onChange({ prompt: next.value });
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(next.cursor, next.cursor); });
  };
  const ident = (v: string) => v.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]+/, "").slice(0, 40);

  return (
    <div className={cn("panel rounded-2xl p-4 sm:p-5", !step.enabled && "opacity-70")} data-step={n}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-bold">{n}</span>
        <Icon size={16} aria-hidden className="shrink-0 text-muted" />
        <Input aria-label={t("aicc.wf.stepName")} value={step.name} maxLength={80}
          onChange={(e) => onChange({ name: e.target.value })} className="min-w-0 flex-1 basis-40" />
        <span className="flex shrink-0 flex-wrap gap-1">
          <Button size="sm" variant="ghost" disabled={pending || index === 0} onClick={() => onMove(-1)} aria-label={t("aicc.wf.moveUp")}>
            <ArrowUp size={14} aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" disabled={pending || index >= steps.length - 1} onClick={() => onMove(1)} aria-label={t("aicc.wf.moveDown")}>
            <ArrowDown size={14} aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" disabled={pending || steps.length >= MAX_STEPS} onClick={onDuplicate} aria-label={t("aicc.wf2.duplicate")}>
            <Copy size={14} aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" disabled={pending || steps.length <= 1} onClick={onRemove} aria-label={t("aicc.wf.remove")}>
            <Trash2 size={14} aria-hidden />
          </Button>
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor={`${id}-op`}>{t("aicc.wf2.type")}</Label>
          <Select id={`${id}-op`} value={step.operation}
            onChange={(e) => onChange({ operation: e.target.value as StepOperation })}>
            {(["ai_text", "image_edit", "image_generation", "tool"] as const).map((op) => (
              <option key={op} value={op}>{t(`aicc.wf2.op.${op}`)}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${id}-name`}>{t("aicc.wf2.outputName")}</Label>
          <Input id={`${id}-name`} value={step.outputName} className="font-mono" spellCheck={false} autoCapitalize="off"
            onChange={(e) => onChange({ outputName: ident(e.target.value) })} />
        </div>
        {isText ? (
          <div>
            <Label htmlFor={`${id}-kind`}>{t("aicc.wf.output")}</Label>
            <Select id={`${id}-kind`} value={step.outputKind}
              onChange={(e) => onChange({ outputKind: e.target.value as WorkflowStepInput["outputKind"] })}>
              <option value="text">{t("aicc.wf2.kind.text")}</option>
              <option value="list">{t("aicc.wf2.kind.list")}</option>
              <option value="json">{t("aicc.wf2.kind.json")}</option>
            </Select>
          </div>
        ) : (
          <div className="self-end pb-2 text-xs text-muted">{t("aicc.wf2.kind.image")}</div>
        )}
        <label className="flex min-h-[40px] cursor-pointer items-center gap-2 self-end text-[13px]">
          <input type="checkbox" checked={step.enabled} onChange={(e) => onChange({ enabled: e.target.checked })}
            className="size-4 accent-[rgb(var(--accent))]" />
          {t("aicc.wf.enabled")}
        </label>
      </div>

      {/* Inputs: which image(s), and FOR EACH. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor={`${id}-in`}>{t("aicc.wf2.inputImage")}</Label>
          <Select id={`${id}-in`} value={step.inputImage} onChange={(e) => onChange({ inputImage: e.target.value })}>
            <option value="customer">{t("aicc.wf2.in.customer")}</option>
            {step.operation !== "image_edit" && step.operation !== "tool" && <option value="none">{t("aicc.wf2.in.none")}</option>}
            {images.map((s) => <option key={s.outputName} value={s.outputName}>{`{{${s.outputName}}}`}</option>)}
            {iteratedImages && step.itemName && <option value={step.itemName}>{`{{${step.itemName}}} · ${t("aicc.wf2.in.item")}`}</option>}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${id}-fe`}>{t("aicc.wf2.forEach")}</Label>
          <Select id={`${id}-fe`} value={step.forEach ?? ""}
            onChange={(e) => {
              const v = e.target.value || null;
              onChange({ forEach: v, itemName: v ? step.itemName ?? singular(v) : null, maxItems: v ? step.maxItems ?? 5 : step.maxItems });
            }}>
            <option value="">{t("aicc.wf2.forEachNone")}</option>
            {collections.map((s) => <option key={s.outputName} value={s.outputName}>{`{{${s.outputName}}}`}</option>)}
          </Select>
        </div>
        {step.forEach && (
          <div>
            <Label htmlFor={`${id}-item`}>{t("aicc.wf2.itemName")}</Label>
            <Input id={`${id}-item`} value={step.itemName ?? ""} className="font-mono" spellCheck={false} autoCapitalize="off"
              onChange={(e) => onChange({ itemName: ident(e.target.value) || null })} />
          </div>
        )}
        {(step.forEach || (isText && step.outputKind === "list")) && (
          <div>
            <Label htmlFor={`${id}-max`}>{step.forEach ? t("aicc.wf2.maxItems") : t("aicc.wf2.listCount")}</Label>
            <Input id={`${id}-max`} type="number" inputMode="numeric" min={1} max={MAX_ITEMS} value={step.maxItems ?? 1}
              onChange={(e) => onChange({ maxItems: Math.min(MAX_ITEMS, Math.max(1, Math.trunc(Number(e.target.value) || 1))) })} />
          </div>
        )}
      </div>

      {/* Executor. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isText && (
          <>
            <div>
              <Label htmlFor={`${id}-prov`}>{t("aicc.wf2.provider")}</Label>
              <Select id={`${id}-prov`} value={step.textProvider ?? ""}
                onChange={(e) => onChange({ textProvider: e.target.value === "openai" || e.target.value === "google" ? e.target.value : null })}>
                <option value="">{t("aicc.wf2.providerAuto")}</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${id}-tm`}>{t("aicc.wf2.textModel")}</Label>
              <Input id={`${id}-tm`} value={step.textModel ?? ""} placeholder={t("aicc.wf2.textModelAuto")} className="font-mono"
                spellCheck={false} autoCapitalize="off"
                onChange={(e) => onChange({ textModel: e.target.value.trim().toLowerCase().slice(0, 80) || null })} />
            </div>
          </>
        )}
        {isImage && (
          <>
            <div>
              <Label htmlFor={`${id}-model`}>{t("aicc.wf.model")}</Label>
              <Select id={`${id}-model`} value={step.modelId ?? ""} onChange={(e) => onChange({ modelId: e.target.value || null })}>
                <option value="">{t("aicc.wf.byTool")}</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${id}-fb`}>{t("aicc.apiPath.fallback")}</Label>
              <Select id={`${id}-fb`} value={step.fallbackModelId ?? ""} onChange={(e) => onChange({ fallbackModelId: e.target.value || null })}>
                <option value="">{step.modelId ? t("aicc.apiPath.noFallback") : t("aicc.wf.byTool")}</option>
                {models.filter((m) => m.id !== step.modelId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
          </>
        )}
        {step.operation === "tool" && (
          <div>
            <Label htmlFor={`${id}-tool`}>{t("aicc.wf2.toolSlug")}</Label>
            <Select id={`${id}-tool`} value={step.toolSlug ?? "retouch"}
              onChange={(e) => onChange({ toolSlug: e.target.value as WorkflowStepInput["toolSlug"] })}>
              {TOOL_STEP_SLUGS.map((slug) => <option key={slug} value={slug}>{t(`aicc.wf2.tool.${slug}`)}</option>)}
            </Select>
          </div>
        )}
      </div>

      <details className="mt-3 rounded-xl bg-raised px-3 py-2 text-[13px]">
        <summary className="cursor-pointer select-none py-1 font-semibold text-muted">{t("aicc.wf2.advanced")}</summary>
        <div className="mt-2 grid gap-3 pb-1 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor={`${id}-att`}>{t("aicc.wf2.attempts")}</Label>
            <Input id={`${id}-att`} type="number" inputMode="numeric" min={1} max={MAX_ATTEMPTS} value={step.maxAttempts}
              onChange={(e) => onChange({ maxAttempts: Math.min(MAX_ATTEMPTS, Math.max(1, Math.trunc(Number(e.target.value) || 1))) })} />
          </div>
          <div>
            <Label htmlFor={`${id}-to`}>{t("aicc.wf2.timeout")}</Label>
            <Input id={`${id}-to`} type="number" inputMode="numeric" min={STEP_TIMEOUT_MIN_MS / 1000} max={STEP_TIMEOUT_MAX_MS / 1000}
              value={Math.round(step.timeoutMs / 1000)}
              onChange={(e) => onChange({ timeoutMs: Math.min(STEP_TIMEOUT_MAX_MS, Math.max(STEP_TIMEOUT_MIN_MS, (Math.trunc(Number(e.target.value)) || 280) * 1000)) })} />
          </div>
          <div>
            <Label htmlFor={`${id}-err`}>{t("aicc.wf2.onError")}</Label>
            <Select id={`${id}-err`} value={step.onError} onChange={(e) => onChange({ onError: e.target.value === "continue" ? "continue" : "stop" })}>
              <option value="stop">{t("aicc.wf2.onError.stop")}</option>
              <option value="continue">{t("aicc.wf2.onError.continue")}</option>
            </Select>
          </div>
          {step.forEach && (
            <div>
              <Label htmlFor={`${id}-ierr`}>{t("aicc.wf2.onItemError")}</Label>
              <Select id={`${id}-ierr`} value={step.onItemError} onChange={(e) => onChange({ onItemError: e.target.value === "fail_run" ? "fail_run" : "continue" })}>
                <option value="continue">{t("aicc.wf2.onItemError.continue")}</option>
                <option value="fail_run">{t("aicc.wf2.onItemError.fail_run")}</option>
              </Select>
            </div>
          )}
        </div>
        <p className="pb-1 text-xs text-faint">{t("aicc.wf2.retryNote")}</p>
      </details>

      <div className="mt-3">
        <Label htmlFor={`${id}-prompt`}>{step.operation === "tool" ? t("aicc.wf2.promptTool") : t("aicc.wf.prompt")}</Label>
        <Textarea ref={ref} id={`${id}-prompt`} value={step.prompt} spellCheck={false}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder={t(`aicc.wf2.placeholder.${step.operation}`)}
          className="h-[26dvh] min-h-[8rem] resize-y scroll-mb-40 font-mono text-base leading-relaxed sm:h-48 sm:text-[12px]" />
        <p className={cn("mt-1 text-right text-xs tabular-nums", step.prompt.length > STEP_PROMPT_MAX ? "text-danger" : "text-faint")}>
          {step.prompt.length.toLocaleString()} / {STEP_PROMPT_MAX.toLocaleString()}
        </p>
        <div className="mt-2">
          <VariableChips defs={stepVariables(toolKey, steps, index)} onInsert={insert} />
        </div>
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" disabled={pending || !step.prompt.trim()} onClick={() => onPreview(step.prompt)}>
            <ScanText size={14} aria-hidden /> {t("aicc.prompt.preview")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** "scene_prompts" → "scene_prompt" — a sensible default item name. */
function singular(name: string): string {
  const base = name.endsWith("s") && name.length > 2 ? name.slice(0, -1) : `${name}_item`;
  return base.slice(0, 40);
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
                {v.maxOutputs ? <span className="text-xs text-faint">{t("aicc.wf2.outputs", { n: v.maxOutputs })}</span> : null}
                <span className="min-w-0 break-words text-xs text-muted">{[v.summary, v.reason].filter(Boolean).join(" · ") || "—"}</span>
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
