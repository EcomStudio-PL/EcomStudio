"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check, Download, Loader2, MoreHorizontal, RefreshCw, Sparkles, Zap,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { modelBadgeLabel } from "@/lib/model-badge";
import { cn } from "@/lib/utils";

export type ConceptModelChoice = {
  id: string;
  name: string;
  badge: string | null;
  costCustom: number;
  costEcom: number;
  /** Base credits per output size, so a 2K session quotes the 2K price. */
  pricing: Record<string, number>;
  ecomSurcharge: number;
};

/**
 * ONE price function for every label on the board.
 *
 * The server charges `originCost(model, origin, session.resolution)`, so a 2K
 * session costs the 2K price. Any label that quoted `costEcom` instead would
 * show the model's cheapest size while the wallet lost more — so the retake
 * menu, the card's model select, the bulk sheet and the totals all come
 * through here. An unsupported size falls back exactly as the server does.
 */
function modelPrice(
  m: ConceptModelChoice | undefined, origin: string, resolution?: string | null,
): number {
  if (!m) return 0;
  const base = (resolution && m.pricing[resolution] !== undefined)
    ? m.pricing[resolution]
    : (origin === "custom" ? m.costCustom : m.costEcom - m.ecomSurcharge);
  return origin === "custom" ? base : base + m.ecomSurcharge;
}

export type ConceptCardData = {
  id: string;
  index: number;
  /** Customer-facing copy — the only text a seller ever sees for an
   *  GrovBase concept. */
  title: string;
  description: string | null;
  sceneType: string | null;
  references: { image: number; url: string | null; primary: boolean }[];
  generationCount: number;
  resultUrl: string | null;
  resultPending: boolean;
  /** Pricing origin: GrovBase engine prompt vs the customer's own prompt. */
  origin: "ecomstudio" | "custom";
  /** Saved per-card model override (wins over the global choice). */
  modelId: string | null;
  /** The customer's own prompt — present ONLY on custom cards, editable. */
  customPrompt: string | null;
  /** Display name of the model that served the current photo. */
  generatedWith: string | null;
};

type CardState = "idle" | "queued" | "generating" | "done" | "failed";

type Live = {
  state: CardState;
  url?: string | null;
  error?: string;
  credits?: number;
  modelName?: string;
};

/** Two provider calls in flight keeps a 10-shot batch fast without tripping
 *  provider rate limits; each photo appears the moment it exists. */
const CONCURRENCY = 2;

/**
 * CONCEPT BOARD — the prepared shots as cards, generation in place.
 *
 * The customer now picks the IMAGE MODEL: globally in the "Generuj
 * wszystkie" sheet, or per card via its own selector (a card override always
 * wins). GrovBase prompts stay invisible; a custom card shows the
 * customer's own editable prompt. Prices come from admin pricing per model
 * and per origin — never from the client.
 */
export function ConceptBoard({ concepts, models, balance, engineReady, initialModelId = null, resolution = null }: {
  concepts: ConceptCardData[];
  models: ConceptModelChoice[];
  balance: number;
  engineReady: boolean;
  /** The model picked in the session form — the board's starting default. */
  initialModelId?: string | null;
  /** Output size chosen for this session; every quote here uses it, so the
   *  board never shows a price lower than the one the server charges. */
  resolution?: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const defaultModelId = (initialModelId && models.some((m) => m.id === initialModelId))
    ? initialModelId
    : models[0]?.id ?? "";
  const [live, setLive] = useState<Record<string, Live>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkModelId, setBulkModelId] = useState(defaultModelId);
  /** The model each card currently points at (override or the default). */
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(concepts.map((c) => [c.id, c.modelId ?? defaultModelId])));
  const batchGuard = useRef(false);

  const modelById = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);

  const priceOf = (m: ConceptModelChoice | undefined, origin: string) => modelPrice(m, origin, resolution);
  const costFor = (c: ConceptCardData, modelId?: string) =>
    priceOf(modelById.get(modelId ?? chosen[c.id]) ?? models[0], c.origin);

  const stateOf = (c: ConceptCardData): CardState => {
    const s = live[c.id]?.state;
    if (s && s !== "idle") return s;
    if (c.resultPending) return "generating";
    return c.resultUrl ? "done" : "idle";
  };
  const urlOf = (c: ConceptCardData) => live[c.id]?.url ?? c.resultUrl;

  const pending = concepts.filter((c) => stateOf(c) === "idle" || stateOf(c) === "failed");
  const doneCount = concepts.filter((c) => stateOf(c) === "done").length;
  const activeCount = concepts.filter((c) => { const s = stateOf(c); return s === "generating" || s === "queued"; }).length;

  /** Bulk total: a card override wins over the sheet's global model. */
  const bulkTotal = pending.reduce((sum, c) => sum + costFor(c, c.modelId ?? bulkModelId), 0);
  const notEnough = bulkTotal > balance;

  async function persistModel(conceptId: string, modelId: string) {
    setChosen((prev) => ({ ...prev, [conceptId]: modelId }));
    try {
      await fetch("/api/prompts/card", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: conceptId, modelId }),
      });
    } catch { /* the choice still rides along with the generate call */ }
  }

  async function generateOne(conceptId: string, modelId?: string): Promise<"done" | "failed" | "insufficient"> {
    setLive((prev) => ({ ...prev, [conceptId]: { state: "generating" } }));
    try {
      const res = await fetch("/api/concepts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId, modelId: modelId ?? (chosen[conceptId] || undefined) }),
      });
      const json = await res.json() as {
        ok: boolean; error?: string; images?: { url: string }[]; credits?: number; modelName?: string;
      };
      if (json.ok && json.images?.length) {
        setLive((prev) => ({ ...prev, [conceptId]: { state: "done", url: json.images![0].url, credits: json.credits, modelName: json.modelName } }));
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

  /** GENERUJ WSZYSTKIE — confirmed in the model sheet; a small worker pool
   *  over the not-yet-generated cards. A ref guards against double taps. */
  async function generateAll() {
    if (batchGuard.current || pending.length === 0) return;
    batchGuard.current = true;
    setBulkOpen(false);
    setBatchRunning(true);
    // Card override wins over the sheet's global model.
    const queue = pending.map((c) => ({ id: c.id, modelId: c.modelId ?? bulkModelId }));
    queue.forEach((q) => setLive((prev) => ({ ...prev, [q.id]: { state: "queued" } })));

    let cursor = 0;
    let insufficient = false;
    const worker = async () => {
      while (!insufficient) {
        const index = cursor++;
        if (index >= queue.length) return;
        const outcome = await generateOne(queue[index].id, queue[index].modelId);
        if (outcome === "insufficient") insufficient = true;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (insufficient) {
      setLive((prev) => {
        const next = { ...prev };
        for (const q of queue) if (next[q.id]?.state === "queued") next[q.id] = { state: "idle" };
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
    return pending.length > 0
      ? t("concepts.batchCost", { n: pending.length, cost: bulkTotal })
      : t("concepts.allDone");
  }, [batchRunning, activeCount, doneCount, concepts.length, pending.length, bulkTotal, t]);

  return (
    <div className="min-w-0">
      {/* GENERUJ WSZYSTKIE — always visible above the grid, sticky-safe on phones. */}
      {engineReady && concepts.length > 0 && (
        <div className="dock sticky top-2 z-20 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3 sm:static sm:p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t("concepts.readyTitle", { n: concepts.length })}</p>
            <p className={cn("text-xs", notEnough && pending.length > 0 ? "text-danger" : "text-muted")}>{summary}</p>
            {/* Live batch meter: the board's state at a glance. */}
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
                <div
                  className="brand-gradient h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(doneCount > 0 ? 4 : 0, (doneCount / Math.max(1, concepts.length)) * 100)}%` }}
                />
              </div>
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted">
                {doneCount}/{concepts.length}
              </span>
            </div>
          </div>
          <button
            type="button"
            disabled={batchRunning || pending.length === 0}
            onClick={() => setBulkOpen(true)}
            className={cn(
              "cta inline-flex h-11 shrink-0 items-center gap-2 rounded-xl px-5 text-sm font-semibold",
              (batchRunning || pending.length === 0) && "cursor-not-allowed opacity-50",
            )}
          >
            {batchRunning ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Zap size={15} aria-hidden />}
            {batchRunning
              ? t("concepts.batchProgress", { done: doneCount, total: concepts.length })
              : t("concepts.generateAll", { n: pending.length })}
          </button>
        </div>
      )}

      <div className="stagger grid gap-4 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {concepts.map((c) => (
          <ConceptCard
            key={c.id}
            c={c}
            state={stateOf(c)}
            url={urlOf(c)}
            error={live[c.id]?.error}
            models={models}
            chosenId={chosen[c.id]}
            cost={costFor(c)}
            generatedWith={live[c.id]?.modelName ?? c.generatedWith}
            engineReady={engineReady}
            canAfford={costFor(c) <= balance}
            resolution={resolution}
            onPickModel={(id) => persistModel(c.id, id)}
            onGenerate={(modelId) => generateOne(c.id, modelId).then(() => router.refresh())}
            onChangeScene={() => regenerateScene(c.id)}
          />
        ))}
      </div>

      {/* MODEL SHEET for the whole batch: model list with per-shot price,
          then the honest math — shots × price = total — before any charge. */}
      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title={t("concepts.chooseModel")}>
        <div className="space-y-2">
          {models.map((m) => {
            const per = priceOf(m, pending[0]?.origin ?? "ecomstudio");
            return (
              <button key={m.id} type="button" onClick={() => setBulkModelId(m.id)}
                aria-pressed={bulkModelId === m.id}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors",
                  bulkModelId === m.id ? "is-selected" : "border-line hover:bg-raised",
                )}>
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {m.name}
                  {m.badge && <Badge tone="amber">{modelBadgeLabel(m.badge, t)}</Badge>}
                </span>
                <span className="text-xs tabular-nums text-muted">{t("concepts.perShot", { n: per })}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 rounded-xl bg-raised px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">{t("concepts.bulkShots")}</span>
            <span className="font-semibold tabular-nums">{pending.length}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-muted">{t("concepts.bulkTotal")}</span>
            <span className={cn("font-semibold tabular-nums", notEnough && "text-danger")}>{bulkTotal} kr.</span>
          </div>
          {notEnough && <p className="mt-2 text-xs text-danger">{t("studio.err.insufficient_credits")}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setBulkOpen(false)}
            className="rounded-xl px-4 py-2 text-sm font-medium text-muted hover:bg-raised">{t("common.cancel")}</button>
          <button type="button" disabled={notEnough || pending.length === 0} onClick={generateAll}
            className={cn("cta rounded-xl px-5 py-2 text-sm font-semibold", (notEnough || pending.length === 0) && "cursor-not-allowed opacity-50")}>
            {t("concepts.bulkConfirm", { n: pending.length })}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function ConceptCard({ c, state, url, error, models, chosenId, cost, generatedWith, engineReady, canAfford, resolution, onPickModel, onGenerate, onChangeScene }: {
  c: ConceptCardData;
  state: CardState;
  url: string | null | undefined;
  error?: string;
  models: ConceptModelChoice[];
  chosenId: string;
  cost: number;
  generatedWith: string | null;
  engineReady: boolean;
  canAfford: boolean;
  /** Session output size, so this card's prices match the charge. */
  resolution?: string | null;
  onPickModel: (modelId: string) => void;
  onGenerate: (modelId?: string) => void;
  onChangeScene: () => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [retakeOpen, setRetakeOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(c.customPrompt ?? "");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const busy = state === "generating" || state === "queued";

  function download() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `grovbase-${c.index}.png`;
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    a.click();
  }

  async function savePrompt() {
    setSavingPrompt(true);
    try {
      const res = await fetch("/api/prompts/card", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: c.id, promptText: promptDraft }),
      });
      const json = await res.json() as { ok: boolean };
      if (json.ok) toast.success(t("concepts.promptSaved"));
      else toast.error(t("common.error"));
    } catch { toast.error(t("common.error")); }
    setSavingPrompt(false);
  }

  return (
    <Card className="anim-pop flex min-w-0 flex-col overflow-hidden">
      {/* RESULT / PREVIEW AREA */}
      <div className="relative aspect-[4/3] bg-sunken">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={c.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-faint">
            {busy ? (
              <>
                <Loader2 size={22} className="animate-spin text-accent" aria-hidden />
                <span className="text-xs font-medium">
                  {state === "queued" ? t("concepts.stateQueued") : t("concepts.stateGenerating")}
                </span>
              </>
            ) : (
              <>
                <Sparkles size={22} aria-hidden />
                <span className="text-xs font-medium">{t("concepts.notGenerated")}</span>
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
            <div className="relative">
              <button type="button" onClick={() => { setRetakeOpen(!retakeOpen); setMenuOpen(false); }} aria-label={t("concepts.retake")}
                aria-expanded={retakeOpen}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70">
                <RefreshCw size={14} aria-hidden />
              </button>
              {retakeOpen && (
                <div className="panel absolute bottom-10 right-0 z-10 w-52 rounded-xl p-1 shadow-e3">
                  <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-faint">{t("concepts.retake")}</p>
                  <MenuItem icon={RefreshCw} label={t("concepts.retakeSame")}
                    onClick={() => { setRetakeOpen(false); onGenerate(); }} />
                  {models.filter((m) => m.id !== chosenId).map((m) => (
                    <MenuItem key={m.id} icon={Sparkles}
                      label={t("concepts.retakeWith", { model: m.name, n: modelPrice(m, c.origin, resolution) })}
                      onClick={() => { setRetakeOpen(false); onPickModel(m.id); onGenerate(m.id); }} />
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={download} aria-label={t("common.download")}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70">
              <Download size={14} aria-hidden />
            </button>
            <div className="relative">
              <button type="button" onClick={() => { setMenuOpen(!menuOpen); setRetakeOpen(false); }} aria-label={t("common.actions")}
                aria-expanded={menuOpen}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70">
                <MoreHorizontal size={14} aria-hidden />
              </button>
              {menuOpen && (
                <div className="panel absolute bottom-10 right-0 z-10 w-44 rounded-xl p-1 shadow-e3">
                  <MenuItem icon={RefreshCw} label={t("concepts.retake")} onClick={() => { setMenuOpen(false); setRetakeOpen(true); }} />
                  {c.origin === "ecomstudio" && (
                    <MenuItem icon={Sparkles} label={t("concepts.changeScene")} onClick={() => { setMenuOpen(false); onChangeScene(); }} />
                  )}
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
            <Badge tone="amber" className="shrink-0">{t(`scene.${c.sceneType}`) || c.sceneType}</Badge>
          )}
        </div>
        {c.description && (
          <p className="text-[12.5px] leading-relaxed text-muted">{c.description}</p>
        )}

        {/* The customer's own prompt — theirs to read and edit. */}
        {c.customPrompt !== null && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{t("concepts.yourPrompt")}</p>
            <Textarea
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              rows={3}
              className="min-h-16 resize-y !py-2 text-xs sm:!text-xs"
            />
            {promptDraft.trim() !== (c.customPrompt ?? "").trim() && (
              <button type="button" disabled={savingPrompt || promptDraft.trim().length < 3} onClick={savePrompt}
                className="mt-1 rounded-lg bg-raised px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:bg-sunken">
                {savingPrompt ? t("common.saving") : t("concepts.promptSave")}
              </button>
            )}
          </div>
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

        {/* MODEL — the customer's pick for this card; the override wins. */}
        {models.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{t("concepts.model")}</span>
            <div className="min-w-0 flex-1">
              <Select
                value={chosenId}
                disabled={busy}
                onChange={(e) => onPickModel(e.target.value)}
                aria-label={t("concepts.model")}
                className="!py-1.5 text-xs sm:!text-xs"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {modelPrice(m, c.origin, resolution)} kr.
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

        {state === "failed" && error && error !== "insufficient_credits" && (
          /* The server already retried before answering — the seller only
             needs the outcome and that their credits are safe. */
          <p role="alert" className="rounded-lg bg-[rgb(var(--danger)/0.1)] px-2.5 py-1.5 text-[11px] text-danger">
            {t("concepts.failedFinal")}
          </p>
        )}

        <div className="mt-auto pt-1">
          {state === "done" || url ? (
            <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
              <span className="truncate">
                {generatedWith ? t("concepts.generatedWith", { model: generatedWith }) : t("concepts.takes", { n: Math.max(1, c.generationCount) })}
              </span>
              <span className="shrink-0 tabular-nums">{cost > 0 ? t("concepts.retakeCost", { n: cost }) : ""}</span>
            </div>
          ) : (
            <button
              type="button"
              disabled={!engineReady || busy || !canAfford}
              onClick={() => onGenerate()}
              className={cn(
                "cta flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold",
                (!engineReady || busy || !canAfford) && "cursor-not-allowed opacity-50",
              )}
            >
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
              {busy
                ? t("concepts.stateGenerating")
                : t("concepts.generateOne", { n: cost })}
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
