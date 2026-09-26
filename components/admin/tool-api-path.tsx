import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { PathModel, ToolApiPath } from "@/lib/server/tool-api-path";

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
        <p className="text-muted">{t("aicc.apiPath.customerChoice", { n: path.models })}</p>
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
          </span>
        ) : <span className="text-muted">{t(emptyKey)}</span>}
      </dd>
    </div>
  );
}
