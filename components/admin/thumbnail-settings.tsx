"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { Badge } from "@/components/ui/badge";
import {
  approveThumbnailPromptAction, revokeThumbnailPromptApprovalAction, saveThumbnailSettingsAction,
} from "@/app/actions/thumbnail";
import {
  RANGES, THUMBNAIL_FORMATS, THUMBNAIL_KERNELS, THUMBNAIL_MODELS, THUMBNAIL_QUALITIES, THUMBNAIL_SIZES,
  innerPx, marginPx, type ThumbnailSettingsInput, type TokenPrices,
} from "@/lib/thumbnail/config";

const field = "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px] tabular-nums focus:border-accent focus:outline-none";

/**
 * MINIATURKA — the operator's settings: which Sunburst snapshot, the request
 * quality and size, the photo limit, the local finish and the provider token
 * rates. Validated here and again by the action (one bad field, nothing
 * saved). The price is NOT here: it lives in Admin → Usługi.
 */
export function ThumbnailSettingsForm({ initial }: { initial: ThumbnailSettingsInput }) {
  const { t } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<ThumbnailSettingsInput>(initial);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof ThumbnailSettingsInput>(k: K, value: ThumbnailSettingsInput[K]) => setV((p) => ({ ...p, [k]: value }));
  const setF = <K extends keyof ThumbnailSettingsInput["finish"]>(k: K, value: ThumbnailSettingsInput["finish"][K]) =>
    setV((p) => ({ ...p, finish: { ...p.finish, [k]: value } }));
  const setP = (k: keyof TokenPrices, raw: string) =>
    setV((p) => ({ ...p, tokenPrices: { ...p.tokenPrices, [k]: raw.trim() === "" ? null : Number(raw.replace(",", ".")) } }));
  const numIn = (raw: string) => Number(raw.replace(",", "."));

  function save() {
    startTransition(async () => {
      const res = await saveThumbnailSettingsAction(v);
      if (res.ok) { toast.success(t("aicc.thumb.saved")); router.refresh(); }
      else toast.error(res.field ? t("aicc.thumb.invalidField", { field: t(`aicc.thumb.field.${res.field.replace(/^tokenPrices\./, "price_")}`) }) : t(`aicc.thumb.err.${res.error ?? "generic"}`));
    });
  }

  const m = marginPx(v.finish.target, v.finish.marginPercent);
  return (
    <div className="space-y-5 text-[13px]" data-thumbnail-settings>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-[12px] font-semibold text-muted">{t("aicc.thumb.request")}</legend>
        <Label text={t("aicc.thumb.field.model")}>
          <select className={field} value={v.model} onChange={(e) => set("model", e.target.value as ThumbnailSettingsInput["model"])}>
            {THUMBNAIL_MODELS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Label>
        <Label text={t("aicc.thumb.field.quality")}>
          <select className={field} value={v.quality} onChange={(e) => set("quality", e.target.value as ThumbnailSettingsInput["quality"])}>
            {THUMBNAIL_QUALITIES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Label>
        <Label text={t("aicc.thumb.field.size")} hint={t("aicc.thumb.sizeHint")}>
          <select className={field} value={v.size} onChange={(e) => set("size", e.target.value as ThumbnailSettingsInput["size"])}>
            {THUMBNAIL_SIZES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Label>
        <Label text={t("aicc.thumb.field.maxPhotos")} hint={t("aicc.thumb.range", { min: RANGES.maxPhotos.min, max: RANGES.maxPhotos.max })}>
          <input className={field} type="number" min={RANGES.maxPhotos.min} max={RANGES.maxPhotos.max} step={1}
            value={v.maxPhotos} onChange={(e) => set("maxPhotos", numIn(e.target.value))} />
        </Label>
        <Label text={t("aicc.thumb.field.timeoutMs")} hint={t("aicc.thumb.rangeS", { min: RANGES.timeoutMs.min / 1000, max: RANGES.timeoutMs.max / 1000 })}>
          <input className={field} type="number" min={RANGES.timeoutMs.min / 1000} max={RANGES.timeoutMs.max / 1000} step={5}
            value={v.timeoutMs / 1000} onChange={(e) => set("timeoutMs", Math.round(numIn(e.target.value) * 1000))} />
        </Label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-[12px] font-semibold text-muted">{t("aicc.thumb.finish")}</legend>
        <Label text={t("aicc.thumb.field.target")} hint={t("aicc.thumb.range", { min: RANGES.target.min, max: RANGES.target.max })}>
          <input className={field} type="number" min={RANGES.target.min} max={RANGES.target.max} step={1}
            value={v.finish.target} onChange={(e) => setF("target", numIn(e.target.value))} />
        </Label>
        <Label text={t("aicc.thumb.field.marginPercent")} hint={t("aicc.thumb.marginHint", { px: m, inner: innerPx(v.finish.target, v.finish.marginPercent) })}>
          <input className={field} type="number" min={RANGES.marginPercent.min} max={RANGES.marginPercent.max} step={0.1}
            value={v.finish.marginPercent} onChange={(e) => setF("marginPercent", numIn(e.target.value))} />
        </Label>
        <Label text={t("aicc.thumb.field.brightnessPercent")} hint={t("aicc.thumb.range", { min: RANGES.brightnessPercent.min, max: RANGES.brightnessPercent.max })}>
          <input className={field} type="number" min={RANGES.brightnessPercent.min} max={RANGES.brightnessPercent.max} step={0.5}
            value={v.finish.brightnessPercent} onChange={(e) => setF("brightnessPercent", numIn(e.target.value))} />
        </Label>
        <Label text={t("aicc.thumb.field.kernel")}>
          <select className={field} value={v.finish.kernel} onChange={(e) => setF("kernel", e.target.value as ThumbnailSettingsInput["finish"]["kernel"])}>
            {THUMBNAIL_KERNELS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Label>
        <Label text={t("aicc.thumb.field.format")}>
          <select className={field} value={v.finish.format} onChange={(e) => setF("format", e.target.value as ThumbnailSettingsInput["finish"]["format"])}>
            {THUMBNAIL_FORMATS.map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
          </select>
        </Label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-[12px] font-semibold text-muted">{t("aicc.thumb.prices")}</legend>
        <p className="text-[11.5px] leading-relaxed text-faint sm:col-span-3">{t("aicc.thumb.pricesHint")}</p>
        {(["textInput", "cachedTextInput", "imageInput", "cachedImageInput", "imageOutput", "textOutput"] as (keyof TokenPrices)[]).map((k) => (
          <Label key={k} text={t(`aicc.thumb.field.price_${k}`)}>
            <input className={field} type="number" min={0} max={RANGES.tokenPrice.max} step={0.01}
              placeholder={t("aicc.thumb.unknown")}
              value={v.tokenPrices[k] ?? ""} onChange={(e) => setP(k, e.target.value)} />
          </Label>
        ))}
      </fieldset>

      <button type="button" onClick={save} disabled={pending} data-thumbnail-save
        className="cta flex h-9 items-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold disabled:opacity-60">
        {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}{t("common.save")}
      </button>
    </div>
  );
}

function Label({ text, hint, children }: { text: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] font-medium text-muted">{text}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

/**
 * THE PROMPT THIS TOOL RUNS ON: the version published now, its SHA-256 next
 * to the release reference, and whether it may run. A text that is not the
 * reference runs only after an operator approves exactly this version.
 */
export function ThumbnailPromptApproval({ published, referenceSha256, approval }: {
  published: { version: number | null; sha256: string; approved: boolean; approvedBy: "reference" | "operator" | null } | null;
  referenceSha256: string;
  approval: { version: number | null; approvedAt: string } | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => startTransition(async () => {
    const res = await fn();
    if (res.ok) { toast.success(t("aicc.thumb.saved")); router.refresh(); }
    else toast.error(t(`aicc.thumb.err.${res.error ?? "generic"}`));
  });
  return (
    <div className="space-y-3 text-[13px]" data-thumbnail-prompt>
      <dl className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <dt className="text-muted">{t("aicc.thumb.promptVersion")}</dt>
          <dd className="font-medium">{published ? `v${published.version ?? "—"}` : t("aicc.thumb.promptNone")}</dd>
        </div>
        {published && (
          <div className="flex flex-col gap-1">
            <dt className="text-muted">{t("aicc.thumb.promptSha")}</dt>
            <dd><code className="break-all font-mono text-[11.5px]" data-prompt-sha>{published.sha256}</code></dd>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <dt className="text-muted">{t("aicc.thumb.referenceSha")}</dt>
          <dd><code className="break-all font-mono text-[11.5px]">{referenceSha256}</code></dd>
        </div>
      </dl>
      {published && (
        <p className="flex flex-wrap items-center gap-2">
          {published.approved ? (
            <Badge tone="success" dot>
              {published.approvedBy === "reference" ? t("aicc.thumb.matchesReference") : t("aicc.thumb.approvedByOperator", { v: approval?.version ?? "—" })}
            </Badge>
          ) : (
            <Badge tone="warning" dot>{t("aicc.thumb.notApproved")}</Badge>
          )}
        </p>
      )}
      <p className="text-[11.5px] leading-relaxed text-faint">{t("aicc.thumb.approvalNote")}</p>
      <div className="flex flex-wrap gap-2">
        {published && !published.approved && (
          <button type="button" disabled={pending} onClick={() => act(() => approveThumbnailPromptAction({ version: published.version, sha256: published.sha256 }))} data-thumbnail-approve
            className="cta flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold disabled:opacity-60">
            <ShieldCheck size={13} aria-hidden />{t("aicc.thumb.approve", { v: published.version ?? "—" })}
          </button>
        )}
        {approval && (
          <button type="button" disabled={pending} onClick={() => act(revokeThumbnailPromptApprovalAction)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] font-semibold text-muted hover:bg-raised disabled:opacity-60">
            <CheckCircle2 size={13} aria-hidden />{t("aicc.thumb.revoke")}
          </button>
        )}
      </div>
    </div>
  );
}
