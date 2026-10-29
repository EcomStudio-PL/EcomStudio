"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileDown, FlaskConical, Loader2, Upload } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import { seedSpecDraftsAction } from "@/app/actions/grovshot-v2-admin";
import type { V2RunView } from "@/lib/server/grovshot-v2/admin";
import { GROVSHOT_V2_KEYS } from "@/lib/grovshot-v2/stages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

/**
 * SILNIK V2 — the admin tab's interactive pieces: the spec drafts loader,
 * the engine test (a real order on the admin's own photos, on chosen
 * versions, never charged) and one run's diagnostics. No prompt body ever
 * reaches this file — only versions, codes, verdicts, timings and costs.
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

export function GsV2TestPanel({ versions, ratios, resolutions, workspaceId }: {
  versions: Pickable; ratios: string[]; resolutions: string[]; workspaceId: string | null;
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
  const [shots, setShots] = useState(3);
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
      } });
      if (res.ok && res.runId) { setRun(null); setRunId(res.runId); return; }
      toast.error(`${errText(t, res.error)}${res.blockers?.length ? ` (${res.blockers.join(", ")})` : ""}`);
    });
  }

  const active = run ? run.status === "queued" || run.status === "running" : Boolean(runId);
  const missing = GROVSHOT_V2_KEYS.some((k) => !chosen[k]);
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
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="gsv2-shots">{t("aicc.gsv2.testShots")}</Label>
          <Input id="gsv2-shots" type="number" min={1} max={10} value={shots}
            onChange={(e) => setShots(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
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
      <div className="flex justify-end">
        <Button disabled={pending || active || missing || photos.length === 0 || uploading || !ratio || !resolution} onClick={startTest} data-gsv2-run-test>
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
        {run.notes.length > 0 && <p className="flex flex-wrap gap-1">{run.notes.map((n, i) => <Badge key={`${n}-${i}`} tone="neutral">{n}</Badge>)}</p>}
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
                {s.rounds.map((r) => (
                  <span key={r.round} className="block break-words pl-4 text-muted">
                    {t("aicc.gsv2.round", { n: r.round + 1 })}: {r.decision ?? r.status} · {r.verdicts.join(", ") || "—"}
                    {r.rejecting.length ? ` · ✗ ${r.rejecting.join(", ")}` : ""}{r.retry ? ` · ${t("aicc.gsv2.retry")} ${r.retry}` : ""}
                    {r.reissued ? ` · ${t("aicc.gsv2.reissued", { n: r.reissued })}` : ""} · {usd(r.costUsdMicros)}
                    {r.executor ? ` · ${r.executor}` : ""}{r.error ? ` · ${r.error}` : ""}
                  </span>
                ))}
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
