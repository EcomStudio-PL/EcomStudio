import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ExecutionSummary, PathModel, ToolApiPath } from "@/lib/server/tool-api-path";

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * "Ścieżka API" — which provider and model a customer's run of this tool
 * really reaches. Server-rendered from lib/server/tool-api-path.ts; carries
 * names only, never a key.
 */
export function ToolApiPathCard({ path, t, compact = false }: { path: ToolApiPath; t: T; compact?: boolean }) {
  return (
    <div className={compact ? "space-y-2 text-[13px]" : "space-y-3 text-sm"} data-tool-api-path={path.kind}>
      {path.kind === "local" && (
        <p className="text-muted">{t("aicc.apiPath.local")}</p>
      )}
      {path.kind === "none" && (
        <p className="text-muted">{t("aicc.apiPath.none")}</p>
      )}
      {path.kind === "customer_choice" && (
        <div className="space-y-2">
          <p className="text-muted">{t("aicc.apiPath.customerChoice", { n: path.models })}</p>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-customer-models>
            {path.list.map((m) => <Slot key={m.id} label={m.providerName} model={m} t={t} />)}
          </dl>
        </div>
      )}
      {path.kind === "capability" && (
        <div className="space-y-1.5">
          <p className="text-muted">{t("aicc.apiPath.capability")}</p>
          <ol className="flex flex-wrap items-center gap-1.5">
            {path.chain.map((p, i) => (
              <li key={p.slug} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden className="text-faint">→</span>}
                <Badge tone={p.configured ? "success" : "neutral"} dot>{p.label}</Badge>
              </li>
            ))}
          </ol>
        </div>
      )}
      {(path.kind === "assigned" || path.kind === "fixed" || path.kind === "concept_chain") && (
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Slot label={t("aicc.apiPath.primary")} model={path.primary} t={t} />
          {path.kind !== "fixed" && (
            <Slot label={t("aicc.apiPath.fallback")} model={path.fallback} t={t} emptyKey="aicc.apiPath.noFallback" />
          )}
        </dl>
      )}
      {path.kind === "assigned" && path.defaulted && (
        <p className="text-xs text-faint">{t("aicc.apiPath.defaulted")}</p>
      )}
      {path.kind === "fixed" && <p className="text-xs text-faint">{t("aicc.apiPath.fixed")}</p>}
      {path.kind === "concept_chain" && (
        <p className="text-xs text-faint">
          {t("aicc.apiPath.conceptChain")}{" "}
          <Link href="/admin/ai/modele?tab=modele" className="text-accent hover:underline">{t("aicc.apiPath.editPriority")}</Link>
        </p>
      )}
    </div>
  );
}

function Slot({ label, model, t, emptyKey = "aicc.apiPath.unavailable" }: {
  label: string; model: PathModel | null; t: T; emptyKey?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-raised px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{label}</dt>
      <dd className="mt-0.5 min-w-0">
        {model ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted">{t("aicc.apiPath.provider")}: <span className="text-ink">{model.providerName}</span></span>
            <span className="text-muted">{t("aicc.apiPath.model")}: <span className="text-ink">{model.model}</span></span>
            {!model.ready && <Badge tone="warning">{t("aicc.apiPath.inactive")}</Badge>}
            <span className="basis-full text-xs text-muted" data-cost-source={model.costSource}>
              {t("aicc.exec.costPerImage")}:{" "}
              {model.costPerImageUsdMicros === null
                ? <span className="font-semibold text-warning">{t("aicc.exec.costUnknown")}</span>
                : <span className="text-ink">${(model.costPerImageUsdMicros / 1_000_000).toFixed(4)}</span>}
              {" · "}{t(`aicc.exec.costSource.${model.costSource}`)}
            </span>
          </span>
        ) : <span className="text-muted">{t(emptyKey)}</span>}
      </dd>
    </div>
  );
}

/**
 * THE EXECUTION PATH (§ Modele, API i koszty): what decides the instruction,
 * whether a WORKFLOW drives the tool, and — when it does — each step's
 * executor. When the Workflow switch is ON the model slots below it only
 * apply to steps that name no model of their own; the card says so.
 */
export function ExecutionPathCard({ exec, path, toolKey, t }: {
  exec: ExecutionSummary; path: ToolApiPath; toolKey: string; t: T;
}) {
  const wf = exec.workflow;
  const driven = exec.workflowEnabled && wf !== null;
  return (
    <div className="space-y-4 text-sm" data-execution-path={driven ? "workflow" : path.kind}>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="min-w-0 rounded-xl bg-raised px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{t("aicc.exec.mode")}</dt>
          <dd className="mt-0.5">{t(`aicc.engine.${exec.engineMode}`)}</dd>
        </div>
        <div className="min-w-0 rounded-xl bg-raised px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{t("aicc.exec.workflow")}</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={driven ? "accent" : "neutral"}>{driven ? t("aicc.wf2.on") : t("aicc.wf2.off")}</Badge>
            {wf && <span className="text-xs text-muted">v{wf.version} · {t("aicc.wf2.outputs", { n: wf.maxOutputs })}</span>}
          </dd>
        </div>
        <div className="min-w-0 rounded-xl bg-raised px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{t("aicc.exec.chosenBy")}</dt>
          <dd className="mt-0.5 text-xs text-muted">{driven ? t("aicc.exec.byWorkflow") : t(`aicc.exec.by.${path.kind}`)}</dd>
        </div>
      </dl>

      {driven && wf && (
        <div className="space-y-2 rounded-xl border border-accent/30 bg-accent/5 p-3" data-workflow-driven>
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {t("aicc.exec.drivenTitle")}
            <Link href={`/admin/ai/${toolKey}?tab=workflow`} className="text-[13px] font-semibold text-accent hover:underline">
              {t("aicc.exec.openEditor")}
            </Link>
          </p>
          <ol className="space-y-1.5">
            {wf.steps.map((s) => (
              <li key={s.n} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-bold">{s.n}</span>
                <span className="min-w-0 font-medium">{s.name}</span>
                <Badge tone="neutral">{t(`aicc.wf2.op.${s.operation}`)}</Badge>
                {s.forEach && <Badge tone="info">{t("aicc.wf2.forEachShort", { n: s.maxItems ?? 1 })}</Badge>}
                {!s.enabled && <Badge tone="neutral">{t("aicc.wf.disabled")}</Badge>}
                <span className="min-w-0 break-words text-xs text-muted">
                  {s.operation === "ai_text" || s.operation === "analyze"
                    ? [s.textProvider ?? t("aicc.exec.textAuto"), s.textModel].filter(Boolean).join(" · ")
                    : s.operation === "tool"
                      ? t(`aicc.wf2.tool.${s.toolSlug ?? "retouch"}`)
                      : [s.model ?? t("aicc.exec.toolModel"), s.fallback ? `${t("aicc.apiPath.fallback")}: ${s.fallback}` : null].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-faint">{t("aicc.exec.drivenNote")}</p>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold text-muted">{driven ? t("aicc.exec.toolModelTitle") : t("aicc.exec.productionTitle")}</p>
        <ToolApiPathCard path={path} t={t} />
      </div>
    </div>
  );
}
