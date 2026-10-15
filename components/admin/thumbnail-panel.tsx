import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { ThumbnailAdmin } from "@/lib/server/thumbnail/admin";
import type { DiagImage, ThumbnailDiagnostics } from "@/lib/server/thumbnail/diagnostics";
import { THUMBNAIL_SERVICE, innerPx, marginPx } from "@/lib/thumbnail/config";

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * MINIATURKA ON ITS ADMIN PAGE — read-only cards. Settings and the prompt
 * approval are the client forms beside them (thumbnail-settings.tsx); the
 * price is edited in Admin → Usługi (`tool_thumbnail`), by a person.
 */

/** What still blocks a customer run, item by item. */
export function ThumbnailReadiness({ data, t }: { data: ThumbnailAdmin; t: T }) {
  const s = data.state;
  const items: { key: string; ok: boolean; label: string; detail?: string; href?: string }[] = [
    { key: "prompt", ok: Boolean(s.prompt?.approved), label: t("aicc.thumb.check.prompt"),
      detail: s.prompt ? `v${s.prompt.version ?? "—"} · ${s.prompt.approved ? t("aicc.thumb.approved") : t("aicc.thumb.notApproved")}` : t("aicc.thumb.promptNone"),
      href: "/admin/ai/ecommerce_thumbnail?tab=engine" },
    { key: "price", ok: Boolean(data.service && data.service.credits > 0 && data.service.enabled && !data.service.maintenance),
      label: t("aicc.thumb.check.price"),
      detail: data.service ? `${data.service.credits} kr. · ${data.service.enabled ? t("aicc.thumb.enabled") : t("aicc.thumb.disabled")}` : "—",
      href: "/admin/services" },
    { key: "openai", ok: !s.blockers.includes("provider_inactive") && !s.blockers.includes("no_key"),
      label: t("aicc.thumb.check.openai"),
      detail: s.blockers.includes("provider_inactive") ? t("thumb.blocker.provider_inactive") : s.blockers.includes("no_key") ? t("thumb.blocker.no_key") : t("aicc.thumb.keyStored"),
      href: "/admin/providers" },
    { key: "config", ok: Boolean(s.config), label: t("aicc.thumb.check.config"),
      detail: s.config ? `${s.config.model} · ${s.config.size} · ${s.config.quality}` : t("thumb.blocker.config_unreadable") },
    { key: "retouch", ok: s.retouch.available, label: t("aicc.thumb.check.retouch"),
      detail: s.retouch.available ? t("aicc.thumb.retouchUnit", { n: s.retouch.unit }) : t(`aicc.thumb.retouchOff.${s.retouch.reason}`) },
  ];
  return (
    <div className="space-y-3" data-thumbnail-readiness={s.ready ? "ready" : "blocked"}>
      <Badge tone={s.ready ? "success" : "warning"} dot>{s.ready ? t("aicc.thumb.ready") : t("aicc.thumb.notReady")}</Badge>
      <ul className="divide-y divide-line rounded-xl bg-raised text-[13px]">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-2.5 px-3.5 py-2.5" data-check={i.key} data-ok={i.ok ? "1" : "0"}>
            {i.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
              : <XCircle size={15} className={i.key === "retouch" ? "mt-0.5 shrink-0 text-faint" : "mt-0.5 shrink-0 text-warning"} aria-hidden />}
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{i.label}</span>
              {i.detail && <span className="block break-words text-xs text-muted">{i.detail}</span>}
            </span>
            {i.href && !i.ok && <Link href={i.href} className="shrink-0 text-xs font-semibold text-accent hover:opacity-75">{t("aicc.thumb.fix")}</Link>}
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] text-faint">{t("aicc.thumb.retouchOptional")}</p>
    </div>
  );
}

/** The request as it is sent — no secrets, nothing guessed. */
export function ThumbnailPathCard({ data, t }: { data: ThumbnailAdmin; t: T }) {
  const c = data.state.config;
  const f = c?.finish;
  return (
    <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2" data-thumbnail-path>
      <Fact label={t("aicc.thumb.provider")} value="OpenAI · Images API" />
      <Fact label={t("aicc.thumb.endpoint")} value={<code className="font-mono text-[11.5px]">POST /v1/images/edits</code>} />
      <Fact label={t("aicc.thumb.field.model")} value={<code className="font-mono text-[11.5px]">{c?.model ?? "—"}</code>} />
      <Fact label={t("aicc.thumb.params")} value={<code className="break-all font-mono text-[11.5px]">{c ? `n=1 · size=${c.size} · quality=${c.quality} · background=opaque · output_format=png` : "—"}</code>} />
      <Fact label={t("aicc.thumb.fallback")} value={t("aicc.thumb.noFallback")} />
      <Fact label={t("aicc.thumb.inputs")} value={t("aicc.thumb.inputsValue", { n: c?.maxPhotos ?? "—" })} />
      <Fact label={t("aicc.thumb.finish")} value={f ? t("aicc.thumb.finishValue", {
        target: f.target, margin: marginPx(f.target, f.marginPercent), inner: innerPx(f.target, f.marginPercent),
        b: f.brightnessPercent, k: f.kernel, fmt: f.format.toUpperCase(),
      }) : "—"} />
      <Fact label={t("aicc.thumb.promptPolicy")} value={t("aicc.thumb.promptPolicyValue")} />
    </dl>
  );
}

/** One run, in money: provider cost (measured/estimated), price, margin. */
export function ThumbnailEconomics({ data, t, locale }: { data: ThumbnailAdmin; t: T; locale: string }) {
  const usd = (micros: number | null) => (micros === null ? t("aicc.thumb.unknown") : `$${(micros / 1_000_000).toFixed(4)}`);
  const pln = (v: number | null) => (v === null ? t("aicc.thumb.unknown")
    : new Intl.NumberFormat(locale, { style: "currency", currency: "PLN", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v));
  const e = data.economics.thumbnail;
  const retouchUnit = data.state.retouch.available ? data.state.retouch.unit : null;
  return (
    <div className="space-y-4 text-[13px]" data-thumbnail-economics>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Fact label={t("aicc.thumb.price")} value={data.service && data.service.credits > 0 ? `${data.service.credits} kr.` : t("aicc.thumb.priceUnset")}
          hint={<Link href="/admin/services" className="font-semibold text-accent hover:opacity-75">{t("aicc.thumb.priceWhere", { slug: THUMBNAIL_SERVICE })}</Link>} />
        <Fact label={t("aicc.thumb.retouchPrice")} value={retouchUnit !== null ? t("aicc.thumb.retouchUnit", { n: retouchUnit }) : "—"} />
        <Fact label={t("aicc.thumb.localCost")} value={t("aicc.thumb.localCostValue")} />
        <Fact label={t("aicc.thumb.measured")} value={usd(data.measured.avgUsdMicros)}
          hint={t("aicc.thumb.measuredHint", { n: data.measured.samples })} />
        {data.estimates.map((x) => (
          <Fact key={x.photos} label={t("aicc.thumb.estimate", { n: x.photos })} value={usd(x.usdMicros)} />
        ))}
      </dl>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[420px] text-[12.5px]">
          <thead className="bg-raised text-left text-xs text-muted">
            <tr><th className="px-3 py-2 font-medium">{t("aicc.thumb.econ.item")}</th><th className="px-3 py-2 text-right font-medium">{t("aicc.thumb.econ.value")}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr><td className="px-3 py-2">{t("aicc.thumb.econ.revenue")}</td><td className="px-3 py-2 text-right tabular-nums">{e ? pln(e.revenuePln) : "—"}</td></tr>
            <tr><td className="px-3 py-2">{t("aicc.thumb.econ.cost")}</td><td className="px-3 py-2 text-right tabular-nums">{e ? pln(e.costPln) : "—"}</td></tr>
            <tr><td className="px-3 py-2">{t("aicc.thumb.econ.margin")}</td><td className="px-3 py-2 text-right tabular-nums">
              {e && e.marginPln !== null ? `${pln(e.marginPln)} · ${e.marginPercent !== null ? `${e.marginPercent.toFixed(1)}%` : "—"}` : t("aicc.thumb.unknown")}
            </td></tr>
            <tr><td className="px-3 py-2">{t("aicc.thumb.econ.suggested", { m: data.billing.minMarginPercent, b: data.billing.bufferPercent })}</td>
              <td className="px-3 py-2 text-right tabular-nums">{data.economics.suggestedMin !== null ? `${data.economics.suggestedMin} kr.` : t("aicc.thumb.unknown")}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] leading-relaxed text-faint">
        {t("aicc.thumb.econNote", { fx: data.billing.usdToPln.toFixed(2), pln: (data.billing.plnPerCredit).toFixed(2) })}
      </p>
    </div>
  );
}

/** The last runs: what happened, what it used, what it cost. */
export function ThumbnailRuns({ data, t, locale }: { data: ThumbnailAdmin; t: T; locale: string }) {
  if (data.runs.length === 0) return <p className="px-1 py-6 text-center text-sm text-muted">{t("aicc.thumb.noRuns")}</p>;
  return (
    <div className="space-y-3" data-thumbnail-runs>
      <p className="text-xs text-muted">
        {t("aicc.thumb.stats", { runs: data.stats.runs, ok: data.stats.ok, failed: data.stats.failed })}
      </p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {data.runs.map((r) => (
          <li key={r.id} className="space-y-1 px-3.5 py-2.5 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={r.status === "ok" ? "success" : r.status === "failed" ? "danger" : "accent"}>{t(`aicc.runs.status.${r.status}`)}</Badge>
              <Badge tone="neutral">{t("aicc.thumb.runPhotos", { n: r.photos })}</Badge>
              {r.retouch && <Badge tone="info">{t("aicc.thumb.runRetouch")}</Badge>}
              {r.model && <Badge tone="neutral">{r.model}</Badge>}
              <span className="ml-auto text-xs text-faint">{formatDate(r.createdAt, locale)}</span>
              <Link href={`/admin/ai/ecommerce_thumbnail?tab=models&diag=${r.id}#diagnostics`} data-thumbnail-diag-link
                className="text-xs font-semibold text-accent hover:opacity-75">{t("aicc.thumb.diag.open")}</Link>
            </div>
            <p className="break-words text-xs text-muted">
              {[
                r.quality && r.size ? `${r.size} · ${r.quality}` : null,
                r.responseSize ? `${t("aicc.thumb.responseSize")} ${r.responseSize}` : null,
                r.inputTokens !== null ? t("aicc.thumb.tokens", { i: r.inputTokens, img: r.imageTokens ?? "—", txt: r.textTokens ?? "—", o: r.outputTokens ?? "—" }) : null,
                r.costUsdMicros !== null ? `$${(r.costUsdMicros / 1_000_000).toFixed(4)}` : r.inputTokens !== null ? t("aicc.thumb.costUnknown") : null,
                r.credits !== null ? `${r.credits} kr.` : null,
                r.delivered ? `${r.delivered.width}×${r.delivered.height}` : null,
                r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)} s` : null,
                r.retouchFailed ? t("aicc.thumb.retouchFailedN", { n: r.retouchFailed }) : null,
                r.error ? `${t("aicc.runs.error")} ${r.error}` : null,
              ].filter(Boolean).join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
      {hint && <dd className="text-[11px] text-faint">{hint}</dd>}
    </div>
  );
}

/**
 * ONE RUN, STAGE BY STAGE (admin only): the real images in and out of every
 * stage and the real requests — to see WHERE a product changed. Hashes,
 * versions and ids only; never a key or prompt text.
 */
export function ThumbnailDiagnosticsCard({ d, t, locale }: { d: ThumbnailDiagnostics; t: T; locale: string }) {
  const yes = (v: boolean | null) => (v === null ? "—" : v ? t("aicc.thumb.diag.yes") : t("aicc.thumb.diag.no"));
  const short = (v: string | null) => (v ? `${v.slice(0, 12)}…` : "—");
  return (
    <div className="space-y-5 text-[12.5px]" data-thumbnail-diagnostics={d.id}>
      <p className="flex flex-wrap items-center gap-1.5">
        <Badge tone={d.status === "ok" ? "success" : d.status === "failed" ? "danger" : "accent"}>{t(`aicc.runs.status.${d.status}`)}</Badge>
        {d.retouch && <Badge tone="info">{t("aicc.thumb.runRetouch")}</Badge>}
        <span className="text-xs text-faint">{formatDate(d.createdAt, locale)}</span>
        {d.error && <span className="text-xs text-danger">{t("aicc.runs.error")} {d.error}</span>}
        <span className="ml-auto font-mono text-[11px] text-faint">{d.id}</span>
      </p>
      {d.incomplete && <p className="text-xs text-danger" data-thumbnail-diag-incomplete>{t("aicc.thumb.diag.incomplete")}</p>}

      <DiagSection title={t("aicc.thumb.diag.inputs")}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {d.photos.map((p, i) => <DiagThumb key={p.path} img={p} label={`#${i + 1}`} />)}
        </div>
      </DiagSection>

      {d.retouch && (
        <DiagSection title={t("aicc.thumb.diag.retouch")}>
          <ul className="space-y-3">
            {d.retouchStages.map((r) => (
              <li key={r.index} className="rounded-xl border border-line p-3">
                <p className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-semibold">#{r.index + 1}</span>
                  <Badge tone={r.status === "succeeded" ? "success" : r.status === "failed" ? "danger" : "neutral"}>{r.status}</Badge>
                  {r.reused && <Badge tone="neutral">{t("aicc.thumb.diag.reused")}</Badge>}
                  {r.recovered && <Badge tone="neutral">{t("aicc.thumb.diag.recovered")}</Badge>}
                  {r.error && <span className="text-danger">{r.error}</span>}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:max-w-md">
                  <DiagThumb img={r.original} label={t("aicc.thumb.diag.original")} />
                  {r.output ? <DiagThumb img={r.output} label={t("aicc.thumb.diag.retouched")} /> : <span className="text-xs text-faint">—</span>}
                </div>
                {r.request ? (
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-2">
                    <DiagFact k={t("aicc.thumb.diag.provider")} v={`${r.request.provider ?? "—"} · ${r.request.model ?? "—"}`} />
                    <DiagFact k={t("aicc.thumb.diag.endpoint")} v={`${r.request.method ?? ""} ${r.request.endpoint ?? "—"}`} mono />
                    <DiagFact k={t("aicc.thumb.diag.fields")} v={r.request.fields.join(", ") || "—"} mono />
                    <DiagFact k={t("aicc.thumb.diag.order")} v={r.request.inputOrder.join(" → ") || "—"} />
                    <DiagFact k="store" v={String(r.request.store)} mono />
                    <DiagFact k={t("aicc.thumb.diag.http")} v={`${r.request.httpRequests ?? "—"} · fallback ${r.request.fallback ?? "—"} · ${t("aicc.thumb.diag.history")} ${r.request.historyCount ?? "—"}`} />
                    <DiagFact k={t("aicc.thumb.diag.sizeRatio")} v={`${r.request.imageSize ?? "—"} / ${r.request.aspectRatio ?? "—"}`} />
                    <DiagFact k={t("aicc.thumb.diag.extras")} v={`system ${yes(r.request.systemInstruction)} · config ${yes(r.request.generationConfig)} · ${t("aicc.thumb.diag.contract")} ${yes(r.request.contractOk)}`} />
                    <DiagFact k={t("aicc.thumb.diag.prompt")} v={`v${r.request.promptVersion ?? "—"} · ${short(r.request.promptSha256)} · ${t("aicc.thumb.diag.publishedEq")} ${yes(r.request.publishedEqualsProvider)}`} mono />
                    <DiagFact k={t("aicc.thumb.diag.input")} v={`${short(r.request.inputSha256)} · ${r.request.inputBytes ?? "—"} B · ${r.request.inputTransform ?? "—"} · ${t("aicc.thumb.diag.asOriginal")} ${yes(r.request.inputEqualsOriginal)}`} mono />
                    <DiagFact k={t("aicc.thumb.diag.body")} v={short(r.request.bodySha256)} mono />
                    {r.delivered && (
                      <DiagFact k={t("aicc.thumb.diag.delivered")}
                        v={`${r.delivered.providerWidth ?? "—"}×${r.delivered.providerHeight ?? "—"} → ${r.delivered.storedWidth ?? "—"}×${r.delivered.storedHeight ?? "—"} · ${r.delivered.postprocess ?? "—"} · ${short(r.delivered.storedSha256)}`} mono />
                    )}
                  </dl>
                ) : (
                  <p className="mt-2 text-[11.5px] text-faint">{t("aicc.thumb.diag.noBoundary")}</p>
                )}
              </li>
            ))}
          </ul>
        </DiagSection>
      )}

      {d.compose && (
        <DiagSection title={t("aicc.thumb.diag.compose")}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr]">
            <p className="text-[11.5px] text-faint">{t("aicc.thumb.diag.noRaw")}</p>
            <dl className="grid content-start gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-2">
              <DiagFact k={t("aicc.thumb.diag.provider")} v={`${d.compose.provider ?? "—"} · ${d.compose.model ?? "—"}`} />
              <DiagFact k={t("aicc.thumb.diag.endpoint")} v={`${d.compose.method ?? ""} ${d.compose.endpoint ?? "—"}`} mono />
              <DiagFact k={t("aicc.thumb.diag.params")} v={`${d.compose.size ?? "—"} · ${d.compose.quality ?? "—"} · n=${d.compose.n ?? "—"} · ${d.compose.background ?? "—"} · ${d.compose.outputFormat ?? "—"}`} />
              <DiagFact k={t("aicc.thumb.diag.fields")} v={d.compose.fields.join(", ") || "—"} mono />
              <DiagFact k={t("aicc.thumb.diag.prompt")} v={`v${d.compose.promptVersion ?? "—"} · ${short(d.compose.promptSha256)}`} mono />
              <DiagFact k={t("aicc.thumb.diag.status")} v={`${d.compose.status ?? "—"}${d.compose.error ? ` · ${d.compose.error}` : ""} · HTTP ${d.compose.httpStatus ?? "—"} · ${t("aicc.thumb.diag.contract")} ${d.compose.contract ?? "—"}`} />
              <DiagFact k="request_id" v={d.compose.requestId ?? "—"} mono />
              {d.compose.response && (
                <DiagFact k={t("aicc.thumb.diag.response")} v={`${d.compose.response.width ?? "—"}×${d.compose.response.height ?? "—"} · data ${d.compose.response.dataCount ?? "—"} · ${d.compose.response.durationMs !== null ? `${(d.compose.response.durationMs / 1000).toFixed(1)} s` : "—"} · ${short(d.compose.response.sha256)}`} mono />
              )}
              <DiagFact k={t("aicc.thumb.diag.usage")} v={d.compose.usage ? JSON.stringify(d.compose.usage) : "—"} mono />
              <DiagFact k={t("aicc.thumb.diag.cost")} v={d.compose.costUsdMicros !== null ? `$${(d.compose.costUsdMicros / 1_000_000).toFixed(4)}` : t("aicc.thumb.costUnknown")} />
            </dl>
          </div>
          <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-muted">
            {d.compose.inputs.map((x) => (
              <li key={x.index} className="break-all">
                image[{x.index}] {short(x.sentSha256)} · {x.bytes ?? "—"} B · {x.mime ?? "—"} · {x.transform ?? "—"}
                {x.retouchJobId && <> · Retusz {short(x.retouchJobId)} · {t("aicc.thumb.diag.verified")} {yes(x.retouchVerified)}</>}
              </li>
            ))}
          </ul>
        </DiagSection>
      )}

      {d.finish && (
        <DiagSection title={t("aicc.thumb.diag.finish")}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr]">
            <div>{d.finish.image ? <DiagThumb img={d.finish.image} label={t("aicc.thumb.diag.final")} /> : <span className="text-xs text-faint">—</span>}</div>
            <dl className="grid content-start gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-2">
              <DiagFact k={t("aicc.thumb.diag.status")} v={d.finish.status ?? "—"} />
              <DiagFact k={t("aicc.thumb.diag.size")} v={`${d.finish.width ?? "—"}×${d.finish.height ?? "—"} · ${t("aicc.thumb.diag.margin")} ${d.finish.marginPx ?? "—"} px`} />
              <DiagFact k={t("aicc.thumb.diag.inner")} v={d.finish.inner ? JSON.stringify(d.finish.inner) : "—"} mono />
              <DiagFact k={t("aicc.thumb.diag.checks")} v={d.finish.checks ? JSON.stringify(d.finish.checks) : "—"} mono />
              <DiagFact k={t("aicc.thumb.diag.postprocess")} v={d.finish.postprocess.join(" → ") || "—"} />
            </dl>
          </div>
        </DiagSection>
      )}
    </div>
  );
}

function DiagSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-2 text-[12px] font-semibold text-muted">{title}</p>
      {children}
    </section>
  );
}

function DiagThumb({ img, label }: { img: DiagImage; label: string }) {
  return (
    <figure className="min-w-0">
      {img.url ? (
        <a href={img.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg bg-white ring-1 ring-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt="" className="h-full w-full object-contain" loading="lazy" />
        </a>
      ) : (
        <span className="flex aspect-square items-center justify-center rounded-lg bg-raised text-[11px] text-faint ring-1 ring-line">—</span>
      )}
      <figcaption className="mt-1 truncate text-[10.5px] text-faint" title={img.path}>{label}</figcaption>
    </figure>
  );
}

function DiagFact({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className={`min-w-0 break-all ${mono ? "font-mono text-[11px]" : ""}`}>{v}</dd>
    </div>
  );
}
