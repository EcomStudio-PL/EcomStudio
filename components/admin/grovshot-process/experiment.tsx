"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { ProcessData, PromptBView } from "@/lib/grovshot-shot/process-types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { usd } from "@/components/admin/grovshot-process/bits";

/**
 * "Uruchom ponownie to ujęcie" — the admin's experiment editor: the shot's
 * final prompt, the reference list in send order (only this order's photos:
 * reorder, remove, add, at most 6 — Nano Banana Pro's limit), the estimated
 * price, an explicit confirmation of that price. One paid call; the result is
 * a new experiment node; nothing is charged to the customer and nothing
 * reaches the customer's gallery without the separate "Dodaj do galerii".
 */
const MAX_REFS = 6;

export function ExperimentEditor({ data, shot, prompt, refs, promptB, onClose, onDone }: {
  data: ProcessData; shot: number; prompt: string; refs: number[];
  /** Prompt B of this shot (13.11.2026) — same references as A, so the A/B changes one thing. */
  promptB?: PromptBView | null;
  onClose: () => void; onDone: (runId: string) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(prompt);
  const [list, setList] = useState<number[]>(refs);
  const [variant, setVariant] = useState<"a" | "b">("a");
  const pick = (v: "a" | "b") => {
    setVariant(v);
    setText(v === "b" && promptB ? promptB.text : prompt);
    setList(v === "b" && promptB ? promptB.references : refs);
  };
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estimate = data.run.experimentEstimateMicros;
  const move = (i: number, d: -1 | 1) => setList((l) => {
    const j = i + d;
    if (j < 0 || j >= l.length) return l;
    const c = l.slice();
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });
  const url = (n: number) => data.photos[n - 1]?.url ?? null;
  const run = async () => {
    if (!estimate || !confirmed || list.length === 0 || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/grovshot-shot/experiment", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceRunId: data.run.id, shot, prompt: text, references: list, confirmUsdMicros: estimate }),
      });
      const j = (await res.json()) as { ok: boolean; runId?: string; error?: string; spentUsdMicros?: number | null; capUsdMicros?: number | null };
      if (!j.ok || !j.runId) {
        setError(j.error === "experiment_budget"
          ? t("gsp.err.experiment_budget", { spent: usd(j.spentUsdMicros ?? null), cap: usd(j.capUsdMicros ?? null) })
          : t(`gsp.err.${j.error ?? "generic"}`));
        return;
      }
      onDone(j.runId);
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal aria-label={t("gsp.exp.title", { n: shot })}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold">{t("gsp.exp.title", { n: shot })}</h3>
          <button type="button" onClick={onClose} aria-label={t("gsp.close")} className="rounded-md p-1 hover:bg-raised"><X size={16} aria-hidden /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-[12.5px]">
          <p className="text-muted">{t("gsp.exp.intro")}</p>
          {promptB && (
            <div className="rounded-lg border border-line p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">{t("gsp.ab.title")}</span>
                <button type="button" onClick={() => pick("a")} aria-pressed={variant === "a"}
                  className={`rounded-md px-2 py-1 text-[11.5px] ${variant === "a" ? "bg-accent-soft text-accent" : "hover:bg-raised"}`}>
                  {t("gsp.ab.a", { n: promptB.charsA })}
                </button>
                <button type="button" onClick={() => pick("b")} aria-pressed={variant === "b"}
                  className={`rounded-md px-2 py-1 text-[11.5px] ${variant === "b" ? "bg-accent-soft text-accent" : "hover:bg-raised"}`}>
                  {t("gsp.ab.b", { n: promptB.chars })}
                </button>
              </div>
              <p className="mt-1 text-[11.5px] text-muted">{t("gsp.ab.hint")}</p>
              {promptB.refsV2.length > 0 && promptB.refsV2.join(",") !== promptB.references.join(",") && (
                <p className="mt-1 text-[11.5px]">
                  {t("gsp.ab.refsV2", { list: promptB.refsV2.map((n) => `Z${n}`).join(", ") })}{" "}
                  <button type="button" onClick={() => setList(promptB.refsV2)} className="text-accent underline-offset-2 hover:underline">{t("gsp.ab.useRefsV2")}</button>
                </p>
              )}
              {(promptB.reasonsV2.length > 0 || promptB.droppedV2.length > 0) && (
                <p className="mt-1 text-[11px] text-muted">
                  {promptB.reasonsV2.map((r) => `Z${r.photo}: ${t(`gsp.reason.${r.reason}`)}`).join(" · ")}
                  {promptB.droppedV2.length > 0 ? ` · ${t("gsp.ab.dropped")}: ${promptB.droppedV2.map((d) => `Z${d.photo} (${t(`gsp.drop.${d.reason}`)})`).join(", ")}` : ""}
                </p>
              )}
            </div>
          )}
          <div>
            <p className="mb-1 font-semibold">{t("gsp.exp.refs", { n: list.length, max: MAX_REFS })}</p>
            <ol className="flex flex-wrap gap-2">
              {list.map((n, i) => (
                <li key={n} className="w-[118px] rounded-lg border border-line p-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url(n) ? <img src={url(n) ?? ""} alt="" className="h-20 w-full rounded object-contain" /> : <div className="h-20 rounded bg-raised" />}
                  <p className="mt-0.5 text-center font-semibold">{t("gsp.exp.position", { i: i + 1 })} · Z{n}</p>
                  <div className="mt-0.5 flex justify-center gap-1">
                    <button type="button" onClick={() => move(i, -1)} aria-label={t("gsp.exp.up")} className="rounded p-1 hover:bg-raised"><ArrowUp size={13} aria-hidden /></button>
                    <button type="button" onClick={() => move(i, 1)} aria-label={t("gsp.exp.down")} className="rounded p-1 hover:bg-raised"><ArrowDown size={13} aria-hidden /></button>
                    <button type="button" onClick={() => setList((l) => l.filter((x) => x !== n))} aria-label={t("gsp.exp.remove")} className="rounded p-1 text-danger hover:bg-raised"><X size={13} aria-hidden /></button>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.photos.filter((p) => !list.includes(p.n)).map((p) => (
                <button key={p.n} type="button" disabled={list.length >= MAX_REFS} onClick={() => setList((l) => [...l, p.n])}
                  className="inline-flex items-center gap-1 rounded-md border border-dashed border-line px-2 py-1 text-[11.5px] hover:bg-raised disabled:opacity-40">
                  <Plus size={12} aria-hidden /> Z{p.n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 font-semibold">{t("gsp.exp.prompt", { n: text.length })}</p>
            <p className="mb-1 text-[11.5px] text-muted">{t("gsp.exp.bindingHint")}</p>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} className="font-mono text-[11.5px]" />
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-warning/50 bg-[rgb(var(--warning)/0.08)] p-2">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
            <span>{estimate ? t("gsp.exp.confirm", { cost: usd(estimate) }) : t("gsp.exp.noPrice")}</span>
          </label>
          {error && <p className="text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>{t("gsp.cancel")}</Button>
          <Button size="sm" onClick={() => void run()} disabled={busy || !confirmed || !estimate || list.length === 0 || !text.trim()}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden />} {t("gsp.exp.run")}
          </Button>
        </div>
      </div>
    </div>
  );
}
