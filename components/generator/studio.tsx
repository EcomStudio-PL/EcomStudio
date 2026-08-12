"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, Download, ImagePlus, Loader2, RefreshCw, Sparkles, Star, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { submitGenerationFeedbackAction } from "@/app/actions/feedback";

export type StudioProduct = {
  id: string; name: string; description: string | null; category: string | null;
  extra_info: string | null;
  images: { id: string; url: string; path: string; isPrimary: boolean }[];
};

/** Client-facing model: display identity + capabilities + pricing.
 *  Providers are backend infrastructure — they never reach this component. */
export type StudioModel = {
  id: string;
  displayName: string;
  badge: string | null;
  description: string | null;
  pricing: Record<string, number>;
  resolutions: string[];
  maxQuantity: number;
  supportsReferenceImages: boolean;
  supportsNegativePrompt: boolean;
};

/** Prefilled Studio session coming from a Prompty card — the user never
 *  re-uploads photos or re-copies prompts. */
export type StudioSession = {
  promptId: string;
  sessionId: string;
  productId: string | null;
  productName: string;
  prompt: string;
  negative: string;
  aspectRatio: string;
  refs: { path: string; url: string; selected: boolean }[];
};

type Ref = { key: string; path: string; url: string; imageId?: string; selected: boolean };
type ResultImage = { url: string; path: string };

const RATIOS = ["1:1", "4:5", "16:9", "9:16"] as const;
const ISSUE_KEYS = ["wrong_product", "wrong_color", "wrong_quantity", "wrong_anatomy", "wrong_scale", "bad_scene", "bad_quality", "other"] as const;

export function Studio({ products, models, credits, workspaceId, initialPrompt = "", session = null }: {
  products: StudioProduct[]; models: StudioModel[]; credits: number;
  workspaceId: string; initialPrompt?: string; session?: StudioSession | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [productId, setProductId] = useState<string>(session?.productId ?? "");
  const [np, setNp] = useState({ name: "", sku: "", category: "", description: "", extraInfo: "", sourceUrl: "" });
  const [moreOpen, setMoreOpen] = useState(false);
  const [refs, setRefs] = useState<Ref[]>(
    session ? session.refs.map((r) => ({ key: r.path, path: r.path, url: r.url, selected: r.selected })) : []
  );
  const [prompt, setPrompt] = useState(session?.prompt ?? initialPrompt);
  const [negative, setNegative] = useState(session?.negative ?? "");
  const [negOpen, setNegOpen] = useState(false);
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>(
    (RATIOS as readonly string[]).includes(session?.aspectRatio ?? "") ? session!.aspectRatio as (typeof RATIOS)[number] : "1:1"
  );
  const [resolution, setResolution] = useState<string>(models[0]?.resolutions[0] ?? "1K");
  const [quantity, setQuantity] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ResultImage[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [balance, setBalance] = useState(credits);
  const fileRef = useRef<HTMLInputElement>(null);
  const adhocFolder = useRef(`adhoc-${Math.random().toString(36).slice(2, 10)}`);

  const model = useMemo(() => models.find((m) => m.id === modelId), [models, modelId]);
  // Capability-driven UI: only resolutions this model supports are shown,
  // and the cost always mirrors the admin's per-resolution price config.
  const effectiveResolution = model?.resolutions.includes(resolution) ? resolution : model?.resolutions[0] ?? "1K";
  const unitPrice = model?.pricing[effectiveResolution] ?? 0;
  const cost = unitPrice * quantity;
  const missing = Math.max(0, cost - balance);
  const product = useMemo(() => products.find((p) => p.id === productId), [products, productId]);
  const contextReady = productId ? true : (session?.productName ?? np.name).trim().length > 1;
  const canGenerate = !!model && contextReady && prompt.trim().length > 2 && missing === 0 && !busy && !uploading;

  useEffect(() => {
    if (model && !model.resolutions.includes(resolution)) setResolution(model.resolutions[0] ?? "1K");
    if (model && quantity > model.maxQuantity) setQuantity(model.maxQuantity);
  }, [model, resolution, quantity]);

  function pickProduct(id: string) {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    setRefs(p ? p.images.map((img) => ({
      key: img.id, path: img.path, url: img.url, imageId: img.id, selected: true,
    })) : []);
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
      setRefs((prev) => [...prev, { key: path, path, url: URL.createObjectURL(file), selected: true }]);
    }
    setUploading(false);
  }

  async function generate() {
    if (!canGenerate || !model) return;
    setBusy(true);
    setResults([]);
    try {
      const selected = refs.filter((r) => r.selected);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: model.id, prompt, negative: negative || undefined,
          aspectRatio: ratio, resolution: effectiveResolution,
          quantity,
          productId: productId || undefined,
          newProduct: productId ? undefined : {
            name: session?.productName ?? np.name, sku: np.sku, category: np.category,
            description: np.description, extraInfo: np.extraInfo, sourceUrl: np.sourceUrl,
          },
          referencePaths: selected.map((r) => r.path),
          referenceImageIds: selected.map((r) => r.imageId).filter(Boolean),
          promptId: session?.promptId, promptSessionId: session?.sessionId,
        }),
      });
      const json = await res.json() as
        | { ok: true; images: ResultImage[]; productId: string; jobId: string }
        | { ok: false; error: string; missingCredits?: number };
      if (json.ok) {
        setResults(json.images);
        setJobId(json.jobId);
        setBalance((b) => Math.max(0, b - cost));
        if (!productId) setProductId(json.productId);
        toast.success(t("studio.done"));
        router.refresh();
      } else {
        toast.error(t(`studio.err.${json.error}`, {}) || t("common.error"));
      }
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  if (models.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="font-display text-lg font-semibold">{t("generator.noModelsTitle")}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">{t("generator.noModelsBody")}</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        {session && (
          <div className="glass anim-fade flex items-center gap-2 rounded-2xl px-4 py-3">
            <Sparkles size={14} className="shrink-0 text-accent" />
            <p className="text-xs text-muted">
              {t("studio.fromPrompts", { name: session.productName })}
            </p>
          </div>
        )}

        {/* PRODUCT / CONTEXT */}
        <Card>
          <CardHeader title={t("studio.context")} sub={t("studio.contextSub")} />
          <div className="space-y-3 p-5 pt-3">
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => { setProductId(""); setRefs([]); }}
                className={cn("rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                  !productId ? "brand-gradient text-white" : "border border-line text-muted hover:bg-raised")}>
                + {t("studio.newProduct")}
              </button>
              {products.map((p) => (
                <button key={p.id} type="button" onClick={() => pickProduct(p.id)}
                  className={cn("max-w-40 truncate rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                    productId === p.id ? "brand-gradient text-white" : "border border-line text-muted hover:bg-raised")}>
                  {p.name}
                </button>
              ))}
            </div>
            {productId && product ? (
              <p className="text-xs text-muted">
                {product.name}{product.category ? ` · ${product.category}` : ""} — {t("studio.usingSaved")}
              </p>
            ) : productId && session ? (
              <p className="text-xs text-muted">{session.productName} — {t("studio.usingSaved")}</p>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>{t("studio.title")} *</Label>
                    <Input value={np.name} placeholder={t("products.namePh")}
                      onChange={(e) => setNp({ ...np, name: e.target.value })} />
                  </div>
                  <div>
                    <Label>{t("common.category")}</Label>
                    <Input value={np.category} placeholder={t("products.categoryPh")}
                      onChange={(e) => setNp({ ...np, category: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>{t("studio.extraInfo")}</Label>
                  <Textarea rows={4} value={np.extraInfo} placeholder={t("studio.extraInfoPh")}
                    onChange={(e) => setNp({ ...np, extraInfo: e.target.value })} />
                </div>
                <button type="button" onClick={() => setMoreOpen(!moreOpen)}
                  className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
                  <ChevronDown size={13} className={cn("transition-transform", moreOpen && "rotate-180")} />
                  {t("studio.moreFields")}
                </button>
                {moreOpen && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label>SKU</Label>
                      <Input value={np.sku} onChange={(e) => setNp({ ...np, sku: e.target.value })} />
                    </div>
                    <div>
                      <Label>{t("common.description")}</Label>
                      <Input value={np.description} onChange={(e) => setNp({ ...np, description: e.target.value })} />
                    </div>
                    <div>
                      <Label>{t("studio.sourceUrl")}</Label>
                      <Input value={np.sourceUrl} placeholder="https://…"
                        onChange={(e) => setNp({ ...np, sourceUrl: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* REFERENCES */}
        <Card>
          <CardHeader title={t("studio.refs")} sub={model?.supportsReferenceImages ? t("studio.refsSub") : t("studio.refsUnsupported")} />
          <div className="p-5 pt-3">
            <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif"
              className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
            <div className="flex flex-wrap gap-2.5">
              {refs.map((r, i) => (
                <div key={r.key} className={cn("group relative h-24 w-24 overflow-hidden rounded-xl border-2 transition-colors",
                  r.selected ? "border-accent" : "border-line opacity-60")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="" className="h-full w-full cursor-pointer object-cover"
                    onClick={() => setRefs(refs.map((x, j) => j === i ? { ...x, selected: !x.selected } : x))} />
                  {i === 0 && r.selected && (
                    <span className="absolute left-1 top-1 rounded-full bg-black/60 p-1"><Star size={10} className="text-accent2" /></span>
                  )}
                  <button type="button" aria-label={t("common.delete")}
                    onClick={() => setRefs(refs.filter((_, j) => j !== i))}
                    className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-1 text-white group-hover:block">
                    <X size={10} />
                  </button>
                </div>
              ))}
              <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
                className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line text-muted transition-colors hover:border-accent/50 hover:text-ink"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}>
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                <span className="text-[10px] font-medium">{t("products.upload")}</span>
              </button>
            </div>
          </div>
        </Card>

        {/* PROMPT */}
        <Card>
          <CardHeader title="Prompt" sub={t("studio.promptSub")} />
          <div className="space-y-3 p-5 pt-3">
            <Textarea rows={session ? 8 : 4} value={prompt} placeholder={t("studio.promptPh")}
              onChange={(e) => setPrompt(e.target.value)} />
            {model?.supportsNegativePrompt !== false && (
              <>
                <button type="button" onClick={() => setNegOpen(!negOpen)}
                  className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
                  <ChevronDown size={13} className={cn("transition-transform", (negOpen || !!negative) && "rotate-180")} />
                  {t("studio.negative")}{negative ? " ✓" : ""}
                </button>
                {(negOpen || (!!negative && session)) && (
                  <Textarea rows={3} value={negative} placeholder={t("studio.negativePh")}
                    onChange={(e) => setNegative(e.target.value)} />
                )}
              </>
            )}
            <p className="text-xs text-faint">
              {t("studio.inspHint")} <Link href="/inspirations" className="text-accent hover:underline">{t("insp.title")}</Link>
              {" · "}<Link href="/prompts" prefetch className="text-accent hover:underline">{t("prompts.title")}</Link>
            </p>
          </div>
        </Card>

        {/* RESULTS */}
        {(busy || results.length > 0) && (
          <Card>
            <CardHeader title={t("studio.results")} />
            <div className="p-5 pt-3">
              {busy ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {Array.from({ length: quantity }, (_, i) => (
                    <div key={i} className="skeleton aspect-square rounded-xl" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {results.map((r) => (
                    <ResultTile key={r.path} r={r} jobId={jobId} onRegenerate={generate} />
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* RIGHT RAIL */}
      <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
        <Card>
          <CardHeader title="Model" />
          <div className="space-y-2 p-4 pt-2">
            {models.map((m) => {
              const minPrice = Math.min(...Object.values(m.pricing));
              const hasVariants = Object.keys(m.pricing).length > 1;
              return (
                <button key={m.id} type="button" onClick={() => { setModelId(m.id); setQuantity(1); }}
                  aria-pressed={m.id === modelId}
                  className={cn("w-full rounded-xl border p-3 text-left transition-all duration-150",
                    m.id === modelId ? "is-selected" : "border-line hover:-translate-y-0.5 hover:bg-raised")}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{m.displayName}</p>
                    <Badge tone="indigo">{hasVariants ? t("studio.fromCr", { n: minPrice }) : `${minPrice} ◆`}</Badge>
                  </div>
                  {(m.badge || m.supportsReferenceImages) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {m.badge === "recommended" && <Badge tone="green">{t("studio.badgeRecommended")}</Badge>}
                      {m.badge === "high_quality" && <Badge tone="amber">{t("studio.badgeHQ")}</Badge>}
                      {m.supportsReferenceImages && <span className="text-[11px] text-muted">{t("studio.refsBadge")}</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("studio.settings")} />
          <div className="space-y-4 p-4 pt-2">
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
            {(model?.resolutions.length ?? 0) > 1 && (
              <div>
                <Label>{t("studio.quality")}</Label>
                <div className="flex gap-1.5">
                  {model!.resolutions.map((r) => (
                    <button key={r} type="button" onClick={() => setResolution(r)}
                      aria-pressed={r === effectiveResolution}
                      className={cn("flex-1 rounded-lg border py-2 text-xs font-semibold transition-colors",
                        r === effectiveResolution ? "is-selected text-accent" : "border-line text-muted hover:bg-raised")}>
                      {r}
                      <span className="ml-1 text-[10px] opacity-70">{model!.pricing[r]}◆</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label>{t("studio.quantity")}</Label>
              <div className="flex gap-1.5">
                {Array.from({ length: model?.maxQuantity ?? 1 }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" onClick={() => setQuantity(n)}
                    aria-pressed={n === quantity}
                    className={cn("flex-1 rounded-lg border py-2 text-xs font-semibold transition-colors",
                      n === quantity ? "is-selected text-accent" : "border-line text-muted hover:bg-raised")}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-muted">{t("studio.yourCredits")}</span>
            <span className="font-display font-semibold text-accent">◆ {balance}</span>
          </div>
          <button type="button" disabled={!canGenerate} onClick={generate}
            className={cn("brand-gradient flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition-opacity",
              canGenerate ? "hover:opacity-90" : "cursor-not-allowed opacity-50")}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {t("studio.generate")} · {cost} ◆
          </button>
          {missing > 0 && (
            <p className="mt-2 text-center text-xs text-red-500">
              {t("studio.missing", { n: missing })}{" "}
              <Link href="/credits" className="font-semibold text-accent hover:underline">{t("credits.topup")}</Link>
            </p>
          )}
          {!contextReady && <p className="mt-2 text-center text-xs text-muted">{t("studio.needContext")}</p>}
        </Card>
      </div>
    </div>
  );
}

/** One generated image + FEEDBACK LOOP: accept, regenerate, "what was wrong". */
function ResultTile({ r, jobId, onRegenerate }: {
  r: ResultImage; jobId: string | null; onRegenerate: () => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "accepted" | "asking">("idle");
  const [issues, setIssues] = useState<string[]>([]);

  async function accept() {
    setState("accepted");
    if (jobId) void submitGenerationFeedbackAction({ jobId, assetPath: r.path, verdict: "accepted" });
    toast.success(t("studio.fbAccepted"));
  }

  async function regenerate() {
    if (jobId) void submitGenerationFeedbackAction({ jobId, assetPath: r.path, verdict: "regenerate", issues });
    setState("idle"); setIssues([]);
    onRegenerate();
  }

  return (
    <div className="group relative overflow-hidden rounded-xl border border-line">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={r.url} alt="" className="w-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-2">
        <div className="flex gap-1">
          <button type="button" onClick={accept} aria-label={t("studio.fbAccept")}
            className={cn("rounded-lg p-2 text-white transition-colors", state === "accepted" ? "bg-green-600" : "bg-black/50 hover:bg-black/70")}>
            <Check size={13} />
          </button>
          <button type="button" onClick={() => setState(state === "asking" ? "idle" : "asking")} aria-label={t("studio.fbRegen")}
            className="rounded-lg bg-black/50 p-2 text-white transition-colors hover:bg-black/70">
            <RefreshCw size={13} />
          </button>
        </div>
        <a href={r.url} download target="_blank" className="rounded-lg bg-black/50 p-2 text-white hover:bg-black/70">
          <Download size={13} />
        </a>
      </div>
      {state === "asking" && (
        <div className="absolute inset-0 flex flex-col justify-end gap-2 bg-black/80 p-3 anim-fade">
          <p className="text-xs font-semibold text-white">{t("studio.fbWhat")}</p>
          <div className="flex flex-wrap gap-1">
            {ISSUE_KEYS.map((k) => (
              <button key={k} type="button"
                onClick={() => setIssues(issues.includes(k) ? issues.filter((i) => i !== k) : [...issues, k])}
                className={cn("rounded-full px-2 py-1 text-[10px] font-medium transition-colors",
                  issues.includes(k) ? "bg-accent text-white" : "bg-white/10 text-white/80 hover:bg-white/20")}>
                {t(`studio.issue.${k}`)}
              </button>
            ))}
          </div>
          <button type="button" onClick={regenerate}
            className="brand-gradient rounded-lg px-3 py-2 text-xs font-semibold text-white">
            {t("studio.fbRegen")}
          </button>
        </div>
      )}
    </div>
  );
}
