"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Textarea, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PromptProductOption = {
  id: string; name: string;
  images: { path: string; url: string }[];
};

type Ref = { key: string; path: string; url: string };

const RATIOS = ["1:1", "4:5", "16:9", "9:16"] as const;

/** "+ Nowe prompty": product name + marketplace description + photos →
 *  GENERUJ 5 PROMPTÓW. No prior product required; picking an existing
 *  product prefills everything and avoids duplicates. */
export function SessionForm({ products, workspaceId, engineAvailable }: {
  products: PromptProductOption[]; workspaceId: string; engineAvailable: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [extraInfo, setExtraInfo] = useState("");
  const [style, setStyle] = useState("");
  const [styleOpen, setStyleOpen] = useState(false);
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>("1:1");
  const [refs, setRefs] = useState<Ref[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"analyzing" | "lock" | "prompts">("analyzing");
  const [failure, setFailure] = useState<string | null>(null);
  const submitting = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const adhocFolder = useRef(`adhoc-${Math.random().toString(36).slice(2, 10)}`);

  const canSubmit = engineAvailable && name.trim().length > 1 && refs.length > 0 && !busy && !uploading;

  function pickProduct(id: string) {
    if (id === productId) return;
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (p) {
      setName(p.name);
      setRefs(p.images.map((img) => ({ key: img.path, path: img.path, url: img.url })));
    } else {
      setName(""); setRefs([]);
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

  async function submit() {
    // Guard the request itself, not just the disabled attribute: a double tap
    // on mobile must never start two analyses (or two draft products).
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setFailure(null);
    setBusy(true);
    setStage("analyzing");
    // The server runs analysis -> Product Lock -> 5 prompts in one request;
    // these timings mirror the real stage durations so the label stays honest.
    const toLock = setTimeout(() => setStage("lock"), 12_000);
    const toPrompts = setTimeout(() => setStage("prompts"), 22_000);
    try {
      const res = await fetch("/api/prompts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: productId || undefined,
          productName: name, description: description || undefined,
          extraInfo: extraInfo || undefined, style: style || undefined,
          aspectRatio: ratio,
          referencePaths: refs.map((r) => r.path).slice(0, 8),
        }),
      });
      const json = await res.json() as { ok: boolean; sessionId?: string; error?: string };
      if (json.ok && json.sessionId) {
        router.push(`/prompts/${json.sessionId}`);
        return; // keep the button busy until the new route paints
      }
      const message = t(`studio.err.${json.error}`, {}) || t("common.error");
      setFailure(message);
      toast.error(message);
      setBusy(false);
    } catch {
      setFailure(t("common.error"));
      toast.error(t("common.error"));
      setBusy(false);
    } finally {
      clearTimeout(toLock);
      clearTimeout(toPrompts);
      submitting.current = false;
    }
  }

  return (
    <Card className="anim-pop">
      <CardHeader title={t("psess.newTitle")} sub={t("psess.newSub")} />
      <div className="space-y-4 p-5 pt-3">
        {products.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => pickProduct("")}
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
        )}

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

        <div>
          <Label>{t("psess.photos")} *</Label>
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif"
            className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
          <div className="flex flex-wrap gap-2.5">
            {refs.map((r, i) => (
              <div key={r.key} className="group relative h-20 w-20 overflow-hidden rounded-xl border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt="" className="h-full w-full object-cover" />
                <span className="absolute left-1 top-1 rounded-md bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
                <button type="button" aria-label={t("common.delete")}
                  onClick={() => setRefs(refs.filter((_, j) => j !== i))}
                  className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-1 text-white group-hover:block">
                  <X size={10} />
                </button>
              </div>
            ))}
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line text-muted transition-colors hover:border-accent/50 hover:text-ink"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}>
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
              <span className="text-[10px] font-medium">{t("products.upload")}</span>
            </button>
          </div>
        </div>

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

        <button type="button" onClick={() => setStyleOpen(!styleOpen)}
          className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
          <ChevronDown size={13} className={cn("transition-transform", styleOpen && "rotate-180")} />
          {t("psess.styleToggle")}
        </button>
        {styleOpen && (
          <Input value={style} placeholder={t("psess.stylePh")} onChange={(e) => setStyle(e.target.value)} />
        )}

        {!engineAvailable && (
          <p className="rounded-xl bg-raised px-4 py-3 text-xs text-muted">{t("psess.unavailable")}</p>
        )}

        <button type="button" disabled={!canSubmit} onClick={submit}
          className={cn("brand-gradient flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition-opacity",
            canSubmit ? "hover:opacity-90" : "cursor-not-allowed opacity-50")}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {busy ? t(`psess.stage_${stage}`) : t("psess.generate5")}
        </button>
        {busy && (
          <div className="space-y-2 rounded-xl bg-raised px-4 py-3 anim-fade">
            {(["analyzing", "lock", "prompts"] as const).map((s, i) => {
              const idx = ["analyzing", "lock", "prompts"].indexOf(stage);
              const done = i < idx;
              return (
                <p key={s} className={cn("flex items-center gap-2 text-xs",
                  i === idx ? "font-medium text-ink" : done ? "text-muted" : "text-faint")}>
                  <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full",
                    i === idx ? "bg-accent" : done ? "bg-accent/40" : "bg-line-strong")} />
                  {t(`psess.stage_${s}`)}
                </p>
              );
            })}
            <p className="text-xs text-faint">{t("psess.stepHint")}</p>
          </div>
        )}
        {failure && !busy && (
          <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-xs text-red-500 anim-fade">
            {failure} <span className="text-muted">{t("psess.retryHint")}</span>
          </p>
        )}
      </div>
    </Card>
  );
}
