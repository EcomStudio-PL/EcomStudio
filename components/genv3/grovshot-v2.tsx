"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Info, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PanelSection } from "@/components/genv3/controls";
import { cn } from "@/lib/utils";
import { V2_DESCRIPTION_MAX, type V2Dims } from "@/lib/generator/studio";
import { GROVSHOT_V2_STOP_CODES } from "@/lib/grovshot-v2/stages";

/**
 * GROVBASE SHOT V2 — the panel's only new pieces (spec + brief §15): the
 * Allegro description, optional dimensions, and what the engine said about
 * the photos and the order. Everything the customer reads here is i18n text
 * chosen by a CODE the server sent — never model prose.
 */

const UNITS: V2Dims["unit"][] = ["cm", "mm", "m", "in"];

export function V2Fields({ description, onDescription, dims, onDims, dimsOpen, onDimsOpen }: {
  description: string; onDescription: (v: string) => void;
  dims: V2Dims | null; onDims: (d: V2Dims | null) => void;
  dimsOpen: boolean; onDimsOpen: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const d = dims ?? { width: "", depth: "", height: "", unit: "cm" as const };
  const set = (patch: Partial<V2Dims>) => onDims({ ...d, ...patch });
  const nearCap = description.length > V2_DESCRIPTION_MAX * 0.9;
  return (
    <>
      <PanelSection title={t("gsv2.descLabel")} data="gsv2-description"
        aside={description.length > 0 ? `${description.length}/${V2_DESCRIPTION_MAX}` : undefined}>
        <Textarea data-gsv2-description value={description} maxLength={V2_DESCRIPTION_MAX}
          onChange={(e) => onDescription(e.target.value)} aria-label={t("gsv2.descLabel")}
          placeholder={t("gsv2.descPh")} rows={5}
          className={cn("min-h-[7.5rem] resize-y text-[13px]", nearCap && "border-[rgb(var(--accent2)/0.55)]")} />
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{t("gsv2.descHint")}</p>
      </PanelSection>
      {dimsOpen ? (
        <PanelSection title={t("gsv2.dimsLabel")} optional data="gsv2-dimensions">
          <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,0.8fr)] gap-2">
            {(["width", "depth", "height"] as const).map((k) => (
              <label key={k} className="min-w-0">
                <span className="mb-1 block truncate text-[11px] font-medium text-faint">{t(`gsv2.dim.${k}`)}</span>
                <Input data-gsv2-dim={k} inputMode="decimal" value={d[k]} placeholder="—"
                  onChange={(e) => set({ [k]: e.target.value.replace(/[^0-9.,]/g, "").slice(0, 8) })}
                  className="px-2.5 py-2 text-[13px]" />
              </label>
            ))}
            <label className="min-w-0">
              <span className="mb-1 block truncate text-[11px] font-medium text-faint">{t("gsv2.dim.unit")}</span>
              <Select data-gsv2-dim="unit" value={d.unit} onChange={(e) => set({ unit: e.target.value as V2Dims["unit"] })}
                className="px-2.5 py-2 text-[13px]">
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </label>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{t("gsv2.dimsHint")}</p>
          <button type="button" onClick={() => { onDims(null); onDimsOpen(false); }}
            className="mt-1 text-[11.5px] font-semibold text-faint transition-colors hover:text-accent">{t("gsv2.dimsRemove")}</button>
        </PanelSection>
      ) : (
        <button type="button" data-gsv2-add-dims onClick={() => onDimsOpen(true)}
          className="flex items-center gap-1.5 self-start text-[12.5px] font-semibold text-accent transition-opacity hover:opacity-75">
          <Plus size={14} aria-hidden />{t("gsv2.addDims")}
        </button>
      )}
    </>
  );
}

/** The dimensions as the order sends them (numbers, a unit), or null. */
export function dimsForOrder(d: V2Dims | null): { width?: number; depth?: number; height?: number; unit: V2Dims["unit"] } | null {
  if (!d) return null;
  const num = (s: string) => {
    const v = Number(s.replace(",", "."));
    return s.trim() && Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const out = { width: num(d.width), depth: num(d.depth), height: num(d.height), unit: d.unit };
  return out.width || out.depth || out.height ? out : null;
}

/* ── the order's status ───────────────────────────────────────────────── */

export type V2Note = { code: string; photo?: number; row?: number; ask?: boolean };
export type V2Shot = { shot: number; state: string; reason: string | null; refunded: boolean; job_id: string | null };
export type V2Status = {
  id: string; status: string; stage: string | null; error: string | null;
  shots: V2Shot[]; ordered: number | null; notes: V2Note[];
};

/** Follows the LAST order this panel started (its status read also keeps a
 *  stalled order moving). Stops once it has ended. */
export function useV2Order() {
  const [order, setOrder] = useState<V2Status | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poll = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/grovshot/runs/${id}`, { cache: "no-store" });
      const json = await res.json() as { ok?: boolean; run?: V2Status };
      if (json.ok && json.run) {
        setOrder(json.run);
        if (json.run.status !== "queued" && json.run.status !== "running") return;
      }
    } catch { /* the next tick asks again */ }
    timer.current = setTimeout(() => { void poll(id); }, 4_000);
  }, []);
  useEffect(() => {
    if (!runId) return;
    void poll(runId);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [runId, poll]);
  return {
    order,
    track: (id: string) => { setOrder(null); setRunId(id); },
    clear: () => { if (timer.current) clearTimeout(timer.current); setRunId(null); setOrder(null); },
  };
}


/** What the engine said: per-photo notes, why it stopped (before anything
 *  was charged), and — when it ended — how many shots arrived and why the
 *  rest did not. */
export function V2Notes({ order, onContinue, busy }: { order: V2Status | null; onContinue: () => void; busy: boolean }) {
  const { t } = useI18n();
  if (!order) return null;
  const stopped = order.status === "blocked" && order.error && GROVSHOT_V2_STOP_CODES.has(order.error);
  const finished = order.status === "ok" || order.status === "partial" || order.status === "failed";
  const delivered = order.shots.filter((s) => s.state === "delivered").length;
  const missed = order.shots.filter((s) => s.state === "not_delivered");
  const notes = order.notes.filter((n) => t(`gsv2.note.${n.code}`, {}) !== `gsv2.note.${n.code}`);
  if (!stopped && notes.length === 0 && !(finished && missed.length > 0)) return null;
  const askable = stopped && order.error !== "blocked_input";
  return (
    <section data-gsv2-notes role="status"
      className={cn("rounded-xl border px-3 py-2.5 text-[12.5px] leading-relaxed",
        stopped ? "border-[rgb(var(--accent2)/0.45)] bg-[rgb(var(--accent2)/0.07)]" : "border-line bg-sunken/60")}>
      {stopped && (
        <p className="mb-1.5 flex items-start gap-2 font-semibold">
          <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0 text-accent2" />
          {t(`gsv2.stop.${order.error}`)}
        </p>
      )}
      {notes.length > 0 && (
        <ul className="space-y-1">
          {notes.map((n, i) => (
            <li key={`${n.code}:${n.photo ?? n.row ?? i}`} data-gsv2-note={n.code} className="flex items-start gap-2">
              <Info size={13} aria-hidden className={cn("mt-0.5 shrink-0", n.ask ? "text-accent2" : "text-faint")} />
              <span>{t(`gsv2.note.${n.code}`, { n: n.photo ?? n.row ?? "" })}</span>
            </li>
          ))}
        </ul>
      )}
      {finished && missed.length > 0 && (
        <p data-gsv2-summary className="mt-1.5">
          {t("gsv2.summary", { k: delivered, n: order.shots.length })}{" "}
          {missed.some((s) => s.reason === "quality_failed") && t("gsv2.missedQuality")}{" "}
          {missed.some((s) => s.refunded) ? t("gsv2.missedRefunded") : t("gsv2.missedNotCharged")}
        </p>
      )}
      {askable && (
        <button type="button" data-gsv2-continue disabled={busy} onClick={onContinue}
          className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
          {t("gsv2.continue")}
        </button>
      )}
    </section>
  );
}
