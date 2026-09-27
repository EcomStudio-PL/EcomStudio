"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { deleteUnitPriceAction, saveUnitPriceAction } from "@/app/actions/ai-economics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { UnitPriceModel, UnitPriceRow } from "@/lib/services/token-prices";

/**
 * PER-UNIT PRICES — what one image (at a size and quality), one second of
 * video, one request or one page costs GrovBase at the provider. Cost
 * ESTIMATES only; a customer's charge never depends on them. A model with no
 * row keeps its flat per-image cost (when one is set on the model) or stays
 * UNKNOWN — never a confident 0.00.
 */
export function UnitPriceEditor({ rows, models }: { rows: UnitPriceRow[]; models: UnitPriceModel[] }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3" data-unit-prices>
      <ul className="flex flex-wrap gap-1.5">
        {models.map((m) => (
          <li key={`${m.providerSlug}:${m.model}`}>
            <Badge tone={m.priced ? "success" : m.flatUsdPerImage !== null ? "neutral" : "warning"}>
              {m.providerSlug} · {m.model} · {m.priced
                ? t("aicc.units.priced")
                : m.flatUsdPerImage !== null ? t("aicc.units.flat", { usd: m.flatUsdPerImage.toFixed(4) }) : t("aicc.units.unknown")}
            </Badge>
          </li>
        ))}
      </ul>
      {rows.map((r) => <UnitRow key={`${r.providerSlug}:${r.model}:${r.unitKind}:${r.resolution}:${r.quality}`} row={r} />)}
      <NewUnitRow models={models} />
    </div>
  );
}

function UnitRow({ row }: { row: UnitPriceRow }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [usd, setUsd] = useState(row.usdPerUnit.toString());
  const parsed = Number(usd.replace(",", "."));
  return (
    <div className="grid grid-cols-1 items-center gap-2 rounded-xl bg-raised p-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto]" data-unit-row>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.model}</p>
        <p className="text-xs text-faint">
          {row.providerSlug} · {t(`aicc.units.kind.${row.unitKind}`)} · {row.resolution === "*" ? t("aicc.units.anySize") : row.resolution} · {row.quality === "*" ? t("aicc.units.anyQuality") : row.quality}
        </p>
      </div>
      <Input inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} aria-label={t("aicc.units.usdPerUnit")} />
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !Number.isFinite(parsed) || usd.trim() === ""}
          onClick={() => start(async () => {
            const res = await saveUnitPriceAction({ ...row, usdPerUnit: parsed });
            if (res.ok) { toast.success(t("common.save")); router.refresh(); } else toast.error(t("common.error"));
          })}>{t("common.save")}</Button>
        <Button size="sm" variant="ghost" disabled={pending}
          onClick={() => start(async () => {
            const res = await deleteUnitPriceAction(row);
            if (res.ok) { toast.success(t("common.save")); router.refresh(); } else toast.error(t("common.error"));
          })}>{t("common.delete")}</Button>
      </div>
    </div>
  );
}

function NewUnitRow({ models }: { models: UnitPriceModel[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState(models[0] ? `${models[0].providerSlug}|${models[0].model}` : "");
  const [unitKind, setUnitKind] = useState("image");
  const [resolution, setResolution] = useState("*");
  const [quality, setQuality] = useState("*");
  const [usd, setUsd] = useState("");
  const parsed = Number(usd.replace(",", "."));
  const [providerSlug, model] = target.split("|");
  const select = "h-10 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-base sm:text-sm";
  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border border-dashed border-border p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))_minmax(0,0.8fr)_auto]" data-unit-new>
      <select className={select} value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t("aicc.prices.model")}>
        {models.map((m) => <option key={`${m.providerSlug}|${m.model}`} value={`${m.providerSlug}|${m.model}`}>{m.providerSlug} · {m.model}</option>)}
      </select>
      <select className={select} value={unitKind} onChange={(e) => setUnitKind(e.target.value)} aria-label={t("aicc.units.unit")}>
        {["image", "second", "request", "page"].map((k) => <option key={k} value={k}>{t(`aicc.units.kind.${k}`)}</option>)}
      </select>
      <Input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="* / 1K / 1024x1024" aria-label={t("aicc.units.resolution")} />
      <Input value={quality} onChange={(e) => setQuality(e.target.value)} placeholder="* / high" aria-label={t("aicc.units.quality")} />
      <Input inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="0.00" aria-label={t("aicc.units.usdPerUnit")} />
      <Button size="sm" disabled={pending || !target || usd.trim() === "" || !Number.isFinite(parsed)}
        onClick={() => start(async () => {
          const res = await saveUnitPriceAction({ providerSlug, model, unitKind, resolution, quality, usdPerUnit: parsed });
          if (res.ok) { toast.success(t("common.save")); setUsd(""); router.refresh(); } else toast.error(t("common.error"));
        })}>{t("aicc.units.add")}</Button>
    </div>
  );
}
