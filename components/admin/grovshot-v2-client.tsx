"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileDown, FlaskConical, Loader2, Upload } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import { saveRoleModelsAction, seedSpecDraftsAction, testStageModelAction } from "@/app/actions/grovshot-v2-admin";
import type { V2RunView } from "@/lib/server/grovshot-v2/admin";
import { GROVSHOT_V2_KEYS } from "@/lib/grovshot-v2/stages";
import { CLAUDE_STAGE_MODELS, STAGE_PROVIDERS, STAGE_ROLES, type StageModel, type StageRole } from "@/lib/grovshot-v2/config";
import { ANTHROPIC_EFFORTS } from "@/lib/ai/anthropic-options";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

/**
 * SILNIK V2 — the admin tab's interactive pieces: the spec drafts loader,
 * the stage models (saved as a config draft, each testable with one minimal
 * request), the engine test (a real order on the admin's own photos, on
 * chosen versions, never charged — "prompts" or "full") and one run's
 * diagnostics. No stage template body reaches this file; a TEST run's own
 * card, plan and compiled shot prompts are shown to the admin who ran it.
 */

/** „Test silnika” goes through the admin-only route (app/api/admin/grovshot-v2/test). */
type TestReply = { ok: boolean; error?: string; blockers?: string[]; runId?: string; run?: V2RunView };
async function testApi(init?: { body: unknown } | { run: string }): Promise<TestReply> {
  try {
    const res = init && "run" in init
      ? await fetch(`/api/admin/grovshot-v2/test?run=${encodeURIComponent(init.run)}`, { cache: "no-store" })
      : await fetch("/api/admin/grovshot-v2/test", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init?.body ?? {}),
        });
    return (await res.json()) as TestReply;
  } catch {
    return { ok: false, error: "generic" };
  }
}

const errText = (t: ReturnType<typeof useI18n>["t"], code: string | undefined) => {
  const key = `aicc.gsv2.err.${code ?? "generic"}`;
  const known = t(key);
  return known === key ? t("common.error") : known;
};

const usdOf = (m: number | null | undefined) => (m === null || m === undefined ? "—" : `$${(m / 1_000_000).toFixed(m < 10_000 ? 5 : 3)}`);

/* ── stage models ────────────────────────────────────────────────────────*/

type Ref = { provider: string; model: string; effort: string };
type RoleRow = Ref & { fallback: Ref | null };
const blankRef: Ref = { provider: "anthropic", model: CLAUDE_STAGE_MODELS[0], effort: "" };
const toRow = (m: StageModel | undefined): RoleRow => m
  ? { provider: m.provider, model: m.model, effort: m.effort ?? "", fallback: m.fallback ? { provider: m.fallback.provider, model: m.fallback.model, effort: m.fallback.effort ?? "" } : null }
  : { ...blankRef, fallback: null };
const toRef = (r: Ref) => ({ provider: r.provider, model: r.model.trim(), ...(r.provider === "anthropic" && r.effort ? { effort: r.effort } : {}) });

export function GsV2RoleModels({ models, states }: {
  models: Partial<Record<StageRole, StageModel>> | null; states: Partial<Record<StageRole, string>>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Record<StageRole, RoleRow>>(() =>
    Object.fromEntries(STAGE_ROLES.map((r) => [r, toRow(models?.[r])])) as Record<StageRole, RoleRow>);
  const [reason, setReason] = useState("");
  const [tests, setTests] = useState<Partial<Record<StageRole, string>>>({});
  const [testing, setTesting] = useState<StageRole | null>(null);
  const set = (role: StageRole, patch: Partial<RoleRow>) => setRows((x) => ({ ...x, [role]: { ...x[role], ...patch } }));

  function refFields(role: StageRole, ref: Ref, onChange: (r: Ref) => void, idp: string) {
    return (
      <div className="grid min-w-0 gap-2 sm:grid-cols-3">
        <div className="min-w-0">
          <Label htmlFor={`${idp}-p`}>{t("aicc.gsv2.provider")}</Label>
          <Select id={`${idp}-p`} value={ref.provider} onChange={(e) => onChange({ ...ref, provider: e.target.value, effort: "" })}>
            {STAGE_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>
        <div className="min-w-0">
          <Label htmlFor={`${idp}-m`}>{t("aicc.gsv2.model")}</Label>
          <Input id={`${idp}-m`} list={ref.provider === "anthropic" ? "gsv2-claude-models" : undefined} value={ref.model} maxLength={61}
            onChange={(e) => onChange({ ...ref, model: e.target.value })} />
        </div>
        <div className="min-w-0">
          <Label htmlFor={`${idp}-e`}>{t("aicc.gsv2.effort")}</Label>
          <Select id={`${idp}-e`} value={ref.effort} disabled={ref.provider !== "anthropic"} onChange={(e) => onChange({ ...ref, effort: e.target.value })}>
            <option value="">{t("aicc.gsv2.effortDefault")}</option>
            {ANTHROPIC_EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-gsv2-models>
      <datalist id="gsv2-claude-models">{CLAUDE_STAGE_MODELS.map((m) => <option key={m} value={m} />)}</datalist>
      {STAGE_ROLES.map((role) => {
        const row = rows[role];
        return (
          <div key={role} className="space-y-2 rounded-xl bg-raised px-3.5 py-3" data-gsv2-role={role}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-semibold">{t(`aicc.gsv2.role.${role}`)}</p>
              {states[role] && <Badge tone={states[role] === "ok" ? "success" : "warning"} dot>{t(`aicc.gsv2.roleState.${states[role]}`)}</Badge>}
              <Button variant="secondary" size="sm" className="ml-auto" disabled={testing !== null}
                onClick={() => { setTesting(role); void testStageModelAction(role, toRef(row)).then((res) => {
                  setTesting(null);
                  const r = res.test;
                  setTests((x) => ({ ...x, [role]: !res.ok || !r ? errText(t, res.error)
                    : r.ok ? t("aicc.gsv2.modelTestOk", { ms: r.latencyMs, input: r.input ?? "—", output: r.output ?? "—", cost: usdOf(r.usdMicros) })
                      : t("aicc.gsv2.modelTestFail", { code: r.error }) }));
                }); }} data-gsv2-model-test={role}>
                {testing === role ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <FlaskConical size={14} aria-hidden />}
                {t("aicc.gsv2.modelTest")}
              </Button>
            </div>
            {refFields(role, row, (r) => set(role, { ...r }), `gsv2-${role}`)}
            <details open={row.fallback !== null}>
              <summary className="cursor-pointer text-xs text-muted">{t("aicc.gsv2.fallback")}</summary>
              <div className="mt-2 space-y-2">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={row.fallback !== null}
                    onChange={(e) => set(role, { fallback: e.target.checked ? { ...blankRef, model: CLAUDE_STAGE_MODELS[1] } : null })} />
                  {row.fallback ? t("aicc.gsv2.fallback") : t("aicc.gsv2.fallbackNone")}
                </label>
                {row.fallback && refFields(role, row.fallback, (r) => set(role, { fallback: r }), `gsv2-${role}-fb`)}
              </div>
            </details>
            {tests[role] && <p className="break-words text-xs text-muted" data-gsv2-model-result={role}>{tests[role]}</p>}
          </div>
        );
      })}
      <p className="text-xs text-faint">{t("aicc.gsv2.modelTestNote")}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor="gsv2-models-reason">{t("aicc.gsv2.modelsReason")}</Label>
          <Input id="gsv2-models-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </div>
        <Button disabled={pending || !reason.trim()} data-gsv2-models-save
          onClick={() => start(async () => {
            const payload = Object.fromEntries(STAGE_ROLES.map((r) => [r, { ...toRef(rows[r]), ...(rows[r].fallback ? { fallback: toRef(rows[r].fallback!) } : {}) }]));
            const res = await saveRoleModelsAction(payload, reason);
            if (res.ok) { toast.success(t("aicc.gsv2.modelsSaved", { v: res.version ?? "?" })); setReason(""); router.refresh(); }
            else toast.error(`${errText(t, res.error)}${res.problems?.length ? ` (${res.problems.join(", ")})` : ""}`);
          })}>
          {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {t("aicc.gsv2.modelsSave")}
        </Button>
      </div>
    </div>
  );
}

export function GsV2SeedDrafts({ hasDrafts }: { hasDrafts: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-raised px-3.5 py-3 sm:flex-row sm:items-end" data-gsv2-seed>
      <div className="min-w-0 flex-1">
        <Label htmlFor="gsv2-seed-reason">{t("aicc.gsv2.seedTitle")}</Label>
        <p className="mb-1.5 text-xs text-muted">{hasDrafts ? t("aicc.gsv2.seedAgain") : t("aicc.gsv2.seedSub")}</p>
        <Input id="gsv2-seed-reason" value={reason} maxLength={300} placeholder={t("aicc.gsv2.seedReason")}
          onChange={(e) => setReason(e.target.value)} />
      </div>
      <Button variant="secondary" size="sm" disabled={pending || !reason.trim()}
        onClick={() => start(async () => {
          const res = await seedSpecDraftsAction(reason);
          if (res.ok) { toast.success(t("aicc.gsv2.seeded", { n: res.saved ?? 0 })); setReason(""); router.refresh(); }
          else toast.error(errText(t, res.error));
        })}>
        {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <FileDown size={14} aria-hidden />}
        {t("aicc.gsv2.seed")}
      </Button>
    </div>
  );
}

type Pickable = Record<string, { id: string; version: number; status: string }[]>;

export function GsV2TestPanel({ versions, ratios, resolutions, workspaceId, budgets }: {
  versions: Pickable; ratios: string[]; resolutions: string[]; workspaceId: string | null;
  /** The per-order API budget of a 1-, 2- and 3-shot test (USD micros). */
  budgets: number[] | null;
}) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState<Record<string, string>>(() => Object.fromEntries(GROVSHOT_V2_KEYS.map((k) => {
    const list = versions[k] ?? [];
    // The newest draft first (what the admin is testing), else the published one.
    return [k, (list.find((v) => v.status === "draft") ?? list[0])?.id ?? ""];
  })));
  const [photos, setPhotos] = useState<{ path: string; url: string }[]>([]);
  const [description, setDescription] = useState("");
  const [shots, setShots] = useState(1);
  const [mode, setMode] = useState<"prompts" | "full">("prompts");
  const [confirmed, setConfirmed] = useState(false);
  const [ratio, setRatio] = useState(ratios.includes("4:5") ? "4:5" : ratios[0] ?? "");
  const [resolution, setResolution] = useState(resolutions.includes("2K") ? "2K" : resolutions[0] ?? "");
  const [uploading, setUploading] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<V2RunView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const folder = useRef(`gsv2-test-input/${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const tick = async () => {
      const res = await testApi({ run: runId });
      if (stop) return;
      if (res.ok && res.run) {
        setRun(res.run);
        if (res.run.status === "queued" || res.run.status === "running") timer.current = setTimeout(tick, 3000);
      } else timer.current = setTimeout(tick, 6000);
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
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024) {
          toast.error(t("aicc.wf2.test.badType")); continue;
        }
        const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        const path = `${workspaceId}/${folder.current}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file);
        if (error) { toast.error(t("common.error")); continue; }
        setPhotos((p) => [...p, { path, url: URL.createObjectURL(file) }]);
      }
    } finally { setUploading(false); }
  }

  function startTest() {
    start(async () => {
      const res = await testApi({ body: {
        versions: chosen, photos: photos.map((p) => p.path), shots, aspectRatio: ratio, resolution, description,
        mode, confirmed: mode === "full" && confirmed,
      } });
      if (res.ok && res.runId) { setRun(null); setRunId(res.runId); return; }
      toast.error(`${errText(t, res.error)}${res.blockers?.length ? ` (${res.blockers.join(", ")})` : ""}`);
    });
  }

  const active = run ? run.status === "queued" || run.status === "running" : Boolean(runId);
  const missing = GROVSHOT_V2_KEYS.some((k) => !chosen[k]);
  const budget = budgets?.[shots - 1] ?? null;
  return (
    <div className="space-y-4" data-gsv2-test-panel>
      <p className="text-xs leading-relaxed text-muted">{t("aicc.gsv2.testNote")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {GROVSHOT_V2_KEYS.map((k) => (
          <div key={k} className="min-w-0">
            <Label htmlFor={`gsv2-v-${k}`}>{t(`aicc.gsv2.stage.${k.replace("grovshot_v2_", "")}`)}</Label>
            <Select id={`gsv2-v-${k}`} value={chosen[k] ?? ""} onChange={(e) => setChosen({ ...chosen, [k]: e.target.value })}>
              {(versions[k] ?? []).length === 0 && <option value="">{t("aicc.gsv2.noVersion")}</option>}
              {(versions[k] ?? []).map((v) => (
                <option key={v.id} value={v.id}>v{v.version} · {t(`aicc.prompt.status.${v.status}`)}</option>
              ))}
            </Select>
          </div>
        ))}
      </div>
      <div className="space-y-1.5" data-gsv2-test-mode={mode}>
        <Label htmlFor="gsv2-mode">{t("aicc.gsv2.testMode")}</Label>
        <Select id="gsv2-mode" value={mode} onChange={(e) => { setMode(e.target.value === "full" ? "full" : "prompts"); setConfirmed(false); }}>
          <option value="prompts">{t("aicc.gsv2.mode.prompts")}</option>
          <option value="full">{t("aicc.gsv2.mode.full")}</option>
        </Select>
        <p className="text-xs text-muted">{mode === "full" ? t("aicc.gsv2.testModeFullHelp") : t("aicc.gsv2.testModePromptsHelp")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="gsv2-shots">{t("aicc.gsv2.testShots")}</Label>
          <Select id="gsv2-shots" value={String(shots)} onChange={(e) => { setShots(Math.max(1, Math.min(3, Number(e.target.value) || 1))); setConfirmed(false); }}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="gsv2-ratio">{t("aicc.gsv2.testRatio")}</Label>
          <Select id="gsv2-ratio" value={ratio} onChange={(e) => setRatio(e.target.value)}>
            {ratios.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="gsv2-res">{t("aicc.gsv2.testResolution")}</Label>
          <Select id="gsv2-res" value={resolution} onChange={(e) => setResolution(e.target.value)}>
            {resolutions.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="gsv2-desc">{t("aicc.gsv2.testDescription")}</Label>
        <Textarea id="gsv2-desc" rows={4} value={description} maxLength={20_000} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold text-muted">{t("aicc.wf2.test.photos")}</p>
        <div className="flex flex-wrap items-center gap-2">
          {photos.map((p, i) => (
            <span key={p.path} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="size-16 rounded-lg object-cover ring-1 ring-line" />
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">{i + 1}</span>
            </span>
          ))}
          <label className="inline-flex h-16 min-w-16 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-xs text-muted">
            {uploading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />}
            {t("aicc.wf2.test.add")}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={uploading || !workspaceId}
              onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      </div>
      <div className="space-y-1.5 rounded-xl bg-raised px-3.5 py-3 text-xs" data-gsv2-budget>
        <p className="font-semibold">{t("aicc.gsv2.testBudget", { usd: usdOf(budget) })}</p>
        {mode === "full" && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-gsv2-confirm />
            <span>{t("aicc.gsv2.testConfirm", { usd: usdOf(budget) })}</span>
          </label>
        )}
      </div>
      <div className="flex justify-end">
        <Button disabled={pending || active || missing || photos.length === 0 || uploading || !ratio || !resolution || (mode === "full" && !confirmed)} onClick={startTest} data-gsv2-run-test>
          <FlaskConical size={14} aria-hidden /> {active ? t("aicc.wf2.test.running") : t("aicc.gsv2.testRun")}
        </Button>
      </div>
      {run && <GsV2RunCard run={run} locale={locale} open />}
    </div>
  );
}

export function GsV2RunCard({ run, locale, open }: { run: V2RunView; locale: string; open?: boolean }) {
  const { t } = useI18n();
  const usd = (m: number | null) => (m === null ? "—" : `$${(m / 1_000_000).toFixed(3)}`);
  const delivered = run.shots.filter((s) => s.state === "delivered").length;
  const tone = run.status === "ok" ? "success" : run.status === "partial" || run.status === "blocked" ? "warning"
    : run.status === "queued" || run.status === "running" ? "accent" : "danger";
  return (
    <details open={open} className="rounded-xl bg-raised px-3.5 py-2.5" data-gsv2-run={run.status}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 text-[12.5px]">
        <Badge tone={tone} dot>{t(`aicc.runs.status.${run.status}`)}</Badge>
        {run.kind === "grovshot_test" && <Badge tone="info">{t("aicc.runs.test")}</Badge>}
        <Badge tone="neutral">{t("aicc.runs.delivered", { n: delivered, of: run.planned ?? run.ordered })}</Badge>
        {run.recipe && <Badge tone={run.recipe === "base" ? "warning" : "neutral"}>{run.recipe === "base" ? t("aicc.gsv2.recipeBase") : run.recipe}</Badge>}
        {run.error && <code className="text-xs text-danger">{run.error}</code>}
        <span className="text-xs text-muted">{run.credits} kr. · {usd(run.costUsdMicros)}{run.costUnknown ? ` + ${t("aicc.exec.costUnknown")} ×${run.costUnknown}` : ""}</span>
        <span className="ml-auto text-xs text-faint">{formatDate(run.createdAt, locale)}{run.durationMs ? ` · ${(run.durationMs / 1000).toFixed(0)} s` : ""}</span>
      </summary>
      <div className="mt-2 space-y-2 text-xs">
        <p className="break-words text-muted">
          {run.engineVersion ?? "—"} · {GROVSHOT_V2_KEYS.map((k) => `${k.replace("grovshot_v2_", "")} v${run.versions[k] ?? "?"}`).join(" · ")}
        </p>
        {run.mode && <Badge tone="info">{t(`aicc.gsv2.mode.${run.mode}`)}</Badge>}
        {run.notes.length > 0 && <p className="flex flex-wrap gap-1">{run.notes.map((n, i) => <Badge key={`${n}-${i}`} tone="neutral">{n}</Badge>)}</p>}
        {run.costByStage.some((c) => c.calls > 0 || c.usdMicros > 0 || c.unknown > 0) && (
          <div data-gsv2-costs>
            <p className="font-semibold">{t("aicc.gsv2.costs")}</p>
            <ul className="mt-1 grid gap-x-4 gap-y-0.5 text-muted sm:grid-cols-2">
              {run.costByStage.filter((c) => c.calls > 0 || c.usdMicros > 0 || c.unknown > 0).map((c) => (
                <li key={c.stage} className="break-words" data-gsv2-cost={c.stage}>
                  <span className="text-ink">{t(`aicc.gsv2.stage.${c.stage}`)}</span>{": "}
                  {t("aicc.gsv2.costRow", { cost: usdOf(c.usdMicros), calls: c.calls, input: c.input, output: c.output })}
                  {c.cached ? t("aicc.gsv2.costCached", { n: c.cached }) : ""}{c.unknown ? t("aicc.gsv2.usageUnknown", { n: c.unknown }) : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {run.preview && (run.preview.card || run.preview.plan) && (
          <details data-gsv2-preview>
            <summary className="cursor-pointer font-semibold">{t("aicc.gsv2.preview")}</summary>
            {run.preview.card && <Pre title={t("aicc.gsv2.previewCard")} text={run.preview.card} />}
            {run.preview.plan && <Pre title={t("aicc.gsv2.previewPlan")} text={run.preview.plan} />}
          </details>
        )}
        <p className="flex flex-wrap gap-1">
          {run.stages.map((s) => (
            <Badge key={s.name} tone={s.status === "succeeded" ? "success" : s.status === "failed" ? "danger" : "accent"}>
              {t(`aicc.gsv2.stage.${s.name}`)}{s.cached ? ` · ${t("aicc.gsv2.cached")}` : ""}{s.ms ? ` · ${(s.ms / 1000).toFixed(1)} s` : ""}
              {s.executor ? ` · ${s.executor}` : ""}{s.error ? ` · ${s.error}` : ""}
            </Badge>
          ))}
        </p>
        {run.shots.length > 0 && (
          <ol className="space-y-1">
            {run.shots.map((s) => (
              <li key={s.n} className="rounded-lg bg-sunken px-2.5 py-1.5" data-gsv2-shot={s.state}>
                <span className="font-semibold">#{s.n}</span>{" "}
                <span className={s.state === "delivered" ? "text-success" : s.state === "not_delivered" ? "text-danger" : "text-muted"}>
                  {t(`aicc.gsv2.shot.${s.state}`)}{s.reason ? ` (${s.reason})` : ""}
                </span>
                {s.charges > 0 && <span className="text-muted"> · {t("aicc.gsv2.charges", { n: s.charges, released: s.released })}</span>}
                {s.writes.map((w) => (
                  <span key={`w${w.round}`} className="block break-words pl-4 text-muted" data-gsv2-write={w.status}>
                    {t("aicc.gsv2.write", { n: w.round + 1 })}: {w.status}{w.amended ? ` · ${t("aicc.gsv2.amended")}` : ""}
                    {w.promptSha ? ` · ${w.promptSha.slice(0, 10)}` : ""} · {usd(w.costUsdMicros)}
                    {w.executor ? ` · ${w.executor}` : ""}{w.error ? ` · ${w.error}` : ""}
                  </span>
                ))}
                {s.rounds.map((r) => (
                  <span key={r.round} className="block break-words pl-4 text-muted">
                    {t("aicc.gsv2.round", { n: r.round + 1 })}: {r.decision ?? r.status} · {r.verdicts.join(", ") || "—"}
                    {r.rejecting.length ? ` · ✗ ${r.rejecting.join(", ")}` : ""}{r.retry ? ` · ${t("aicc.gsv2.retry")} ${r.retry}` : ""}
                    {r.reissued ? ` · ${t("aicc.gsv2.reissued", { n: r.reissued })}` : ""} · {usd(r.costUsdMicros)}
                    {r.executor ? ` · ${r.executor}` : ""}{r.error ? ` · ${r.error}` : ""}
                    {r.refs.length > 0 && (
                      <span className="block" data-gsv2-refs>
                        {t("aicc.gsv2.refs", { list: r.refs.map((x) => `${x.n}←#${x.photo}${x.role ? ` ${x.role}` : ""}`).join(", ") })}
                      </span>
                    )}
                  </span>
                ))}
                {s.writes.some((w) => w.blocks || w.prompt) && (
                  <details className="pl-4" data-gsv2-shot-preview>
                    <summary className="cursor-pointer text-muted">{t("aicc.gsv2.preview")}</summary>
                    {s.writes.map((w) => (
                      <div key={`p${w.round}`}>
                        {w.blocks && <Pre title={`${t("aicc.gsv2.previewBlocks")} · ${t("aicc.gsv2.write", { n: w.round + 1 })}`} text={Object.entries(w.blocks).map(([k, v]) => `[${k}]\n${v}`).join("\n\n")} />}
                        {w.prompt && <Pre title={`${t("aicc.gsv2.previewPrompt")} · ${t("aicc.gsv2.write", { n: w.round + 1 })}`} text={w.prompt} />}
                      </div>
                    ))}
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
        {run.results.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" data-gsv2-results>
            {run.results.map((u) => (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="aspect-square w-full rounded-lg object-cover ring-1 ring-line" /></a>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function Pre({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-2 min-w-0">
      <p className="mb-1 text-[11px] font-semibold text-muted">{title}</p>
      <pre className="thin-scroll max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sunken p-2.5 font-mono text-[11px] leading-relaxed">{text}</pre>
    </div>
  );
}
