"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { GenerationGallery } from "@/components/genv3/gallery";
import {
  CostSummary, InspirationSection, ProductRefsSection,
  PromptSection, SessionTypeSection, SettingsSection, ShotBriefsSection, VariantChips,
} from "@/components/genv3/sections";
import { ModelSelect } from "@/components/genv3/model-select";
import { InspirationLibraryModal } from "@/components/genv3/inspiration-library";
import { DropOverlay, useFileDrop } from "@/components/genv3/uploader";
import { useHomeHandoff } from "@/lib/home-handoff";
import { useSmartPrompt } from "@/components/genv3/smart-prompt";
import type { SmartPromptOffer } from "@/lib/smart-prompt";
import { cn } from "@/lib/utils";
import {
  defaultRatio, snapQuality, snapRatio, snapTo, unitPrice,
  type BriefState, type GalleryItem, type GenMode, type GenModel, type UploadedRef,
} from "@/components/genv3/types";
import type { CategoryVariant } from "@/lib/categories";
import type { SessionPreviewMap } from "@/components/genv3/sections";
import { refSource, useToolSession } from "@/components/public-tools/use-tool-session";
import { BalanceLine, ToolDraftBanner, ToolNotice } from "@/components/public-tools/tool-notice";
import { useToolViewer } from "@/components/public-tools/tool-viewer";
import { frozenSnapshot as frozen, submitTracked } from "@/lib/inflight/store";
import { enqueueBatch } from "@/lib/inflight/queue";
import { LimitNote, useInflightGate } from "@/components/inflight/use-inflight-gate";
import { reorder } from "@/components/genv3/sortable-photos";
import { useReorderHint } from "@/components/tool-guide/use-reorder-hint";
import { limitText } from "@/components/inflight/inflight-tile";

/** Reference photos the seller may drop in for one generation session. */
const MAX_REFS = 10;
/** Own-prompt length. The field expands in place and then scrolls inside
 *  itself, so a long prompt costs the panel no height — the cap only guards
 *  the request. */
const PROMPT_MAX = 4000;

/**
 * GENERATOR WORKSPACE — one screen, two flavours.
 *
 * LEFT: the whole configuration (photos, session type or
 * prompt, settings, model, shots/inspiration) scrolling inside itself, with
 * the cost + CTA island pinned to its bottom edge. RIGHT: the living gallery
 * of this workspace's generations. On phones the configuration stacks and
 * every generation-critical control also lives in the docked toolbar above
 * the bottom navigation, opening bottom sheets.
 *
 * NO PRODUCT CATALOGUE: the seller drops today's photos straight in. Nothing
 * is saved as a product, nothing has to be picked first, and an uploaded
 * photo is never auto-assigned to a shot — the photos are a POOL the
 * customer draws from per shot.
 *
 * The managed flavour drives the hidden GrovBase engine: prepare (one
 * planner pass, prompts sealed server-side) then generate each shot through
 * /api/concepts/generate with limited concurrency — every image appears in
 * the gallery the moment it exists. The custom flavour posts the customer's
 * own prompt to /api/generate. Prices always come from the model config the
 * server also uses; the server re-computes and enforces them regardless.
 */
export function GeneratorWorkspace({
  mode, models, credits, workspaceId, engineAvailable = true,
  initialItems, initialCursor, initialStyle, initialRatio, initialShots,
  variant, initialPrompt = "", sessionPreviews, smartPrompt,
}: {
  mode: GenMode;
  models: GenModel[];
  credits: number;
  workspaceId: string;
  engineAvailable?: boolean;
  initialItems: GalleryItem[];
  initialCursor: string | null;
  initialStyle?: string;
  initialRatio?: string;
  initialShots?: number;
  variant?: CategoryVariant;
  initialPrompt?: string;
  /** Admin-configured preview media for the two session tiles. */
  sessionPreviews?: SessionPreviewMap;
  /** Inteligentny prompt: price + whether to offer it (custom mode only). */
  smartPrompt?: SmartPromptOffer;
}) {
  const { t, locale } = useI18n();
  const managed = mode === "managed";
  const firstModel = models[0];

  // ── Configuration state ────────────────────────────────────────────────
  const [refs, setRefs] = useState<UploadedRef[]>([]);
  const [insp, setInsp] = useState<UploadedRef[]>([]);
  /** The GrovBase inspiration library, opened from the second tile. */
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sessionType, setSessionType] = useState<"advertising" | "lifestyle">("advertising");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [modelId, setModelId] = useState(firstModel?.id ?? "");
  const [ratio, setRatio] = useState(initialRatio ?? defaultRatio(firstModel?.ratios ?? []));
  const [resolution, setResolution] = useState(firstModel?.resolutions[0] ?? "1K");
  // "Jakość" — only meaningful for a model that declares qualities; the
  // effective value below is undefined for every other model.
  const [quality, setQuality] = useState("medium");
  const [count, setCount] = useState(managed ? Math.min(Math.max(initialShots ?? 5, 1), 10) : 1);
  const [briefs, setBriefs] = useState<BriefState[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries((variant?.controls ?? []).filter((c) => c.initial).map((c) => [c.key, c.initial!])));
  const [uploading, setUploading] = useState(false);
  const [stageLabel, setStageLabel] = useState("");
  const [balance, setBalance] = useState(credits);
  const adhocFolder = useRef(`adhoc-${Math.random().toString(36).slice(2, 10)}`);
  /** Slots claimed by uploads that have not reached state yet, per pool. */
  const reserved = useRef<{ refs: number; insp: number }>({ refs: 0, insp: 0 });
  const inFlight = useRef(0);
  const inspFolder = useRef(`insp-${Math.random().toString(36).slice(2, 10)}`);
  const submitting = useRef(false);

  // ── Gallery feed (fresh results prepend; the gallery fetches the rest) ─
  const [freshItems, setFreshItems] = useState<GalleryItem[]>([]);
  const knownAssets = useRef(new Set<string>(initialItems.map((i) => i.assetId)));

  // ── Generacje w toku V2: the button's limit, "Dodano ✓", the balance ───
  const gate = useInflightGate();
  /** The tool's own "drag to reorder" line (Admin → its guide), or the default. */
  const reorderHint = useReorderHint(managed ? "prompts" : "generator");
  useEffect(() => { if (gate.balance !== null) setBalance(gate.balance); }, [gate.balance, gate.balanceAt]);
  /** GrovBase only: the hidden planner pass before the shots are sent. */
  const [preparing, setPreparing] = useState(false);

  // ── Capability snapping ────────────────────────────────────────────────
  const model = useMemo(() => models.find((m) => m.id === modelId) ?? firstModel, [models, modelId, firstModel]);
  const effRatio = model ? snapRatio(model.ratios, ratio) : ratio;
  const effResolution = model ? snapTo(model.resolutions, resolution) : resolution;
  const effQuality = snapQuality(model, quality);
  const maxCount = managed ? 10 : Math.max(1, model?.maxOutputs ?? 1);
  const effCount = Math.min(Math.max(count, 1), maxCount);

  // ── Inteligentny prompt (custom mode): rewrites land in `prompt` itself ─
  const refPaths = useMemo(() => refs.map((r) => r.path).slice(0, MAX_REFS), [refs]);
  const smart = useSmartPrompt({
    value: prompt, onChange: setPrompt, offer: managed ? undefined : smartPrompt,
    referencePaths: refPaths, onBalance: setBalance,
  });

  const perShot = unitPrice(model, effResolution, mode, effQuality);
  const total = perShot * effCount;
  const missing = Math.max(0, total - balance);

  /*
    PUBLIC TOOLS V1. A visitor prepares the generation exactly as a member does
    — product photos and inspirations stay in the browser (never Storage),
    nothing paid runs (the smart prompt is not offered to them) — and Generate
    opens the sign-in dialog. Back signed in, the same files go through
    `upload` in the same order, with the prompt and the settings as they were.
  */
  const viewer = useToolViewer();
  const INSP = "insp:";
  const session = useToolSession({
    settings: { prompt, modelId, ratio, resolution, quality, count, sessionType, choices, briefs },
    sources: [...refs.map(refSource), ...insp.map((r) => ({ ...refSource(r), id: `${INSP}${r.key}` }))],
    apply: (saved: Partial<{
      prompt: string; modelId: string; ratio: string; resolution: string; quality: string; count: number;
      sessionType: "advertising" | "lifestyle"; choices: Record<string, string>; briefs: BriefState[];
    }>, files: File[], ids: string[]) => {
      if (typeof saved.prompt === "string") setPrompt(saved.prompt.slice(0, PROMPT_MAX));
      if (typeof saved.modelId === "string" && models.some((m) => m.id === saved.modelId)) setModelId(saved.modelId);
      // Ratio, size, quality and count are snapped to the model on every
      // render, exactly as when they are picked by hand.
      if (typeof saved.ratio === "string") setRatio(saved.ratio);
      if (typeof saved.resolution === "string") setResolution(saved.resolution);
      if (typeof saved.quality === "string") setQuality(saved.quality);
      if (typeof saved.count === "number" && Number.isFinite(saved.count)) setCount(Math.max(1, Math.floor(saved.count)));
      if (saved.sessionType === "advertising" || saved.sessionType === "lifestyle") setSessionType(saved.sessionType);
      if (saved.choices && typeof saved.choices === "object") {
        const allowed = new Set((variant?.controls ?? []).map((c) => c.key));
        setChoices(Object.fromEntries(Object.entries(saved.choices).filter(([k, v]) => allowed.has(k) && typeof v === "string")));
      }
      if (Array.isArray(saved.briefs)) {
        setBriefs(saved.briefs.slice(0, 10).map((b) => ({
          text: typeof b?.text === "string" ? b.text.slice(0, 2000) : "",
          keepFraming: b?.keepFraming === true,
          refIndex: typeof b?.refIndex === "number" ? b.refIndex : null,
        })));
      }
      const refFiles = files.filter((_, i) => !ids[i]?.startsWith(INSP));
      const inspFiles = files.filter((_, i) => ids[i]?.startsWith(INSP));
      // One after the other: two uploads at once would read the same
      // pre-commit counts and race the caps.
      void (async () => {
        if (refFiles.length > 0) await upload(refFiles, "refs");
        if (inspFiles.length > 0 && !managed) await upload(inspFiles, "insp");
      })();
    },
  });

  function pickModel(id: string) {
    setModelId(id);
    const m = models.find((x) => x.id === id);
    if (m) {
      setRatio((r) => snapRatio(m.ratios, r));
      setResolution((r) => snapTo(m.resolutions, r));
      setCount((c) => Math.min(c, managed ? 10 : Math.max(1, m.maxOutputs)));
    }
  }

  // ── Uploads (browser → private bucket; only paths travel to the API) ───
  // Accepts files from ALL three entry points — picker, drag & drop and a
  // clipboard paste — because they all arrive here as plain File objects.
  async function upload(files: File[], target: "refs" | "insp") {
    const folder = target === "insp" ? inspFolder.current : adhocFolder.current;
    const setter = target === "insp" ? setInsp : setRefs;
    const cap = target === "insp" ? 5 : MAX_REFS;
    // Room is checked BEFORE anything uploads — an over-cap file must not
    // land in storage only to be silently dropped from the state. Slots taken
    // by an upload that is still in flight count as occupied: a drop and a
    // paste arriving together both read the same pre-commit array length, so
    // without the reservation they would jointly exceed the cap and orphan
    // the surplus in storage.
    const existing = (target === "insp" ? insp.length : refs.length) + reserved.current[target];
    const room = Math.max(0, cap - existing);
    if (files.length > room) toast.error(t("genv3.capReached", { max: cap }));
    if (room === 0) return;
    const batch = files.slice(0, room);
    reserved.current[target] += batch.length;
    // Counted, not a boolean: the first upload to finish must not report the
    // workspace as idle while a second one is still running.
    inFlight.current += 1;
    setUploading(true);
    try {
      for (const file of batch) {
        if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) { toast.error(t("products.invalidType")); continue; }
        if (file.size > 10 * 1024 * 1024) { toast.error(t("products.tooLarge")); continue; }
        if (session.guest) {
          // A visitor's photo is a local stand-in: no request of any kind.
          const ref = session.localRef(file);
          setter((prev) => prev.length >= cap ? prev : [...prev, ref]);
          session.added(1);
          continue;
        }
        const supabase = createClient();
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${workspaceId}/${folder}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file);
        if (error) { toast.error(t("common.error")); continue; }
        setter((prev) => prev.length >= cap ? prev : [...prev, { key: path, path, url: URL.createObjectURL(file) }]);
      }
    } finally {
      reserved.current[target] -= batch.length;
      inFlight.current -= 1;
      if (inFlight.current === 0) setUploading(false);
    }
  }

  // A photo chosen on /home for this screen arrives here once and goes through
  // the SAME upload as a picked one (lib/home-handoff.ts). Nothing else from
  // /home — no prompt, no settings — and nothing starts by itself: the seller
  // still sees the price and presses this screen's own button.
  useHomeHandoff((file) => { void upload([file], "refs"); });

  /**
   * A PICK FROM THE GROVBASE LIBRARY, TURNED INTO AN ORDINARY UPLOAD.
   *
   * The library image is fetched in the browser and handed to `upload` above
   * as a plain File — the same function the picker, a drag and a paste all end
   * in. Nothing downstream learns that this one came from the library: same
   * storage folder, same cap, same reservation, same `UploadedRef`, same
   * `inspirationPaths`.
   *
   * That is deliberate rather than lazy. `/api/generate` keeps only the
   * inspiration paths that start with this workspace's id, which is what stops
   * one workspace aiming the generator at another's files. A library URL sent
   * straight through would be dropped by that filter without a word, and the
   * seller would watch a picture they chose quietly do nothing.
   */
  async function addFromLibrary(urls: string[]) {
    const files: File[] = [];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const blob = await res.blob();
        // Some storage origins answer without a usable content-type; the
        // extension is the fallback, because `upload` validates the MIME and
        // would otherwise reject a perfectly good library image.
        const ext = (url.split("?")[0].split(".").pop() || "jpg").toLowerCase();
        const type = blob.type && blob.type.startsWith("image/")
          ? blob.type
          : `image/${ext === "jpg" ? "jpeg" : ext}`;
        files.push(new File([blob], `inspiration.${ext}`, { type }));
      } catch {
        // One unreachable image must not lose the rest of the selection.
      }
    }
    if (files.length === 0) { toast.error(t("common.error")); return; }
    await upload(files, "insp");
  }

  /**
   * Move one reference photo (Drag & drop zdjęć V2) AND keep every shot row
   * pointing at the photo it chose: `refIndex` is positional, so the rows
   * follow their photo to its new place instead of re-aiming at a neighbour.
   */
  function moveRef(from: number, to: number) {
    const prev = refs;
    const next = reorder(prev, from, to);
    const at = new Map(next.map((r, i) => [r.key, i + 1]));
    setRefs(next);
    setBriefs((rows) => rows.map((b) => {
      if (!b?.refIndex) return b;
      const key = prev[b.refIndex - 1]?.key;
      const moved = key ? at.get(key) : undefined;
      return moved ? { ...b, refIndex: moved } : b;
    }));
  }

  /** Remove one reference photo AND keep every shot row pointing at the photo
   *  it actually chose: `refIndex` is positional, so dropping a photo from the
   *  middle would otherwise silently re-aim later rows at their neighbour. */
  function removeRef(index: number) {
    setRefs((prev) => prev.filter((_, j) => j !== index));
    const removed = index + 1;
    setBriefs((prev) => prev.map((b) => {
      if (!b?.refIndex) return b;
      if (b.refIndex === removed) return { ...b, refIndex: null, keepFraming: false };
      return b.refIndex > removed ? { ...b, refIndex: b.refIndex - 1 } : b;
    }));
  }

  // ── Merging fresh results from the server (full-fidelity cards) ────────
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

  // ── MANAGED: prepare hidden concepts, then send them all ───────────────
  /*
   * GENERACJE W TOKU V2. The planner pass is the one wait the panel shows
   * ("Przygotowuję ujęcia…"); after it every shot is a job of its own,
   * queued at module level and sent two at a time (the pace it always had),
   * each shown as a tile the moment the server accepts it. The panel is free
   * again as soon as the shots are queued — leaving the page does not stop
   * them, and the next session can be prepared while these render.
   */
  async function generateManaged() {
    if (submitting.current) return;
    submitting.current = true;
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
          sessionType,
          // refIndex is ONLY what the customer picked for that row. Nothing is
          // inferred from the upload order — an untouched row carries no
          // reference and lets the engine plan the scene itself.
          shotBriefs: Array.from({ length: effCount }, (_, i) => {
            const b = briefs[i];
            const ref = b?.refIndex && refs[b.refIndex - 1] ? b.refIndex : undefined;
            return {
              text: b?.text?.trim() || undefined,
              keepFraming: !!b?.keepFraming && !!ref,
              refIndex: ref,
            };
          }),
          referencePaths: refs.map((r) => r.path).slice(0, MAX_REFS),
        }),
      });
      const prepJson = await prep.json() as { ok: boolean; sessionId?: string; error?: string };
      if (!prepJson.ok || !prepJson.sessionId) {
        toast.error(errText(prepJson.error));
        return;
      }

      // Safe columns only: ids in priority order. The prompts themselves are
      // ciphertext and are never selected anywhere in the customer UI.
      const supabase = createClient();
      const { data: concepts } = await supabase
        .from("generated_prompts")
        .select("id, priority")
        .eq("session_id", prepJson.sessionId)
        .order("priority", { ascending: true });
      const queue = (concepts ?? []).map((c) => c.id);
      if (queue.length === 0) { toast.error(t("common.error")); return; }

      const preview = refs[0]?.url ?? null;
      let refused = false;
      // The shots of one session are ONE operation for the plan's limit; the
      // server groups them by the session itself.
      enqueueBatch({
        batchId: prepJson.sessionId,
        items: queue.map((conceptId) => ({
          snapshot: frozen({ endpoint: "/api/concepts/generate", credits: perShot, body: { conceptId, modelId: model?.id, quality: effQuality } }),
          tool: "prompts", operation: null, expected: 1, ratio: effRatio, preview,
        })),
        onAccepted: (out) => setBalance((b) => Math.max(0, b - (out.credits || perShot))),
        onRefused: (out) => {
          if (refused) return;
          refused = true;
          toast.error(out.error === "insufficient_credits" ? t("studio.err.insufficient_credits") : errText(out.error));
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

  /** Category workflow decisions ride as one internal style directive —
   *  the same contract the previous workspace used. */
  function composeVariantStyle(): string {
    const directives = (variant?.controls ?? [])
      .map((c) => c.options.find((o) => o.key === (choices[c.key] ?? c.initial))?.directive)
      .filter((d): d is string => Boolean(d && d.trim()));
    return [initialStyle?.trim(), ...directives].filter(Boolean).join(". ");
  }

  // ── CUSTOM: the customer's own prompt, verbatim ────────────────────────
  /*
   * GENERACJE W TOKU V2. One click = one job, answered the moment the server
   * accepts it (charged, inside the plan's limit). The request the click
   * sent is frozen into the tile's snapshot — "Spróbuj ponownie" repeats
   * exactly that, whatever the panel shows by then — and the panel itself is
   * left exactly as it was, ready for the next click.
   */
  async function generateCustom() {
    if (submitting.current) return;
    submitting.current = true;
    session.ran();
    setStageLabel(t("inflight.sending"));
    try {
      const out = await submitTracked({
        snapshot: frozen({
          endpoint: "/api/generate", credits: total,
          body: {
            modelId: model?.id, prompt: prompt.trim(),
            aspectRatio: effRatio, resolution: effResolution, quality: effQuality, quantity: effCount,
            referencePaths: refs.map((r) => r.path).slice(0, MAX_REFS),
            referenceImageIds: [],
            inspirationPaths: insp.map((r) => r.path).slice(0, 5),
          },
        }),
        tool: "generator", operation: null, expected: effCount, ratio: effRatio, preview: refs[0]?.url ?? null,
      });
      if (out.ok) {
        setBalance((b) => Math.max(0, b - out.credits));
        gate.flash();
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

  /**
   * DROP ANYWHERE ON THE WORKSPACE. The pool a file joins is decided by what
   * sits under the pointer: releasing over the inspiration block adds
   * inspiration, everything else adds product photos — so the seller can aim
   * at the panel instead of at the small tile.
   */
  const dragging = useFileDrop({
    enabled: true,
    onDrop: (files, event) => {
      if (files.length === 0) { toast.error(t("products.invalidType")); return; }
      const target = (event.target as Element | null)?.closest?.("[data-drop-target]");
      const pool = target?.getAttribute("data-drop-target") === "insp" && !managed ? "insp" : "refs";
      void upload(files, pool);
    },
  });

  // Photos are the only hard requirement now — no product, no name.
  // A visitor's Generate is the sign-in dialog: their (absent) balance never greys it out.
  // Not while a rewrite is on its way: the text about to be replaced is not
  // the text the customer would be generating from.
  // Generacje w toku V2: a click in flight (the POST, or GrovBase's planner
  // pass) and the plan's limit are the only things that hold the button —
  // never a generation that is merely running.
  const sending = stageLabel !== "" || preparing;
  const canGenerate = !!model && !sending && !gate.added && !gate.atLimit && !smart.busy && !uploading && refs.length > 0
    && (session.guest || missing === 0)
    && (managed ? engineAvailable : prompt.trim().length > 2);
  const generate = () => void session.gate(managed ? generateManaged : generateCustom);

  if (models.length === 0) {
    return (
      // Still the frame's growing child: without `gen-shell-body` the
      // viewport-height shell would have nothing to fill it and no scroller,
      // so longer copy would have nowhere to go.
      <div className="gen-shell-body panel rounded-2xl p-9 text-center lg:overflow-y-auto">
        <p className="font-display text-lg font-semibold">{t("generator.noModelsTitle")}</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{t("generator.noModelsBody")}</p>
      </div>
    );
  }

  return (
    // DESKTOP: `gen-shell-body` makes this the one growing child of the page
    // shell (see `.gen-shell` in globals.css), so its height is whatever the
    // viewport has left after the topbar and the page's own header band —
    // measured by the layout, never computed from tokens that can disagree
    // with the real chrome. Both columns then scroll inside themselves and
    // the page does not scroll at all.
    <div className={cn(
      "gen-shell-body relative grid min-w-0 items-start gap-5 [&>*]:min-w-0",
      "lg:grid-cols-[clamp(420px,29vw,470px)_minmax(0,1fr)] lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0",
    )}>
      <DropOverlay show={dragging} title={t("genv3.dropTitle")} sub={t("genv3.dropSub")} />
      {/* Mounted beside the overlay rather than inside the scrolling panel:
          the modal is fixed-position and must not be clipped by the column's
          `overflow: hidden`. `room` is what is left of the cap right now, so
          the picker cannot offer a selection the upload would trim. */}
      <InspirationLibraryModal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        room={Math.max(0, 5 - insp.length)}
        onPick={(urls) => { void addFromLibrary(urls); }}
      />
      {/* ── LEFT: configuration ─────────────────────────────────────────── */}
      {/* Two physical parts, per spec: a bounded scrolling body and a footer
          that is a SIBLING of it, not a sticky element inside it. The
          scrollbar therefore belongs to the body alone and stops at the
          island's top edge. `overflow: hidden` on the column stops a tall
          child from stretching it and taking the island down with it.
          Below lg nothing changes: the column has no bounded height there, so
          the same classes leave the panel at its natural size and the phone
          keeps its normally-scrolling page.

          `lg:overflow-y-auto` is the scroll of last resort, not the normal
          path. The body above has `min-h-0 flex-1`, so it shrinks to whatever
          is free and the column's content normally fits its height exactly —
          no scrollbar ever appears here. It engages only on a viewport so
          short that the island alone does not fit, and then it keeps the CTA
          REACHABLE where `overflow: hidden` would have cut it off with no way
          to get to it. */}
      <div className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        {/* The scroll/flex classes stay UNSCOPED so the phone keeps exactly
            the containment it had before (overflow-y:auto also makes the
            horizontal axis a scroll container, which is what stops a wide chip
            row from spilling past the panel). `lg:pb-6` is the "normal gap"
            after the last field: the island is a sibling below, so nothing is
            ever hidden underneath it, and the content still does not end flush
            against the scroller's edge. */}
        <div className="panel thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto rounded-2xl p-4 sm:p-5 lg:pb-6">
          <ToolDraftBanner session={session} />
          <ProductRefsSection
            refs={refs}
            max={MAX_REFS}
            uploading={uploading}
            onUpload={(files) => upload(files, "refs")}
            onRemove={removeRef}
            onMove={moveRef}
            reorderHint={reorderHint}
          />
          {managed ? (
            <>
              <SessionTypeSection value={sessionType} onChange={setSessionType} previews={sessionPreviews} />
              {variant && variant.controls.length > 0 && (
                <VariantChips variant={variant} choices={choices}
                  onChoose={(k, v) => setChoices((p) => ({ ...p, [k]: v }))} />
              )}
            </>
          ) : (
            // "Stwórz zdjęcie" order: photos → inspiration → prompt → settings
            // → engine. Inspiration sits right under the product photos, so
            // both uploads are together and the prompt follows what it will
            // describe. The upload itself is unchanged — only the position.
            <>
              <InspirationSection
                items={insp}
                uploading={uploading}
                disabled={!model?.supportsRefs}
                onUpload={(files) => upload(files, "insp")}
                onRemove={(i) => setInsp((prev) => prev.filter((_, j) => j !== i))}
                onMove={(from, to) => setInsp((prev) => reorder(prev, from, to))}
                reorderHint={reorderHint}
                // The GrovBase library is an account's (it reads the library
                // table); a visitor uploads their own inspiration.
                onOpenLibrary={session.guest ? undefined : () => setLibraryOpen(true)}
              />
              <PromptSection value={prompt} onChange={setPrompt} max={PROMPT_MAX} smart={smart} />
            </>
          )}
          <SettingsSection
            managed={managed}
            model={model}
            ratio={effRatio} onRatio={setRatio}
            resolution={effResolution} onResolution={setResolution}
            quality={effQuality} onQuality={setQuality}
            count={effCount} maxCount={maxCount} onCount={setCount}
            perShotAt={(res, q) => unitPrice(model, res, mode, q ?? effQuality)}
          />
          <ModelSelect
            label={managed ? t("genv3.modelAi") : t("genv3.engineAi")}
            models={models}
            value={model?.id ?? ""}
            onChange={pickModel}
            priceOf={(m) => unitPrice(m, snapTo(m.resolutions, effResolution), mode, snapQuality(m, quality))}
          />
          {managed && (
            <ShotBriefsSection
              count={effCount}
              refs={refs}
              briefs={briefs}
              onChange={(i, patch) => setBriefs((prev) => {
                const next = [...prev];
                const base = next[i] ?? { text: "", keepFraming: false, refIndex: null };
                next[i] = { ...base, ...patch };
                return next;
              })}
            />
          )}
        </div>

        <CostSummary
          perShot={perShot}
          total={total}
          balance={balance}
          missing={missing}
          busy={sending}
          busyLabel={stageLabel}
          added={gate.added}
          limitNote={gate.atLimit && gate.limit && !session.guest ? <LimitNote max={gate.limit.max} plan={gate.limit.plan} /> : undefined}
          canGenerate={canGenerate}
          engineUnavailable={managed && !engineAvailable}
          needsPhotos={refs.length === 0}
          needsPrompt={!managed && prompt.trim().length <= 2}
          onGenerate={generate}
          status={viewer ? {
            balance: <BalanceLine balance={balance} />,
            notice: refs.length > 0 ? <ToolNotice cost={total} balance={balance} session={session} className="mt-2.5" /> : null,
          } : undefined}
        />
      </div>

      {/* ── RIGHT: the living gallery, scrolling in its own column ──────── */}
      <div className="thin-scroll min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4 lg:pr-1">
        <GenerationGallery
          initialItems={initialItems}
          initialCursor={initialCursor}
          freshItems={freshItems}
          onFresh={setFreshItems}
          pendingCount={0}
          pendingRatio={effRatio}
          inflight={{ tools: [managed ? "prompts" : "generator"] }}
          models={models}
          balance={balance}
          onBalance={setBalance}
          onAbsorb={absorbLatest}
        />
      </div>

      {/* NO FLOATING DOCK. The phone used to get a second copy of every
          control here — mode, model, format, size, count, the price line and
          a second GENERUJ — in a `position: fixed` bar above the navigation.
          It rode the scroll, covered the gallery, and made the page reserve
          225px of empty space underneath itself for a bar that was never part
          of the page.

          Nothing was lost by deleting it. `SettingsSection`, `ModelSelect`
          and the mode switch on the page above all render at every width, and
          `CostSummary` below the settings body is the same cost + CTA panel
          Retusz has always had, in the same place. One panel, in the page. */}

    </div>
  );
}
