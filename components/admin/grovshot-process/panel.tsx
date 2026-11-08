"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Download, FlaskConical, Loader2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { geminiParts } from "@/lib/grovshot-shot/diagnostics";
import type { ProcessData, ProcessNode, StepDetail, StepRef } from "@/lib/grovshot-shot/process-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Block, Kv, arr, kb, obj, pre, secs, short, str, usd } from "@/components/admin/grovshot-process/bits";
import { cn } from "@/lib/utils";

type T = (k: string, v?: Record<string, string | number>) => string;
const API = "/api/admin/grovshot-shot/process";

function useStep(runId: string, ref: StepRef | null): { step: StepDetail | null; loading: boolean } {
  const [step, setStep] = useState<StepDetail | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!ref) { setStep(null); return; }
    let live = true;
    setLoading(true);
    void fetch(`${API}?run=${runId}&pos=${ref.pos}&item=${ref.item}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ ok: boolean; step?: StepDetail }>)
      .then((j) => { if (live) setStep(j.ok && j.step ? j.step : null); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [runId, ref?.pos, ref?.item]);
  return { step, loading };
}

const tone = (s: string) => (s === "ok" ? "success" : s === "warning" ? "warning" : s === "failed" ? "danger" : s === "running" ? "info" : "neutral");

/** A thumbnail of an image AS SENT (hash-proven); falls back to the original with a red note. */
function SentThumb({ src, fallback, t }: { src: string; fallback: string | null; t: T }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-0.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={failed ? fallback ?? "" : src} alt="" className={cn("h-20 w-20 rounded-md border object-contain", failed ? "border-danger" : "border-line")} onError={() => setFailed(true)} />
      {failed && <p className="text-[10px] text-danger">{t("gsp.sent.notProven")}</p>}
    </div>
  );
}

function systemText(body: unknown): string {
  const s = obj(body).system;
  if (typeof s === "string") return s;
  return arr(s).map((b) => str(obj(b).text)).join("\n");
}
function userTexts(body: unknown): string {
  return arr(obj(body).messages).flatMap((m) => arr(obj(m).content)).filter((c) => obj(c).type === "text").map((c) => str(obj(c).text)).join("\n\n");
}

function NoBoundary({ t }: { t: T }) {
  return <p className="flex items-start gap-1.5 rounded-lg border border-warning/50 bg-[rgb(var(--warning)/0.08)] p-2 text-[11.5px]"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden />{t("gsp.noBoundary")}</p>;
}

/* ── one Claude request (card, plan, PRODUKT+SKALA, scenes) ───────────────*/
function TextAttempt({ data, step, t }: { data: ProcessData; step: StepDetail; t: T }) {
  const out = obj(step.output);
  const reqs = arr(obj(out.boundary).requests).map(obj);
  const photos = arr(out.image_photos).map(Number);
  const copy = (text: string) => ({ text, label: t("gsp.copy"), done: t("gsp.copied") });
  const kbFrom = typeof out.system_kb_from === "number" ? out.system_kb_from : null;
  return (
    <div className="space-y-2.5">
      <Kv rows={[
        [t("gsp.f.status"), <Badge key="s" tone={step.status === "succeeded" ? "success" : "danger"}>{step.status}{step.error ? ` · ${step.error}` : ""}</Badge>],
        [t("gsp.f.model"), `${step.provider ?? "—"} · ${step.model ?? "—"}`],
        [t("gsp.f.versions"), `${str(out.engine_version) || "—"} · KB v${String(out.kb_version ?? "?")}`],
        [t("gsp.f.tokens"), `${step.inputTokens ?? "—"} → ${step.outputTokens ?? "—"}`],
        [t("gsp.f.time"), secs(step.ms)], [t("gsp.f.cost"), step.costBasis === "unknown" ? "UNKNOWN" : usd(step.costMicros)],
        [t("gsp.f.feedback"), out.feedback ? t("gsp.yes") : t("gsp.no")],
      ]} />
      {reqs.length === 0 && <NoBoundary t={t} />}
      {reqs.map((r, i) => {
        const sys = systemText(r.body);
        const user = userTexts(r.body);
        const res = obj(r.response);
        return (
          <div key={i} className="space-y-2 rounded-xl border border-dashed border-line p-2">
            <p className="text-[11px] text-muted">{t("gsp.req.title", { n: i + 1 })} · {str(r.provider)} · {str(obj(r.body).model)} · HTTP {String(res.status ?? res.error ?? "—")} · {secs(Number(r.ms))} · {r.observable ? t("gsp.req.observed") : t("gsp.req.notObservable")}</p>
            <Block title={t("gsp.req.system")} copy={copy(sys)}>
              <div className={pre}>
                {kbFrom !== null && kbFrom <= sys.length
                  ? <><span>{sys.slice(0, kbFrom)}</span><span className="block border-l-2 border-accent2 bg-accent2-soft/40 pl-1.5"><span className="mb-1 block font-sans text-[10px] font-semibold uppercase text-accent2">{t("gsp.req.kbPart", { v: String(out.kb_version ?? "?") })}</span>{sys.slice(kbFrom)}</span></>
                  : sys}
              </div>
            </Block>
            <Block title={t("gsp.req.user")} copy={copy(user)}><div className={pre}>{user}</div></Block>
            <Block title={t("gsp.req.images", { n: arr(r.images).length })}>
              <div className="flex flex-wrap gap-2">
                {arr(r.images).map(obj).map((img) => {
                  const n = Number(img.n);
                  const z = photos[n - 1];
                  return (
                    <div key={n} className="w-[150px] space-y-0.5 text-[10.5px]">
                      <SentThumb src={`${API}/sent?run=${data.run.id}&pos=${step.pos}&item=${step.item}&req=${i}&n=${n}`} fallback={data.photos[(z ?? 0) - 1]?.url ?? null} t={t} />
                      <p className="font-semibold">#{n} · Z{z ?? "?"}</p>
                      <p className="text-muted">{String(img.width ?? "?")}×{String(img.height ?? "?")} · {str(img.mime)} · {kb(img.bytes)}</p>
                      <p className="font-mono text-muted">{short(img.sha256)}</p>
                    </div>
                  );
                })}
              </div>
            </Block>
            <Block title={t("gsp.req.response")} copy={copy(str(res.text))}><div className={pre}>{str(res.text) || JSON.stringify(res.body ?? res, null, 2)}</div></Block>
          </div>
        );
      })}
      <Block title={t("gsp.f.parsed")} copy={copy(JSON.stringify(out.raw ?? null, null, 2))}><pre className={pre}>{JSON.stringify(out.raw ?? null, null, 2)}</pre></Block>
      {arr(out.errors).length > 0 && (
        <Block title={t("gsp.f.validation", { n: arr(out.errors).length })} tone="warning">
          <ul className="list-disc space-y-0.5 pl-4 text-[11.5px]">{arr(out.errors).map((e, i) => <li key={i}>{String(e)}</li>)}</ul>
        </Block>
      )}
    </div>
  );
}

function TextSection({ data, node, t }: { data: ProcessData; node: ProcessNode; t: T }) {
  const [sel, setSel] = useState(node.steps.length - 1);
  useEffect(() => { setSel(node.steps.length - 1); }, [node.id, node.steps.length]);
  const ref = node.steps[sel] ?? null;
  const { step, loading } = useStep(data.run.id, ref);
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {node.steps.map((s, i) => (
          <button key={`${s.pos}-${s.item}`} type="button" onClick={() => setSel(i)}
            className={cn("rounded-md border px-2 py-0.5 text-[11px]", i === sel ? "border-accent bg-accent/10" : "border-line", s.status !== "succeeded" && "text-danger")}>
            {t("gsp.attempt", { n: i + 1 })}{s.error ? ` · ${s.error}` : ""}
          </button>
        ))}
      </div>
      {node.kind === "plan" && <PlanTable data={data} t={t} />}
      {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {step && <TextAttempt data={data} step={step} t={t} />}
    </div>
  );
}

function PlanTable({ data, t }: { data: ProcessData; t: T }) {
  return (
    <Block title={t("gsp.plan.title")}>
      <div className="space-y-1.5">
        {data.plan.map((s) => (
          <div key={s.numer} className={cn("rounded-lg border p-1.5 text-[11.5px]", s.violations.length ? "border-warning/60" : "border-line")}>
            <p className="font-semibold">#{s.numer} · {t(`gsp.type.${s.typ || "uzycie"}`)} · {s.kadr} · {s.ludzie} · {s.swiatlo}</p>
            <p>{s.opis}</p>
            <p className="text-muted">{t("gsp.plan.refs")}: {s.referencje.map((r) => `Z${r}`).join(", ") || "—"}{s.caly_produkt ? ` · ${t("gsp.plan.whole")}` : ""}</p>
            {s.violations.length > 0 && <p className="text-warning">{t("gsp.plan.violations")}: {s.violations.map((v) => t(`gsp.violation.${v}`)).join(", ")}</p>}
          </div>
        ))}
      </div>
    </Block>
  );
}

/* ── one Nano Banana Pro call ──────────────────────────────────────────────*/
function RoundSection({ data, node, t }: { data: ProcessData; node: ProcessNode; t: T }) {
  const ref = node.steps[0] ?? null;
  const { step, loading } = useStep(data.run.id, ref);
  if (loading || !step) return <Loader2 size={14} className="animate-spin" aria-hidden />;
  const out = obj(step.output);
  const reqs = arr(obj(out.boundary).requests).map(obj);
  const gi = reqs.map((r) => r.provider).lastIndexOf("google");
  const r = gi >= 0 ? reqs[gi] : null;
  const parts = r ? geminiParts(r.body) : null;
  const prompt = parts?.texts.join("\n") ?? "";
  const check = obj(out.reference_check);
  const issues = arr(check.issues).map(String);
  const planned = arr(out.references_planned).map(Number);
  const prepared = arr(out.references_prepared).map(obj);
  const sentMap = arr(check.sent).map(obj);
  const res = obj(r?.response);
  const resBody = obj(res.body);
  const cand = obj(arr(resBody.candidates)[0]);
  const copy = (text: string) => ({ text, label: t("gsp.copy"), done: t("gsp.copied") });
  const modelPath = r ? (/\/models\/([^:/?]+)/.exec(str(r.url))?.[1] ?? "—") : "—";
  return (
    <div className="space-y-2.5">
      <Kv rows={[
        [t("gsp.f.status"), <Badge key="s" tone={out.ok ? "success" : "danger"}>{out.ok ? t("gsp.ok") : str(out.error) || step.error || "—"}</Badge>],
        [t("gsp.f.model"), `${step.provider ?? "google"} · ${r ? modelPath : step.model ?? "—"}`],
        [t("gsp.f.format"), `${str(out.aspect_ratio)} · ${str(out.resolution)} → ${String(out.width ?? "?")}×${String(out.height ?? "?")} ${str(out.mime)}`],
        [t("gsp.f.time"), secs(step.ms)], [t("gsp.f.cost"), step.costBasis === "unknown" ? "UNKNOWN" : usd(step.costMicros)],
        [t("gsp.f.attempt"), String(out.attempt ?? "—")],
      ]} />
      <a href={`${API}/pack?run=${data.run.id}&item=${step.item}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium hover:bg-raised">
        <Download size={13} aria-hidden /> {t("gsp.pack")}
      </a>
      {!r && <NoBoundary t={t} />}
      {issues.length > 0 && (
        <Block title={t("gsp.refs.mismatchTitle")} tone="danger">
          <ul className="list-disc pl-4 text-[11.5px] text-danger">{issues.map((i) => <li key={i}>{t(`gsp.issue.${i}`)}</li>)}</ul>
        </Block>
      )}
      <Block title={t("gsp.refs.title")}>
        <table className="w-full text-[11.5px]">
          <thead><tr className="text-muted"><th className="text-left">#</th><th className="text-left">{t("gsp.refs.planned")}</th><th className="text-left">{t("gsp.refs.prepared")}</th><th className="text-left">{t("gsp.refs.sent")}</th></tr></thead>
          <tbody>
            {Array.from({ length: Math.max(planned.length, prepared.length, sentMap.length) }, (_, i) => {
              const p = planned[i];
              const pr = prepared[i];
              const s = sentMap[i];
              const bad = (p !== undefined && pr && Number(pr.photo) !== p) || (r && pr && (!s || Number(s.photo) !== Number(pr.photo)));
              return (
                <tr key={i} className={cn("border-t border-line", bad && "bg-[rgb(var(--danger)/0.08)] text-danger")}>
                  <td>{i + 1}</td><td>{p !== undefined ? `Z${p}` : "—"}</td><td>{pr ? `Z${String(pr.photo)} (${str(pr.transform)})` : "—"}</td>
                  <td>{r ? s ? `Z${String(s.photo ?? "?")}` : "—" : t("gsp.refs.unknown")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Block>
      {r && (
        <>
          <Block title={t("gsp.req.prompt")} copy={copy(prompt)}><div className={pre}>{prompt}</div></Block>
          <Block title={t("gsp.req.images", { n: arr(r.images).length })}>
            <div className="flex flex-wrap gap-2">
              {arr(r.images).map(obj).map((img) => {
                const n = Number(img.n);
                const z = Number(sentMap.find((x) => Number(x.n) === n)?.photo) || null;
                return (
                  <div key={n} className="w-[150px] space-y-0.5 text-[10.5px]">
                    <SentThumb src={`${API}/sent?run=${data.run.id}&pos=${step.pos}&item=${step.item}&req=${gi}&n=${n}`} fallback={z ? data.photos[z - 1]?.url ?? null : null} t={t} />
                    <p className="font-semibold">{t("gsp.req.position", { n })} · Z{z ?? "?"}</p>
                    <p className="text-muted">{String(img.width ?? "?")}×{String(img.height ?? "?")} · {str(img.mime)} · {kb(img.bytes)}</p>
                    <p className="text-muted">{t("gsp.req.inline")}</p>
                    <p className="font-mono text-muted">{short(img.sha256)}</p>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted">{t("gsp.req.partOrder")}: {parts?.partOrder.join(" → ")}</p>
          </Block>
          <Block title={t("gsp.req.params")} copy={copy(JSON.stringify(obj(r.body).generationConfig ?? null, null, 2))}>
            <pre className={pre}>{JSON.stringify({ endpoint: r.url, generationConfig: obj(r.body).generationConfig ?? null }, null, 2)}</pre>
          </Block>
          <Block title={t("gsp.req.response")} copy={copy(JSON.stringify(resBody, null, 2))}>
            <Kv rows={[
              ["HTTP", String(res.status ?? res.error ?? "—")], ["finishReason", str(cand.finishReason) || "—"],
              ["usage", JSON.stringify(resBody.usageMetadata ?? null)], [t("gsp.req.outImages"), String(arr(res.images).length)],
            ]} />
            <details className="mt-1"><summary className="cursor-pointer text-[11px]">JSON</summary><pre className={pre}>{JSON.stringify(resBody, null, 2)}</pre></details>
          </Block>
        </>
      )}
      {!r && (
        <Block title={t("gsp.refs.engineRecord")}>
          <pre className={pre}>{JSON.stringify(out.references_sent ?? null, null, 2)}</pre>
        </Block>
      )}
      {node.thumb && (
        <Block title={t("gsp.result")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={node.thumb} alt="" className="max-h-72 w-full rounded-lg object-contain" />
          <p className="font-mono text-[10.5px] text-muted">{short(out.sha256)} · {kb(out.bytes)}</p>
        </Block>
      )}
    </div>
  );
}

/* ── a shot ────────────────────────────────────────────────────────────────*/
function ShotSection({ data, node, t, onExperiment }: { data: ProcessData; node: ProcessNode; t: T; onExperiment: (shot: number, prompt: string, refs: number[], pattern: string) => void }) {
  const isDerived = Boolean(data.run.experimentOf || data.run.regenOf);
  const { step } = useStep(data.run.id, { pos: 10, item: 30, status: "", error: null });
  const shots = arr(obj(step?.output).shots).map(obj);
  const mine = shots.find((s) => Number(s.numer) === node.shot) ?? (shots.length === 1 ? shots[0] : null);
  const plan = data.plan.find((s) => s.numer === node.shot);
  const prompt = str(mine?.text);
  const refs = arr(mine?.references).map(Number);
  const corrections = arr(mine?.corrections).map(obj);
  const copy = (text: string) => ({ text, label: t("gsp.copy"), done: t("gsp.copied") });
  return (
    <div className="space-y-2.5">
      {plan && (
        <Block title={t("gsp.shot.plan")} tone={plan.violations.length ? "warning" : undefined}>
          <Kv rows={[
            [t("gsp.shot.type"), t(`gsp.type.${plan.typ || "uzycie"}`)], [t("gsp.shot.scene"), plan.opis],
            [t("gsp.plan.refs"), plan.referencje.map((r) => `Z${r}`).join(", ")], [t("gsp.shot.frame"), `${plan.kadr} · ${plan.ludzie} · ${plan.swiatlo}`],
            [t("gsp.shot.place"), plan.miejsce], [t("gsp.plan.violations"), plan.violations.length ? plan.violations.map((v) => t(`gsp.violation.${v}`)).join(", ") : "—"],
          ]} />
        </Block>
      )}
      {(corrections.length > 0 || Boolean(mine?.blocked) || Boolean(mine?.binding_source)) && (
        <Block title={t("gsp.shot.refsDecision")} tone={mine?.blocked ? "danger" : corrections.length ? "warning" : undefined}>
          <Kv rows={[
            [t("gsp.shot.refsPlanned"), arr(mine?.planned_references).map((r) => `Z${Number(r)}`).join(", ") || "—"],
            [t("gsp.shot.refsFinal"), refs.map((r, i) => `${i + 1}: Z${r}${arr(mine?.aux_references).map(Number).includes(r) ? ` (${t("gsp.shot.aux")})` : ""}`).join(", ") || "—"],
            [t("gsp.shot.corrections"), corrections.length ? corrections.map((c) => `${t(`gsp.corr.${str(c.code)}`)}${arr(c.photos).length ? `: ${arr(c.photos).map((n) => `Z${Number(n)}`).join(", ")}` : ""}`).join(" · ") : "—"],
            [t("gsp.shot.binding"), mine?.blocked ? t("gsp.corr.blocked_no_whole") : mine?.binding_source === "kb" ? t("gsp.shot.bindingKb") : t("gsp.shot.bindingDefault")],
          ]} />
        </Block>
      )}
      <Block title={t("gsp.shot.prompt")} copy={copy(prompt)}>
        <p className="text-[11px] text-muted">{t("gsp.shot.promptNote")} · {t("gsp.plan.refs")}: {refs.map((r) => `Z${r}`).join(", ") || "—"} · {str(mine?.pattern)}</p>
        <div className={pre}>{prompt || "—"}</div>
      </Block>
      {node.thumb && (
        <Block title={t("gsp.result")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={node.thumb} alt="" className="max-h-72 w-full rounded-lg object-contain" />
        </Block>
      )}
      {!isDerived && prompt && node.shot !== null && (
        <Button size="sm" onClick={() => onExperiment(node.shot as number, prompt, refs, str(mine?.pattern))}>
          <FlaskConical size={14} aria-hidden /> {t("gsp.exp.rerun")}
        </Button>
      )}
    </div>
  );
}

/* ── an experiment ─────────────────────────────────────────────────────────*/
function ExperimentSection({ data, node, t, reload }: { data: ProcessData; node: ProcessNode; t: T; reload: () => void }) {
  const e = data.experiments.find((x) => x.id === node.runId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!e) return null;
  const canPublish = e.status === "ok" && !e.published && data.run.kind === "grovshot";
  const publish = async () => {
    if (!window.confirm(t("gsp.exp.publishConfirm"))) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/grovshot-shot/experiment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "publish", runId: e.id }) });
      const j = (await res.json()) as { ok: boolean; error?: string };
      setMsg(j.ok ? t("gsp.exp.published") : t(`gsp.err.${j.error ?? "generic"}`));
      if (j.ok) reload();
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2.5">
      <Kv rows={[
        [t("gsp.f.status"), <Badge key="s" tone={tone(node.status)}>{e.status}{e.error ? ` · ${e.error}` : ""}</Badge>],
        [t("gsp.plan.refs"), e.references.map((r) => `Z${r}`).join(", ")], [t("gsp.f.cost"), usd(e.costMicros)],
        [t("gsp.exp.gallery"), e.published ? t("gsp.exp.inGallery") : t("gsp.exp.notInGallery")],
      ]} />
      {(() => {
        // Before / after: the order's own image of this shot next to the experiment's.
        const before = data.nodes.find((x) => x.kind === "shot" && x.shot === e.shot)?.thumb ?? null;
        if (!e.imageUrl && !before) return null;
        return (
          <div className="grid grid-cols-2 gap-2" data-gsp-compare>
            {[[t("gsp.exp.before"), before], [t("gsp.exp.after"), e.imageUrl]].map(([label, url]) => (
              <figure key={String(label)} className="min-w-0 space-y-1">
                <figcaption className="text-[11px] font-semibold text-muted">{label}</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {url ? <img src={String(url)} alt="" className="max-h-64 w-full rounded-lg border border-line object-contain" /> : <div className="flex h-32 items-center justify-center rounded-lg bg-raised text-[11px] text-muted">—</div>}
              </figure>
            ))}
          </div>
        );
      })()}
      <div className="flex flex-wrap gap-2">
        <Link href={`/admin/grovshot/${e.id}`} className="inline-flex items-center rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium hover:bg-raised">{t("gsp.exp.openProcess")}</Link>
        {canPublish && <Button size="sm" variant="secondary" onClick={() => void publish()} disabled={busy}>{t("gsp.exp.publish")}</Button>}
      </div>
      {data.run.kind !== "grovshot" && <p className="text-[11px] text-muted">{t("gsp.exp.testNoGallery")}</p>}
      {msg && <p className="text-[12px]">{msg}</p>}
    </div>
  );
}

function FormSection({ data, t }: { data: ProcessData; t: T }) {
  const r = data.run;
  return (
    <div className="space-y-2.5">
      <Kv rows={[
        [t("gsp.form.account"), r.customer.email ?? r.customer.id ?? "—"], [t("gsp.form.shots"), String(r.ordered)],
        [t("gsp.f.format"), `${r.ratio ?? "—"} · ${r.resolution ?? "—"}`], [t("gsp.f.versions"), `${r.engineVersion ?? "—"} · KB v${r.kbVersion ?? "?"}`],
        [t("gsp.form.kind"), r.experimentOf ? t("gsp.orders.kindExperiment") : r.regenOf ? t("gsp.orders.kindRegen") : r.kind === "grovshot_test" ? `${t("gsp.orders.kindTest")} (${r.testMode ?? "—"})` : t("gsp.orders.kindOrder")],
      ]} />
      {(r.experimentOf || r.regenOf) && <Link href={`/admin/grovshot/${r.experimentOf ?? r.regenOf}`} className="text-[12px] font-medium text-accent hover:underline">{t("gsp.form.source")}</Link>}
      <Block title={t("gsp.form.photos", { n: data.photos.length })}>
        <div className="flex flex-wrap gap-2">
          {data.photos.map((p) => (
            <div key={p.n} className="w-[92px] text-[10.5px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.url ? <img src={p.url} alt="" className="h-20 w-20 rounded-md border border-line object-contain" /> : <div className="h-20 w-20 rounded-md bg-raised" />}
              <p className="font-semibold">Z{p.n}</p><p className="font-mono text-muted">{short(p.sha256)}</p>
            </div>
          ))}
        </div>
      </Block>
      <Block title={t("gsp.form.description")}><div className={pre}>{r.description || "—"}</div></Block>
      {r.legacyNotes && <Block title={t("gsp.form.legacyNotes")}><div className={pre}>{r.legacyNotes}</div></Block>}
    </div>
  );
}

export function NodePanel({ data, node, onClose, onExperiment, reload }: {
  data: ProcessData; node: ProcessNode; onClose: () => void; reload: () => void;
  onExperiment: (shot: number, prompt: string, refs: number[], pattern: string) => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="fixed inset-x-0 bottom-0 z-[60] flex max-h-[72vh] flex-col rounded-t-2xl border border-line bg-surface shadow-2xl lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[480px] lg:rounded-none lg:border-y-0 lg:border-r-0"
      data-gsp-panel={node.kind}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{t(node.title.key, node.title.values)}</p>
          <p className="text-[11px] text-muted">{node.model ?? ""}{node.attempts > 1 ? ` · ${t("gsp.attempts", { n: node.attempts })}` : ""}</p>
        </div>
        <Badge tone={tone(node.status)}>{t(`gsp.status.${node.status}`)}</Badge>
        <button type="button" onClick={onClose} aria-label={t("gsp.close")} className="rounded-md p-1 hover:bg-raised"><X size={16} aria-hidden /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {node.kind === "form" && <FormSection data={data} t={t} />}
        {(node.kind === "card" || node.kind === "plan" || node.kind === "product" || node.kind === "scenes") && <TextSection data={data} node={node} t={t} />}
        {node.kind === "shot" && <ShotSection data={data} node={node} t={t} onExperiment={onExperiment} />}
        {node.kind === "round" && <RoundSection data={data} node={node} t={t} />}
        {node.kind === "experiment" && <ExperimentSection data={data} node={node} t={t} reload={reload} />}
      </div>
    </aside>
  );
}
