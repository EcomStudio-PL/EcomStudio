"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PenLine, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { GenerationGallery } from "@/components/genv3/gallery";
import { InspirationSection, ProductRefsSection, PromptSection, VariantChips } from "@/components/genv3/sections";
import {
  FormatTiles, MoreSettings, PanelSection, ScenarioCards, ShotPlan, Stepper, fmtDefault, useDeltaMeta, type FormatOption,
} from "@/components/genv3/controls";
import { Segmented } from "@/components/ui/segmented";
import { ModelSelect } from "@/components/genv3/model-select";
import { ratioName } from "@/components/genv3/ratio-options";
import { InspirationLibraryModal } from "@/components/genv3/inspiration-library";
import { DropOverlay, useFileDrop } from "@/components/genv3/uploader";
import { useHomeHandoff } from "@/lib/home-handoff";
import { useSmartPrompt } from "@/components/genv3/smart-prompt";
import type { SmartPromptOffer } from "@/lib/smart-prompt";
import { cn } from "@/lib/utils";
import {
  defaultRatio, snapQuality, snapRatio, snapTo, unitPrice,
  type GalleryItem, type GenModel, type UploadedRef,
} from "@/components/genv3/types";
import type { CategoryVariant } from "@/lib/categories";
import type { SessionPreviewMap } from "@/components/genv3/sections";
import { refSource, useToolSession } from "@/components/public-tools/use-tool-session";
import { ToolDraftBanner } from "@/components/public-tools/tool-notice";
import { frozenSnapshot as frozen, submitTracked } from "@/lib/inflight/store";
import { enqueueBatch } from "@/lib/inflight/queue";
import { useInflightGate } from "@/components/inflight/use-inflight-gate";
import { reorder } from "@/components/genv3/sortable-photos";
import { useFormatUses, useReorderHint } from "@/components/tool-guide/use-reorder-hint";
import { limitText } from "@/components/inflight/inflight-tile";
import { ToolColumns, ToolFrame, useToolFrameController } from "@/components/tool-frame/frame";
import { GenerateBar, useBarLine } from "@/components/generate/generate-bar";
import {
  SHOTS_DEFAULT, SHOTS_MAX, SHOTS_MIN, STUDIO_MAX_REFS, customPhotoBudget, dropPhoto, parseTab, patchRow,
  planToBriefs, readStudioDraft, remapPhotos,
  type GrovshotSettings, type StudioDraft, type StudioTab, type StworzSettings,
} from "@/lib/generator/studio";

/** Reference photos one session may carry. */
const MAX_REFS = STUDIO_MAX_REFS;
/** Own-prompt length (the field scrolls inside itself; the cap guards the request). */
const PROMPT_MAX = 4000;
const INSP_MAX = 5;
const INSP = "insp:";

export type ManagedModeData = {
  models: GenModel[];
  engineAvailable: boolean;
  sessionPreviews?: SessionPreviewMap;
  variant?: CategoryVariant;
  initialStyle?: string;
  initialRatio?: string;
  initialShots?: number;
};

export type CustomModeData = {
  models: GenModel[];
  smartPrompt?: SmartPromptOffer;
  initialPrompt?: string;
};

/**
 * THE GENERATOR — GrovBase Shot 1.0 and Stwórz zdjęcie on ONE screen.
 *
 * The two modes used to be two pages, and switching was a full server
 * navigation that mounted a fresh panel: the photos, the prompt and every
 * setting were gone. Now both modes live in this one panel and the switch is
 * a client-side tab (`?tryb=grovshot|stworz`, kept in the URL with the
 * history API: direct links, refresh and Back all land on the right mode).
 *
 *   SHARED     the product photos — the same files, keys, thumbnails, order
 *              and upload state; nothing is uploaded again by a switch
 *   PER MODE   everything else: the prompt and inspiration (Stwórz), the
 *              scenario and the shot plan (GrovShot), and each mode's own
 *              model, format, size, quality and count
 *
 * The price on the Generate bar is always the ACTIVE mode's. Each click sends
 * a frozen snapshot (Generacje w toku V2); the panel is never cleared and the
 * work is kept as a draft (24 h, this browser, this account) so a refresh or a
 * return finds it again.
 *
 * A category workflow (/k/{cat}/{wf}) mounts the same panel with GrovShot
 * alone.
 */
export function GeneratorWorkspace({
  managed: managedData, custom: customData, initialTab, credits, workspaceId,
  initialItems, initialCursor, back, title, draftKey,
}: {
  managed?: ManagedModeData;
  custom?: CustomModeData;
  /** The mode this address opens on (`?tryb=` wins). */
  initialTab: StudioTab;
  credits: number;
  workspaceId: string;
  initialItems: GalleryItem[];
  initialCursor: string | null;
  /** The way back from this screen. */
  back: { href: string; label: string };
  /** The screen's name when there are no mode tabs. */
  title?: string;
  /** Keep a member's work as a draft under this key (the two-mode screen). */
  draftKey?: string;
}) {
  const { t, locale } = useI18n();
  const both = !!managedData && !!customData;
  const managedModels = useMemo(() => managedData?.models ?? [], [managedData]);
  const customModels = useMemo(() => customData?.models ?? [], [customData]);
  const variant = managedData?.variant;

  // ── the active mode, mirrored in ?tryb= ───────────────────────────────
  const search = useSearchParams();
  const urlTab = both ? parseTab(search?.get("tryb")) : null;
  const fallbackTab: StudioTab = managedData && customData ? initialTab : managedData ? "grovshot" : "stworz";
  const [tab, setTab] = useState<StudioTab>(urlTab ?? fallbackTab);
  // Back / Forward: the URL leads and the panel follows — including back to
  // the address without `?tryb=`, which is the page's own mode.
  useEffect(() => { setTab(urlTab ?? fallbackTab); }, [urlTab, fallbackTab]);
  /** Change the mode on the client. Native history: Next.js keeps its router
   *  in step (useSearchParams), nothing is fetched or rendered on the server,
   *  and the gallery, its filters and the running tiles stay as they are. */
  const switchTab = useCallback((next: StudioTab, how: "push" | "replace" = "push") => {
    setTab(next);
    const url = new URL(window.location.href);
    // Already the address's mode (with or without ?tryb=): no entry for Back.
    if ((parseTab(url.searchParams.get("tryb")) ?? fallbackTab) === next) return;
    url.searchParams.set("tryb", next);
    window.history[how === "push" ? "pushState" : "replaceState"](null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [fallbackTab]);
  const managed = tab === "grovshot";
  const toolKey = managed ? "prompts" : "generator";

  // ── defaults per mode (also what "Przywróć zalecane" returns to) ───────
  const grovDefaults = useCallback((): GrovshotSettings => {
    const m = managedModels[0];
    return {
      sessionType: "advertising",
      choices: Object.fromEntries((variant?.controls ?? []).filter((c) => c.initial).map((c) => [c.key, c.initial!])),
      modelId: m?.id ?? "",
      ratio: managedData?.initialRatio ?? defaultRatio(m?.ratios ?? []),
      resolution: m?.resolutions[0] ?? "1K",
      quality: "medium",
      count: Math.min(Math.max(managedData?.initialShots ?? SHOTS_DEFAULT, SHOTS_MIN), SHOTS_MAX),
      plan: [],
    };
  }, [managedModels, managedData, variant]);
  const stworzDefaults = useCallback((): StworzSettings => {
    const m = customModels[0];
    return {
      prompt: (customData?.initialPrompt ?? "").slice(0, PROMPT_MAX),
      modelId: m?.id ?? "",
      ratio: defaultRatio(m?.ratios ?? []),
      resolution: m?.resolutions[0] ?? "1K",
      quality: "medium",
      count: 1,
    };
  }, [customModels, customData]);

  // ── state: one photo pool, two modes ──────────────────────────────────
  const [refs, setRefs] = useState<UploadedRef[]>([]);
  const [insp, setInsp] = useState<UploadedRef[]>([]);
  const [grov, setGrov] = useState<GrovshotSettings>(grovDefaults);
  const [stw, setStw] = useState<StworzSettings>(stworzDefaults);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stageLabel, setStageLabel] = useState("");
  const [balance, setBalance] = useState(credits);
  const [preparing, setPreparing] = useState(false);
  const adhocFolder = useRef(`adhoc-${Math.random().toString(36).slice(2, 10)}`);
  const inspFolder = useRef(`insp-${Math.random().toString(36).slice(2, 10)}`);
  /** Slots claimed by uploads that have not reached state yet, per pool. */
  const reserved = useRef<{ refs: number; insp: number }>({ refs: 0, insp: 0 });
  const inFlight = useRef(0);
  /** "Wyczyść" bumps it: a restore still putting photos back stops there. */
  const restoreEpoch = useRef(0);
  const submitting = useRef(false);

  // ── gallery feed ──────────────────────────────────────────────────────
  const [freshItems, setFreshItems] = useState<GalleryItem[]>([]);
  const knownAssets = useRef(new Set<string>(initialItems.map((i) => i.assetId)));

  // ── Generacje w toku V2: the limit, "Dodano ✓", the balance ───────────
  const gate = useInflightGate();
  const reorderHint = useReorderHint(toolKey);
  const formatUses = useFormatUses(toolKey);
  useEffect(() => { if (gate.balance !== null) setBalance(gate.balance); }, [gate.balance, gate.balanceAt]);

  // ── the active mode's effective values (snapped to its model) ─────────
  const models = managed ? managedModels : customModels;
  const cfg = managed ? grov : stw;
  const model = useMemo(() => models.find((m) => m.id === cfg.modelId) ?? models[0], [models, cfg.modelId]);
  const effRatio = model ? snapRatio(model.ratios, cfg.ratio) : cfg.ratio;
  const effResolution = model ? snapTo(model.resolutions, cfg.resolution) : cfg.resolution;
  const effQuality = snapQuality(model, cfg.quality);
  const maxCount = managed ? SHOTS_MAX : Math.max(1, model?.maxOutputs ?? 1);
  const effCount = Math.min(Math.max(cfg.count, 1), maxCount);
  const perShot = unitPrice(model, effResolution, managed ? "managed" : "custom", effQuality);
  const total = perShot * effCount;
  const missing = Math.max(0, total - balance);
  /** How many product photos THIS mode sends (the rest stay, greyed). */
  const usable = managed ? MAX_REFS : customPhotoBudget(model, insp.length);

  const setCfg = (patch: Partial<GrovshotSettings & StworzSettings>) => {
    if (managed) setGrov((s) => ({ ...s, ...patch }));
    else setStw((s) => ({ ...s, ...patch }));
  };
  const setPrompt = useCallback((v: string) => setStw((s) => ({ ...s, prompt: v })), []);

  // ── Inteligentny prompt (Stwórz): rewrites land in the prompt itself ──
  const refPaths = useMemo(() => refs.map((r) => r.path).slice(0, MAX_REFS), [refs]);
  const smart = useSmartPrompt({
    value: stw.prompt, onChange: setPrompt, offer: customData?.smartPrompt,
    referencePaths: refPaths, onBalance: setBalance,
  });

  /*
    THE DRAFT. A visitor's work stays in the browser exactly as before (Public
    Tools V1) and opens the sign-in dialog at Generate. A member's is kept too
    (`draftKey`): both modes, the shared photos and their order — 24 h,
    this account only — and put back on the next visit with
    "Przywróciliśmy… · Wyczyść". A run does not drop it. The mode on screen
    is the address's, never the draft's.
  */
  const settings: StudioDraft = useMemo(() => ({ v: 3, grovshot: grov, stworz: stw }), [grov, stw]);
  const session = useToolSession({
    settings,
    sources: [...refs.map(refSource), ...insp.map((r) => ({ ...refSource(r), id: `${INSP}${r.key}` }))],
    memberDraft: draftKey ? { key: draftKey } : undefined,
    apply: (saved: unknown, files: File[], ids: string[]) => {
      const legacyKeys = ids.filter((id) => !id.startsWith(INSP));
      const d = readStudioDraft(saved, { v: 3, grovshot: grovDefaults(), stworz: stworzDefaults() }, fallbackTab, legacyKeys);
      const okModel = (list: GenModel[], id: string, fallback: string) => (list.some((m) => m.id === id) ? id : fallback);
      const allowed = new Set((variant?.controls ?? []).map((c) => c.key));
      setGrov({
        ...d.grovshot,
        modelId: okModel(managedModels, d.grovshot.modelId, grovDefaults().modelId),
        count: Math.min(Math.max(d.grovshot.count, SHOTS_MIN), SHOTS_MAX),
        choices: Object.fromEntries(Object.entries(d.grovshot.choices).filter(([k]) => allowed.has(k))),
      });
      setStw({ ...d.stworz, modelId: okModel(customModels, d.stworz.modelId, stworzDefaults().modelId) });
      void restorePhotos(files, ids);
    },
  });

  /** One stored photo as a ref: a visitor's stays local; a member's own
   *  upload is reused (it is already in their workspace — never sent twice);
   *  anything else goes through a normal upload. */
  async function storeFile(file: File, folder: string): Promise<UploadedRef | null> {
    if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) { toast.error(t("products.invalidType")); return null; }
    if (file.size > 10 * 1024 * 1024) { toast.error(t("products.tooLarge")); return null; }
    if (session.guest) {
      session.added(1);
      return session.localRef(file);
    }
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${workspaceId}/${folder}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file);
    if (error) { toast.error(t("common.error")); return null; }
    return { key: path, path, url: URL.createObjectURL(file) };
  }

  async function restorePhotos(files: File[], ids: string[]) {
    if (files.length === 0) return;
    const epoch = restoreEpoch.current;
    // The restored photos hold their places while they come back: a photo
    // dropped meanwhile is counted against the cap, and kept.
    const want = {
      refs: Math.min(MAX_REFS, ids.filter((id) => !id.startsWith(INSP)).length),
      insp: customData ? Math.min(INSP_MAX, ids.filter((id) => id.startsWith(INSP)).length) : 0,
    };
    reserved.current.refs += want.refs;
    reserved.current.insp += want.insp;
    inFlight.current += 1;
    setUploading(true);
    try {
      const keyMap = new Map<string, string>();
      const nextRefs: UploadedRef[] = [];
      const nextInsp: UploadedRef[] = [];
      for (let i = 0; i < files.length; i++) {
        if (epoch !== restoreEpoch.current) return;
        const id = ids[i] ?? "";
        const isInsp = id.startsWith(INSP);
        const raw = isInsp ? id.slice(INSP.length) : id;
        const file = files[i]!;
        const ref = !session.guest && workspaceId && raw.startsWith(`${workspaceId}/`)
          ? { key: raw, path: raw, url: URL.createObjectURL(file) }
          : await storeFile(file, isInsp ? inspFolder.current : adhocFolder.current);
        if (!ref) continue;
        if (isInsp) { if (nextInsp.length < INSP_MAX && customData) nextInsp.push(ref); }
        else if (nextRefs.length < MAX_REFS) { nextRefs.push(ref); keyMap.set(raw, ref.key); }
      }
      if (epoch !== restoreEpoch.current) return;
      // In front of anything added while they came back (a drop, a paste, a
      // photo handed over from /home) — never instead of it.
      const merge = (restored: UploadedRef[], cap: number) => (prev: UploadedRef[]) => {
        const seen = new Set(restored.map((r) => r.key));
        return [...restored, ...prev.filter((r) => !seen.has(r.key))].slice(0, cap);
      };
      setRefs(merge(nextRefs, MAX_REFS));
      setInsp(merge(nextInsp, INSP_MAX));
      setGrov((g) => ({ ...g, plan: remapPhotos(g.plan, keyMap) }));
    } finally {
      reserved.current.refs -= want.refs;
      reserved.current.insp -= want.insp;
      inFlight.current -= 1;
      if (inFlight.current === 0) setUploading(false);
    }
  }

  // ── uploads (browser → private bucket; only paths travel to the API) ───
  async function upload(files: File[], target: "refs" | "insp") {
    const folder = target === "insp" ? inspFolder.current : adhocFolder.current;
    const setter = target === "insp" ? setInsp : setRefs;
    const cap = target === "insp" ? INSP_MAX : MAX_REFS;
    // Room is checked BEFORE anything uploads, with in-flight uploads counted
    // as occupied: a drop and a paste together must not exceed the cap.
    const existing = (target === "insp" ? insp.length : refs.length) + reserved.current[target];
    const room = Math.max(0, cap - existing);
    if (files.length > room) toast.error(t("genv3.capReached", { max: cap }));
    if (room === 0) return;
    const batch = files.slice(0, room);
    reserved.current[target] += batch.length;
    inFlight.current += 1;
    setUploading(true);
    try {
      for (const file of batch) {
        const ref = await storeFile(file, folder);
        if (ref) setter((prev) => prev.length >= cap ? prev : [...prev, ref]);
      }
    } finally {
      reserved.current[target] -= batch.length;
      inFlight.current -= 1;
      if (inFlight.current === 0) setUploading(false);
    }
  }

  // A photo chosen on /home for this screen: the same upload as a picked one.
  useHomeHandoff((file) => { void upload([file], "refs"); });

  /** A GrovBase library pick becomes an ordinary inspiration upload (the
   *  generate route keeps only this workspace's paths). */
  async function addFromLibrary(urls: string[]) {
    const files: File[] = [];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const blob = await res.blob();
        const ext = (url.split("?")[0].split(".").pop() || "jpg").toLowerCase();
        const type = blob.type && blob.type.startsWith("image/") ? blob.type : `image/${ext === "jpg" ? "jpeg" : ext}`;
        files.push(new File([blob], `inspiration.${ext}`, { type }));
      } catch { /* one unreachable image must not lose the rest */ }
    }
    if (files.length === 0) { toast.error(t("common.error")); return; }
    await upload(files, "insp");
  }

  /** Reordering changes nothing in the shot plan: a row names its photo. */
  const moveRef = (from: number, to: number) => setRefs((prev) => reorder(prev, from, to));
  /** A photo leaving the pool sends its shot rows back to "Dowolne". */
  function removeRef(index: number) {
    const gone = refs[index];
    setRefs((prev) => prev.filter((_, j) => j !== index));
    if (gone) setGrov((g) => ({ ...g, plan: dropPhoto(g.plan, gone.key) }));
  }

  function pickModel(id: string) {
    const m = models.find((x) => x.id === id);
    if (!m) return;
    setCfg({
      modelId: id,
      ratio: snapRatio(m.ratios, cfg.ratio),
      resolution: snapTo(m.resolutions, cfg.resolution),
      count: Math.min(cfg.count, managed ? SHOTS_MAX : Math.max(1, m.maxOutputs)),
    });
  }

  const absorbLatest = useCallback(async (expect: number) => {
    try {
      const res = await fetch(`/api/generations?limit=${Math.min(Math.max(expect, 1) + 2, 24)}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; items?: GalleryItem[] };
      if (!json.ok || !json.items) return;
      const fresh = json.items.filter((i) => !knownAssets.current.has(i.assetId));
      if (fresh.length === 0) return;
      fresh.forEach((i) => { i.fresh = true; knownAssets.current.add(i.assetId); });
      setFreshItems((prev) => [...fresh, ...prev]);
    } catch { /* the card shows on the next page load */ }
  }, []);

  const errText = useCallback((code?: string) => {
    const known = code ? t(`studio.err.${code}`, {}) : "";
    return known && known !== `studio.err.${code}` ? known : t("common.error");
  }, [t]);

  const frame = useToolFrameController();
  /** The gallery quotes retakes with whichever engine made an image. */
  const galleryModels = useMemo(() => {
    const seen = new Set<string>();
    return [...managedModels, ...customModels].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  }, [managedModels, customModels]);

  // ── GROVSHOT: one planner pass, then every shot is a job of its own ────
  async function generateManaged() {
    if (submitting.current) return;
    submitting.current = true;
    const clickedAt = performance.now();
    session.ran();
    setPreparing(true);
    setStageLabel(t("genv3.stagePrepare"));
    try {
      const prep = await fetch("/api/prompts/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style: composeVariantStyle() || undefined,
          aspectRatio: effRatio,
          resolution: effResolution,
          shots: effCount,
          sessionType: grov.sessionType,
          // Plan ujęć: only what the customer set for a row — its words and,
          // when picked, its photo (by path; the server checks it and turns it
          // into the engine's position). An untouched row plans itself.
          shotBriefs: planToBriefs(grov.plan, effCount, refs),
          referencePaths: refs.map((r) => r.path).slice(0, MAX_REFS),
        }),
      });
      const prepJson = await prep.json() as { ok: boolean; sessionId?: string; error?: string };
      if (!prepJson.ok || !prepJson.sessionId) { toast.error(errText(prepJson.error)); return; }

      // Safe columns only: ids in priority order (the prompts are ciphertext).
      const supabase = createClient();
      const { data: concepts } = await supabase
        .from("generated_prompts").select("id, priority")
        .eq("session_id", prepJson.sessionId).order("priority", { ascending: true });
      const queue = (concepts ?? []).map((c) => c.id);
      if (queue.length === 0) { toast.error(t("common.error")); return; }

      const preview = refs[0]?.url ?? null;
      let refused = false;
      let shown = false;
      // The shots of one session are ONE operation for the plan's limit.
      enqueueBatch({
        batchId: prepJson.sessionId,
        items: queue.map((conceptId) => ({
          snapshot: frozen({ endpoint: "/api/concepts/generate", credits: perShot, body: { conceptId, modelId: model?.id, quality: effQuality } }),
          tool: "prompts", operation: null, expected: 1, ratio: effRatio, preview,
        })),
        onAccepted: (out) => {
          setBalance((b) => Math.max(0, b - (out.credits || perShot)));
          if (!shown) { shown = true; frame.accepted(clickedAt); }
        },
        onRefused: (out) => {
          if (refused) return;
          refused = true;
          toast.error(out.error === "insufficient_credits" ? t("studio.err.insufficient_credits")
            : out.error === "concurrency_limit" ? limitText(t, locale, out.limit ?? gate.limit?.max ?? 1)
              : errText(out.error));
        },
      });
      gate.flash();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setPreparing(false);
      setStageLabel("");
      submitting.current = false;
    }
  }

  /** Category workflow decisions ride as one internal style directive. */
  function composeVariantStyle(): string {
    const directives = (variant?.controls ?? [])
      .map((c) => c.options.find((o) => o.key === (grov.choices[c.key] ?? c.initial))?.directive)
      .filter((d): d is string => Boolean(d && d.trim()));
    return [managedData?.initialStyle?.trim(), ...directives].filter(Boolean).join(". ");
  }

  // ── STWÓRZ: the customer's own prompt, verbatim — one click, one job ───
  async function generateCustom() {
    if (submitting.current) return;
    submitting.current = true;
    const clickedAt = performance.now();
    session.ran();
    setStageLabel(t("inflight.sending"));
    try {
      const out = await submitTracked({
        snapshot: frozen({
          endpoint: "/api/generate", credits: total,
          body: {
            modelId: model?.id, prompt: stw.prompt.trim(),
            aspectRatio: effRatio, resolution: effResolution, quality: effQuality, quantity: effCount,
            // Only the photos this model takes (the panel greys the rest).
            // Only the photos this mode uses travel (the server would trim to
            // the same first X) — what the job records is then what the image
            // was made from, for "Popraw" too. A model that takes no product
            // photo keeps receiving them as before: it ignores them, and a
            // retake still has the product to hold on to.
            referencePaths: refs.map((r) => r.path).slice(0, usable > 0 ? Math.min(usable, MAX_REFS) : MAX_REFS),
            referenceImageIds: [],
            inspirationPaths: insp.map((r) => r.path).slice(0, INSP_MAX),
          },
        }),
        tool: "generator", operation: null, expected: effCount, ratio: effRatio, preview: refs[0]?.url ?? null,
      });
      if (out.ok) {
        setBalance((b) => Math.max(0, b - out.credits));
        gate.flash();
        frame.accepted(clickedAt);
      } else if (out.error === "concurrency_limit") {
        toast.error(limitText(t, locale, out.limit ?? gate.limit?.max ?? 1));
      } else {
        toast.error(errText(out.error));
      }
    } catch {
      toast.error(t("common.error"));
    } finally {
      setStageLabel("");
      submitting.current = false;
    }
  }

  /** Drop anywhere: over the inspiration block it is inspiration (Stwórz),
   *  everywhere else product photos. */
  const dragging = useFileDrop({
    enabled: true,
    onDrop: (files, event) => {
      if (files.length === 0) { toast.error(t("products.invalidType")); return; }
      const target = (event.target as Element | null)?.closest?.("[data-drop-target]");
      const pool = target?.getAttribute("data-drop-target") === "insp" && !managed ? "insp" : "refs";
      void upload(files, pool);
    },
  });

  // ── the bar ───────────────────────────────────────────────────────────
  const engineAvailable = managedData?.engineAvailable ?? false;
  const sending = stageLabel !== "" || preparing;
  const promptOk = stw.prompt.trim().length > 2;
  const canGenerate = !!model && !gate.atLimit && !smart.busy && !uploading && refs.length > 0
    && (session.guest || missing === 0)
    && (managed ? engineAvailable : promptOk);
  const line = useBarLine({
    unavailable: models.length === 0 ? t("generator.noModelsTitle") : managed && !engineAvailable ? t("psess.unavailable") : null,
    invalid: refs.length === 0 ? t("genv3.needPhotos")
      : uploading ? t("bar.uploading")
        : !managed && !promptOk ? t("genv3.needPrompt")
          : smart.busy ? t("bar.rewriting")
            : null,
    limit: gate.atLimit && gate.limit && !session.guest ? gate.limit : null,
    cost: total, balance, session,
  });
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const breakdown = [t(managed ? "bar.shots" : "bar.images", { n: n(effCount), p: n(perShot) })];
  const generate = () => void session.gate(managed ? generateManaged : generateCustom);

  // ── controls shared by the two modes ──────────────────────────────────
  const delta = useDeltaMeta();
  const defaultsNow = managed ? grovDefaults() : stworzDefaults();
  const defaultModel = models.find((m) => m.id === defaultsNow.modelId) ?? models[0];
  const qualityLabel = (q: string) => q === "low" ? t("genv3.qualityLow") : q === "high" ? t("genv3.qualityHigh") : t("genv3.qualityMedium");
  const recommendedRes = model ? snapTo(model.resolutions, defaultsNow.resolution) : "";
  const basePrice = unitPrice(model, recommendedRes, "custom", effQuality);
  const resolutionControl = model && model.resolutions.length > 0 && (
    <PanelSection title={t("genv3.resolution")} data="resolution">
      <Segmented label={t("genv3.resolution")} value={effResolution}
        onChange={(v) => setCfg({ resolution: v })}
        options={model.resolutions.map((r) => ({ value: r, label: r, meta: delta(unitPrice(model, r, "custom", effQuality), basePrice, r === recommendedRes) }))} />
    </PanelSection>
  );
  const recommendedQuality = snapQuality(model, "medium");
  const qualityControl = model && effQuality && model.qualities.length > 0 && (
    <PanelSection title={t("genv3.quality")} data="quality">
      <Segmented label={t("genv3.quality")} value={effQuality}
        onChange={(v) => setCfg({ quality: v })}
        options={model.qualities.map((q) => ({
          value: q, label: qualityLabel(q),
          meta: delta(unitPrice(model, effResolution, "custom", q), unitPrice(model, effResolution, "custom", recommendedQuality), q === recommendedQuality),
        }))} />
    </PanelSection>
  );
  const exact = new Set(model?.exactRatios ?? model?.ratios ?? []);
  const formatOptions: FormatOption[] = (model?.ratios ?? []).slice()
    .sort((a, b) => (a === "auto" ? -1 : b === "auto" ? 1 : 0))
    .map((r) => ({
      value: r, ratio: r === "auto" ? undefined : r, label: ratioName(t, r),
      use: formatUses?.[r] ?? fmtDefault(t, r),
      icon: r === "auto" ? <Sparkles size={16} aria-hidden /> : undefined,
      approx: r !== "auto" && !exact.has(r),
    }));
  const formatControl = (
    <PanelSection title={t("genv3.format")} data="format">
      <FormatTiles label={t("genv3.format")} options={formatOptions} value={effRatio} onChange={(v) => setCfg({ ratio: v })} />
    </PanelSection>
  );
  const modelControl = (note?: string) => (
    <div>
      <ModelSelect label={t("genv3.modelAi")} models={models} value={model?.id ?? ""} onChange={pickModel}
        priceOf={(m) => unitPrice(m, snapTo(m.resolutions, effResolution), managed ? "managed" : "custom", snapQuality(m, cfg.quality))} />
      {note && <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{note}</p>}
    </div>
  );

  if (models.length === 0 && !(both && (managedModels.length > 0 || customModels.length > 0))) {
    return (
      <div className="gen-shell-body panel rounded-2xl p-9 text-center lg:overflow-y-auto">
        <p className="font-display text-lg font-semibold">{t("generator.noModelsTitle")}</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{t("generator.noModelsBody")}</p>
      </div>
    );
  }

  const changedMore = managed && !!model && (
    model.id !== defaultModel?.id || effResolution !== recommendedRes || (!!effQuality && effQuality !== recommendedQuality)
  );
  const moreSummary = [model?.name, effResolution, effQuality ? qualityLabel(effQuality) : null].filter(Boolean).join(" · ");

  // Per-shot tails on the tabs: each mode at its own default model.
  const tailOf = (list: GenModel[]) => {
    const m = list[0];
    return m ? unitPrice(m, m.resolutions[0] ?? "1K", "custom", snapQuality(m, "medium")) : 0;
  };
  const tabs = both ? (
    <div role="tablist" aria-label={t("genv3.modes")} data-studio-tabs
      className="flex w-full items-stretch gap-1 rounded-xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.8))] bg-sunken/80 p-1 lg:w-[clamp(420px,29vw,470px)]">
      {([["grovshot", Sparkles, t("genv3.modeManaged"), tailOf(managedModels)], ["stworz", PenLine, t("genv3.modeCustom"), tailOf(customModels)]] as const).map(([key, Icon, label, cost]) => {
        const on = tab === key;
        return (
          <button key={key} type="button" role="tab" aria-selected={on} data-studio-tab={key}
            onClick={() => switchTab(key)}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1.5 text-center transition-all sm:px-2",
              on ? "bg-surface text-ink shadow-e2 ring-1 ring-[rgb(var(--accent)/0.45)]" : "text-muted hover:bg-surface/60 hover:text-ink",
            )}>
            <span className="flex min-w-0 max-w-full items-center gap-1.5 text-[12.5px] font-semibold leading-tight sm:text-[13px]">
              {/* The icon gives way on a phone so the name fits whole. */}
              <Icon size={14} aria-hidden className={cn("hidden shrink-0 sm:block", on ? "text-accent" : "text-faint")} />
              <span className="truncate">{label}</span>
            </span>
            {cost > 0 && (
              <span className={cn("inline-flex shrink-0 items-center gap-0.5 text-[10.5px] font-semibold leading-none tabular-nums", on ? "text-accent" : "text-faint")}>
                <Sparkles size={9} aria-hidden />{t("genv3.perPhoto", { n: cost })}
              </span>
            )}
          </button>
        );
      })}
    </div>
  ) : <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>;

  const restoredBanner = session.restored && (
    <div data-studio-restored role="status"
      className="flex items-center gap-2.5 rounded-xl border border-[rgb(var(--accent)/0.3)] bg-[rgb(var(--accent)/0.06)] px-3 py-2 text-[12.5px]">
      <RotateCcw size={14} aria-hidden className="shrink-0 text-accent" />
      <p className="min-w-0 flex-1">{t("genv3.restored")}</p>
      <button type="button" data-studio-clear onClick={() => {
        restoreEpoch.current += 1;
        void session.clear();
        setRefs([]); setInsp([]); setGrov(grovDefaults()); setStw(stworzDefaults());
      }} className="shrink-0 font-semibold text-accent transition-opacity hover:opacity-75">
        {t("genv3.clear")}
      </button>
    </div>
  );

  const photos = (
    <ProductRefsSection refs={refs} max={MAX_REFS} uploading={uploading}
      onUpload={(files) => upload(files, "refs")} onRemove={removeRef} onMove={moveRef} reorderHint={reorderHint}
      usable={usable < refs.length ? usable : undefined}
      usableNote={usable === 0 ? t("genv3.photosUnusedAll") : usable === 1 ? t("genv3.photosUsedOne") : t("genv3.photosUsed", { n: usable })} />
  );

  // One mode has no model to offer while the other does: its card says so
  // (the tabs stay, the other mode is one click away).
  const panel = models.length === 0 ? (
    <>
      {restoredBanner}
      {photos}
      <div data-no-models className="py-4 text-center">
        <p className="font-display text-base font-semibold">{t("generator.noModelsTitle")}</p>
        <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-muted">{t("generator.noModelsBody")}</p>
      </div>
    </>
  ) : managed ? (
    <>
      {restoredBanner}
      <ToolDraftBanner session={session} />
      {photos}
      <PanelSection title={t("genv3.scenario")} data="scenario">
        <ScenarioCards value={grov.sessionType} onChange={(v) => setGrov((g) => ({ ...g, sessionType: v }))} previews={managedData?.sessionPreviews} />
        {variant && variant.controls.length > 0 && (
          <div className="mt-3">
            <VariantChips variant={variant} choices={grov.choices}
              onChoose={(k, v) => setGrov((g) => ({ ...g, choices: { ...g.choices, [k]: v } }))} />
          </div>
        )}
      </PanelSection>
      {formatControl}
      <PanelSection title={t("genv3.countShots")} data="count">
        <Stepper label={t("genv3.countShots")} value={effCount} min={SHOTS_MIN} max={SHOTS_MAX} onChange={(v) => setCfg({ count: v })} data="shots" />
        <div className="mt-3">
          <ShotPlan count={effCount} refs={refs} plan={grov.plan}
            onPatch={(i, patch) => setGrov((g) => ({ ...g, plan: patchRow(g.plan, i, patch) }))} />
        </div>
      </PanelSection>
      <MoreSettings storageKey={`more:${toolKey}`} summary={moreSummary} changed={changedMore}
        onRestore={() => setGrov((g) => {
          const d = grovDefaults();
          return { ...g, modelId: d.modelId, resolution: d.resolution, quality: d.quality };
        })}>
        {modelControl(t("genv3.grovshotModelNote"))}
        {resolutionControl}
        {qualityControl}
      </MoreSettings>
    </>
  ) : (
    <>
      {restoredBanner}
      <ToolDraftBanner session={session} />
      {photos}
      <PromptSection value={stw.prompt} onChange={setPrompt} max={PROMPT_MAX} smart={smart} />
      <InspirationSection
        items={insp}
        uploading={uploading}
        disabled={!model?.supportsRefs}
        onUpload={(files) => upload(files, "insp")}
        onRemove={(i) => setInsp((prev) => prev.filter((_, j) => j !== i))}
        onMove={(from, to) => setInsp((prev) => reorder(prev, from, to))}
        reorderHint={reorderHint}
        onOpenLibrary={session.guest ? undefined : () => setLibraryOpen(true)}
      />
      {modelControl()}
      {formatControl}
      <div className={cn("grid gap-6 [&>*]:min-w-0", qualityControl && "min-[420px]:grid-cols-2 min-[420px]:gap-4")}>
        {resolutionControl}
        {qualityControl}
      </div>
      <PanelSection title={t("genv3.countImages")} data="count">
        <Stepper label={t("genv3.countImages")} value={effCount} min={1} max={maxCount} onChange={(v) => setCfg({ count: v })} data="images" />
      </PanelSection>
    </>
  );

  return (
    <ToolFrame frame={frame} tools={both ? ["prompts", "generator"] : ["prompts"]} back={back} title={tabs}>
      <ToolColumns
        cols="lg:grid-cols-[clamp(420px,29vw,470px)_minmax(0,1fr)]"
        attrs={{ "data-studio": tab }}
        overlay={(
          <>
            <DropOverlay show={dragging} title={t("genv3.dropTitle")} sub={t("genv3.dropSub")} />
            {customData && (
              <InspirationLibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)}
                room={Math.max(0, INSP_MAX - insp.length)} onPick={(urls) => { void addFromLibrary(urls); }} />
            )}
          </>
        )}
        panel={panel}
        bar={(
          <GenerateBar
            label={t("genv3.generateCta")}
            total={total}
            breakdown={breakdown}
            state={gate.added ? "added" : sending ? "sending" : "idle"}
            sendingLabel={stageLabel}
            blocked={!canGenerate}
            onGenerate={generate}
            line={line}
            ctaAttrs={{ "data-generate-cta": true }}
          />
        )}
        gallery={(
          <GenerationGallery
            initialItems={initialItems}
            initialCursor={initialCursor}
            freshItems={freshItems}
            onFresh={setFreshItems}
            pendingCount={0}
            pendingRatio={effRatio}
            inflight={{ tools: both ? ["prompts", "generator"] : ["prompts"] }}
            models={galleryModels}
            balance={balance}
            onBalance={setBalance}
            onAbsorb={absorbLatest}
            guideTool={toolKey}
          />
        )}
      />
    </ToolFrame>
  );
}
