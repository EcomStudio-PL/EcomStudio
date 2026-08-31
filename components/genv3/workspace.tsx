"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { ProductPicker, type PickableProduct } from "@/components/products/product-picker";
import { GenerationGallery } from "@/components/genv3/gallery";
import { MobileDock } from "@/components/genv3/mobile-dock";
import {
  CostSummary, DescriptionSection, InspirationSection, ProductRefsSection,
  PromptSection, SessionTypeSection, SettingsSection, ShotBriefsSection, VariantChips,
} from "@/components/genv3/sections";
import { ModelSelect } from "@/components/genv3/model-select";
import {
  snapTo, unitPrice,
  type BriefState, type GalleryItem, type GenMode, type GenModel, type UploadedRef,
} from "@/components/genv3/types";
import type { CategoryVariant } from "@/lib/categories";

export type WorkspaceProduct = {
  id: string; name: string;
  category: string | null;
  description: string | null;
  images: { path: string; url: string }[];
};

/**
 * GENERATOR WORKSPACE — one screen, two flavours.
 *
 * LEFT: the whole configuration (photos, description, session type or
 * prompt, settings, model, briefs/inspiration, cost). RIGHT: the living
 * gallery of this workspace's generations. On phones the configuration
 * stacks and every generation-critical control also lives in the docked
 * toolbar above the bottom navigation, opening bottom sheets.
 *
 * The managed flavour drives the hidden GrovBase engine: prepare (one
 * planner pass, prompts sealed server-side) then generate each shot through
 * /api/concepts/generate with limited concurrency — every image appears in
 * the gallery the moment it exists. The custom flavour posts the customer's
 * own prompt to /api/generate. Prices always come from the model config the
 * server also uses; the server re-computes and enforces them regardless.
 */
export function GeneratorWorkspace({
  mode, models, products, credits, workspaceId, engineAvailable = true,
  initialItems, initialCursor, initialStyle, initialRatio, initialShots,
  variant, initialPrompt = "",
}: {
  mode: GenMode;
  models: GenModel[];
  products: WorkspaceProduct[];
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
  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const adhocFolder = useRef(`adhoc-${Math.random().toString(36).slice(2, 10)}`);
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

  const pickable: PickableProduct[] = useMemo(() => products.map((p) => ({
    id: p.id, name: p.name, category: p.category,
    thumbnail: p.images[0]?.url ?? null, imageCount: p.images.length,
  })), [products]);

  function pickProduct(id: string) {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (p) {
      setName(p.name);
      setDescription(p.description ?? "");
      setRefs(p.images.map((img) => ({ key: img.path, path: img.path, url: img.url })));
    } else {
      setName(""); setDescription(""); setRefs([]);
    }
  }

  // ── Uploads (browser → private bucket; only paths travel to the API) ───
  async function upload(files: FileList, target: "refs" | "insp") {
    setUploading(true);
    const supabase = createClient();
    const folder = target === "insp" ? inspFolder.current : (productId || adhocFolder.current);
    const setter = target === "insp" ? setInsp : setRefs;
    const cap = target === "insp" ? 5 : 8;
    for (const file of Array.from(files)) {
      if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) { toast.error(t("products.invalidType")); continue; }
      if (file.size > 10 * 1024 * 1024) { toast.error(t("products.tooLarge")); continue; }
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${workspaceId}/${folder}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file);
      if (error) { toast.error(t("common.error")); continue; }
      setter((prev) => prev.length >= cap ? prev : [...prev, { key: path, path, url: URL.createObjectURL(file) }]);
    }
    setUploading(false);
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
          productId: productId || undefined,
          productName: name.trim(),
          description: description.trim() || undefined,
          style: composeVariantStyle() || undefined,
          aspectRatio: effRatio,
          resolution: effResolution,
          shots: effCount,
          sessionType,
          shotBriefs: briefs.slice(0, effCount).map((b) => ({
            text: b?.text?.trim() || undefined,
            keepFraming: !!b?.keepFraming && !!b?.text?.trim(),
          })),
          referencePaths: refs.map((r) => r.path).slice(0, 8),
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
          productId: productId || undefined,
          newProduct: productId ? undefined : { name: name.trim(), description: description.trim() || undefined },
          referencePaths: refs.map((r) => r.path).slice(0, 8),
          referenceImageIds: [],
          inspirationPaths: insp.map((r) => r.path).slice(0, 5),
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string; productId?: string; images?: unknown[] };
      if (json.ok) {
        if (!productId && json.productId) setProductId(json.productId);
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

  const contextReady = productId ? true : name.trim().length > 1;
  const canGenerate = !!model && !busy && !uploading && refs.length > 0 && contextReady
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
    <div className="grid min-w-0 items-start gap-5 pb-[var(--gen-page-bottom)] [&>*]:min-w-0 lg:grid-cols-[400px_minmax(0,1fr)] lg:pb-10 xl:grid-cols-[420px_minmax(0,1fr)]">
      {/* ── LEFT: configuration ─────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--header-h)+0.875rem)] lg:h-[calc(100dvh-var(--header-h)-1.75rem)]">
        <div className="panel thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto rounded-2xl p-4 sm:p-5">
          <ProductRefsSection
            refs={refs}
            uploading={uploading}
            product={productId ? pickable.find((p) => p.id === productId) ?? null : null}
            onPickProduct={() => setPickerOpen(true)}
            onClearProduct={() => pickProduct("")}
            onUpload={(files) => upload(files, "refs")}
            onRemove={(i) => setRefs((prev) => prev.filter((_, j) => j !== i))}
          />
          <DescriptionSection
            showName={!productId}
            name={name} onName={setName}
            description={description} onDescription={setDescription}
          />
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
                const base = next[i] ?? { text: "", keepFraming: false };
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
          needsContext={!contextReady}
          needsPrompt={!managed && prompt.trim().length <= 2}
          onGenerate={generate}
        />
      </div>

      {/* ── RIGHT: the living gallery ───────────────────────────────────── */}
      <GenerationGallery
        initialItems={initialItems}
        initialCursor={initialCursor}
        freshItems={freshItems}
        pendingCount={pendingCount}
        pendingRatio={effRatio}
        models={models}
        balance={balance}
        onBalance={setBalance}
        onAbsorb={absorbLatest}
      />

      <ProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={pickable}
        selectedId={productId || undefined}
        onSelect={(p) => pickProduct(p.id)}
      />

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
