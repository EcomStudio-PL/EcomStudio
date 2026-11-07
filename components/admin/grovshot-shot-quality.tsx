"use client";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { formatDate } from "@/lib/utils";
import type { CostRow, QualityData, QualityRow } from "@/lib/server/grovshot-shot/quality";
import type { ShotRunView } from "@/lib/server/grovshot-shot/admin";
import { RunView } from "@/components/admin/grovshot-shot-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";

/**
 * GROVBASE SHOT → Jakość: regeneration and report shares (by recipe, shot
 * kind, knowledge version — before/after a version is visible side by side),
 * the reports with their evidence, the economics, and every order step by
 * step. Read-only; computed from stored rows; an unknown cost says UNKNOWN.
 */

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const usd = (m: number | null) => (m === null ? "UNKNOWN" : `$${(m / 1_000_000).toFixed(4)}`);
const pre = "whitespace-pre-wrap break-words rounded-lg bg-raised p-2 text-[11px] leading-relaxed";

export function ShotQualityPanel({ data }: { data: QualityData }) {
  const { t, locale } = useI18n();
  const [reason, setReason] = useState("");
  const [recipe, setRecipe] = useState("");
  const [kb, setKb] = useState("");
  const [days, setDays] = useState(90);
  const [order, setOrder] = useState<ShotRunView | null>(null);
  const [loading, setLoading] = useState(false);
  const since = Date.now() - days * 86_400_000;
  const reports = useMemo(() => data.reports.filter((r) => (!reason || r.reason === reason) && (!recipe || r.recipe === recipe)
    && (!kb || `v${r.kbVersion ?? "?"}` === kb) && Date.parse(r.createdAt) >= since), [data.reports, reason, recipe, kb, since]);
  const grouped = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reports) m.set(r.reason, (m.get(r.reason) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [reports]);
  const runs = data.runs.filter((r) => Date.parse(r.createdAt) >= since && (!recipe || r.recipe === recipe) && (!kb || `v${r.kb ?? "?"}` === kb));
  const recipes = [...new Set(data.byRecipe.map((r) => r.key))];
  const kbs = [...new Set(data.byKb.map((r) => r.key))];

  async function open(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/grovshot-shot/test?run=${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; run?: ShotRunView };
      if (json.ok && json.run) setOrder(json.run);
    } finally { setLoading(false); }
  }

  const table = (title: string, rows: QualityRow[]) => (
    <div className="overflow-x-auto">
      <p className="mb-1 text-xs font-semibold">{title}</p>
      <table className="w-full text-left text-[11.5px]">
        <thead><tr className="text-muted"><th>{t("gss.q.key")}</th><th>{t("gss.q.orders")}</th><th>{t("gss.q.delivered")}</th><th>{t("gss.q.regens")}</th><th>{t("gss.q.regenShare")}</th><th>{t("gss.q.reports")}</th><th>{t("gss.q.reportShare")}</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.key} className="border-t border-border"><td>{r.key}</td><td>{r.orders}</td><td>{r.delivered}</td><td>{r.regens}</td><td>{pct(r.regenShare)}</td><td>{r.reports}</td><td>{pct(r.reportShare)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
  const costLine = (c: CostRow) => (
    <tr key={c.key} className="border-t border-border"><td>{c.key}</td><td>{c.orders}</td><td>{c.delivered}</td><td>{usd(c.perOrderMicros)}</td><td>{usd(c.perPhotoMicros)}</td><td>{usd(c.knownMicros)}</td><td>{c.unknownCalls}</td></tr>
  );

  return (
    <div className="space-y-6 text-xs" data-gss-quality>
      <div className="grid gap-3 sm:grid-cols-4">
        <div><Label htmlFor="gq-days">{t("gss.q.window")}</Label>
          <Select id="gq-days" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90].map((d) => <option key={d} value={d}>{t("gss.q.days", { n: d })}</option>)}
          </Select></div>
        <div><Label htmlFor="gq-kb">{t("gss.q.kb")}</Label>
          <Select id="gq-kb" value={kb} onChange={(e) => setKb(e.target.value)}><option value="">{t("gss.q.all")}</option>{kbs.map((k) => <option key={k} value={k}>{k}</option>)}</Select></div>
        <div><Label htmlFor="gq-recipe">{t("gss.q.recipe")}</Label>
          <Select id="gq-recipe" value={recipe} onChange={(e) => setRecipe(e.target.value)}><option value="">{t("gss.q.all")}</option>{recipes.map((k) => <option key={k} value={k}>{k}</option>)}</Select></div>
        <div><Label htmlFor="gq-reason">{t("gss.q.reason")}</Label>
          <Select id="gq-reason" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">{t("gss.q.all")}</option>
            {["product_changed", "wrong_scale", "hands_faces", "light_mood", "scene_mismatch", "other"].map((r) => <option key={r} value={r}>{t(`gss.reason.${r}`)}</option>)}
          </Select></div>
      </div>

      <section className="space-y-3" data-gss-quality-shares>
        <h3 className="text-sm font-semibold">{t("gss.q.sharesTitle")}</h3>
        <p className="text-muted">{t("gss.q.definition")}</p>
        <p>{t("gss.q.totals", { o: data.totals.orders, d: data.totals.delivered, r: data.totals.regens, rep: data.totals.reports })}</p>
        {table(t("gss.q.byRecipe"), data.byRecipe)}
        {table(t("gss.q.byKind"), data.byKind)}
        {table(t("gss.q.byKb"), data.byKb)}
      </section>

      <section className="space-y-3" data-gss-quality-reports>
        <h3 className="text-sm font-semibold">{t("gss.q.reportsTitle", { n: reports.length })}</h3>
        <div className="flex flex-wrap gap-2">{grouped.map(([r, n]) => <Badge key={r} tone="neutral">{t(`gss.reason.${r}`)}: {n}</Badge>)}</div>
        {reports.map((r) => (
          <details key={r.id} className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer">
              {formatDate(r.createdAt, locale)} · {t(`gss.reason.${r.reason}`)} · #{r.shot} · {r.recipe ?? "—"} · {r.kind ?? "—"} · v{r.kbVersion ?? "?"}{r.comment ? ` · „${r.comment}”` : ""}
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-[200px_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {r.imageUrl ? <img src={r.imageUrl} alt="" className="w-full rounded-lg" /> : <span className="text-muted">—</span>}
              <div className="space-y-2">
                <p className="font-semibold">{t("gss.q.prompt")}</p><p className={pre}>{r.prompt ?? "—"}</p>
                <details><summary className="cursor-pointer">{t("gss.q.planShot")}</summary><pre className={pre}>{JSON.stringify(r.planShot, null, 2)}</pre></details>
                <details><summary className="cursor-pointer">{t("gss.q.card")}</summary><pre className={pre}>{JSON.stringify(r.card, null, 2)}</pre></details>
                <p>{t("gss.q.versions", { n: r.versions.length })} {r.versions.map((v, i) => v.url ? <a key={v.generationId} href={v.url} target="_blank" rel="noreferrer" className="mr-2 underline">{i + 1}</a> : null)}</p>
                <Button size="sm" variant="ghost" onClick={() => void open(r.runId)}>{t("gss.q.openOrder")}</Button>
              </div>
            </div>
          </details>
        ))}
      </section>

      <section className="space-y-3" data-gss-quality-costs>
        <h3 className="text-sm font-semibold">{t("gss.q.costsTitle")}</h3>
        <p className="text-muted">{t("gss.q.costsDefinition", { calls: data.totals.imageCalls, retries: data.totals.retries, tech: data.totals.techErrors,
          perPhoto: data.totals.delivered ? (data.totals.imageCalls / data.totals.delivered).toFixed(2) : "—",
          techShare: data.totals.imageCalls ? pct(data.totals.techErrors / data.totals.imageCalls) : "—" })}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11.5px]">
            <thead><tr className="text-muted"><th>{t("gss.q.key")}</th><th>{t("gss.q.orders")}</th><th>{t("gss.q.delivered")}</th><th>{t("gss.q.perOrder")}</th><th>{t("gss.q.perPhoto")}</th><th>{t("gss.q.known")}</th><th>{t("gss.q.unknown")}</th></tr></thead>
            <tbody>{costLine(data.costs.overall)}{data.costs.byKb.map(costLine)}</tbody>
          </table>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11.5px]">
            <thead><tr className="text-muted"><th>{t("gss.q.model")}</th><th>{t("gss.q.calls")}</th><th>{t("gss.q.known")}</th><th>{t("gss.q.unknown")}</th></tr></thead>
            <tbody>{data.costs.byModel.map((m) => <tr key={m.model} className="border-t border-border"><td>{m.model}</td><td>{m.calls}</td><td>{usd(m.knownMicros)}</td><td>{m.unknownCalls}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2" data-gss-quality-orders>
        <h3 className="text-sm font-semibold">{t("gss.q.ordersTitle", { n: runs.length })}</h3>
        <ul className="space-y-1">{runs.map((r) => (
          <li key={r.id}>
            <button type="button" className="hover:underline" onClick={() => void open(r.id)}>
              {formatDate(r.createdAt, locale)} · {r.status} · v{r.kb ?? "?"} · {r.recipe ?? "—"} · {r.delivered}/{r.shots} · {usd(r.costMicros)}{r.unknown ? ` (${t("gss.q.unknownCalls", { n: r.unknown })})` : ""}
            </button>
          </li>
        ))}</ul>
        {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
        {order && <RunView run={order} t={t} locale={locale} />}
      </section>
    </div>
  );
}
