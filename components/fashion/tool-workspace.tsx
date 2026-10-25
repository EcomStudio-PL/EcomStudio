"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/notify";
import { Sparkles, Wand2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { PhotoUploader, DropOverlay, useFileDrop } from "@/components/genv3/uploader";
import { GenerationGallery } from "@/components/genv3/gallery";
import { InfoHint } from "@/components/ui/hint";
import { ratioName } from "@/components/genv3/ratio-options";
import { Segmented } from "@/components/ui/segmented";
import { FormatTiles, PanelSection, fmtDefault, useDeltaMeta } from "@/components/genv3/controls";
import { FASHION_HINT_MAX, type FashionSlotKey, type FashionToolConfig } from "@/lib/fashion-tools";
import { cn } from "@/lib/utils";
import type { GalleryItem, UploadedRef } from "@/components/genv3/types";
import { refSource, useToolSession } from "@/components/public-tools/use-tool-session";
import { ToolDraftBanner } from "@/components/public-tools/tool-notice";
import { frozenSnapshot } from "@/lib/inflight/store";
import { enqueueBatch } from "@/lib/inflight/queue";
import { useInflightGate } from "@/components/inflight/use-inflight-gate";
import { limitText } from "@/components/inflight/inflight-tile";
import { reorder } from "@/components/genv3/sortable-photos";
import { useFormatUses, useReorderHint } from "@/components/tool-guide/use-reorder-hint";
import { ToolColumns, ToolFrame, useToolFrameController } from "@/components/tool-frame/frame";
import { GenerateBar, useBarLine } from "@/components/generate/generate-bar";
import { isGuideTool } from "@/lib/tool-guides";

/**
 * MODA — one panel for every tool in the category.
 *
 * The brief supplied two reference screenshots and the three single-input tools
 * use the first one: an upload block, a size, a framing, an optional hint, the
 * two figures and the button. The PAIRED ones replace the single upload block
 * with TWO — a garment and a person for "Zmiana postaci", a photograph and a
 * face for "Zmiana twarzy modela" — and each drops or adds the controls its own
 * reference shows.
 *
 * That is one component, not one per tool. Copying the panel per tool would
 * mean a place per tool to fix one padding and a chance per tool for them to
 * drift into looking like separate products; the shape comes from
 * `config.slots` and the flags beside it instead. Geometry, tokens, radii and
 * spacing are taken verbatim from the retouch panel, which is the screenshot's
 * own source, so nothing here introduces a new colour or a new measurement.
 *
 * THE TWO PAIRED TOOLS DO NOT LOOK THE SAME, and that is configuration rather
 * than drift: one is numbered with a counter in the box, the other names the
 * pool and its capacity in the heading. See `numberedSteps` and `denseZones`
 * in lib/fashion-tools.ts.
 *
 * TWO POOLS STAY TWO POOLS. A dual-input tool keeps its uploads in separate
 * lists and posts them under separate names, because the server has to know
 * which photograph is which — a garment is not a person and a photograph is
 * not a face. Flattening them into one array would be a silent, unrecoverable
 * loss of meaning.
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
  /** Local preview of the leading source, so a tile shows what is being made. */
  url: string;
};

type Pools = Record<string, UploadedRef[]>;

export function FashionToolWorkspace({
  config, workspaceId, credits, available, resolutions, ratios, pricing, outputsPerRun = 1,
  initialItems, initialCursor, back, title,
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
  /** Results ONE run delivers: 1, or the published workflow's count when the
   *  tool runs a workflow — the price below is per run, like the charge. */
  outputsPerRun?: number;
  initialItems: GalleryItem[];
  initialCursor: string | null;
  back: { href: string; label: string };
  title: string;
}) {
  const { t, locale } = useI18n();
  const frame = useToolFrameController();
  const delta = useDeltaMeta();

  const [pools, setPools] = useState<Pools>(() =>
    Object.fromEntries(config.slots.map((slot) => [slot.key, [] as UploadedRef[]])));
  const [uploading, setUploading] = useState(false);
  const [resolution, setResolution] = useState(
    () => (resolutions.includes("2K") ? "2K" : resolutions[0] ?? "1K"));
  const [format, setFormat] = useState(config.defaultFormat);
  const [hint, setHint] = useState("");
  const [balance, setBalance] = useState(credits);
  const [freshItems, setFreshItems] = useState<GalleryItem[]>([]);

  const knownAssets = useRef(new Set<string>(initialItems.map((i) => i.assetId)));
  const folder = useRef(`${config.operation}-${Math.random().toString(36).slice(2, 10)}`);
  const reserved = useRef<Record<string, number>>({});
  const inFlight = useRef(0);
  const running = useRef(false);
  // Generacje w toku V2: the plan's limit, "Dodano ✓", the server's balance.
  const gate = useInflightGate();
  const reorderHint = useReorderHint(isGuideTool(config.toolKey) ? config.toolKey : "generator");
  const formatUses = useFormatUses(isGuideTool(config.toolKey) ? config.toolKey : "generator");
  useEffect(() => { if (gate.balance !== null) setBalance(gate.balance); }, [gate.balance, gate.balanceAt]);

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

  const perImage = (pricing[resolution] ?? Object.values(pricing)[0] ?? 0) * Math.max(1, outputsPerRun);
  const total = perImage * runCount;
  const missing = Math.max(0, total - balance);
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);

  /** Pools that still need a photograph before the button may light up. */
  const emptyRequired = config.slots.filter(
    (slot) => slot.required && (pools[slot.key]?.length ?? 0) === 0);

  /*
    PUBLIC TOOLS V1. A visitor prepares the tool exactly as a member does —
    every pool's photos stay in the browser (never Storage), Generate opens the
    sign-in dialog — and once signed in the same photos go back into their own
    pools through `upload` below, like any picked by hand. Without a viewer (no
    provider) nothing changes.
  */
  // `upload` is declared below and reaches the restore through a ref: a saved
  // preparation is put back once, when the panel mounts.
  const uploadRef = useRef<(slotKey: FashionSlotKey, files: File[]) => Promise<void>>(async () => {});
  const session = useToolSession({
    settings: { resolution, format, hint },
    // A source id names its pool, so two pools never trade photographs.
    sources: config.slots.flatMap((slot) => (pools[slot.key] ?? [])
      .map((ref) => ({ ...refSource(ref), id: `${slot.key}:${ref.key}` }))),
    apply: (saved: { resolution?: string; format?: string; hint?: string }, files: File[], ids: string[]) => {
      if (saved.resolution && resolutions.includes(saved.resolution)) setResolution(saved.resolution);
      if (saved.format && (saved.format === "auto" || ratios.includes(saved.format))) setFormat(saved.format);
      if (typeof saved.hint === "string") setHint(saved.hint.slice(0, FASHION_HINT_MAX));
      void (async () => {
        for (const slot of config.slots) {
          const mine = files.filter((_, i) => ids[i]?.startsWith(`${slot.key}:`));
          if (mine.length > 0) await uploadRef.current(slot.key, mine);
        }
      })();
    },
  });

  // ── Upload: the same three ways in, per pool ─────────────────────────────
  const upload = useCallback(async (slotKey: FashionSlotKey, files: File[]) => {
    const slot = config.slots.find((s) => s.key === slotKey);
    if (!slot) return;
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
        if (session.guest) {
          // A visitor's photo is a local stand-in: no request of any kind.
          const ref = session.localRef(file);
          setPools((prev) => {
            const current = prev[slotKey] ?? [];
            if (current.length >= slot.max) return prev;
            return { ...prev, [slotKey]: [...current, ref] };
          });
          session.added(1);
          continue;
        }
        const supabase = createClient();
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
  }, [config.slots, pools, workspaceId, t, session]);
  uploadRef.current = upload;

  /** A page-wide drop lands in the FIRST pool: with two blocks on screen the
   *  drop target is ambiguous, and guessing wrong puts a person's photograph
   *  in the garment pool. The per-block targets below stay exact. */
  const dragging = useFileDrop({
    enabled: true,
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
      return { key: `${config.key}-${i}-${stamp}`, inputs, url: preview?.url ?? "" };
    });
  }, [config, pools, runCount]);

  /**
   * ONE CLICK (Generacje w toku V2): every combination is its own job, queued
   * two at a time, each frozen with THIS click's inputs and settings — a
   * tile's "Spróbuj ponownie" repeats exactly it. The panel stays as it is.
   */
  function runAll() {
    // Guarded against the double click that would otherwise pay twice.
    if (running.current || runCount === 0) return;
    running.current = true;
    session.ran();
    let refused = false;
    let shown = false;
    enqueueBatch({
      maxInFlight: CONCURRENCY,
      items: buildBatch().map((job) => ({
        snapshot: frozenSnapshot({
          endpoint: "/api/fashion", credits: perImage,
          body: {
            tool: config.key,
            inputs: job.inputs,
            resolution: config.showResolution ? resolution : undefined,
            format: config.showFormat ? format : undefined,
            hint: config.showHint ? hint.trim().slice(0, FASHION_HINT_MAX) : undefined,
            expectedOutputs: outputsPerRun,
          },
        }),
        tool: config.toolKey, operation: config.operation, expected: Math.max(1, outputsPerRun),
        ratio: config.showFormat ? format : null, preview: job.url || null,
      })),
      onAccepted: (out) => {
        setBalance((b) => Math.max(0, b - (out.credits || perImage)));
        if (!shown) { shown = true; frame.accepted(); }
      },
      onRefused: (out) => {
        if (refused) return;
        refused = true;
        toast.error(out.error === "concurrency_limit"
          ? limitText(t, locale, out.limit ?? gate.limit?.max ?? 1)
          : errText(out.error));
      },
    });
    gate.flash();
    setTimeout(() => { running.current = false; }, 600);
  }

  // A visitor's Generate is always the sign-in dialog, so their balance (none)
  // does not grey it out; a member's is the server-checked wallet, as before.
  const canRun = available && !gate.atLimit && !uploading && runCount > 0 && (session.guest || missing === 0);
  const ctaLabel = t(`wf.moda.${config.key}.cta`);

  /**
   * NUMBERED MODE MOVES THE WORDING, it does not just add a digit.
   *
   * Off (the default): the heading names the pool and its capacity — "Zdjęcie
   * referencyjne (max. 10)" — and the box carries the instruction, "Dodaj
   * zdjęcie referencyjne".
   *
   * On: the heading carries the numbered instruction — "1. Dodaj zdjęcie
   * referencyjne" — and the box falls back to the plain "Import" with its
   * counter, which is then the only place the capacity is written. That is
   * why `denseZones` (which removes the counter) must stay OFF wherever this
   * is on: together they would take the capacity off the screen entirely.
   *
   * `step` numbers the controls after the pools, so a two-pool tool with one
   * dropdown ends at "3. Format" and one with two ends at "4. Format".
   */
  const step = (n: number) => config.numberedSteps ? `${config.slots.length + n}. ` : "";

  /**
   * The AI card's body: the tool's OWN sentence about what happens after the
   * button, not its catalogue line. The `sub` is the pitch on the tile the
   * seller just clicked, so repeating it here says nothing new.
   *
   * NO RUNTIME FALLBACK, deliberately. `t()` humanizes a missing key rather
   * than returning it (lib/i18n/t.ts), so a component cannot tell "absent"
   * from "present" and any fallback written here would be dead code that
   * silently rendered "Ai note". The guarantee belongs where it can be
   * enforced: `scripts/fashion-tests.ts` fails if a tool sets `showAiNote`
   * without an `aiNote` entry in all three dictionaries — which `i18n:check`
   * cannot do for itself, because this key is interpolated.
   */
  const aiNoteBody = t(`wf.moda.${config.key}.aiNote`);

  const line = useBarLine({
    unavailable: !available ? t("fashion.unavailable") : null,
    invalid: emptyRequired.length > 0 ? t(`fashion.need.${emptyRequired[0]!.key}`) : uploading ? t("bar.uploading") : null,
    limit: gate.atLimit && gate.limit && !session.guest ? gate.limit : null,
    cost: total, balance, session,
  });
  // The size the panel opens on is the recommended one.
  const recommendedRes = resolutions.includes("2K") ? "2K" : resolutions[0] ?? "";
  const priceAt = (r: string) => (pricing[r] ?? 0) * Math.max(1, outputsPerRun);

  return (
    <ToolFrame frame={frame} tools={[config.toolKey]} back={back} title={<h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>}>
      <ToolColumns
        // THE SETTINGS COLUMN IS A WIDTH, NOT A SHARE: what the controls need,
        // every further pixel to the gallery (unchanged from before).
        cols="lg:grid-cols-[clamp(300px,23vw,330px)_minmax(0,1fr)]"
        overlay={<DropOverlay show={dragging} title={t("fashion.dropTitle")} sub={t("fashion.dropSub")} />}
        panel={(
          <>
            <ToolDraftBanner session={session} />
            {/* One block per pool; only the first claims the paste shortcut.
                The heading names the pool, the box says what to do with it —
                unless the tool is numbered (see `step`). */}
            {config.slots.map((slot, index) => (
              <PhotoUploader
                preview
                key={slot.key}
                items={pools[slot.key] ?? []}
                max={slot.max}
                uploading={uploading}
                capturePaste={index === 0}
                compact
                zone
                dropTarget={`fashion-${slot.key}`}
                zoneLabel={config.numberedSteps || !slot.zoneLabelKey ? undefined : t(slot.zoneLabelKey)}
                zoneDense={config.denseZones}
                onFiles={(files) => void upload(slot.key, files)}
                onRemove={(i) => removeAt(slot.key, i)}
                // Each pool keeps its own order — a garment never trades places
                // with a person.
                onMove={slot.max > 1 ? (from, to) => setPools((prev) => ({ ...prev, [slot.key]: reorder(prev[slot.key] ?? [], from, to) })) : undefined}
                reorderHint={reorderHint}
                label={config.numberedSteps && slot.zoneLabelKey
                  ? `${index + 1}. ${t(slot.zoneLabelKey)}`
                  : t(slot.labelKey, { n: slot.max })}
              />
            ))}

            {config.showResolution && resolutions.length > 0 && (
              <PanelSection title={`${step(1)}${t("genv3.resolution")}`} data="resolution">
                <Segmented label={t("genv3.resolution")} value={resolution} onChange={setResolution}
                  options={resolutions.map((r) => ({ value: r, label: r, meta: delta(priceAt(r), priceAt(recommendedRes), r === recommendedRes) }))} />
              </PanelSection>
            )}
            {config.showFormat && (
              <PanelSection title={`${step(config.showResolution ? 2 : 1)}${t("genv3.format")}`} data="format">
                <FormatTiles label={t("genv3.format")} value={format} onChange={setFormat}
                  options={[
                    { value: "auto", label: t("fashion.formatAuto"), icon: <Wand2 size={16} aria-hidden />,
                      use: formatUses?.auto ?? t("fashion.formatAutoSub") },
                    ...ratios.map((r) => ({ value: r, ratio: r, label: ratioName(t, r), use: formatUses?.[r] ?? fmtDefault(t, r) })),
                  ]} />
              </PanelSection>
            )}

            {config.showHint && (
              <section>
                <label htmlFor={`hint-${config.key}`}
                  className="flex items-center gap-1.5 text-[14px] font-semibold tracking-tight">
                  {t("fashion.hint")}
                  <span className="font-normal text-faint">{t("fashion.hintOptional")}</span>
                  <InfoHint text={t("fashion.hintInfo")} />
                </label>
                <div className="relative mt-2">
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

            {/* WHAT THIS TOOL DOES — the tool's own sentence (`aiNote`), as a
                line of copy rather than a card. */}
            {config.showAiNote && (
              <section data-fashion-ai-note>
                <p className="flex items-center gap-1.5 text-[14px] font-semibold tracking-tight">
                  <Sparkles size={14} aria-hidden className="text-accent" />
                  {t("fashion.aiNoteTitle")}
                  <InfoHint text={t("fashion.aiNoteHint")} />
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{aiNoteBody}</p>
              </section>
            )}
          </>
        )}
        bar={(
          <GenerateBar
            label={ctaLabel}
            total={total}
            breakdown={[t("bar.photos", { n: n(runCount), p: n(perImage) })]}
            state={gate.added ? "added" : "idle"}
            blocked={!canRun}
            onGenerate={() => void session.gate(runAll)}
            line={line}
            ctaAttrs={{ "data-fashion-cta": true }}
          />
        )}
        gallery={(
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
            inflight={{ tools: [config.toolKey] }}
            emptyTitle={t("fashion.emptyTitle")}
            emptyBody={t(`wf.moda.${config.key}.empty`)}
          />
        )}
      />
    </ToolFrame>
  );
}
