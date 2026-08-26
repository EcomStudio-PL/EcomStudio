"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, ImagePlus, Loader2, Package, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { Input, Textarea, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ProductPicker, ProductChoice, type PickableProduct } from "@/components/products/product-picker";
import { GenerationToolbar, type ToolbarModel, type ToolbarState } from "@/components/generator/generation-toolbar";
import { RecentPanel, type RecentSession } from "@/components/prompts/recent-panel";
import { DEFAULT_VARIANT, type CategoryVariant } from "@/lib/categories";

export type PromptProductOption = {
  id: string; name: string;
  category?: string | null;
  description?: string | null;
  extraInfo?: string | null;
  images: { path: string; url: string }[];
};

/** One image model as the seller chooses it: identity, per-size prices and
 *  the capabilities the toolbar is allowed to offer. */
export type SessionModelOption = {
  id: string;
  name: string;
  badge: string | null;
  costCustom: number;
  costEcom: number;
  pricing: Record<string, number>;
  resolutions: string[];
  ratios: string[];
  ecomSurcharge: number;
};

type Ref = { key: string; path: string; url: string };

const RATIOS = ["1:1", "4:5", "16:9", "9:16"] as const;
const SHOT_CHOICES = [5, 6, 7, 8, 9, 10] as const;

/**
 * GENERATOR WORKSPACE — one compact screen instead of four tall steps.
 *
 * Everything that decides what gets rendered and what it costs lives in the
 * docked toolbar at the bottom: prompt mode, engine, framing, output size,
 * shot count, running total, CTA. The page above it holds only the things
 * that genuinely need room — the product, its reference photos and the shot
 * presets — so changing a setting never means scrolling back up. Nothing is
 * offered twice: if a control is in the toolbar it is not repeated here.
 *
 * Category workspaces pass a `variant`: which shot presets make sense, which
 * extra decisions that kind of work needs, and which framings to lead with.
 * Those choices are appended to the style directive the planner reads, so a
 * fashion session and a mailing session genuinely brief the engine
 * differently rather than sharing one form with a different title.
 */
export function SessionForm({
  products, workspaceId, engineAvailable, models, balance, initialStyle,
  initialRatio, initialShots, variant = DEFAULT_VARIANT, recent = [],
}: {
  products: PromptProductOption[]; workspaceId: string; engineAvailable: boolean;
  models: SessionModelOption[];
  balance: number;
  /** Style hint preselected by a category workflow. */
  initialStyle?: string;
  initialRatio?: (typeof RATIOS)[number];
  initialShots?: number;
  /** What makes this category its own tool. */
  variant?: CategoryVariant;
  /** Recent sessions for the right rail. */
  recent?: RecentSession[];
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [customPrompts, setCustomPrompts] = useState<string[]>([""]);
  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [extraInfo, setExtraInfo] = useState("");
  const [style, setStyle] = useState(initialStyle ?? "");
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [shotTypes, setShotTypes] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(variant.controls.filter((c) => c.initial).map((c) => [c.key, c.initial!])));
  const [refs, setRefs] = useState<Ref[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"analyzing" | "lock" | "prompts">("analyzing");
  const [failure, setFailure] = useState<string | null>(null);
  const submitting = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const adhocFolder = useRef(`adhoc-${Math.random().toString(36).slice(2, 10)}`);
  const [pickerOpen, setPickerOpen] = useState(false);

  const firstModel = models[0];
  const [bar, setBar] = useState<ToolbarState>({
    mode: "engine",
    modelId: firstModel?.id ?? "",
    ratio: initialRatio ?? (variant.ratioOrder[0] as string) ?? "16:9",
    resolution: firstModel?.resolutions[0] ?? "1K",
    shots: initialShots ?? 5,
  });
  const patchBar = (next: Partial<ToolbarState>) => setBar((b) => ({ ...b, ...next }));

  const toolbarModels: ToolbarModel[] = useMemo(() => models.map((m) => ({
    id: m.id, name: m.name, badge: m.badge,
    pricing: m.pricing, resolutions: m.resolutions,
    // Lead with this category's framings, but only the ones the engine renders.
    ratios: variant.ratioOrder.filter((r) => m.ratios.length === 0 || m.ratios.includes(r)),
    ecomSurcharge: m.ecomSurcharge,
  })), [models, variant.ratioOrder]);

  const pickable: PickableProduct[] = useMemo(() => products.map((p) => ({
    id: p.id, name: p.name, category: p.category,
    thumbnail: p.images[0]?.url ?? null, imageCount: p.images.length,
  })), [products]);

  const validCustom = customPrompts.filter((p) => p.trim().length >= 3);
  const plannedCount = bar.mode === "engine" ? bar.shots : validCustom.length;
  const canSubmit = name.trim().length > 1 && refs.length > 0 && !busy && !uploading
    && (bar.mode === "engine" ? engineAvailable : validCustom.length > 0);

  /** Everything the seller decided on this screen, as one directive for the
   *  planner: the workflow's style, the chosen shot types and the category's
   *  own answers. This is why the categories differ where it counts. */
  function composeStyle(): string {
    const shotLabels = shotTypes.map((k) => t(`generator.mt.${k}`));
    const directives = variant.controls
      .map((c) => c.options.find((o) => o.key === choices[c.key])?.directive)
      .filter((d): d is string => Boolean(d && d.trim()));
    return [style.trim(), shotLabels.join(", "), ...directives]
      .filter((p) => p.length > 0).join(". ");
  }

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

  function boardUrl(sessionId: string) {
    return bar.modelId ? `/prompts/${sessionId}?m=${bar.modelId}` : `/prompts/${sessionId}`;
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
          aspectRatio: bar.ratio,
          resolution: bar.resolution,
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
    if (bar.mode === "custom") return submitCustom();
    // Guard the request itself, not just the disabled attribute: a double tap
    // on mobile must never start two analyses (or two draft products).
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setFailure(null);
    setBusy(true);
    setStage("analyzing");
    const toLock = setTimeout(() => setStage("lock"), 9_000);
    const toPrompts = setTimeout(() => setStage("prompts"), 14_000);
    try {
      const res = await fetch("/api/prompts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: productId || undefined,
          productName: name, description: description || undefined,
          extraInfo: extraInfo || undefined,
          style: composeStyle() || undefined,
          aspectRatio: bar.ratio,
          resolution: bar.resolution,
          shots: bar.shots,
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

  const steps = [
    { n: 1, key: "step1", done: name.trim().length > 1 },
    { n: 2, key: "step2", done: refs.length > 0 },
    { n: 3, key: "step3", done: bar.mode === "custom" ? validCustom.length > 0 : shotTypes.length > 0 },
    { n: 4, key: "step4", done: canSubmit },
  ];
  const current = steps.find((s) => !s.done)?.n ?? 4;
  const chosenProduct = productId ? pickable.find((x) => x.id === productId) : null;

  return (
    <div className="min-w-0">
      {/* STEPPER — four compact cards, not four tall sections. */}
      <div className="thin-scroll mb-4 flex gap-2 overflow-x-auto pb-1 [&>*]:min-w-0">
        {steps.map((s) => (
          <a
            key={s.n}
            href={`#ws-${s.key}`}
            className={cn(
              "panel flex min-w-[10rem] flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors duration-200",
              s.n === current && "border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.06)]",
            )}
          >
            <span aria-hidden className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold",
              s.done ? "bg-[rgb(var(--success)/0.16)] text-success"
                : s.n === current ? "brand-gradient text-white" : "bg-raised text-faint",
            )}>
              {s.done ? <Check size={13} strokeWidth={3} /> : s.n}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-semibold">{t(`ws.${s.key}`)}</span>
              <span className="block truncate text-[10.5px] text-faint">{t(`ws.${s.key}Sub`)}</span>
            </span>
          </a>
        ))}
      </div>

      <div className="grid min-w-0 gap-4 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Bottom padding clears the docked toolbar (and, on phones, the
            bottom navigation underneath it). */}
        <div className="min-w-0 space-y-4 pb-[13rem] lg:pb-[8.5rem]">
          {/* PRODUCT */}
          <section id="ws-step1" className="panel rounded-2xl p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="overline">{t("ws.yourProduct")}</p>
              {chosenProduct && (
                <button type="button" onClick={() => setPickerOpen(true)}
                  className="text-[12px] font-semibold text-accent transition-opacity duration-200 hover:opacity-75">
                  {t("ws.changeProduct")}
                </button>
              )}
            </div>
            <ProductChoice
              product={chosenProduct ?? null}
              onPick={() => setPickerOpen(true)}
              onClear={() => pickProduct("")}
              newLabel={t("studio.newProduct")}
            />
            <div className="mt-3.5">
              <Label>{t("psess.name")} *</Label>
              <Input value={name} placeholder={t("products.namePh")} onChange={(e) => setName(e.target.value)} />
            </div>
            <button type="button" onClick={() => setFieldsOpen(!fieldsOpen)}
              className="mt-3 flex items-center gap-1 text-xs font-semibold text-muted transition-colors duration-200 hover:text-ink">
              <ChevronDown size={13} className={cn("transition-transform duration-200", fieldsOpen && "rotate-180")} />
              {t("ws.moreFields")}
            </button>
            {fieldsOpen && (
              <div className="animate-fade mt-3 space-y-3">
                <div>
                  <Label>{t("psess.description")}</Label>
                  <Textarea rows={3} value={description} placeholder={t("psess.descriptionPh")}
                    onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div>
                  <Label>{t("studio.extraInfo")}</Label>
                  <Textarea rows={2} value={extraInfo} placeholder={t("studio.extraInfoPh")}
                    onChange={(e) => setExtraInfo(e.target.value)} />
                </div>
                <div>
                  <Label>{t("ws.styleLabel")}</Label>
                  <Input value={style} placeholder={t("psess.stylePh")} onChange={(e) => setStyle(e.target.value)} />
                </div>
              </div>
            )}
          </section>

          {/* REFERENCES */}
          <section id="ws-step2" className="panel rounded-2xl p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="overline">{t("psess.photos")}</p>
              <span className="plate rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums text-muted">
                {t("ws.refsCount", { n: refs.length })}
              </span>
            </div>
            <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif"
              className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
              {refs.map((r, i) => (
                <div key={r.key} className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="" className="h-full w-full object-cover" />
                  <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
                  <button type="button" aria-label={t("common.delete")}
                    onClick={() => setRefs(refs.filter((_, j) => j !== i))}
                    className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <X size={10} />
                  </button>
                </div>
              ))}
              {refs.length < 8 && (
                <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/60 text-faint transition-colors duration-200 hover:border-[rgb(var(--accent)/0.6)] hover:bg-accent-soft/30 hover:text-accent"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}>
                  {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                  <span className="text-[9.5px] font-semibold">{t("ws.addRefs")}</span>
                </button>
              )}
            </div>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-faint">{t("psess.tipRefs")}</p>
          </section>

          {/* SHOT TYPES + CATEGORY DECISIONS */}
          {bar.mode === "engine" && (
            <section id="ws-step3" className="panel rounded-2xl p-4 sm:p-5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="overline">{t("ws.shotTypes")}</p>
                {shotTypes.length > 0 && (
                  <span className="text-[11px] font-semibold text-accent">{t("ws.selected", { n: shotTypes.length })}</span>
                )}
              </div>
              <p className="mb-3 text-[12px] leading-relaxed text-muted">{t("ws.shotTypesSub")}</p>
              {/* A horizontal scroller on phones — seven tall cards stacked
                  is exactly the scrolling this rebuild removes. */}
              <div className="thin-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4 xl:grid-cols-5">
                {variant.shotTypes.map((k) => {
                  const on = shotTypes.includes(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setShotTypes((p) => on ? p.filter((x) => x !== k) : [...p, k])}
                      className={cn(
                        "relative flex w-[8.5rem] shrink-0 flex-col overflow-hidden rounded-xl border p-2.5 text-left transition-colors duration-200 sm:w-auto",
                        on ? "is-selected" : "border-line hover:bg-raised",
                      )}
                    >
                      <span aria-hidden className={cn(
                        "mb-2 flex h-14 items-center justify-center rounded-lg text-[10px] font-bold uppercase tracking-wide",
                        on ? "bg-[rgb(var(--accent)/0.16)] text-accent" : "bg-sunken text-faint",
                      )}>
                        <Package size={18} strokeWidth={1.8} />
                      </span>
                      <span className={cn("truncate text-[12px] font-semibold", on ? "text-ink" : "text-muted")}>
                        {t(`generator.mt.${k}`)}
                      </span>
                      {on && (
                        <span aria-hidden className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white">
                          <Check size={10} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {variant.controls.length > 0 && (
                <div className="mt-4 space-y-3 border-t border-line pt-3.5">
                  {variant.controls.map((c) => (
                    <div key={c.key}>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">{t(`vc.${c.key}`)}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {c.options.map((o) => {
                          const on = (choices[c.key] ?? c.initial) === o.key;
                          return (
                            <button key={o.key} type="button" aria-pressed={on}
                              onClick={() => setChoices((p) => ({ ...p, [c.key]: o.key }))}
                              className={cn("rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors duration-200",
                                on ? "is-selected text-accent" : "border-line text-muted hover:bg-raised")}>
                              {t(`vc.${c.key}_${o.key}`)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!engineAvailable && (
                <p className="mt-3 rounded-xl bg-raised px-4 py-3 text-xs text-muted">{t("psess.unavailable")}</p>
              )}
            </section>
          )}

          {/* PROGRESS — only while the engine is working. */}
          {busy && bar.mode === "engine" && (
            <section id="ws-step4" className="panel animate-fade space-y-2 rounded-2xl p-4">
              {(["analyzing", "lock", "prompts"] as const).map((s, i) => {
                const idx = ["analyzing", "lock", "prompts"].indexOf(stage);
                const done = i < idx;
                return (
                  <p key={s} className={cn("flex items-center gap-2 text-xs",
                    i === idx ? "font-medium text-ink" : done ? "text-muted" : "text-faint")}>
                    <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full",
                      i === idx ? "bg-accent" : done ? "bg-accent/40" : "bg-line-strong")} />
                    <span className="tabular-nums text-faint">{i + 1}/3</span> {t(`psess.stage_${s}`, { n: bar.shots })}
                  </p>
                );
              })}
              <p className="text-xs text-faint">{t("psess.stepHint")}</p>
            </section>
          )}

          {/* Phones have no right rail — recent work rides here instead. */}
          <RecentPanel sessions={recent} horizontal className="xl:hidden" />
        </div>

        {/* RIGHT RAIL — recent generations only. Model, framing, size and
            count all live in the toolbar; repeating them here is what made
            the old page twice as tall as it needed to be. */}
        <aside className="hidden min-w-0 xl:sticky xl:top-20 xl:block xl:h-fit">
          <RecentPanel sessions={recent} />
        </aside>
      </div>

      <GenerationToolbar
        models={toolbarModels}
        state={bar}
        onChange={patchBar}
        shotRange={SHOT_CHOICES}
        credits={balance}
        disabled={!canSubmit}
        busy={busy}
        busyLabel={bar.mode === "custom" ? t("common.saving") : t(`psess.stage_${stage}`, { n: bar.shots })}
        ctaLabel={bar.mode === "custom"
          ? t("psess.customCta", { n: validCustom.length })
          : t("concepts.prepare", { n: plannedCount })}
        onGenerate={submit}
        note={failure && !busy ? (
          <span role="alert" className="text-danger">{failure} <span className="text-muted">{t("psess.retryHint")}</span></span>
        ) : undefined}
        promptSlot={
          <div>
            <Label>{t("psess.customPrompts")}</Label>
            <div className="space-y-2">
              {customPrompts.map((cp, i) => (
                <div key={i} className="relative">
                  <span className="absolute -top-2 left-3 z-10 rounded-md bg-[rgb(var(--accent)/0.14)] px-1.5 text-[10px] font-bold tabular-nums text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Textarea rows={2} value={cp} placeholder={t("psess.customPromptPh", { n: i + 1 })}
                    onChange={(e) => setCustomPrompts(customPrompts.map((v, j) => j === i ? e.target.value : v))} />
                  {customPrompts.length > 1 && (
                    <button type="button" aria-label={t("common.delete")}
                      onClick={() => setCustomPrompts(customPrompts.filter((_, j) => j !== i))}
                      className="absolute right-2 top-2 rounded-full bg-black/40 p-1 text-white transition-colors duration-200 hover:bg-black/60">
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {customPrompts.length < 10 && (
              <button type="button" onClick={() => setCustomPrompts([...customPrompts, ""])}
                className="mt-2 rounded-lg bg-raised px-3 py-2 text-xs font-semibold text-ink transition-colors duration-200 hover:bg-sunken">
                + {t("psess.customAdd")}
              </button>
            )}
          </div>
        }
      />

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
