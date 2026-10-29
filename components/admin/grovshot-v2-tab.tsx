import Link from "next/link";
import type { createClient } from "@/lib/supabase/server";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PromptDraftProvider, ToolPromptEditor, ToolPromptHistory } from "@/components/admin/tool-prompt";
import { GROVSHOT_V2_KEYS, isGrovshotV2Key, type GrovshotStageKey } from "@/lib/grovshot-v2/stages";
import { TYPICAL_ASSUMPTIONS } from "@/lib/grovshot-v2/economics";
import { readGrovshotAdmin, readStageVersions } from "@/lib/server/grovshot-v2/admin";
import { readReadiness } from "@/lib/server/grovshot-v2/readiness";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { formatDate } from "@/lib/utils";
import { GsV2RoleModels, GsV2RunCard, GsV2SeedDrafts, GsV2TestPanel } from "@/components/admin/grovshot-v2-client";

/**
 * SILNIK V2 — GrovShot's Lifestyle Engine V2 in the GrovShot tool page:
 *   0 the readiness centre (every line read now: Anthropic key, the model of
 *     each role, Nano Banana Pro, templates, worker, margin gate, the last
 *     full test), the stage models and the launch sequence,
 *   1 status (readiness, flag, may customers get it at today's prices),
 *   2 the six stage keys (versioned like every prompt: draft · publish ·
 *     rollback, audited) with the spec drafts loader,
 *   3 costs and margin per order size (assumptions stated),
 *   4 an admin test on chosen versions (drafts included, never charged),
 *   5 the last orders, stage by stage.
 * V1 (the Silnik tab) is untouched and stays every customer's default.
 */

type T = (key: string, values?: Record<string, string | number>) => string;

const short = (k: GrovshotStageKey) => k.replace("grovshot_v2_", "");

export async function GrovshotV2Tab({ supabase, t, locale, stage }: {
  supabase: Awaited<ReturnType<typeof createClient>>; t: T; locale: string; stage?: string;
}) {
  const selected: GrovshotStageKey = stage && isGrovshotV2Key(stage) ? stage : "grovshot_v2_config";
  const { data: { user } } = await supabase.auth.getUser();
  const [admin, versions, workspace] = await Promise.all([
    readGrovshotAdmin(supabase), readStageVersions(supabase, selected),
    user ? getCurrentWorkspace(supabase, user.id) : Promise.resolve(null),
  ]);
  const { state, flag, economics, stages } = admin;
  const rc = await readReadiness(supabase, admin);
  const states = Object.fromEntries(state.roles.map((r) => [r.role, r.primary.state]));
  const toDo = rc.checks.filter((c) => !c.good).length;
  const allVersions = await Promise.all(GROVSHOT_V2_KEYS.map((k) => (k === selected ? Promise.resolve(versions) : readStageVersions(supabase, k))));
  const pickable = Object.fromEntries(GROVSHOT_V2_KEYS.map((k, i) => [k,
    allVersions[i].filter((v) => v.status === "draft" || v.status === "published").map((v) => ({ id: v.id, version: v.version, status: v.status }))]));
  const usd = (m: number | null) => (m === null ? "—" : `$${(m / 1_000_000).toFixed(3)}`);

  return (
    <div className="space-y-4" data-grovshot-v2-admin>
      <Card className="p-4 sm:p-5" data-gsv2-readiness={rc.ready ? "ready" : "not_ready"}>
        <CardHeader title={`0. ${t("aicc.gsv2.rc")}`} sub={t("aicc.gsv2.rcSub")} />
        <div className="space-y-4 pt-4">
          <Badge tone={rc.ready ? "success" : "warning"} dot>
            {rc.ready ? t("aicc.gsv2.rcReady") : t("aicc.gsv2.rcNotReady", { n: toDo, of: rc.checks.length })}
          </Badge>
          <ul className="grid gap-1.5 sm:grid-cols-2" data-gsv2-checks>
            {rc.checks.map((c) => (
              <li key={c.key} className="flex min-w-0 items-start justify-between gap-2 rounded-lg bg-raised px-3 py-2 text-[12.5px]" data-gsv2-check={c.key} data-status={c.status}>
                <span className="min-w-0">
                  <span className="font-semibold">{t(`aicc.gsv2.check.${c.key}`)}</span>
                  {c.detail && <code className="block break-words font-mono text-[11px] text-muted">{c.detail}</code>}
                </span>
                <Badge tone={c.good ? "success" : c.status === "error" || c.status === "blocked" ? "danger" : "warning"}>{t(`aicc.gsv2.cs.${c.status}`)}</Badge>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <Fact label={t("aicc.gsv2.anthropic")}>
              <Badge tone={rc.anthropic.state === "ok" ? "success" : "warning"} dot>{t(`aicc.gsv2.anthropicState.${rc.anthropic.state}`)}</Badge>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{t("aicc.gsv2.anthropicHelp")}</p>
              <Link href="/admin/ai/modele" className="mt-1 inline-block text-xs font-semibold text-accent hover:underline">{t("aicc.gsv2.anthropicOpen")}</Link>
              <p className="mt-1.5 break-words text-xs text-muted" data-gsv2-anthropic-error>
                {t("aicc.gsv2.lastError")}: {rc.anthropic.lastError
                  ? `${rc.anthropic.lastError.code}${rc.anthropic.lastError.model ? ` · ${rc.anthropic.lastError.model}` : ""} · ${formatDate(rc.anthropic.lastError.at, locale)}`
                  : t("aicc.gsv2.noError")}
              </p>
              <p className="mt-1 break-words text-xs text-muted" data-gsv2-anthropic-usage>
                {t("aicc.gsv2.usage", {
                  calls: rc.anthropic.usage.calls, input: rc.anthropic.usage.input, output: rc.anthropic.usage.output,
                  cached: rc.anthropic.usage.cached, cost: `$${(rc.anthropic.usage.usdMicros / 1_000_000).toFixed(4)}`,
                })}
                {rc.anthropic.usage.unknown ? t("aicc.gsv2.usageUnknown", { n: rc.anthropic.usage.unknown }) : ""}
              </p>
            </Fact>
            <Fact label={t("aicc.gsv2.lastTest")}>
              <p className="text-[13px]" data-gsv2-last-test>
                {rc.lastTest
                  ? t("aicc.gsv2.lastTestValue", {
                      mode: rc.lastTest.mode ? t(`aicc.gsv2.mode.${rc.lastTest.mode}`) : "—",
                      status: t(`aicc.runs.status.${rc.lastTest.status}`), n: rc.lastTest.delivered, date: formatDate(rc.lastTest.at, locale),
                    })
                  : t("aicc.gsv2.noTest")}
              </p>
              <p className="mt-2 text-xs font-semibold text-muted">{t("aicc.gsv2.seq")}</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-muted" data-gsv2-sequence>
                {[1, 2, 3, 4, 5, 6].map((n) => <li key={n}>{t(`aicc.gsv2.seq.${n}`)}</li>)}
              </ol>
            </Fact>
          </div>
          <div>
            <p className="text-[13px] font-semibold">{t("aicc.gsv2.models")}</p>
            <p className="mb-2 text-xs leading-relaxed text-muted">{t("aicc.gsv2.modelsSub")}</p>
            <GsV2RoleModels models={state.models} states={states} />
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5" data-gsv2-status>
        <CardHeader title={`1. ${t("aicc.gsv2.status")}`} sub={t("aicc.gsv2.statusSub")} />
        <div className="grid gap-3 pt-4 sm:grid-cols-3">
          <Fact label={t("aicc.gsv2.readiness")}>
            <Badge tone={state.ready ? "success" : "warning"} dot>{state.ready ? t("aicc.gsv2.ready") : t("aicc.gsv2.notReady")}</Badge>
            {state.blockers.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-muted" data-gsv2-blockers>
                {state.blockers.map((b) => <li key={b}><code className="font-mono">{b}</code></li>)}
              </ul>
            )}
          </Fact>
          <Fact label={t("aicc.gsv2.flag")}>
            <Badge tone={flag.enabled ? "accent" : "neutral"} dot>
              {flag.enabled ? t("aicc.gsv2.flagOn") : t("aicc.gsv2.flagOff")}
            </Badge>
            <p className="mt-1.5 text-xs text-muted">
              {t("aicc.gsv2.flagRoles", { roles: flag.roles.length ? flag.roles.join(", ") : t("aicc.gsv2.everyone") })}
              {flag.rollout !== null ? ` · ${flag.rollout}%` : ""}
            </p>
            <Link href="/admin/system" className="mt-1 inline-block text-xs font-semibold text-accent hover:underline">{t("aicc.gsv2.flagEdit")}</Link>
          </Fact>
          <Fact label={t("aicc.gsv2.customers")}>
            <Badge tone={economics?.customerAllowed ? "success" : "danger"} dot data-gsv2-customers={economics?.customerAllowed ? "allowed" : "blocked"}>
              {economics?.customerAllowed ? t("aicc.gsv2.customersAllowed") : t("aicc.gsv2.customersBlocked")}
            </Badge>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{t("aicc.gsv2.customersNote")}</p>
          </Fact>
        </div>
        <p className="mt-3 text-xs text-faint">
          {state.model
            ? t("aicc.gsv2.modelLine", {
                model: state.model.identifier,
                prices: state.model.resolutions.map((r) => `${r} ${state.model!.pricing[r] ?? "—"} kr.`).join(" · "),
                backends: state.roles.filter((r) => r.usable).length,
              })
            : t("aicc.gsv2.noModel")}
        </p>
      </Card>

      <Card className="p-4 sm:p-5" data-gsv2-stages>
        <CardHeader title={`2. ${t("aicc.gsv2.stages")}`} sub={t("aicc.gsv2.stagesSub")} />
        <div className="space-y-4 pt-4">
          <nav className="flex flex-wrap gap-1.5" aria-label={t("aicc.gsv2.stages")}>
            {stages.map((s) => (
              <Link key={s.key} href={`/admin/ai/prompts?tab=engine_v2&stage=${s.key}`} scroll={false}
                aria-current={s.key === selected ? "page" : undefined} data-gsv2-stage={short(s.key)}
                className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                  s.key === selected ? "bg-raised text-ink" : "text-muted hover:text-ink")}>
                {t(`aicc.gsv2.stage.${short(s.key)}`)}
                <Badge tone={s.published !== null ? "success" : "neutral"}>
                  {s.published !== null ? `v${s.published}` : t("aicc.gsv2.unpublished")}
                </Badge>
                {s.drafts > 0 && <Badge tone="info">{t("aicc.gsv2.drafts", { n: s.drafts })}</Badge>}
              </Link>
            ))}
          </nav>
          <GsV2SeedDrafts hasDrafts={stages.some((s) => s.drafts > 0 || s.published !== null)} />
          <p className="text-xs leading-relaxed text-muted">{t(`aicc.gsv2.stageHelp.${short(selected)}`)}</p>
          <PromptDraftProvider key={selected}>
            <div className="space-y-4">
              <ToolPromptEditor toolKey={selected} versions={versions} locale={locale} hasEngine />
              <ToolPromptHistory versions={versions} locale={locale} />
            </div>
          </PromptDraftProvider>
        </div>
      </Card>

      <Card className="p-4 sm:p-5" data-gsv2-economics>
        <CardHeader title={`3. ${t("aicc.gsv2.econ")}`} sub={t("aicc.gsv2.econSub", {
          complex: Math.round(TYPICAL_ASSUMPTIONS.complexShare * 100), retry: Math.round(TYPICAL_ASSUMPTIONS.retryShare * 100),
          delivered: Math.round(TYPICAL_ASSUMPTIONS.deliveredShare * 100),
        })} />
        {!economics ? (
          <p className="pt-4 text-[13px] text-muted">{t("aicc.gsv2.econUnavailable")}</p>
        ) : (
          <div className="space-y-4 pt-4">
            <p className="text-xs text-muted">
              {t("aicc.gsv2.econBilling", {
                pln: economics.billing.plnPerCredit.toFixed(2), fx: economics.billing.usdToPln.toFixed(2), floor: economics.billing.minMarginPercent,
              })}
              {!economics.textPriced && <span className="text-warning"> {t("aicc.gsv2.econTextEstimated")}</span>}
              {!economics.imageTokensPriced && <span className="text-warning"> {t("aicc.gsv2.econImageTokensEstimated")}</span>}
            </p>
            {economics.tables.map((tb) => (
              <div key={tb.resolution} className="min-w-0" data-gsv2-econ={tb.resolution}>
                <p className="mb-1.5 text-[13px] font-semibold">
                  {tb.resolution} · {tb.unitCredits} kr. / {t("aicc.gsv2.perImage")} · {t("aicc.gsv2.providerImage")} {usd(tb.imageUsdMicros)}
                </p>
                {tb.rows.length === 0 ? <p className="text-xs text-muted">{t("aicc.gsv2.econNoPrice")}</p> : (
                  <div className="thin-scroll overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-[12px] tabular-nums">
                      <thead className="text-faint">
                        <tr>
                          <th className="py-1 pr-2 font-medium">{t("aicc.gsv2.econShots")}</th>
                          <th className="py-1 pr-2 font-medium">{t("aicc.gsv2.econScenario")}</th>
                          <th className="py-1 pr-2 font-medium">{t("aicc.gsv2.econCalls")}</th>
                          <th className="py-1 pr-2 font-medium">{t("aicc.gsv2.econRevenue")}</th>
                          <th className="py-1 pr-2 font-medium">{t("aicc.gsv2.econCost")}</th>
                          <th className="py-1 font-medium">{t("aicc.gsv2.econMargin")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {tb.rows.map((r) => (
                          <tr key={`${r.shots}-${r.scenario}`} data-gsv2-econ-row={`${r.shots}:${r.scenario}`}>
                            <td className="py-1 pr-2">{r.shots}</td>
                            <td className="py-1 pr-2">{t(`aicc.gsv2.scenario.${r.scenario}`)}</td>
                            <td className="py-1 pr-2">{t("aicc.gsv2.econCallsValue", { images: r.images, text: r.textCalls })}</td>
                            <td className="py-1 pr-2">{r.revenuePln.toFixed(2)} zł</td>
                            <td className="py-1 pr-2">{r.costPln.toFixed(2)} zł (${r.costUsd.toFixed(3)})</td>
                            <td className={cn("py-1 font-semibold", r.marginPercent === null ? "text-danger" : r.meetsFloor ? "text-success" : "text-danger")}>
                              {r.marginPercent === null ? t("aicc.gsv2.econLoss") : `${r.marginPercent.toFixed(1)}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
            <p className="text-xs text-faint">{t("aicc.gsv2.econNote")}</p>
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5" data-gsv2-test>
        <CardHeader title={`4. ${t("aicc.gsv2.test")}`} sub={t("aicc.gsv2.testSub")} />
        <div className="pt-4">
          <GsV2TestPanel versions={pickable} ratios={state.model?.ratios ?? []} resolutions={state.model?.resolutions ?? []}
            workspaceId={workspace?.id ?? null} budgets={state.testBudgets} />
        </div>
      </Card>

      <Card className="p-4 sm:p-5" data-gsv2-runs>
        <CardHeader title={`5. ${t("aicc.gsv2.runs")}`} sub={t("aicc.gsv2.runsSub")} />
        <div className="space-y-2 pt-4">
          {admin.runs.length === 0
            ? <p className="text-[13px] text-muted">{t("aicc.gsv2.runsEmpty")}</p>
            : admin.runs.map((r) => <GsV2RunCard key={r.id} run={r} locale={locale} />)}
        </div>
      </Card>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-raised px-3.5 py-3">
      <p className="mb-1.5 text-xs text-muted">{label}</p>
      {children}
    </div>
  );
}
