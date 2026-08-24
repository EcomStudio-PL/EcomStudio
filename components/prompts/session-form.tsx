"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ImagePlus, Layers, Loader2, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { Panel } from "@/components/ui/surface";
import { PanelHeader } from "@/components/ui/section-header";
import { StepPanel, TipCard } from "@/components/ui/step-panel";
import { CreditsPanel } from "@/components/ui/credits-panel";
import { ActionBar } from "@/components/ui/action-bar";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ProductPicker, ProductChoice, type PickableProduct } from "@/components/products/product-picker";

export type PromptProductOption = {
  id: string; name: string;
  category?: string | null;
  description?: string | null;
  extraInfo?: string | null;
  images: { path: string; url: string }[];
};

/** One image model as the seller chooses it: identity plus BOTH per-shot
 *  prices (engine prompt vs own prompt) — admin pricing, never client math. */
export type SessionModelOption = {
  id: string;
  name: string;
  badge: string | null;
  costCustom: number;
  costEcom: number;
};

type Ref = { key: string; path: string; url: string };

const RATIOS = ["1:1", "4:5", "16:9", "9:16"] as const;
const SHOT_CHOICES = [5, 6, 7, 8, 9, 10] as const;

/** Same gradient monogram tiles as AI Studio — one visual language. */
const MODEL_TILES = [
  "bg-[linear-gradient(135deg,#C900CF,#F800F8_60%,#FF3DDA)]",
  "bg-[linear-gradient(135deg,#4338CA,#7A82FF_60%,#A5B4FC)]",
  "bg-[linear-gradient(135deg,#B45309,#F59E0B_60%,#FCD34D)]",
  "bg-[linear-gradient(135deg,#047857,#10B981_60%,#6EE7B7)]",
  "bg-[linear-gradient(135deg,#0E7490,#06B6D4_60%,#67E8F9)]",
] as const;

/**
 * GENERATOR UJĘĆ — the session workspace as four numbered steps: product →
 * references → working mode (EcomStudio engine vs own prompts) → generate.
 * The right rail carries the model picker (it drives every price on screen
 * and becomes the board's default), the wallet card and recent sessions.
 * Preparing a session charges nothing; credits move only when shots are
 * generated on the board — the summary says so out loud.
 */
export function SessionForm({ products, workspaceId, engineAvailable, models, balance, plan, aside }: {
  products: PromptProductOption[]; workspaceId: string; engineAvailable: boolean;
  models: SessionModelOption[];
  balance: number;
  plan?: string;
  /** Server-rendered extras for the right rail (recent sessions). */
  aside?: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<"engine" | "custom">("engine");
  const [customPrompts, setCustomPrompts] = useState<string[]>([""]);
  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [extraInfo, setExtraInfo] = useState("");
  const [style, setStyle] = useState("");
  const [styleOpen, setStyleOpen] = useState(false);
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>("16:9");
  const [shots, setShots] = useState(5);
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [refs, setRefs] = useState<Ref[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"analyzing" | "lock" | "prompts">("analyzing");
  const [failure, setFailure] = useState<string | null>(null);
  const submitting = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const adhocFolder = useRef(`adhoc-${Math.random().toString(36).slice(2, 10)}`);
  const [pickerOpen, setPickerOpen] = useState(false);

  /** Same picker shape as AI Studio — one selector for the whole product. */
  const pickable: PickableProduct[] = useMemo(() => products.map((p) => ({
    id: p.id, name: p.name, category: p.category,
    thumbnail: p.images[0]?.url ?? null, imageCount: p.images.length,
  })), [products]);

  const model = useMemo(() => models.find((m) => m.id === modelId) ?? models[0] ?? null, [models, modelId]);
  const perShot = model ? (mode === "engine" ? model.costEcom : model.costCustom) : 0;
  const validCustom = customPrompts.filter((p) => p.trim().length >= 3);
  const plannedCount = mode === "engine" ? shots : validCustom.length;
  const totalCost = plannedCount * perShot;

  const canSubmit = name.trim().length > 1 && refs.length > 0 && !busy && !uploading
    && (mode === "engine" ? engineAvailable : validCustom.length > 0);

  function pickProduct(id: string) {
    if (id === productId) return;
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (p) {
      setName(p.name);
      setDescription(p.description ?? "");
      setExtraInfo(p.extraInfo ?? "");
      setRefs(p.images.map((img) => ({ key: img.path, path: img.path, url: img.url })));
    } else {
      setName(""); setDescription(""); setExtraInfo(""); setRefs([]);
    }
  }

  async function upload(files: FileList) {
    setUploading(true);
    const supabase = createClient();
    const folder = productId || adhocFolder.current;
    for (const file of Array.from(files)) {
      if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) { toast.error(t("products.invalidType")); continue; }
      if (file.size > 10 * 1024 * 1024) { toast.error(t("products.tooLarge")); continue; }
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${workspaceId}/${folder}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file);
      if (error) { toast.error(t("common.error")); continue; }
      setRefs((prev) => [...prev, { key: path, path, url: URL.createObjectURL(file) }]);
    }
    setUploading(false);
  }

  /** After a dropped connection: watch for the session the server is still
   *  preparing (same workspace, same product, started moments ago). */
  async function rescueSession(): Promise<string | null> {
    const supabase = createClient();
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 4000));
      const { data } = await supabase
        .from("prompt_sessions")
        .select("id,status")
        .eq("workspace_id", workspaceId)
        .eq("product_name", name.trim())
        .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.status === "ready") return data.id;
      if (data?.status === "failed") return null;
    }
    return null;
  }

  /** The board opens with the model chosen here as its default. */
  function boardUrl(sessionId: string) {
    return modelId ? `/prompts/${sessionId}?m=${modelId}` : `/prompts/${sessionId}`;
  }

  async function submitCustom() {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setFailure(null);
    setBusy(true);
    try {
      const res = await fetch("/api/prompts/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: productId || undefined,
          productName: name, description: description || undefined,
          extraInfo: extraInfo || undefined,
          aspectRatio: ratio,
          referencePaths: refs.map((r) => r.path).slice(0, 8),
          prompts: validCustom.slice(0, 10),
        }),
      });
      const json = await res.json() as { ok: boolean; sessionId?: string; error?: string };
      if (json.ok && json.sessionId) {
        router.push(boardUrl(json.sessionId));
        return;
      }
      const known = t(`studio.err.${json.error}`, {});
      const message = known && known !== `studio.err.${json.error}` ? known : t("common.error");
      setFailure(message);
      toast.error(message);
      setBusy(false);
    } catch {
      setFailure(t("common.error"));
      toast.error(t("common.error"));
      setBusy(false);
    } finally {
      submitting.current = false;
    }
  }

  async function submit() {
    if (mode === "custom") return submitCustom();
    // Guard the request itself, not just the disabled attribute: a double tap
    // on mobile must never start two analyses (or two draft products).
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setFailure(null);
    setBusy(true);
    setStage("analyzing");
    // The server runs analysis -> Product Lock -> N hidden concepts in one request;
    // these timings mirror the real stage durations so the label stays honest.
    const toLock = setTimeout(() => setStage("lock"), 9_000);
    const toPrompts = setTimeout(() => setStage("prompts"), 14_000);
    try {
      const res = await fetch("/api/prompts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: productId || undefined,
          productName: name, description: description || undefined,
          extraInfo: extraInfo || undefined, style: style || undefined,
          aspectRatio: ratio,
          shots,
          referencePaths: refs.map((r) => r.path).slice(0, 8),
        }),
      });
      const json = await res.json() as { ok: boolean; sessionId?: string; error?: string };
      if (json.ok && json.sessionId) {
        router.push(boardUrl(json.sessionId));
        return; // keep the button busy until the new route paints
      }
      const known = t(`studio.err.${json.error}`, {});
      const message = known && known !== `studio.err.${json.error}` ? known : t("concepts.prepareFailed");
      setFailure(message);
      toast.error(message);
      setBusy(false);
    } catch {
      // The connection died mid-preparation (proxies cap long responses) but
      // the pipeline usually finishes server-side — find its session before
      // declaring failure. The server dedupes replays the same way.
      const rescued = await rescueSession();
      if (rescued) {
        router.push(boardUrl(rescued));
        return;
      }
      setFailure(t("concepts.prepareFailed"));
      toast.error(t("concepts.prepareFailed"));
      setBusy(false);
    } finally {
      clearTimeout(toLock);
      clearTimeout(toPrompts);
      submitting.current = false;
    }
  }

  return (
    <div className="grid min-w-0 gap-5 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5 pb-32 lg:pb-0">
        {/* KROK 1 — PRODUKT */}
        <StepPanel n={1} overline={t("psess.step1")} title={t("studio.context")} sub={t("psess.step1Sub")}>
          <div className="space-y-4">
            <ProductChoice
              product={productId ? pickable.find((x) => x.id === productId) : null}
              onPick={() => setPickerOpen(true)}
              onClear={() => pickProduct("")}
              newLabel={t("studio.newProduct")}
            />
            <div>
              <Label>{t("psess.name")} *</Label>
              <Input value={name} placeholder={t("products.namePh")} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>{t("psess.description")}</Label>
              <Textarea rows={4} value={description} placeholder={t("psess.descriptionPh")}
                onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <Label>{t("studio.extraInfo")}</Label>
              <Textarea rows={2} value={extraInfo} placeholder={t("studio.extraInfoPh")}
                onChange={(e) => setExtraInfo(e.target.value)} />
            </div>
          </div>
        </StepPanel>

        {/* KROK 2 — REFERENCJE */}
        <StepPanel
          n={2}
          overline={t("psess.step2")}
          title={t("psess.photos")}
          sub={t("psess.step2Sub")}
          action={refs.length > 0 ? (
            <span className="plate rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums text-muted">
              {refs.length}/8
            </span>
          ) : undefined}
        >
          <div className="space-y-3">
            <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif"
              className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
              {refs.map((r, i) => (
                <div key={r.key} className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="" className="h-full w-full object-cover" />
                  <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
                  <button type="button" aria-label={t("common.delete")}
                    onClick={() => setRefs(refs.filter((_, j) => j !== i))}
                    className="absolute right-1.5 top-1.5 hidden rounded-full bg-black/60 p-1 text-white group-hover:block">
                    <X size={10} />
                  </button>
                </div>
              ))}
              <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/60 text-faint transition-colors hover:border-[rgb(var(--accent)/0.6)] hover:bg-accent-soft/30 hover:text-accent"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}>
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                <span className="text-[10px] font-semibold">{t("products.upload")}</span>
              </button>
            </div>
            <TipCard>{t("psess.tipRefs")}</TipCard>
          </div>
        </StepPanel>

        {/* KROK 3 — TRYB PRACY: gotowy silnik vs własne prompty. */}
        <StepPanel n={3} overline={t("psess.step3")} title={t("psess.modeTitle")} sub={t("psess.step3Sub")}>
          <div className="space-y-4">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <button type="button" onClick={() => setMode("engine")} aria-pressed={mode === "engine"}
                className={cn("rounded-xl border p-3.5 text-left transition-colors",
                  mode === "engine" ? "is-selected" : "border-line hover:bg-raised")}>
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {t("psess.modeEngine")}
                  <span className="rounded-full brand-gradient px-2 py-0.5 text-[10px] font-bold text-white">{t("psess.modeEngineBadge")}</span>
                </span>
                <span className="mt-1.5 block text-[11px] leading-relaxed text-muted">{t("psess.modeEngineSub")}</span>
                {model && <span className="mt-1.5 block text-[11px] font-semibold tabular-nums text-accent">{t("psess.modePrice", { model: model.name, n: model.costEcom })}</span>}
              </button>
              <button type="button" onClick={() => setMode("custom")} aria-pressed={mode === "custom"}
                className={cn("rounded-xl border p-3.5 text-left transition-colors",
                  mode === "custom" ? "is-selected" : "border-line hover:bg-raised")}>
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {t("psess.modeCustom")}
                  <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-bold text-muted ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]">{t("psess.modeCustomBadge")}</span>
                </span>
                <span className="mt-1.5 block text-[11px] leading-relaxed text-muted">{t("psess.modeCustomSub")}</span>
                {model && <span className="mt-1.5 block text-[11px] font-semibold tabular-nums text-accent">{t("psess.modePrice", { model: model.name, n: model.costCustom })}</span>}
              </button>
            </div>

            {mode === "engine" && (
              <>
                <div>
                  <Label>{t("concepts.shots")}</Label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {SHOT_CHOICES.map((n) => (
                      <button key={n} type="button" onClick={() => setShots(n)}
                        aria-pressed={n === shots}
                        className={cn("rounded-xl border py-2.5 text-sm font-bold tabular-nums transition-colors",
                          n === shots ? "is-selected text-accent" : "border-line text-muted hover:bg-raised")}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                {/* SLOTY — the batch made visible: one slot per shot, scenes
                    assigned by the engine, reviewed on the board before any
                    credit is spent. */}
                <div className="plate rounded-xl p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: shots }, (_, i) => (
                      <span key={i} className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgb(var(--accent)/0.12)] text-[11px] font-bold tabular-nums text-accent ring-1 ring-[rgb(var(--accent)/0.25)]">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted">{t("psess.slotHint")}</p>
                </div>
                <div>
                  <button type="button" onClick={() => setStyleOpen(!styleOpen)}
                    className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
                    <ChevronDown size={13} className={cn("transition-transform", styleOpen && "rotate-180")} />
                    {t("psess.styleToggle")}
                  </button>
                  {styleOpen && (
                    <div className="mt-2">
                      <Input value={style} placeholder={t("psess.stylePh")} onChange={(e) => setStyle(e.target.value)} />
                    </div>
                  )}
                </div>
                {!engineAvailable && (
                  <p className="rounded-xl bg-raised px-4 py-3 text-xs text-muted">{t("psess.unavailable")}</p>
                )}
              </>
            )}

            {mode === "custom" && (
              <div>
                <Label>{t("psess.customPrompts")}</Label>
                <div className="space-y-2">
                  {customPrompts.map((cp, i) => (
                    <div key={i} className="relative">
                      <span className="absolute -top-2 left-3 z-10 rounded-md bg-[rgb(var(--accent)/0.14)] px-1.5 text-[10px] font-bold tabular-nums text-accent">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <Textarea rows={3} value={cp} placeholder={t("psess.customPromptPh", { n: i + 1 })}
                        onChange={(e) => setCustomPrompts(customPrompts.map((v, j) => j === i ? e.target.value : v))} />
                      {customPrompts.length > 1 && (
                        <button type="button" aria-label={t("common.delete")}
                          onClick={() => setCustomPrompts(customPrompts.filter((_, j) => j !== i))}
                          className="absolute right-2 top-2 rounded-full bg-black/40 p-1 text-white hover:bg-black/60">
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {customPrompts.length < 10 && (
                  <button type="button" onClick={() => setCustomPrompts([...customPrompts, ""])}
                    className="mt-2 rounded-lg bg-raised px-3 py-2 text-xs font-semibold text-ink hover:bg-sunken">
                    + {t("psess.customAdd")}
                  </button>
                )}
                <TipCard className="mt-3">{t("psess.tipCustom")}</TipCard>
              </div>
            )}
          </div>
        </StepPanel>

        {/* KROK 4 — GENERUJ: format, the honest math, the one CTA. */}
        <StepPanel n={4} last overline={t("psess.step4")} title={t("psess.step4Title")} sub={t("psess.step4Sub")}>
          <div className="space-y-4">
            <div>
              <Label>{t("generator.stepFormat")}</Label>
              <div className="flex gap-1.5">
                {RATIOS.map((r) => (
                  <button key={r} type="button" onClick={() => setRatio(r)}
                    aria-pressed={r === ratio}
                    className={cn("flex-1 rounded-lg border py-2 text-xs font-semibold transition-colors",
                      r === ratio ? "is-selected text-accent" : "border-line text-muted hover:bg-raised")}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Cost summary — every number the seller needs BEFORE acting. */}
            <div className="plate space-y-1.5 rounded-xl px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">{t("psess.summaryShots")}</span>
                <span className="font-semibold tabular-nums">{plannedCount}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">{t("concepts.model")}</span>
                <span className="min-w-0 truncate font-semibold">{model?.name ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">{t("psess.summaryPer")}</span>
                <span className="font-semibold tabular-nums">{perShot} kr.</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line pt-1.5">
                <span className="font-medium text-ink">{t("psess.summaryTotal")}</span>
                <span className="metric text-[17px] text-accent">{totalCost} kr.</span>
              </div>
              <p className="pt-0.5 text-[11px] leading-relaxed text-faint">{t("psess.chargeNote")}</p>
            </div>

            <ActionBar
              summary={
                <>
                  <span className="text-xs font-medium uppercase tracking-wide text-muted">{t("studio.yourCredits")}</span>
                  <span className="metric text-[15px] text-accent">◆ {new Intl.NumberFormat(locale).format(balance)}</span>
                </>
              }
              note={failure && !busy ? (
                <span role="alert" className="text-danger">{failure} <span className="text-muted">{t("psess.retryHint")}</span></span>
              ) : undefined}
            >
              <button type="button" disabled={!canSubmit} onClick={submit}
                className={cn("cta flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold",
                  !canSubmit && "cursor-not-allowed opacity-50")}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {mode === "custom"
                  ? (busy ? t("common.saving") : t("psess.customCta", { n: validCustom.length }))
                  : (busy ? t(`psess.stage_${stage}`, { n: shots }) : t("concepts.prepare", { n: shots }))}
              </button>
            </ActionBar>

            {busy && mode === "engine" && (
              <div className="space-y-2 rounded-xl bg-raised px-4 py-3 anim-fade">
                {(["analyzing", "lock", "prompts"] as const).map((s, i) => {
                  const idx = ["analyzing", "lock", "prompts"].indexOf(stage);
                  const done = i < idx;
                  return (
                    <p key={s} className={cn("flex items-center gap-2 text-xs",
                      i === idx ? "font-medium text-ink" : done ? "text-muted" : "text-faint")}>
                      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full",
                        i === idx ? "bg-accent" : done ? "bg-accent/40" : "bg-line-strong")} />
                      <span className="tabular-nums text-faint">{i + 1}/3</span> {t(`psess.stage_${s}`, { n: shots })}
                    </p>
                  );
                })}
                <p className="text-xs text-faint">{t("psess.stepHint")}</p>
              </div>
            )}
          </div>
        </StepPanel>
      </div>

      {/* RIGHT RAIL — model choice (drives all pricing + the board default),
          the wallet, recent sessions. */}
      <div className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:h-fit">
        {models.length > 0 && (
          <Panel>
            <PanelHeader overline={t("concepts.model")} title={t("concepts.chooseModel")} sub={t("studio.chooseModelSub")} icon={Layers} />
            <div className="space-y-2 px-3 pb-4 sm:px-4">
              {models.map((m, idx) => {
                const selected = m.id === (model?.id ?? "");
                const price = mode === "engine" ? m.costEcom : m.costCustom;
                return (
                  <button key={m.id} type="button" onClick={() => setModelId(m.id)}
                    aria-pressed={selected}
                    className={cn(
                      "relative w-full overflow-hidden rounded-xl border p-3 text-left transition-all duration-200",
                      selected
                        ? "is-selected"
                        : "border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.6))] bg-sunken/50 hover:border-[rgb(var(--accent)/0.35)] hover:bg-raised/60"
                    )}>
                    <div className="flex items-center gap-3">
                      <span aria-hidden className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-sm font-bold text-white",
                        "shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_6px_14px_-6px_rgb(0_0_0/0.45)]",
                        MODEL_TILES[idx % MODEL_TILES.length],
                      )}>
                        {m.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "AI"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-semibold tracking-tight">{m.name}</p>
                          <span className={cn(
                            "shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold tabular-nums",
                            selected ? "bg-[rgb(var(--accent)/0.22)] text-accent" : "bg-raised text-muted"
                          )}>
                            {t("concepts.perShot", { n: price })}
                          </span>
                        </div>
                        {m.badge && (
                          <div className="mt-1">
                            <Badge tone="amber">{t(`models.badge.${m.badge}`, {}) || m.badge}</Badge>
                          </div>
                        )}
                      </div>
                    </div>
                    {selected && (
                      <span aria-hidden className="absolute right-0 top-0 h-full w-[3px] brand-gradient" />
                    )}
                  </button>
                );
              })}
            </div>
          </Panel>
        )}

        <CreditsPanel credits={balance} plan={plan} />

        {aside}
      </div>

      <ProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={pickable}
        selectedId={productId || undefined}
        onSelect={(p) => pickProduct(p.id)}
      />
    </div>
  );
}
