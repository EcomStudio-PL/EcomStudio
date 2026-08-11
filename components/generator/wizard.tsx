"use client";
import { useMemo, useState } from "react";
import Image from "next/image";
import { useI18n } from "@/lib/i18n/provider";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea, Select, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MATERIAL_TYPES = [
  "product_hero","packshot","premium_lifestyle","product_in_use","closeup",
  "macro_detail","scale","technical","benefit","social_ad","marketplace_gallery",
] as const;
const RATIOS = ["1:1", "4:5", "16:9", "9:16"] as const;

type ProductOption = {
  id: string; name: string;
  images: { id: string; url: string; isPrimary: boolean }[];
};

export function GeneratorWizard({ products, modelCount }: {
  products: ProductOption[]; modelCount: number;
}) {
  const { t } = useI18n();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [material, setMaterial] = useState<(typeof MATERIAL_TYPES)[number]>("product_hero");
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>("1:1");

  const product = useMemo(() => products.find((p) => p.id === productId), [products, productId]);
  const aiUnavailable = modelCount === 0;

  function toggleRef(id: string) {
    setSelectedRefs((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <Card>
          <CardHeader title={`1 · ${t("generator.stepProduct")}`} />
          <div className="p-5">
            <Label htmlFor="gen-product">{t("generator.selectProduct")}</Label>
            <Select id="gen-product" value={productId}
              onChange={(e) => { setProductId(e.target.value); setSelectedRefs([]); }}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
        </Card>
        <Card>
          <CardHeader title={`2 · ${t("generator.stepRefs")}`} sub={t("generator.selectRefsHint")} />
          <div className="p-5">
            {product && product.images.length > 0 ? (
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {product.images.map((img) => {
                  const selected = selectedRefs.includes(img.id);
                  return (
                    <li key={img.id}>
                      <button type="button" onClick={() => toggleRef(img.id)}
                        className={cn(
                          "relative block aspect-square w-full overflow-hidden rounded-xl border-2 transition",
                          selected ? "frame-mark border-accent" : "border-line opacity-80 hover:opacity-100"
                        )}>
                        {img.url && <Image src={img.url} alt="" fill sizes="120px" className="object-cover" />}
                        {img.isPrimary && (
                          <span className="absolute left-1.5 top-1.5 rounded bg-accent px-1.5 text-[10px] font-semibold text-white dark:text-emerald-950">★</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("products.noImages")}</p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title={`3 · ${t("generator.stepMaterial")}`} />
          <div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-3">
            {MATERIAL_TYPES.map((m) => (
              <button key={m} type="button" onClick={() => setMaterial(m)}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition",
                  material === m ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-raised"
                )}>
                {t(`generator.mt.${m}`)}
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title={`4 · ${t("generator.stepFormat")}`} />
          <div className="flex flex-wrap gap-2 p-5">
            {RATIOS.map((r) => (
              <button key={r} type="button" onClick={() => setRatio(r)}
                className={cn(
                  "rounded-xl border px-4 py-2 text-sm font-semibold transition",
                  ratio === r ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-raised"
                )}>
                {r}
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title={`5 · ${t("generator.stepInstructions")}`} />
          <div className="p-5">
            <Textarea placeholder={t("generator.extraPh")} disabled={aiUnavailable} />
          </div>
        </Card>
      </div>
      <div className="lg:sticky lg:top-20 lg:h-fit">
        <Card className="p-5">
          {aiUnavailable ? (
            <div>
              <Badge tone="amber">{t("common.unavailable")}</Badge>
              <h3 className="mt-3 font-display text-base font-semibold">{t("generator.noModelsTitle")}</h3>
              <p className="mt-2 text-sm text-muted">{t("generator.noModelsBody")}</p>
              <Button className="mt-5 w-full" disabled>{t("generator.generate")}</Button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted">{t("generator.creditCost", { n: 3 })}</p>
              <Button className="mt-4 w-full" disabled={selectedRefs.length === 0}>
                {t("generator.generate")}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
