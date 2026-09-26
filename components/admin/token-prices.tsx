"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { deleteTokenPriceAction, saveTokenPriceAction } from "@/app/actions/ai-economics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { TokenPriceRow } from "@/lib/services/token-prices";

/**
 * The token price list the cost ESTIMATES are built from. Empty until the
 * operator types the provider's published prices in — a model without a price
 * keeps its calls' cost "unknown" rather than a guessed zero.
 */
export function TokenPriceEditor({ rows }: { rows: TokenPriceRow[] }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2" data-token-prices>
      <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint md:grid">
        <span>{t("aicc.prices.model")}</span>
        <span>{t("aicc.prices.input")}</span>
        <span>{t("aicc.prices.output")}</span>
        <span />
      </div>
      {rows.map((r) => <PriceRow key={`${r.providerSlug}:${r.model}`} row={r} />)}
    </div>
  );
}

function PriceRow({ row }: { row: TokenPriceRow }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [input, setInput] = useState(row.inputUsdPerM?.toString() ?? "");
  const [output, setOutput] = useState(row.outputUsdPerM?.toString() ?? "");
  const parse = (v: string) => Number(v.replace(",", "."));
  const valid = input.trim() !== "" && output.trim() !== "" && Number.isFinite(parse(input)) && Number.isFinite(parse(output));

  return (
    <div className="grid grid-cols-1 items-center gap-2 rounded-xl bg-raised p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.model}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
          <span>{row.providerSlug}</span>
          {row.inputUsdPerM === null
            ? <Badge tone="warning">{t("aicc.prices.missing")}</Badge>
            : <Badge tone="success">{t("aicc.prices.set")}</Badge>}
          {row.unpricedCalls > 0 && <span>{t("aicc.prices.unpriced", { n: row.unpricedCalls })}</span>}
        </p>
      </div>
      <label className="min-w-0 text-xs text-muted">
        <span className="md:sr-only">{t("aicc.prices.input")}</span>
        <Input inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0.00" aria-label={t("aicc.prices.input")} />
      </label>
      <label className="min-w-0 text-xs text-muted">
        <span className="md:sr-only">{t("aicc.prices.output")}</span>
        <Input inputMode="decimal" value={output} onChange={(e) => setOutput(e.target.value)} placeholder="0.00" aria-label={t("aicc.prices.output")} />
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !valid}
          onClick={() => start(async () => {
            const res = await saveTokenPriceAction({
              providerSlug: row.providerSlug, model: row.model, inputUsdPerM: parse(input), outputUsdPerM: parse(output),
            });
            if (res.ok) { toast.success(t("common.save")); router.refresh(); } else toast.error(t("common.error"));
          })}>
          {t("common.save")}
        </Button>
        {row.inputUsdPerM !== null && (
          <Button size="sm" variant="ghost" disabled={pending}
            onClick={() => start(async () => {
              const res = await deleteTokenPriceAction({ providerSlug: row.providerSlug, model: row.model });
              if (res.ok) { toast.success(t("common.save")); router.refresh(); } else toast.error(t("common.error"));
            })}>
            {t("common.delete")}
          </Button>
        )}
      </div>
    </div>
  );
}
