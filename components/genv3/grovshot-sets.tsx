"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Flag, Loader2, RefreshCw, Check, Archive } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { formatDate, cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { SetShot, ShotSet, ShotVersion } from "@/lib/server/grovshot-shot/sets";

/**
 * GROVBASE SHOT — THE CUSTOMER'S SETS (Etap 2). One order = one set, its
 * shots in the plan's order and staying on their places: while the order
 * runs, every tile shows the common stage (W kolejce → Analiza produktu →
 * Planowanie zdjęć → Przygotowanie scen), then its own (Generowanie… /
 * gotowe / nieudane); a ready image takes its tile's place. Per image:
 * download, a PAID regeneration (same prompt and references, price shown and
 * confirmed, charged only when delivered), a problem report; versions 1/2
 * with "Użyj tej wersji" (the ZIP takes the chosen one).
 */

const REASONS = ["product_changed", "wrong_scale", "hands_faces", "light_mood", "scene_mismatch", "other"] as const;
const ACTIVE = new Set(["queued", "running"]);
const ratioClass = (r: string) => (r === "1:1" ? "aspect-square" : r === "4:5" ? "aspect-[4/5]" : r === "3:4" ? "aspect-[3/4]" : r === "16:9" ? "aspect-video" : r === "9:16" ? "aspect-[9/16]" : "aspect-square");

type Reply = { ok: boolean; error?: string; sets?: ShotSet[]; quote?: { unit: number } };

/** `balance` decides only whether "Wygeneruj ponownie" can be confirmed (charged when delivered). */
export function GrovshotSets({ refreshKey, balance }: { refreshKey: number; balance: number }) {
  const { t } = useI18n();
  const [sets, setSets] = useState<ShotSet[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const res = await fetch("/api/grovshot/sets", { cache: "no-store" });
      const json = (await res.json()) as Reply;
      if (json.ok && json.sets) {
        setSets(json.sets);
        const busy = json.sets.some((s) => ACTIVE.has(s.status) || s.shots.some((x) => x.regenerating));
        if (busy) timer.current = setTimeout(() => { void load(); }, 5_000);
        return;
      }
    } catch { /* asked again below */ }
    timer.current = setTimeout(() => { void load(); }, 15_000);
  }, []);
  useEffect(() => { void load(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [load, refreshKey]);
  if (!sets || sets.length === 0) return null;
  return (
    <section data-gss-sets className="space-y-4" aria-label={t("gsv2.sets.title")}>
      {sets.map((s) => <SetCard key={s.id} set={s} onChanged={() => void load()} balance={balance} />)}
    </section>
  );
}

function SetCard({ set, onChanged, balance }: { set: ShotSet; onChanged: () => void; balance: number }) {
  const { t, locale } = useI18n();
  const running = ACTIVE.has(set.status);
  const delivered = set.shots.filter((x) => x.versions.length > 0).length;
  // Before the plan exists the order's shots are not listed yet: as many tiles as ordered.
  const tiles: (SetShot | null)[] = set.shots.length > 0 ? set.shots : Array.from({ length: set.ordered }, () => null);
  const common = running && (set.stage === null || set.stage === "analyze" || set.stage === "plan" || set.stage === "scenes")
    ? t(`gsv2.sets.stage.${set.stage ?? "queued"}`) : null;
  return (
    <article data-gss-set={set.id} data-status={set.status} className="rounded-2xl border border-line bg-surface p-3">
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold">{set.product || t("gsv2.sets.untitled")}</p>
          <p className="text-[11.5px] text-muted">{formatDate(set.createdAt, locale)} · {t("gsv2.sets.count", { k: delivered, n: set.ordered })} · {set.ratio} · {set.resolution}</p>
        </div>
        {delivered > 0 && (
          <a href={`/api/grovshot/sets/${set.id}/zip`} data-gss-zip
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold hover:bg-raised">
            <Archive size={13} aria-hidden />{t("gsv2.sets.zip")}
          </a>
        )}
      </header>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {tiles.map((shot, i) => (
          <ShotTile key={shot?.n ?? `p${i}`} set={set} shot={shot} n={shot?.n ?? i + 1} common={common} onChanged={onChanged} balance={balance} />
        ))}
      </div>
    </article>
  );
}

function ShotTile({ set, shot, n, common, onChanged, balance }: {
  set: ShotSet; shot: SetShot | null; n: number; common: string | null; onChanged: () => void; balance: number;
}) {
  const { t } = useI18n();
  const versions = shot?.versions ?? [];
  const usedIndex = Math.max(0, versions.findIndex((v) => v.generationId === shot?.chosen));
  const defaultIndex = shot?.chosen ? usedIndex : versions.length - 1;
  const [view, setView] = useState<number | null>(null);
  const shown = versions.length ? versions[Math.min(versions.length - 1, Math.max(0, view ?? defaultIndex))] : null;
  const [regen, setRegen] = useState(false);
  const [report, setReport] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setView(null); }, [versions.length]);

  const choose = async (v: ShotVersion) => {
    setBusy(true);
    try {
      const res = await fetch("/api/grovshot/sets/choose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ generationId: v.generationId }) });
      const json = (await res.json()) as Reply;
      if (!json.ok) { toast.error(t("gsv2.sets.err.generic")); return; }
      toast.success(t("gsv2.sets.chosen"));
      onChanged();
    } finally { setBusy(false); }
  };

  const label = (() => {
    if (shot?.regenerating) return t("gsv2.sets.state.working");
    if (common) return common;
    if (!shot) return t("gsv2.sets.stage.queued");
    if (shot.state === "working") return t("gsv2.sets.state.working");
    if (shot.state === "queued") return t("gsv2.sets.state.queued");
    return null;
  })();
  const failed = shot && shot.state === "not_delivered" && versions.length === 0;
  const chosenNow = shown && (shot?.chosen ? shown.generationId === shot.chosen : shown === versions[versions.length - 1]);

  return (
    <div data-gss-shot={n} data-state={shot?.state ?? "queued"} className="space-y-1.5">
      <div className={cn("relative overflow-hidden rounded-xl border border-line bg-sunken", ratioClass(set.ratio))}>
        {shown ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={shown.thumbUrl} alt={shot?.title ?? ""} className="size-full object-cover" loading="lazy" />
        ) : failed ? (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 p-3 text-center text-[11.5px] text-muted">
            <AlertTriangle size={16} aria-hidden className="text-warning" />
            <span className="font-semibold text-ink">{t("gsv2.sets.failed")}</span>
            <span>{shot?.refunded ? t("gsv2.sets.refunded") : t("gsv2.sets.notCharged")}</span>
          </div>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-[11.5px] text-muted">
            <Loader2 size={16} aria-hidden className="animate-spin" />
            <span>{label}</span>
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 text-[10.5px] font-semibold text-white">{String(n).padStart(2, "0")}</span>
        {shown && shot?.regenerating && (
          <span className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10.5px] text-white">
            <Loader2 size={11} aria-hidden className="animate-spin" />{t("gsv2.sets.state.working")}
          </span>
        )}
        {versions.length > 1 && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded bg-black/55 text-[10.5px] font-semibold text-white" data-gss-versions>
            <button type="button" aria-label={t("gsv2.sets.prev")} className="px-1 py-0.5" onClick={() => setView(Math.max(0, (view ?? defaultIndex) - 1))}><ChevronLeft size={11} aria-hidden /></button>
            {(view ?? defaultIndex) + 1}/{versions.length}
            <button type="button" aria-label={t("gsv2.sets.next")} className="px-1 py-0.5" onClick={() => setView(Math.min(versions.length - 1, (view ?? defaultIndex) + 1))}><ChevronRight size={11} aria-hidden /></button>
          </span>
        )}
      </div>
      {shot?.title && <p className="truncate text-[11.5px] text-muted" title={shot.title}>{shot.title}</p>}
      {shot?.regenFailed && !shot.regenerating && <p className="text-[11px] text-warning">{t("gsv2.sets.regenFailed")}</p>}
      {(shown || failed) && (
        <div className="flex flex-wrap gap-1">
          {shown && (
            <a href={shown.url} download data-gss-download className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-semibold hover:bg-raised">
              <Download size={11} aria-hidden />{t("gsv2.sets.download")}
            </a>
          )}
          {!shot?.regenerating && !ACTIVE.has(set.status) && (
            <button type="button" data-gss-regen onClick={() => setRegen(true)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-semibold hover:bg-raised">
              <RefreshCw size={11} aria-hidden />{t("gsv2.sets.regen")}
            </button>
          )}
          {shown && (
            <button type="button" data-gss-report onClick={() => setReport(true)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-semibold hover:bg-raised">
              <Flag size={11} aria-hidden />{t("gsv2.sets.report")}
            </button>
          )}
          {shown && versions.length > 1 && !chosenNow && (
            <button type="button" data-gss-choose disabled={busy} onClick={() => void choose(shown)} className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
              <Check size={11} aria-hidden />{t("gsv2.sets.use")}
            </button>
          )}
        </div>
      )}
      <RegenDialog open={regen} onClose={() => setRegen(false)} set={set} n={n} balance={balance}
        onDone={() => { setRegen(false); onChanged(); }} />
      {shown && <ReportDialog open={report} onClose={() => setReport(false)} generationId={shown.generationId} />}
    </div>
  );
}

function RegenDialog({ open, onClose, set, n, balance, onDone }: {
  open: boolean; onClose: () => void; set: ShotSet; n: number; balance: number; onDone: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const short = balance < set.unit;
  const go = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/grovshot/runs/${set.id}/regenerate`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shot: n, quotedTotal: set.unit }),
      });
      const json = (await res.json()) as Reply;
      if (!json.ok) {
        toast.error(t(`gsv2.sets.err.${["insufficient_credits", "price_changed", "too_many_runs", "rate_limited", "concurrency_limit", "order_in_progress"].includes(json.error ?? "") ? json.error : "generic"}`));
        return;
      }
      toast.success(t("gsv2.sets.regenStarted"));
      onDone();
    } catch {
      toast.error(t("gsv2.sets.err.generic"));
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={t("gsv2.sets.regenTitle", { n })}>
      <div className="space-y-3 text-[13px]" data-gss-regen-dialog>
        <p>{t("gsv2.sets.regenBody", { n: set.unit })}</p>
        {short && <p className="text-warning">{t("gsv2.sets.err.insufficient_credits")}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
          <Button size="sm" onClick={() => void go()} disabled={busy || short}>
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}{t("gsv2.sets.regenConfirm", { n: set.unit })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ReportDialog({ open, onClose, generationId }: { open: boolean; onClose: () => void; generationId: string }) {
  const { t } = useI18n();
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      const res = await fetch("/api/grovshot/sets/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ generationId, reason, comment }) });
      const json = (await res.json()) as Reply;
      if (!json.ok) { toast.error(t(json.error === "rate_limited" ? "gsv2.sets.err.rate_limited" : "gsv2.sets.err.generic")); return; }
      toast.success(t("gsv2.sets.thanks"));
      setReason(null); setComment("");
      onClose();
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={t("gsv2.sets.reportTitle")}>
      <div className="space-y-3 text-[13px]" data-gss-report-dialog>
        <div className="space-y-1.5" role="radiogroup" aria-label={t("gsv2.sets.reportTitle")}>
          {REASONS.map((r) => (
            <label key={r} className="flex items-center gap-2">
              <input type="radio" name={`reason-${generationId}`} checked={reason === r} onChange={() => setReason(r)} />
              {t(`gsv2.sets.reason.${r}`)}
            </label>
          ))}
        </div>
        <Textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("gsv2.sets.reportComment")} aria-label={t("gsv2.sets.reportComment")} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
          <Button size="sm" onClick={() => void send()} disabled={busy || !reason}>{t("gsv2.sets.reportSend")}</Button>
        </div>
      </div>
    </Modal>
  );
}
