"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check, Download, Loader2, MoreHorizontal, RefreshCw, Sparkles, Zap,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ConceptCardData = {
  id: string;
  index: number;
  /** Customer-facing copy — the only text a seller ever sees for a concept. */
  title: string;
  description: string | null;
  sceneType: string | null;
  references: { image: number; url: string | null; primary: boolean }[];
  generationCount: number;
  resultUrl: string | null;
  resultPending: boolean;
};

type CardState = "idle" | "queued" | "generating" | "done" | "failed";

type Live = {
  state: CardState;
  url?: string | null;
  error?: string;
  credits?: number;
};

/** Two provider calls in flight keeps a 10-shot batch fast without tripping
 *  provider rate limits; each photo appears the moment it exists. */
const CONCURRENCY = 2;

/**
 * CONCEPT BOARD — the prepared shots as cards, generation in place.
 *
 * The seller reads a title and one sentence, sees which of their photos the
 * shot will use, and presses Generuj — on one card or on the whole set. The
 * board never mentions prompts, engines or models, because the seller's job
 * ended at the upload.
 */
export function ConceptBoard({ concepts, unitCost, balance, engineReady }: {
  concepts: ConceptCardData[];
  unitCost: number;
  balance: number;
  engineReady: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [live, setLive] = useState<Record<string, Live>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const batchGuard = useRef(false);

  const stateOf = (c: ConceptCardData): CardState => {
    const s = live[c.id]?.state;
    if (s && s !== "idle") return s;
    if (c.resultPending) return "generating";
    return c.resultUrl ? "done" : "idle";
  };
  const urlOf = (c: ConceptCardData) => live[c.id]?.url ?? c.resultUrl;

  const pendingIds = concepts.filter((c) => stateOf(c) === "idle" || stateOf(c) === "failed").map((c) => c.id);
  const totalCost = unitCost * pendingIds.length;
  const doneCount = concepts.filter((c) => stateOf(c) === "done").length;
  const activeCount = concepts.filter((c) => { const s = stateOf(c); return s === "generating" || s === "queued"; }).length;
  const notEnough = totalCost > balance;

  async function generateOne(conceptId: string): Promise<"done" | "failed" | "insufficient"> {
    setLive((prev) => ({ ...prev, [conceptId]: { state: "generating" } }));
    try {
      const res = await fetch("/api/concepts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId }),
      });
      const json = await res.json() as {
        ok: boolean; error?: string; images?: { url: string }[]; credits?: number;
      };
      if (json.ok && json.images?.length) {
        setLive((prev) => ({ ...prev, [conceptId]: { state: "done", url: json.images![0].url, credits: json.credits } }));
        return "done";
      }
      // A run already in flight is not a failure — just keep showing progress.
      if (json.error === "already_running") {
        setLive((prev) => ({ ...prev, [conceptId]: { state: "generating" } }));
        return "failed";
      }
      setLive((prev) => ({ ...prev, [conceptId]: { state: "failed", error: json.error ?? "provider_error" } }));
      if (json.error === "insufficient_credits") {
        toast.error(t("studio.err.insufficient_credits"));
        return "insufficient";
      }
      return "failed";
    } catch {
      setLive((prev) => ({ ...prev, [conceptId]: { state: "failed", error: "provider_error" } }));
      return "failed";
    }
  }

  /** GENERUJ WSZYSTKIE — a small worker pool over the not-yet-generated
   *  cards. A ref guards the whole batch against double taps. */
  async function generateAll() {
    if (batchGuard.current || pendingIds.length === 0) return;
    batchGuard.current = true;
    setBatchRunning(true);
    const queue = [...pendingIds];
    queue.forEach((id) => setLive((prev) => ({ ...prev, [id]: { state: "queued" } })));

    let cursor = 0;
    let insufficient = false;
    const worker = async () => {
      // An empty wallet fails every remaining shot identically — stop the
      // batch at the first such answer instead of toasting once per card.
      while (!insufficient) {
        const index = cursor++;
        if (index >= queue.length) return;
        const outcome = await generateOne(queue[index]);
        if (outcome === "insufficient") insufficient = true;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (insufficient) {
      setLive((prev) => {
        const next = { ...prev };
        for (const id of queue) if (next[id]?.state === "queued") next[id] = { state: "idle" };
        return next;
      });
    }
    setBatchRunning(false);
    batchGuard.current = false;
    router.refresh();
  }

  async function regenerateScene(conceptId: string) {
    setLive((prev) => ({ ...prev, [conceptId]: { state: "generating" } }));
    try {
      const res = await fetch("/api/prompts/regenerate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: conceptId }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) { toast.success(t("concepts.sceneChanged")); router.refresh(); }
      else toast.error(t(`studio.err.${json.error}`, {}) || t("common.error"));
    } catch { toast.error(t("common.error")); }
    setLive((prev) => ({ ...prev, [conceptId]: { state: "idle" } }));
  }

  const summary = useMemo(() => {
    if (batchRunning || activeCount > 0) {
      return t("concepts.batchProgress", { done: doneCount, total: concepts.length });
    }
    return pendingIds.length > 0
      ? t("concepts.batchCost", { n: pendingIds.length, cost: totalCost })
      : t("concepts.allDone");
  }, [batchRunning, activeCount, doneCount, concepts.length, pendingIds.length, totalCost, t]);

  return (
    <div className="min-w-0">
      {/* GENERUJ WSZYSTKIE — always visible above the grid, sticky-safe on phones. */}
      {engineReady && concepts.length > 0 && (
        <div className="dock sticky top-2 z-20 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3 sm:static sm:p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("concepts.readyTitle", { n: concepts.length })}</p>
            <p className={cn("text-xs", notEnough && pendingIds.length > 0 ? "text-danger" : "text-muted")}>{summary}</p>
          </div>
          <button
            type="button"
            disabled={batchRunning || pendingIds.length === 0 || notEnough}
            onClick={generateAll}
            className={cn(
              "cta inline-flex h-11 shrink-0 items-center gap-2 rounded-xl px-5 text-sm font-semibold",
              (batchRunning || pendingIds.length === 0 || notEnough) && "cursor-not-allowed opacity-50",
            )}
          >
            {batchRunning ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Zap size={15} aria-hidden />}
            {batchRunning
              ? t("concepts.batchProgress", { done: doneCount, total: concepts.length })
              : t("concepts.generateAll", { n: pendingIds.length })}
          </button>
        </div>
      )}

      <div className="stagger grid gap-4 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3">
        {concepts.map((c) => (
          <ConceptCard
            key={c.id}
            c={c}
            state={stateOf(c)}
            url={urlOf(c)}
            error={live[c.id]?.error}
            unitCost={unitCost}
            engineReady={engineReady}
            canAfford={unitCost <= balance}
            onGenerate={() => generateOne(c.id).then(() => router.refresh())}
            onChangeScene={() => regenerateScene(c.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ConceptCard({ c, state, url, error, unitCost, engineReady, canAfford, onGenerate, onChangeScene }: {
  c: ConceptCardData;
  state: CardState;
  url: string | null | undefined;
  error?: string;
  unitCost: number;
  engineReady: boolean;
  canAfford: boolean;
  onGenerate: () => void;
  onChangeScene: () => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const busy = state === "generating" || state === "queued";

  function download() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `ecomstudio-${c.index}.png`;
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    a.click();
  }

  return (
    <Card className="anim-pop flex min-w-0 flex-col overflow-hidden">
      {/* RESULT / PREVIEW AREA */}
      <div className="relative aspect-[4/3] bg-sunken">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={c.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            {busy ? (
              <>
                <Loader2 size={22} className="animate-spin text-accent" aria-hidden />
                <p className="text-xs font-medium text-muted">
                  {state === "queued" ? t("concepts.stateQueued") : t("concepts.stateGenerating")}
                </p>
              </>
            ) : (
              <>
                <Sparkles size={20} className="text-faint" aria-hidden />
                <p className="text-xs text-faint">{t("concepts.notGenerated")}</p>
              </>
            )}
          </div>
        )}
        <span className="absolute left-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-lg brand-gradient text-[11px] font-bold text-white">
          {String(c.index).padStart(2, "0")}
        </span>
        {state === "done" && (
          <span className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--success)/0.9)] text-white">
            <Check size={13} aria-hidden />
          </span>
        )}

        {/* On-image actions once a photo exists. */}
        {url && !busy && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1.5 bg-gradient-to-t from-black/55 to-transparent p-2.5">
            <button type="button" onClick={onGenerate} aria-label={t("concepts.retake")}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70">
              <RefreshCw size={14} aria-hidden />
            </button>
            <button type="button" onClick={download} aria-label={t("common.download")}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70">
              <Download size={14} aria-hidden />
            </button>
            <div className="relative">
              <button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={t("common.actions")}
                aria-expanded={menuOpen}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70">
                <MoreHorizontal size={14} aria-hidden />
              </button>
              {menuOpen && (
                <div className="panel absolute bottom-10 right-0 z-10 w-44 rounded-xl p-1 shadow-e3">
                  <MenuItem icon={RefreshCw} label={t("concepts.retake")} onClick={() => { setMenuOpen(false); onGenerate(); }} />
                  <MenuItem icon={Sparkles} label={t("concepts.changeScene")} onClick={() => { setMenuOpen(false); onChangeScene(); }} />
                  <MenuItem icon={Download} label={t("common.download")} onClick={() => { setMenuOpen(false); download(); }} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* CARD BODY — customer copy only. */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-semibold tracking-tight">{c.title}</h3>
          {c.sceneType && (
            <Badge tone="indigo" className="shrink-0">{t(`scene.${c.sceneType}`) || c.sceneType}</Badge>
          )}
        </div>
        {c.description && (
          <p className="text-[12.5px] leading-relaxed text-muted">{c.description}</p>
        )}

        {c.references.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{t("concepts.refs")}</span>
            <div className="flex gap-1">
              {c.references.slice(0, 5).map((r) => (
                <span key={r.image} className={cn(
                  "relative h-8 w-8 overflow-hidden rounded-md ring-1 ring-inset",
                  r.primary ? "ring-[rgb(var(--accent))]" : "ring-black/10",
                )}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.url && <img src={r.url} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </span>
              ))}
            </div>
          </div>
        )}

        {state === "failed" && error && error !== "insufficient_credits" && (
          /* The server already retried and fell back across providers before
             answering — whatever code it returned, the seller only needs to
             know the outcome and that their credits are safe. */
          <p role="alert" className="rounded-lg bg-[rgb(var(--danger)/0.1)] px-2.5 py-1.5 text-[11px] text-danger">
            {t("concepts.failedFinal")}
          </p>
        )}

        <div className="mt-auto pt-1">
          {state === "done" || url ? (
            <div className="flex items-center justify-between text-[11px] text-faint">
              <span>{t("concepts.takes", { n: Math.max(1, c.generationCount) })}</span>
              <span className="tabular-nums">{unitCost > 0 ? t("concepts.retakeCost", { n: unitCost }) : ""}</span>
            </div>
          ) : (
            <button
              type="button"
              disabled={!engineReady || busy || !canAfford}
              onClick={onGenerate}
              className={cn(
                "cta flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold",
                (!engineReady || busy || !canAfford) && "cursor-not-allowed opacity-50",
              )}
            >
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
              {busy
                ? t("concepts.stateGenerating")
                : t("concepts.generateOne", { n: unitCost })}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function MenuItem({ icon: Icon, label, onClick }: {
  icon: typeof RefreshCw; label: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-ink transition-colors hover:bg-sunken">
      <Icon size={13} className="shrink-0 text-muted" aria-hidden />
      {label}
    </button>
  );
}

/** Small ready-state banner on the session page. */
export function SessionStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === "ready") return <Badge tone="green"><Check size={11} className="mr-1 inline" />{t("psess.ready")}</Badge>;
  if (status === "failed") return <Badge tone="red">{t("psess.failed")}</Badge>;
  return <Badge tone="amber">{t("psess.processing")}</Badge>;
}
