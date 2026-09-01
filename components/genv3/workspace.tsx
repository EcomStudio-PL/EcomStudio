"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { GenerationGallery } from "@/components/genv3/gallery";
import { MobileDock } from "@/components/genv3/mobile-dock";
import {
  CostSummary, DescriptionSection, InspirationSection, ProductRefsSection,
  PromptSection, SessionTypeSection, SettingsSection, ShotBriefsSection, VariantChips,
} from "@/components/genv3/sections";
import { ModelSelect } from "@/components/genv3/model-select";
import { DropOverlay, useFileDrop } from "@/components/genv3/uploader";
import { cn } from "@/lib/utils";
import {
  snapTo, unitPrice,
  type BriefState, type GalleryItem, type GenMode, type GenModel, type UploadedRef,
} from "@/components/genv3/types";
import type { CategoryVariant } from "@/lib/categories";

/** Reference photos the seller may drop in for one generation session. */
const MAX_REFS = 8;

/**
 * GENERATOR WORKSPACE — one screen, two flavours.
 *
 * LEFT: the whole configuration (photos, description, session type or
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
  variant, initialPrompt = "",
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
}) {
  const { t } = useI18n();
  const managed = mode === "managed";
  const firstModel = models[0];

  // ── Configuration state ────────────────────────────────────────────────
  const [description, setDescription] = useState("");
  const [refs, setRefs] = useState<UploadedRef[]>([]);
  const [insp, setInsp] = useState<UploadedRef[]>([]);
  const [sessionType, setSessionType] = useState<"advertising" | "lifestyle">("advertising");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [modelId, setModelId] = useState(firstModel?.id ?? "");
  const [ratio, setRatio] = useState(initialRatio ?? firstModel?.ratios[0] ?? "1:1");
  const [resolution, setResolution] = useState(firstModel?.resolutions[0] ?? "1K");
  const [count, setCount] = useState(managed ? Math.min(Math.max(initialShots ?? 5, 1), 10) : 1);
  const [briefs, setBriefs] = useState<BriefState[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries((variant?.controls ?? []).filter((c) => c.initial).map((c) => [c.key, c.initial!])));
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
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
  const [pendingCount, setPendingCount] = useState(0);
  const knownAssets = useRef(new Set<string>(initialItems.map((i) => i.assetId)));

  // ── Capability snapping ────────────────────────────────────────────────
  const model = useMemo(() => models.find((m) => m.id === modelId) ?? firstModel, [models, modelId, firstModel]);
  const effRatio = model ? snapTo(model.ratios, ratio) : ratio;
  const effResolution = model ? snapTo(model.resolutions, resolution) : resolution;
  const maxCount = managed ? 10 : Math.max(1, model?.maxOutputs ?? 1);
  const effCount = Math.min(Math.max(count, 1), maxCount);

  const perShot = unitPrice(model, effResolution, mode);
  const total = perShot * effCount;
  const missing = Math.max(0, total - balance);

  function pickModel(id: string) {
    setModelId(id);
    const m = models.find((x) => x.id === id);
    if (m) {
      setRatio((r) => snapTo(m.ratios, r));
      setResolution((r) => snapTo(m.resolutions, r));
      setCount((c) => Math.min(c, managed ? 10 : Math.max(1, m.maxOutputs)));
    }
  }

  // ── Uploads (browser → private bucket; only paths travel to the API) ───
  // Accepts files from ALL three entry points — picker, drag & drop and a
  // clipboard paste — because they all arrive here as plain File objects.
  async function upload(files: File[], target: "refs" | "insp") {
    const supabase = createClient();
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

  // ── MANAGED: prepare hidden concepts, then generate them all ───────────
  async function generateManaged() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setPendingCount(effCount);
    setStageLabel(t("genv3.stagePrepare"));
    try {
      const prep = await fetch("/api/prompts/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim() || undefined,
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

      let done = 0;
      let failed = 0;
      let insufficient = false;
      let cursor = 0;
      setStageLabel(t("genv3.stageGenerate", { done: 0, total: queue.length }));
      const worker = async () => {
        while (!insufficient) {
          const i = cursor++;
          if (i >= queue.length) return;
          try {
            const res = await fetch("/api/concepts/generate", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ conceptId: queue[i], modelId: model?.id }),
            });
            const json = await res.json() as { ok: boolean; error?: string; credits?: number; images?: unknown[] };
            if (json.ok) {
              done++;
              setBalance((b) => Math.max(0, b - (json.credits ?? perShot)));
              await absorbLatest(1);
            } else if (json.error === "insufficient_credits") {
              insufficient = true;
            } else {
              failed++;
            }
          } catch { failed++; }
          setPendingCount((p) => Math.max(0, p - 1));
          setStageLabel(t("genv3.stageGenerate", { done, total: queue.length }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));
      if (insufficient) toast.error(t("studio.err.insufficient_credits"));
      else if (failed > 0 && done === 0) toast.error(t("genv3.allFailed"));
      else if (failed > 0) toast.warning(t("genv3.someFailed", { n: failed }));
      else toast.success(t("genv3.batchDone", { n: done }));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setPendingCount(0);
      setStageLabel("");
      setBusy(false);
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
  async function generateCustom() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setPendingCount(effCount);
    setStageLabel(t("genv3.stageGenerateSimple"));
    try {
      const res = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: model?.id, prompt: prompt.trim(),
          aspectRatio: effRatio, resolution: effResolution, quantity: effCount,
          // Free-text context only — the generator never creates a product.
          productDescription: description.trim() || undefined,
          referencePaths: refs.map((r) => r.path).slice(0, MAX_REFS),
          referenceImageIds: [],
          inspirationPaths: insp.map((r) => r.path).slice(0, 5),
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string; images?: unknown[] };
      if (json.ok) {
        setBalance((b) => Math.max(0, b - total));
        await absorbLatest(effCount);
        toast.success(t("studio.done"));
      } else {
        toast.error(errText(json.error));
      }
    } catch {
      toast.error(t("common.error"));
    } finally {
      setPendingCount(0);
      setStageLabel("");
      setBusy(false);
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
    enabled: !busy,
    onDrop: (files, event) => {
      if (files.length === 0) { toast.error(t("products.invalidType")); return; }
      const target = (event.target as Element | null)?.closest?.("[data-drop-target]");
      const pool = target?.getAttribute("data-drop-target") === "insp" && !managed ? "insp" : "refs";
      void upload(files, pool);
    },
  });

  // Photos are the only hard requirement now — no product, no name.
  const canGenerate = !!model && !busy && !uploading && refs.length > 0
    && missing === 0
    && (managed ? engineAvailable : prompt.trim().length > 2);
  const generate = managed ? generateManaged : generateCustom;

  if (models.length === 0) {
    return (
      <div className="panel rounded-2xl p-9 text-center">
        <p className="font-display text-lg font-semibold">{t("generator.noModelsTitle")}</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{t("generator.noModelsBody")}</p>
      </div>
    );
  }

  return (
    // DESKTOP: the workspace owns the viewport height and BOTH columns scroll
    // inside themselves. The page itself no longer scrolls, so the action
    // island at the bottom of the left column has nothing to drift with —
    // sticky positioning could still be pushed around by an ancestor, a fixed
    // bar would detach from the column and cover the gallery.
    <div className={cn(
      "relative grid min-w-0 items-start gap-5 pb-[var(--gen-page-bottom)] [&>*]:min-w-0",
      "lg:h-[calc(100dvh-var(--header-h)-1.75rem)] lg:grid-cols-[clamp(420px,29vw,470px)_minmax(0,1fr)] lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0",
    )}>
      <DropOverlay show={dragging} title={t("genv3.dropTitle")} sub={t("genv3.dropSub")} />
      {/* ── LEFT: configuration ─────────────────────────────────────────── */}
      {/* The column owns the viewport height; only the FORM scrolls, so the
          action island below never leaves the screen. */}
      <div className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0">
        <div className="panel thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto rounded-2xl p-4 sm:p-5">
          <ProductRefsSection
            refs={refs}
            max={MAX_REFS}
            uploading={uploading}
            onUpload={(files) => upload(files, "refs")}
            onRemove={removeRef}
          />
          <DescriptionSection description={description} onDescription={setDescription} />
          {managed ? (
            <>
              <SessionTypeSection value={sessionType} onChange={setSessionType} />
              {variant && variant.controls.length > 0 && (
                <VariantChips variant={variant} choices={choices}
                  onChoose={(k, v) => setChoices((p) => ({ ...p, [k]: v }))} />
              )}
            </>
          ) : (
            <PromptSection value={prompt} onChange={setPrompt} max={2000} />
          )}
          <SettingsSection
            managed={managed}
            model={model}
            ratio={effRatio} onRatio={setRatio}
            resolution={effResolution} onResolution={setResolution}
            count={effCount} maxCount={maxCount} onCount={setCount}
            perShotAt={(res) => unitPrice(model, res, mode)}
          />
          <ModelSelect
            label={managed ? t("genv3.modelAi") : t("genv3.engineAi")}
            models={models}
            value={model?.id ?? ""}
            onChange={pickModel}
            priceOf={(m) => unitPrice(m, snapTo(m.resolutions, effResolution), mode)}
          />
          {managed ? (
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
          ) : (
            <InspirationSection
              items={insp}
              uploading={uploading}
              disabled={!model?.supportsRefs}
              onUpload={(files) => upload(files, "insp")}
              onRemove={(i) => setInsp((prev) => prev.filter((_, j) => j !== i))}
            />
          )}
        </div>

        <CostSummary
          perShot={perShot}
          total={total}
          count={effCount}
          balance={balance}
          missing={missing}
          busy={busy}
          busyLabel={stageLabel}
          canGenerate={canGenerate}
          engineUnavailable={managed && !engineAvailable}
          needsPhotos={refs.length === 0}
          needsPrompt={!managed && prompt.trim().length <= 2}
          onGenerate={generate}
        />
      </div>

      {/* ── RIGHT: the living gallery, scrolling in its own column ──────── */}
      <div className="thin-scroll min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4 lg:pr-1">
        <GenerationGallery
          initialItems={initialItems}
          initialCursor={initialCursor}
          freshItems={freshItems}
          onFresh={setFreshItems}
          pendingCount={pendingCount}
          pendingRatio={effRatio}
          models={models}
          balance={balance}
          onBalance={setBalance}
          onAbsorb={absorbLatest}
        />
      </div>

      <MobileDock
        managed={managed}
        models={models}
        modelId={model?.id ?? ""}
        onModel={pickModel}
        ratio={effRatio} ratios={model?.ratios ?? []} onRatio={setRatio}
        resolution={effResolution} resolutions={model?.resolutions ?? []} onResolution={setResolution}
        count={effCount} maxCount={maxCount} onCount={setCount}
        perShot={perShot} total={total} balance={balance}
        busy={busy} busyLabel={stageLabel}
        canGenerate={canGenerate}
        onGenerate={generate}
        priceOf={(m) => unitPrice(m, snapTo(m.resolutions, effResolution), mode)}
      />
    </div>
  );
}
