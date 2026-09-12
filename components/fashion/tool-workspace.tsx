"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "@/lib/notify";
import { Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { PhotoUploader, DropOverlay, useFileDrop } from "@/components/genv3/uploader";
import { GenerationGallery } from "@/components/genv3/gallery";
import { Dropdown } from "@/components/ui/dropdown";
import { InfoHint } from "@/components/ui/hint";
import { RatioValue, ratioIcon, ratioName } from "@/components/genv3/ratio-options";
import { FASHION_HINT_MAX, type FashionSlotKey, type FashionToolConfig } from "@/lib/fashion-tools";
import { cn } from "@/lib/utils";
import type { GalleryItem, UploadedRef } from "@/components/genv3/types";

/**
 * MODA — one panel for all four tools.
 *
 * The brief supplied two reference screenshots and three of the four tools use
 * the first one: an upload block, a size, a framing, an optional hint, the two
 * figures and the button. The fourth ("Zmiana postaci") replaces the single
 * upload block with TWO — a garment and a person — and drops the controls its
 * reference does not show.
 *
 * That is one component, not four. Copying a panel per tool would mean four
 * places to fix one padding and four chances for them to drift into looking
 * like four different products; the shape comes from `config.slots` and the
 * three `show*` flags instead. Geometry, tokens, radii and spacing are taken
 * verbatim from the retouch panel, which is the screenshot's own source, so
 * nothing here introduces a new colour or a new measurement.
 *
 * TWO POOLS STAY TWO POOLS. A dual-input tool keeps its uploads in separate
 * lists and posts them under separate names, because the server has to know
 * which photograph is the garment and which is the person. Flattening them
 * into one array would be a silent, unrecoverable loss of meaning.
 *
 * ONE RUN PER CLICK. `running` is a ref, not state: a second click that lands
 * before React re-renders would otherwise start a second paid batch.
 */

/** Batch size in flight. Enough to feel like a batch, few enough that one
 *  seller does not look like a denial-of-service to the provider. */
const CONCURRENCY = 2;

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 10 * 1024 * 1024;

type JobState = {
  key: string;
  /** The storage paths this job was built from, by pool. */
  inputs: Record<string, string[]>;
  /** Local preview of the leading source, so a card shows what is being made. */
  url: string;
  status: "queued" | "processing" | "completed" | "failed";
  error?: string;
};

type Pools = Record<string, UploadedRef[]>;

export function FashionToolWorkspace({
  config, workspaceId, credits, available, resolutions, ratios, pricing,
  initialItems, initialCursor,
}: {
  config: FashionToolConfig;
  workspaceId: string;
  credits: number;
  /** False when the tool has no engine or no published prompt yet — the panel
   *  says so honestly instead of offering a button that cannot work. */
  available: boolean;
  resolutions: string[];
  ratios: string[];
  /** Size → credits per image, already carrying the operator's own override.
   *  Never a literal in this component: the price is the operator's to set. */
  pricing: Record<string, number>;
  initialItems: GalleryItem[];
  initialCursor: string | null;
}) {
  const { t, locale } = useI18n();

  const [pools, setPools] = useState<Pools>(() =>
    Object.fromEntries(config.slots.map((slot) => [slot.key, [] as UploadedRef[]])));
  const [uploading, setUploading] = useState(false);
  const [resolution, setResolution] = useState(
    () => (resolutions.includes("2K") ? "2K" : resolutions[0] ?? "1K"));
  const [format, setFormat] = useState(config.defaultFormat);
  const [hint, setHint] = useState("");
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState(credits);
  const [freshItems, setFreshItems] = useState<GalleryItem[]>([]);

  const knownAssets = useRef(new Set<string>(initialItems.map((i) => i.assetId)));
  const folder = useRef(`${config.operation}-${Math.random().toString(36).slice(2, 10)}`);
  const reserved = useRef<Record<string, number>>({});
  const inFlight = useRef(0);
  const running = useRef(false);

  /**
   * HOW MANY RESULTS THIS RUN PRODUCES.
   *
   * A single-input tool makes one result per photograph. A paired tool makes
   * one result per combination the seller actually set up — with one garment
   * and three people that is three results, and the price has to say three
   * before the button is pressed, not after.
   */
  const runCount = useMemo(() => {
    const counts = config.slots.map((slot) => pools[slot.key]?.length ?? 0);
    if (counts.some((c) => c === 0)) return 0;
    return counts.reduce((a, b) => Math.max(a, b), 0);
  }, [config.slots, pools]);

  const perImage = pricing[resolution] ?? Object.values(pricing)[0] ?? 0;
  const total = perImage * runCount;
  const missing = Math.max(0, total - balance);
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);

  /** Pools that still need a photograph before the button may light up. */
  const emptyRequired = config.slots.filter(
    (slot) => slot.required && (pools[slot.key]?.length ?? 0) === 0);

  // ── Upload: the same three ways in, per pool ─────────────────────────────
  const upload = useCallback(async (slotKey: FashionSlotKey, files: File[]) => {
    const slot = config.slots.find((s) => s.key === slotKey);
    if (!slot) return;
    const supabase = createClient();
    const held = reserved.current[slotKey] ?? 0;
    const room = Math.max(0, slot.max - (pools[slotKey]?.length ?? 0) - held);
    if (files.length > room) toast.error(t("genv3.capReached", { max: slot.max }));
    if (room === 0) return;

    const batch = files.slice(0, room);
    reserved.current[slotKey] = held + batch.length;
    inFlight.current += 1;
    setUploading(true);
    try {
      for (const file of batch) {
        if (!ACCEPTED.includes(file.type)) { toast.error(t("products.invalidType")); continue; }
        if (file.size > MAX_BYTES) { toast.error(t("products.tooLarge")); continue; }
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${workspaceId}/${folder.current}/${slotKey}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file);
        if (error) { toast.error(t("fashion.uploadFailed")); continue; }
        setPools((prev) => {
          const current = prev[slotKey] ?? [];
          if (current.length >= slot.max) return prev;
          return { ...prev, [slotKey]: [...current, { key: path, path, url: URL.createObjectURL(file) }] };
        });
      }
    } finally {
      reserved.current[slotKey] = Math.max(0, (reserved.current[slotKey] ?? 0) - batch.length);
      inFlight.current -= 1;
      if (inFlight.current === 0) setUploading(false);
    }
  }, [config.slots, pools, workspaceId, t]);

  /** A page-wide drop lands in the FIRST pool: with two blocks on screen the
   *  drop target is ambiguous, and guessing wrong puts a person's photograph
   *  in the garment pool. The per-block targets below stay exact. */
  const dragging = useFileDrop({
    enabled: !busy,
    onDrop: (files) => {
      if (files.length === 0) { toast.error(t("products.invalidType")); return; }
      void upload(config.slots[0]!.key, files);
    },
  });

  const removeAt = useCallback((slotKey: string, index: number) => {
    setPools((prev) => ({ ...prev, [slotKey]: (prev[slotKey] ?? []).filter((_, i) => i !== index) }));
  }, []);

  /** Pull freshly stored results into the gallery the moment they exist. */
  const absorb = useCallback(async (expect: number) => {
    try {
      const res = await fetch(
        `/api/generations?op=${encodeURIComponent(config.operation)}&limit=${Math.min(expect + 2, 24)}`,
        { cache: "no-store" });
      const json = await res.json() as { ok: boolean; items?: GalleryItem[] };
      if (!json.ok || !json.items) return;
      const fresh = json.items.filter((i) => !knownAssets.current.has(i.assetId));
      if (fresh.length === 0) return;
      fresh.forEach((i) => { i.fresh = true; knownAssets.current.add(i.assetId); });
      setFreshItems((prev) => [...fresh, ...prev]);
    } catch { /* the card appears on the next page load */ }
  }, [config.operation]);

  const errText = useCallback((code?: string) => {
    const known = code ? t(`studio.err.${code}`, {}) : "";
    return known && known !== `studio.err.${code}` ? known : t("common.error");
  }, [t]);

  const runOne = useCallback(async (job: JobState) => {
    setJobs((prev) => prev.map((j) => j.key === job.key ? { ...j, status: "processing", error: undefined } : j));
    try {
      const res = await fetch("/api/fashion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: config.key,
          inputs: job.inputs,
          resolution: config.showResolution ? resolution : undefined,
          format: config.showFormat ? format : undefined,
          hint: config.showHint ? hint.trim().slice(0, FASHION_HINT_MAX) : undefined,
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string; credits?: number };
      if (json.ok) {
        setBalance((b) => Math.max(0, b - (json.credits ?? perImage)));
        await absorb(1);
        setJobs((prev) => prev.map((j) => j.key === job.key ? { ...j, status: "completed" } : j));
        return true;
      }
      setJobs((prev) => prev.map((j) => j.key === job.key ? { ...j, status: "failed", error: errText(json.error) } : j));
      return false;
    } catch {
      setJobs((prev) => prev.map((j) => j.key === job.key ? { ...j, status: "failed", error: t("common.error") } : j));
      return false;
    }
  }, [config, resolution, format, hint, perImage, absorb, errText, t]);

  /**
   * Build the batch. Each job carries one photograph from every pool: index i
   * of each, with a shorter pool reusing its last entry — one garment against
   * three people is three jobs, and the garment is the same in all three.
   */
  const buildBatch = useCallback((): JobState[] => {
    const stamp = Date.now();
    return Array.from({ length: runCount }, (_, i) => {
      const inputs: Record<string, string[]> = {};
      for (const slot of config.slots) {
        const pool = pools[slot.key] ?? [];
        const pick = pool[Math.min(i, pool.length - 1)];
        if (pick) inputs[slot.key] = [pick.path];
      }
      const lead = pools[config.slots[0]!.key] ?? [];
      const preview = lead[Math.min(i, lead.length - 1)];
      return { key: `${config.key}-${i}-${stamp}`, inputs, url: preview?.url ?? "", status: "queued" as const };
    });
  }, [config, pools, runCount]);

  async function runAll() {
    // Guarded against the double click that would otherwise pay twice.
    if (running.current || runCount === 0) return;
    running.current = true;
    setBusy(true);
    const batch = buildBatch();
    setJobs(batch);
    let done = 0, failed = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < batch.length) {
        const job = batch[cursor++]!;
        const ok = await runOne(job);
        if (ok) done++; else failed++;
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
      if (failed > 0 && done === 0) toast.error(t("fashion.allFailed"));
      else if (failed > 0) toast.warning(t("fashion.someFailed", { n: failed }));
      else toast.success(t("fashion.done", { n: done }));
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  async function retry(job: JobState) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try { await runOne(job); } finally { setBusy(false); running.current = false; }
  }

  const canRun = available && !busy && !uploading && runCount > 0 && missing === 0;
  const pending = jobs.filter((j) => j.status !== "completed");
  const ctaLabel = t(`wf.moda.${config.key}.cta`);

  return (
    <div className={cn(
      "gen-shell-body relative grid min-w-0 items-start gap-5 pb-[var(--gen-page-bottom)] [&>*]:min-w-0",
      "lg:grid-cols-[clamp(380px,27vw,430px)_minmax(0,1fr)] lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0",
    )}>
      <DropOverlay show={dragging} title={t("fashion.dropTitle")} sub={t("fashion.dropSub")} />

      {/* ── LEFT: the tool ──────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <div className="panel thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto rounded-2xl p-4 sm:p-5 lg:pb-6">
          {/* One block per pool. Only the first claims the paste shortcut:
              a single Ctrl+V must not land the same image in both pools. */}
          {config.slots.map((slot, index) => (
            <PhotoUploader
              key={slot.key}
              items={pools[slot.key] ?? []}
              max={slot.max}
              uploading={uploading}
              capturePaste={index === 0}
              compact
              zone
              dropTarget={`fashion-${slot.key}`}
              zoneLabel={slot.zoneLabelKey ? t(slot.zoneLabelKey) : undefined}
              onFiles={(files) => void upload(slot.key, files)}
              onRemove={(i) => removeAt(slot.key, i)}
              label={t(slot.labelKey, { n: slot.max })}
            />
          ))}

          {(config.showResolution || config.showFormat) && (
            <section>
              <div className={cn(
                "grid gap-2 [&>*]:min-w-0",
                config.showResolution && config.showFormat ? "grid-cols-2" : "grid-cols-1",
              )}>
                {config.showResolution && (
                  <div className="rounded-xl border border-line bg-sunken/50 p-2">
                    <Dropdown
                      testId="resolution"
                      label={t("genv3.resolution")}
                      value={resolution}
                      options={resolutions.map((r) => ({
                        value: r, label: r, meta: t("genv3.creditsShort", { n: pricing[r] ?? 0 }),
                      }))}
                      onChange={setResolution}
                      panelWidth={210}
                    />
                  </div>
                )}
                {config.showFormat && (
                  <div className="rounded-xl border border-line bg-sunken/50 p-2">
                    <Dropdown
                      testId="format"
                      label={t("genv3.format")}
                      value={format}
                      options={[
                        {
                          value: "auto",
                          label: t("fashion.formatAuto"),
                          sub: t("fashion.formatAutoSub"),
                          icon: <Wand2 size={13} aria-hidden />,
                        },
                        ...ratios.map((r) => ({
                          value: r, label: ratioName(t, r), icon: ratioIcon(r),
                        })),
                      ]}
                      onChange={setFormat}
                      panelWidth={262}
                      renderValue={() => format === "auto" ? (
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Wand2 size={13} aria-hidden className="shrink-0 text-muted" />
                          <span className="min-w-0 truncate">{t("fashion.formatAuto")}</span>
                        </span>
                      ) : <RatioValue t={t} ratio={format} />}
                    />
                  </div>
                )}
              </div>
            </section>
          )}

          {config.showHint && (
            <section>
              <label htmlFor={`hint-${config.key}`}
                className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
                {t("fashion.hint")}
                <span className="text-faint">{t("fashion.hintOptional")}</span>
                <InfoHint text={t("fashion.hintInfo")} />
              </label>
              <div className="relative mt-1.5">
                <textarea
                  id={`hint-${config.key}`}
                  data-fashion-hint
                  value={hint}
                  maxLength={FASHION_HINT_MAX}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder={t("fashion.hintPlaceholder")}
                  rows={5}
                  className={cn(
                    "thin-scroll w-full resize-none rounded-xl border border-line bg-sunken/50 px-3 py-2.5 pb-7",
                    "text-[13px] leading-relaxed text-ink placeholder:text-faint",
                    "outline-none transition-colors focus:border-[rgb(var(--accent)/0.45)]",
                  )}
                />
                <span className="pointer-events-none absolute bottom-2 right-3 text-[10.5px] tabular-nums text-faint">
                  {n(hint.length)} / {n(FASHION_HINT_MAX)}
                </span>
              </div>
            </section>
          )}

          {!available && (
            <p className="rounded-xl bg-raised px-3.5 py-3 text-[12px] leading-relaxed text-muted"
              data-fashion-unavailable>
              {t("fashion.unavailable")}
            </p>
          )}
        </div>

        {/* ── The footer: two figures, a hairline, the action ───────────── */}
        <div className="panel relative z-20 shrink-0 rounded-2xl px-4 py-3">
          <div className="grid grid-cols-2 divide-x divide-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.4))]">
            <div className="min-w-0 px-2 text-center">
              <p className="text-[10px] font-medium leading-tight text-faint">{t("retouch.costPer")}</p>
              <p className="metric mt-0.5 text-[14px] leading-tight text-accent">
                {n(perImage)} <span className="text-[10px] font-semibold text-muted">{t("genv3.credits")}</span>
              </p>
            </div>
            <div className="min-w-0 px-2 text-center">
              <p className="text-[10px] font-medium leading-tight text-faint">{t("genv3.costTotal")}</p>
              <p className="metric mt-0.5 text-[14px] leading-tight text-accent">
                {n(total)} <span className="text-[10px] font-semibold text-muted">{t("genv3.credits")}</span>
              </p>
            </div>
          </div>
          {missing > 0 ? (
            <p className="mt-2 text-center text-[11px] font-medium text-danger">
              {t("studio.missing", { n: missing })}{" · "}
              <Link href="/credits" className="font-semibold text-accent hover:opacity-75">{t("credits.topup")}</Link>
            </p>
          ) : emptyRequired.length > 0 ? (
            <p className="mt-2 text-center text-[11px] text-muted" data-fashion-need>
              {t(`fashion.need.${emptyRequired[0]!.key}`)}
            </p>
          ) : (
            <p className="mt-2 text-center text-[10.5px] tabular-nums text-faint">{t("gtb.balance", { n: n(balance) })}</p>
          )}
          <button type="button" disabled={!canRun} onClick={runAll} data-fashion-cta
            aria-label={`${ctaLabel} · ${n(total)} ${t("genv3.credits")}`}
            className={cn(
              "cta mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold",
              !canRun && "cursor-not-allowed opacity-55",
            )}>
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
            <span>{ctaLabel}</span>
            {total > 0 && <><span aria-hidden className="opacity-60">•</span><span className="tabular-nums">{n(total)}</span></>}
          </button>
        </div>
      </div>

      {/* ── RIGHT: jobs in flight, then everything this tool has made ───── */}
      <div className="thin-scroll min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4 lg:pr-1">
        {pending.length > 0 && (
          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-fashion-jobs>
            {pending.map((job) => (
              <div key={job.key} data-fashion-job={job.status}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface/60 p-2">
                {job.url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={job.url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover opacity-70" />
                  : <span className="h-14 w-14 shrink-0 rounded-lg bg-raised" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                    {job.status !== "failed" && <Loader2 size={12} className="animate-spin text-accent" aria-hidden />}
                    {t(`fashion.status_${job.status}`)}
                  </span>
                  {job.error && <span className="mt-0.5 block text-[11px] leading-snug text-danger">{job.error}</span>}
                </span>
                {job.status === "failed" && (
                  <button type="button" onClick={() => retry(job)} disabled={busy} data-fashion-retry
                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50">
                    <RefreshCw size={12} aria-hidden />{t("retouch.retry")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <GenerationGallery
          initialItems={initialItems}
          initialCursor={initialCursor}
          freshItems={freshItems}
          onFresh={setFreshItems}
          pendingCount={0}
          pendingRatio="1:1"
          models={[]}
          balance={balance}
          onBalance={setBalance}
          onAbsorb={absorb}
          operation={config.operation}
          emptyTitle={t("fashion.emptyTitle")}
          emptyBody={t(`wf.moda.${config.key}.empty`)}
        />
      </div>
    </div>
  );
}
