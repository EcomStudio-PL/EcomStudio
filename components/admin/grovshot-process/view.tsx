"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { ProcessData, ProcessNode } from "@/lib/grovshot-shot/process-types";
import { Badge } from "@/components/ui/badge";
import { FlowCanvas, type Placed } from "@/components/admin/grovshot-process/canvas";
import { NodePanel } from "@/components/admin/grovshot-process/panel";
import { ExperimentEditor } from "@/components/admin/grovshot-process/experiment";
import { secs, usd } from "@/components/admin/grovshot-process/bits";
import { cn } from "@/lib/utils";

/**
 * GROVBASE SHOT → PODGLĄD PROCESU (admins only — the page sits under the
 * admin layout, its data route checks the role again). Full screen, read-only:
 * the order's real steps as a horizontal flow; a node opens its details.
 * Refreshes itself while the order or an experiment is still running.
 */

const dot: Record<ProcessNode["status"], string> = {
  ok: "bg-success", warning: "bg-warning", failed: "bg-danger", running: "bg-indigo animate-pulse", pending: "bg-muted/50", skipped: "bg-muted/50",
};

export function ProcessView({ runId, initialShot }: { runId: string; initialShot: number | null }) {
  const { t } = useI18n();
  const [data, setData] = useState<ProcessData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialShot ? `shot-${initialShot}` : null);
  const [editor, setEditor] = useState<{ shot: number; prompt: string; refs: number[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/grovshot-shot/process?run=${runId}`, { cache: "no-store" });
      const j = (await res.json()) as { ok: boolean; data?: ProcessData; error?: string };
      if (j.ok && j.data) { setData(j.data); setError(null); } else setError(j.error ?? "generic");
    } catch { setError("generic"); } finally { setLoading(false); }
  }, [runId]);

  useEffect(() => { void load(); }, [load]);
  const live = Boolean(data && (data.run.status === "queued" || data.run.status === "running" || data.experiments.some((e) => e.status === "queued" || e.status === "running")));
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(id);
  }, [live, load]);

  const node = data?.nodes.find((n) => n.id === selected) ?? null;
  const renderNode = (n: Placed) => (
    <div className="flex h-full flex-col p-2.5">
      <div className="flex items-center gap-1.5">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", dot[n.status])} aria-hidden />
        <span className="truncate text-[12px] font-semibold">{t(n.title.key, n.title.values)}</span>
      </div>
      <div className="mt-1 flex min-h-0 flex-1 gap-2">
        {n.thumb && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={n.thumb} alt="" className="h-[74px] w-[74px] shrink-0 rounded-md border border-line object-cover" />)}
        <div className="min-w-0 space-y-0.5 text-[10.5px] text-muted">
          {n.model && <p className="truncate">{n.model}</p>}
          {(n.ms || n.costMicros !== null) && <p>{secs(n.ms)} · {n.costUnknown ? "UNKNOWN" : usd(n.costMicros)}</p>}
          {n.attempts > 1 && <p>{t("gsp.attempts", { n: n.attempts })}</p>}
          <div className="flex flex-wrap gap-1 pt-0.5">
            {n.flags.map((f) => (
              <span key={f} className={cn("rounded px-1 text-[9.5px] font-semibold uppercase",
                f === "ref_mismatch" || f === "no_boundary" ? "bg-[rgb(var(--danger)/0.12)] text-danger" : f === "violations" || f === "repeat" ? "bg-[rgb(var(--warning)/0.14)] text-warning" : "bg-raised")}>
                {t(`gsp.flag.${f}`)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg" data-gsp-process>
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Link href="/admin/ai/prompts?tab=shot_orders" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] hover:bg-raised">
          <ArrowLeft size={14} aria-hidden /> {t("gsp.back")}
        </Link>
        <h1 className="text-sm font-semibold">{t("gsp.title")}</h1>
        {data && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
            <Badge tone={data.run.status === "ok" ? "success" : data.run.status === "partial" ? "warning" : data.run.status === "failed" ? "danger" : "info"}>{t(`gsp.runStatus.${data.run.status}`)}</Badge>
            <span>{data.run.delivered}/{data.run.ordered}</span>
            <span>· {data.run.engineVersion ?? "—"} · KB v{data.run.kbVersion ?? "?"}</span>
            <span>· {usd(data.run.costMicros)}{data.run.costUnknown ? " +?" : ""}</span>
            <span className="hidden truncate sm:inline">· {data.run.customer.email ?? data.run.customer.id ?? ""}</span>
            <span className="font-mono">· {data.run.id.slice(0, 8)}</span>
          </div>
        )}
        <button type="button" onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] hover:bg-raised" aria-label={t("gsp.refresh")}>
          {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
        </button>
      </header>
      {data && !data.run.hasBoundary && (
        <p className="flex items-center gap-1.5 border-b border-warning/40 bg-[rgb(var(--warning)/0.08)] px-3 py-1.5 text-[11.5px]">
          <AlertTriangle size={13} className="text-warning" aria-hidden /> {t("gsp.noBoundaryRun")}
        </p>
      )}
      <div className="relative min-h-0 flex-1">
        {error && <p className="p-4 text-sm text-danger">{t(`gsp.err.${error}`)}</p>}
        {!data && !error && <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin" aria-hidden /></div>}
        {data && (
          <FlowCanvas nodes={data.nodes} edges={data.edges} selected={selected} onSelect={setSelected} renderNode={renderNode}
            labels={{ zoomIn: t("gsp.zoomIn"), zoomOut: t("gsp.zoomOut"), fit: t("gsp.fit") }} />
        )}
      </div>
      {data && node && (
        <NodePanel data={data} node={node} onClose={() => setSelected(null)} reload={() => void load()}
          onExperiment={(shot, prompt, refs) => setEditor({ shot, prompt, refs })} />
      )}
      {data && editor && (
        <ExperimentEditor data={data} shot={editor.shot} prompt={editor.prompt} refs={editor.refs} onClose={() => setEditor(null)}
          onDone={() => { setEditor(null); void load(); }} />
      )}
    </div>
  );
}
