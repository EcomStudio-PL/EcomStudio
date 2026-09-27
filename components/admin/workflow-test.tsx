"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "@/lib/notify";
import { CheckCircle2, CircleDashed, FlaskConical, Loader2, Upload, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { readWorkflowTestAction, startWorkflowTestAction, type TestRunView, type TestStepView } from "@/app/actions/ai-engine";
import type { WorkflowVersionRow } from "@/lib/services/ai-tools";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

/**
 * TEST WORKFLOW — a REAL run of a saved version (draft or published) on the
 * admin's own test photos, before anything reaches customers. Every step shows
 * ✓/✗, its time, the provider/model that really answered, N/N items for a
 * fan-out, tokens and cost; the totals are the run's own sums. Step prompts are
 * never shown here — only what each step produced.
 */
export function WorkflowTestPanel({ toolKey, versions, workspaceId }: {
  toolKey: string; versions: WorkflowVersionRow[]; workspaceId: string | null;
}) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const selectable = versions.filter((v) => v.status === "draft" || v.status === "published");
  const [versionId, setVersionId] = useState(selectable[0]?.id ?? "");
  const [photos, setPhotos] = useState<{ path: string; url: string }[]>([]);
  const [hint, setHint] = useState("");
  const [uploading, setUploading] = useState(false);
  const [run, setRun] = useState<TestRunView | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const folder = useRef(`wf-test-input/${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const tick = async () => {
      const res = await readWorkflowTestAction(runId);
      if (stop) return;
      if (res.ok && res.run) {
        setRun(res.run);
        if (res.run.status === "queued" || res.run.status === "running") timer.current = setTimeout(tick, 2500);
      } else timer.current = setTimeout(tick, 5000);
    };
    void tick();
    return () => { stop = true; if (timer.current) clearTimeout(timer.current); };
  }, [runId]);

  async function upload(files: FileList | null) {
    if (!files?.length || !workspaceId) return;
    setUploading(true);
    try {
      const supabase = createClient();
      for (const file of Array.from(files).slice(0, 10 - photos.length)) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
          toast.error(t("aicc.wf2.test.badType")); continue;
        }
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${workspaceId}/${folder.current}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file);
        if (error) { toast.error(t("common.error")); continue; }
        setPhotos((p) => [...p, { path, url: URL.createObjectURL(file) }]);
      }
    } finally { setUploading(false); }
  }

  function startTest() {
    start(async () => {
      const res = await startWorkflowTestAction({ toolKey, workflowId: versionId, referencePaths: photos.map((p) => p.path), hint });
      if (res.ok && res.runId) { setRun(null); setRunId(res.runId); }
      else toast.error(t(`aicc.wf2.err.${res.error ?? "generic"}`) === `aicc.wf2.err.${res.error ?? "generic"}` ? t("common.error") : t(`aicc.wf2.err.${res.error ?? "generic"}`));
    });
  }

  const active = run ? run.status === "queued" || run.status === "running" : Boolean(runId);
  const usd = (micros: number | null) => micros === null ? "—" : `$${(micros / 1_000_000).toFixed(4)}`;
  const secs = (ms: number | null) => ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`;

  // Steps grouped: the step itself, or its fan-out children as N/N.
  const groups = new Map<number, TestStepView[]>();
  for (const s of run?.steps ?? []) groups.set(s.position, [...(groups.get(s.position) ?? []), s]);

  return (
    <div className="space-y-4" data-workflow-test>
      <p className="text-xs leading-relaxed text-muted">{t("aicc.wf2.test.note")}</p>
      {selectable.length === 0 ? (
        <p className="rounded-xl bg-raised px-4 py-3 text-sm text-muted">{t("aicc.wf2.test.saveFirst")}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="wft-version">{t("aicc.wf2.test.version")}</Label>
            <Select id="wft-version" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              {selectable.map((v) => (
                <option key={v.id} value={v.id}>v{v.version} · {t(`aicc.prompt.status.${v.status}`)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="wft-hint">{t("aicc.wf2.test.hint")}</Label>
            <Input id="wft-hint" value={hint} maxLength={1000} onChange={(e) => setHint(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-xs font-semibold text-muted">{t("aicc.wf2.test.photos")}</p>
            <div className="flex flex-wrap items-center gap-2">
              {photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.path} src={p.url} alt="" className="size-16 rounded-lg object-cover ring-1 ring-line" />
              ))}
              <label className="inline-flex h-16 min-w-16 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-xs text-muted">
                {uploading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />}
                {t("aicc.wf2.test.add")}
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only"
                  disabled={uploading || !workspaceId} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button disabled={pending || active || !versionId || photos.length === 0 || uploading} onClick={startTest} data-run-test>
              <FlaskConical size={14} aria-hidden /> {active ? t("aicc.wf2.test.running") : t("aicc.wf2.test.run")}
            </Button>
          </div>
        </div>
      )}

      {run && (
        <div className="panel rounded-2xl p-4 sm:p-5" data-test-run={run.status}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={run.status === "ok" ? "success" : run.status === "partial" ? "warning" : active ? "accent" : "danger"} dot>
              {t(`aicc.wf2.status.${run.status}`)}
            </Badge>
            <span className="text-xs text-muted">v{run.version}</span>
            {run.error && !active && <code className="break-all text-xs text-danger">{run.error}</code>}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
            <Total label={t("aicc.wf2.test.time")} value={secs(run.durationMs)} />
            <Total label={t("aicc.wf2.test.cost")}
              value={run.costUnknown > 0 ? `${usd(run.costUsdMicros)} + ${t("aicc.exec.costUnknown")} ×${run.costUnknown}` : usd(run.costUsdMicros)} />
            <Total label={t("aicc.wf2.test.tokens")} value={`${run.tokensIn.toLocaleString(locale)} / ${run.tokensOut.toLocaleString(locale)}`} />
            <Total label={t("aicc.wf2.test.results")} value={`${run.delivered} / ${run.expected}`} />
          </dl>
          <ol className="mt-4 space-y-2">
            {[...groups.entries()].map(([pos, rows]) => <StepRow key={pos} rows={rows} usd={usd} secs={secs} t={t} />)}
          </ol>
          {run.results.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-test-results>
              {run.results.map((u) => (
                // eslint-disable-next-line @next/next/no-img-element
                <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="aspect-square w-full rounded-lg object-cover ring-1 ring-line" /></a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-raised px-3 py-2">
      <dt className="truncate text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function StepRow({ rows, usd, secs, t }: {
  rows: TestStepView[]; usd: (m: number | null) => string; secs: (ms: number | null) => string;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const head = rows[0];
  const items = rows.filter((r) => r.item >= 0);
  const fan = items.length > 0;
  const done = rows.filter((r) => r.status === "succeeded").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const running = rows.some((r) => r.status === "running" || r.status === "pending");
  const ms = fan ? Math.max(...rows.map((r) => r.ms ?? 0)) : head.ms;
  const cost = rows.reduce((a, r) => a + (r.costUsdMicros ?? 0), 0);
  const unknown = rows.filter((r) => !r.costKnown && (r.status === "succeeded" || r.status === "failed")).length;
  const executors = [...new Set(rows.map((r) => [r.provider, r.model].filter(Boolean).join(" / ")).filter(Boolean))];
  const Icon = running ? CircleDashed : failed && !done ? XCircle : CheckCircle2;
  return (
    <li className="rounded-xl bg-raised p-3" data-test-step={head.position}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <Icon size={16} aria-hidden className={running ? "animate-spin text-muted" : failed && !done ? "text-danger" : "text-success"} />
        <span className="font-semibold">{head.position}. {head.name ?? head.operation}</span>
        <Badge tone="neutral">{t(`aicc.wf2.op.${head.operation}`)}</Badge>
        {fan && <Badge tone={failed ? "warning" : "info"}>{done}/{items.length}</Badge>}
        <span className="text-xs tabular-nums text-muted">{secs(ms)}</span>
        <span className="text-xs tabular-nums text-muted">{unknown ? `${usd(cost)} + ${t("aicc.exec.costUnknown")}` : usd(cost)}</span>
      </p>
      <p className="mt-1 break-words text-xs text-muted">
        {executors.length ? executors.join(" · ") : t("aicc.wf2.test.executorUnknown")}
        {rows.some((r) => r.attempts > 1) ? ` · ${t("aicc.wf2.test.retried")}` : ""}
        {rows.some((r) => r.error) ? ` · ${[...new Set(rows.map((r) => r.error).filter(Boolean))].join(", ")}` : ""}
      </p>
      {rows.some((r) => r.text) && (
        <pre className="thin-scroll mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sunken p-2 font-mono text-[11.5px]">
          {rows.map((r) => r.text).filter(Boolean).join("\n—\n")}
        </pre>
      )}
      {rows.some((r) => r.imageUrl) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {rows.filter((r) => r.imageUrl).map((r) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a key={`${r.position}-${r.item}`} href={r.imageUrl!} target="_blank" rel="noreferrer"><img src={r.imageUrl!} alt="" className="size-20 rounded-lg object-cover ring-1 ring-line" /></a>
          ))}
        </div>
      )}
    </li>
  );
}
