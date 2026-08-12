"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Download, ImagePlus, Loader2, Sparkles, Star, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StudioProduct = {
  id: string; name: string; description: string | null; category: string | null;
  extra_info: string | null;
  images: { id: string; url: string; path: string; isPrimary: boolean }[];
};

export type StudioModel = {
  id: string; name: string; provider_name: string; provider_slug: string;
  credit_cost: number; quality_tier: string; speed_tier: string;
  capabilities_ui: { resolutions: string[]; maxQuantity: number; supportsReferenceImages: boolean };
};

type Ref = { key: string; path: string; url: string; imageId?: string; selected: boolean };
type ResultImage = { url: string; path: string };

const RATIOS = ["1:1", "4:5", "16:9", "9:16"] as const;

/** Higgsfield-style generation workspace: product context (existing OR
 *  ad-hoc, no prior product required), references, prompt, model and
 *  settings — with a live credit cost on the Generate CTA. The server
 *  recomputes the final cost; this preview mirrors admin pricing. */
export function Studio({ products, models, credits, workspaceId, initialPrompt = "" }: {
  products: StudioProduct[]; models: StudioModel[]; credits: number;
  workspaceId: string; initialPrompt?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [productId, setProductId] = useState<string>("");
  const [np, setNp] = useState({ name: "", sku: "", category: "", description: "", extraInfo: "", sourceUrl: "" });
  const [moreOpen, setMoreOpen] = useState(false);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [negative, setNegative] = useState("");
  const [negOpen, setNegOpen] = useState(false);
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>("1:1");
  const [resolution, setResolution] = useState<string>("1K");
  const [quantity, setQuantity] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ResultImage[]>([]);
  const [balance, setBalance] = useState(credits);
  const fileRef = useRef<HTMLInputElement>(null);
  const adhocFolder = useRef(`adhoc-${Math.random().toString(36).slice(2, 10)}`);

  const model = useMemo(() => models.find((m) => m.id === modelId), [models, modelId]);
  const caps = model?.capabilities_ui;
  const cost = (model?.credit_cost ?? 0) * quantity;
  const missing = Math.max(0, cost - balance);
  const product = useMemo(() => products.find((p) => p.id === productId), [products, productId]);
  const contextReady = productId ? true : np.name.trim().length > 1;
  const canGenerate = !!model && contextReady && prompt.trim().length > 2 && missing === 0 && !busy && !uploading;

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
          aspectRatio: ratio, resolution: caps?.resolutions.length ? resolution : undefined,
          quantity,
          productId: productId || undefined,
          newProduct: productId ? undefined : {
            name: np.name, sku: np.sku, category: np.category, description: np.description,
            extraInfo: np.extraInfo, sourceUrl: np.sourceUrl,
          },
          referencePaths: selected.map((r) => r.path),
          referenceImageIds: selected.map((r) => r.imageId).filter(Boolean),
        }),
      });
      const json = await res.json() as
        | { ok: true; images: ResultImage[]; productId: string }
        | { ok: false; error: string; missingCredits?: number };
      if (json.ok) {
        setResults(json.images);
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
          <CardHeader title={t("studio.refs")} sub={caps?.supportsReferenceImages ? t("studio.refsSub") : t("studio.refsUnsupported")} />
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
            <Textarea rows={4} value={prompt} placeholder={t("studio.promptPh")}
              onChange={(e) => setPrompt(e.target.value)} />
            <button type="button" onClick={() => setNegOpen(!negOpen)}
              className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
              <ChevronDown size={13} className={cn("transition-transform", negOpen && "rotate-180")} />
              {t("studio.negative")}
            </button>
            {negOpen && (
              <Textarea rows={2} value={negative} placeholder={t("studio.negativePh")}
                onChange={(e) => setNegative(e.target.value)} />
            )}
            <p className="text-xs text-faint">
              {t("studio.inspHint")} <Link href="/inspirations" className="text-accent hover:underline">{t("insp.title")}</Link>
            </p>
          </div>
        </Card>

        {/* RESULTS */}
        {(busy || results.length > 0) && (
          <Card>
            <CardHeader title={t("studio.results")} />
            <div className="p-5 pt-3">
              {busy ? (
                <div className="flex flex-col items-center gap-3 py-10">
                  <Loader2 size={28} className="animate-spin text-accent" />
                  <p className="text-sm text-muted">{t("studio.generating")}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {results.map((r) => (
                    <div key={r.path} className="group relative overflow-hidden rounded-xl border border-line">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt="" className="w-full object-cover" />
                      <a href={r.url} download target="_blank"
                        className="absolute bottom-2 right-2 hidden rounded-lg bg-black/60 p-2 text-white group-hover:block">
                        <Download size={14} />
                      </a>
                    </div>
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
            {models.map((m) => (
              <button key={m.id} type="button" onClick={() => { setModelId(m.id); setQuantity(1); }}
                className={cn("w-full rounded-xl border p-3 text-left transition-colors",
                  m.id === modelId ? "border-accent bg-accent-soft" : "border-line hover:bg-raised")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{m.name}</p>
                  <Badge tone="indigo">{m.credit_cost} ◆</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {m.provider_name} · {m.quality_tier} · {m.speed_tier}
                  {m.capabilities_ui.supportsReferenceImages ? ` · ${t("studio.refsBadge")}` : ""}
                </p>
              </button>
            ))}
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
                    className={cn("flex-1 rounded-lg border py-2 text-xs font-semibold transition-colors",
                      r === ratio ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-raised")}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {(caps?.resolutions.length ?? 0) > 0 && (
              <div>
                <Label>{t("studio.quality")}</Label>
                <div className="flex gap-1.5">
                  {caps!.resolutions.map((r) => (
                    <button key={r} type="button" onClick={() => setResolution(r)}
                      className={cn("flex-1 rounded-lg border py-2 text-xs font-semibold transition-colors",
                        r === resolution ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-raised")}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label>{t("studio.quantity")}</Label>
              <div className="flex gap-1.5">
                {Array.from({ length: caps?.maxQuantity ?? 1 }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" onClick={() => setQuantity(n)}
                    className={cn("flex-1 rounded-lg border py-2 text-xs font-semibold transition-colors",
                      n === quantity ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-raised")}>
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
