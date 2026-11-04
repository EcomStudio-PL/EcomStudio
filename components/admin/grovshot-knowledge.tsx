"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import {
  activateKnowledgeVersionAction, createRuleAction, createTestCaseAction, publishKnowledgeAction, reviewRulesAction,
  reviseRuleAction, ruleFromTestCaseAction, ruleHistoryAction, updateRuleAction, updateTestCaseAction,
} from "@/app/actions/grovshot-knowledge";
import { KNOWLEDGE_DELIVERIES, KNOWLEDGE_SCOPES, KNOWLEDGE_TOPICS, RULE_STATUSES } from "@/lib/grovshot-v2/knowledge";
import { STAGE_ROLES } from "@/lib/grovshot-v2/config";
import type { KnowledgeAdmin, RuleView, SourceView, TestCaseView } from "@/lib/server/grovshot-v2/knowledge";

/**
 * WIEDZA → GROVSHOT V2 — the expert knowledge base (Kuba's spec, later
 * documents, test cases): sources, the rule review, published versions with
 * rollback, and test cases. Nothing here changes a prompt until „Opublikuj
 * nową wersję”; an order keeps the version it started with.
 */

type Tab = "rules" | "sources" | "versions" | "cases";
type EditMode = { kind: "edit" | "revise" | "create"; rule: RuleView | null } | { kind: "case"; c: TestCaseView };
const PAGE = 60;
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  pending: "warning", approved: "success", rejected: "danger", superseded: "neutral", retired: "neutral",
};

export function GrovshotKnowledge({ data, locale }: { data: KnowledgeAdmin; locale: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<Tab>("rules");
  const [status, setStatus] = useState<string>("pending");
  const [source, setSource] = useState<string>("");
  const [stage, setStage] = useState<string>("");
  const [delivery, setDelivery] = useState<string>("");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [caseOpen, setCaseOpen] = useState(false);
  const [edit, setEdit] = useState<EditMode | null>(null);
  const [history, setHistory] = useState<{ rule: RuleView; data: Awaited<ReturnType<typeof ruleHistoryAction>> | null } | null>(null);
  const [rollback, setRollback] = useState<{ id: string; version: number } | null>(null);

  const fmt = (iso: string | null) => iso
    ? new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB", { dateStyle: "short" }).format(new Date(iso)) : "—";
  const byId = useMemo(() => new Map(data.rules.map((r) => [r.id, r])), [data.rules]);
  const sourceOf = useMemo(() => new Map(data.sources.map((s) => [s.id, s])), [data.sources]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { total: data.rules.length, delivered: 0 };
    for (const s of RULE_STATUSES) c[s] = 0;
    for (const r of data.rules) { c[r.status]++; if (r.status === "approved" && r.delivery === "knowledge") c.delivered++; }
    return c;
  }, [data.rules]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.rules.filter((r) => (!status || r.status === status) && (!source || r.sourceId === source || (source === "cases" && r.exampleId))
      && (!stage || r.stages.includes(stage as RuleView["stages"][number])) && (!delivery || r.delivery === delivery)
      && (!q || `${r.title} ${r.body} ${r.section ?? ""} ${r.scopeValues.join(" ")}`.toLowerCase().includes(q)));
  }, [data.rules, status, source, stage, delivery, query]);

  const errText = (code?: string) => t(`aicc.gsk.err.${code ?? "generic"}`);
  const run = <R extends { ok: boolean; error?: string }>(p: Promise<R>, ok: (r: R) => void) => start(async () => {
    const r = await p;
    if (r.ok) { ok(r); router.refresh(); } else toast.error(errText(r.error));
  });
  const review = (ids: string[], to: string, note = "") => run(reviewRulesAction(ids, to, note), (r) => {
    toast.success(t("aicc.gsk.reviewed", { n: (r as { count?: number }).count ?? 0 }));
    setSelected(new Set());
  });
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const openHistory = (rule: RuleView) => { setHistory({ rule, data: null }); start(async () => setHistory({ rule, data: await ruleHistoryAction(rule.id) })); };

  return (
    <div className="space-y-4" data-gsv2-knowledge>
      <Card className="p-4 sm:p-5">
        <CardHeader overline={t("aicc.gsk.overline")} title={t("aicc.gsk.title")} sub={t("aicc.gsk.sub")} />
        <div className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t("aicc.gsk.activeVersion")}>
            {data.active ? (
              <>
                <Badge tone="success" dot data-gsk-active={data.active.version}>{t("aicc.gsk.versionN", { n: data.active.version })}</Badge>
                <p className="mt-1.5 text-xs text-muted">{t("aicc.gsk.activeSince", { date: fmt(data.active.activatedAt ?? data.active.createdAt), n: data.active.deliveredCount })}</p>
              </>
            ) : (
              <>
                <Badge tone="warning" dot data-gsk-active="none">{t("aicc.gsk.noVersion")}</Badge>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{t("aicc.gsk.noVersionHelp")}</p>
              </>
            )}
          </Fact>
          <Fact label={t("aicc.gsk.rules")}>
            <p className="text-[13px] tabular-nums">{t("aicc.gsk.rulesCounts", { total: counts.total, pending: counts.pending, approved: counts.approved })}</p>
            <p className="mt-1 text-xs text-muted">{t("aicc.gsk.deliveredApproved", { n: counts.delivered })}</p>
          </Fact>
          <Fact label={t("aicc.gsk.changes")}>
            <Badge tone={data.unpublishedChanges > 0 ? "warning" : "neutral"} data-gsk-unpublished={data.unpublishedChanges}>
              {data.unpublishedChanges > 0 ? t("aicc.gsk.changesN", { n: data.unpublishedChanges }) : t("aicc.gsk.noChanges")}
            </Badge>
            <p className="mt-1.5 text-xs text-muted">{t("aicc.gsk.changesHelp")}</p>
          </Fact>
          <Fact label={t("aicc.gsk.sourcesLabel")}>
            <p className="text-[13px]">{t("aicc.gsk.sourcesN", { n: data.sources.length, cases: data.testCases.length })}</p>
          </Fact>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setUploadOpen(true)} data-gsk-add>{t("aicc.gsk.add")}</Button>
          <Button size="sm" variant="secondary" disabled={pending || counts.approved === 0} onClick={() => setPublishOpen(true)} data-gsk-publish>{t("aicc.gsk.publish")}</Button>
          <Button size="sm" variant="secondary" onClick={() => setEdit({ kind: "create", rule: null })}>{t("aicc.gsk.newRule")}</Button>
          <Button size="sm" variant="secondary" onClick={() => setCaseOpen(true)}>{t("aicc.gsk.newCase")}</Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-faint">{t("aicc.gsk.learning")}</p>
      </Card>

      <Segmented size="sm" value={tab} onChange={(v) => setTab(v as Tab)} label={t("aicc.gsk.title")} options={[
        { value: "rules", label: t("aicc.gsk.tab.rules"), meta: String(counts.total) },
        { value: "sources", label: t("aicc.gsk.tab.sources"), meta: String(data.sources.length) },
        { value: "versions", label: t("aicc.gsk.tab.versions"), meta: String(data.versions.length) },
        { value: "cases", label: t("aicc.gsk.tab.cases"), meta: String(data.testCases.length) },
      ]} />

      {tab === "rules" && (
        <Card className="p-4 sm:p-5" data-gsk-rules>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Select aria-label={t("aicc.gsk.f.status")} value={status} onChange={(e) => { setStatus(e.target.value); setShown(PAGE); }}>
              <option value="">{t("aicc.gsk.f.allStatuses")}</option>
              {RULE_STATUSES.map((s) => <option key={s} value={s}>{t(`aicc.gsk.status.${s}`)} ({counts[s]})</option>)}
            </Select>
            <Select aria-label={t("aicc.gsk.f.source")} value={source} onChange={(e) => { setSource(e.target.value); setShown(PAGE); }}>
              <option value="">{t("aicc.gsk.f.allSources")}</option>
              {data.sources.map((s) => <option key={s.id} value={s.id}>{s.title.slice(0, 40)} · v{s.version} · {s.format.toUpperCase()}</option>)}
              <option value="cases">{t("aicc.gsk.f.fromCases")}</option>
            </Select>
            <Select aria-label={t("aicc.gsk.f.stage")} value={stage} onChange={(e) => { setStage(e.target.value); setShown(PAGE); }}>
              <option value="">{t("aicc.gsk.f.allStages")}</option>
              {STAGE_ROLES.map((s) => <option key={s} value={s}>{t(`aicc.gsv2.role.${s}`)}</option>)}
            </Select>
            <Select aria-label={t("aicc.gsk.f.delivery")} value={delivery} onChange={(e) => { setDelivery(e.target.value); setShown(PAGE); }}>
              <option value="">{t("aicc.gsk.f.allDeliveries")}</option>
              {KNOWLEDGE_DELIVERIES.map((d) => <option key={d} value={d}>{t(`aicc.gsk.delivery.${d}`)}</option>)}
            </Select>
            <Input type="search" placeholder={t("aicc.gsk.f.search")} value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span data-gsk-filtered={filtered.length}>{t("aicc.gsk.found", { n: filtered.length })}</span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(filtered.filter((r) => r.status === "pending").map((r) => r.id)))}>{t("aicc.gsk.selectPending")}</Button>
            {selected.size > 0 && (
              <>
                <span className="font-semibold text-ink">{t("aicc.gsk.selected", { n: selected.size })}</span>
                <Button size="sm" disabled={pending} onClick={() => review([...selected], "approved")} data-gsk-bulk-approve>{t("aicc.gsk.approve")}</Button>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => review([...selected], "rejected")}>{t("aicc.gsk.reject")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("aicc.gsk.clear")}</Button>
              </>
            )}
          </div>
          <ul className="mt-3 space-y-2">
            {filtered.slice(0, shown).map((r) => (
              <RuleRow key={r.id} r={r} t={t} fmt={fmt} source={r.sourceId ? sourceOf.get(r.sourceId) ?? null : null} byId={byId}
                checked={selected.has(r.id)} onCheck={() => toggle(r.id)} pending={pending}
                onReview={(to) => review([r.id], to)} onEdit={() => setEdit({ kind: r.status === "pending" ? "edit" : "revise", rule: r })}
                onHistory={() => openHistory(r)} />
            ))}
          </ul>
          {filtered.length > shown && (
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => setShown((n) => n + PAGE)}>{t("aicc.gsk.more", { n: filtered.length - shown })}</Button>
          )}
          {filtered.length === 0 && <p className="mt-3 text-[13px] text-muted">{t("aicc.gsk.empty")}</p>}
        </Card>
      )}

      {tab === "sources" && (
        <div className="grid gap-3 lg:grid-cols-2" data-gsk-sources>
          {data.sources.length === 0 && <Card className="p-4 text-[13px] text-muted">{t("aicc.gsk.noSources")}</Card>}
          {data.sources.map((s) => (
            <SourceCard key={s.id} s={s} t={t} fmt={fmt} pending={pending}
              onShow={() => { setSource(s.id); setStatus(""); setTab("rules"); }}
              onApproveAll={() => review(data.rules.filter((r) => r.sourceId === s.id && r.status === "pending").map((r) => r.id), "approved", t("aicc.gsk.bulkNote", { title: s.title }))} />
          ))}
        </div>
      )}

      {tab === "versions" && (
        <Card className="p-4 sm:p-5" data-gsk-versions>
          {data.versions.length === 0 ? <p className="text-[13px] text-muted">{t("aicc.gsk.noVersionsYet")}</p> : (
            <ul className="divide-y divide-line">
              {data.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5" data-gsk-version={v.version}>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold">
                      {t("aicc.gsk.versionN", { n: v.version })} {v.active && <Badge tone="success" dot>{t("aicc.gsk.active")}</Badge>}
                    </p>
                    <p className="text-xs text-muted">{t("aicc.gsk.versionLine", { date: fmt(v.createdAt), rules: v.ruleCount, sent: v.deliveredCount, cases: v.exampleCount, by: v.createdBy ?? "—" })}</p>
                    {v.changelog && <p className="mt-1 whitespace-pre-line text-xs text-ink">{v.changelog}</p>}
                  </div>
                  {!v.active && <Button size="sm" variant="secondary" disabled={pending} onClick={() => setRollback({ id: v.id, version: v.version })}>{t("aicc.gsk.restore")}</Button>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-faint">{t("aicc.gsk.versionsHelp")}</p>
        </Card>
      )}

      {tab === "cases" && (
        <Card className="p-4 sm:p-5" data-gsk-cases>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs text-muted">{t("aicc.gsk.casesHelp")}</p>
            <Button size="sm" onClick={() => setCaseOpen(true)}>{t("aicc.gsk.newCase")}</Button>
          </div>
          {data.testCases.length === 0 ? <p className="text-[13px] text-muted">{t("aicc.gsk.noCases")}</p> : (
            <ul className="space-y-2">
              {data.testCases.map((c) => (
                <CaseRow key={c.id} c={c} t={t} fmt={fmt} pending={pending}
                  onStatus={(to) => run(updateTestCaseAction(c.id, { status: to }), () => toast.success(t("aicc.gsk.saved")))}
                  onCategory={(cat) => run(updateTestCaseAction(c.id, { category: cat }), () => toast.success(t("aicc.gsk.saved")))}
                  onRule={() => setEdit({ kind: "case", c })} />
              ))}
            </ul>
          )}
        </Card>
      )}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} sets={data.sets} t={t} onDone={() => { setUploadOpen(false); setStatus("pending"); setTab("rules"); router.refresh(); }} />
      <PublishModal open={publishOpen} onClose={() => setPublishOpen(false)} t={t} pending={pending} approved={counts.approved} delivered={counts.delivered}
        onPublish={(log) => run(publishKnowledgeAction(log), (r) => { toast.success(t("aicc.gsk.published", { n: (r as { version?: number }).version ?? 0 })); setPublishOpen(false); })} />
      <CaseModal open={caseOpen} onClose={() => setCaseOpen(false)} t={t} pending={pending}
        onSave={(f) => run(createTestCaseAction(f), () => { toast.success(t("aicc.gsk.saved")); setCaseOpen(false); setTab("cases"); })} />
      {edit && (
        <RuleModal mode={edit} t={t} pending={pending} onClose={() => setEdit(null)}
          onSave={(patch) => {
            const p = edit.kind === "edit" ? updateRuleAction(edit.rule!.id, patch)
              : edit.kind === "revise" ? reviseRuleAction(edit.rule!.id, patch)
              : edit.kind === "case" ? ruleFromTestCaseAction(edit.c.id, patch) : createRuleAction(patch);
            run(p as Promise<{ ok: boolean; error?: string }>, () => { toast.success(t(edit.kind === "revise" ? "aicc.gsk.revised" : "aicc.gsk.saved")); setEdit(null); });
          }} />
      )}
      <Modal portal wide open={Boolean(history)} onClose={() => setHistory(null)} title={t("aicc.gsk.history")}>
        {history && (!history.data ? <p className="text-[13px] text-muted">…</p> : !history.data.ok ? <p className="text-danger">{errText(history.data.error)}</p> : (
          <div className="space-y-3 text-[13px]" data-gsk-history>
            <p className="font-semibold">{history.rule.title}</p>
            <div>
              <p className="text-xs font-semibold text-muted">{t("aicc.gsk.revisions")}</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {history.data.history.revisions.map((v) => <li key={v.id}>r{v.revision} · {t(`aicc.gsk.status.${v.status}`)} · {fmt(v.created_at)}{v.reviewed_at ? ` → ${fmt(v.reviewed_at)}` : ""}</li>)}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted">{t("aicc.gsk.events")}</p>
              {history.data.history.events.length === 0 ? <p className="text-xs text-muted">—</p> : (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {history.data.history.events.map((e, i) => <li key={i}>{fmt(e.at)} · {e.actor ?? "—"} · {e.action.replace("admin.knowledge_", "")}{e.status ? ` → ${t(`aicc.gsk.status.${e.status}`)}` : ""}{e.note ? ` · ${e.note}` : ""}</li>)}
                </ul>
              )}
            </div>
          </div>
        ))}
      </Modal>
      <ConfirmModal portal open={Boolean(rollback)} onClose={() => setRollback(null)} pending={pending}
        title={t("aicc.gsk.restoreTitle", { n: rollback?.version ?? 0 })} body={t("aicc.gsk.restoreBody")} confirmLabel={t("aicc.gsk.restore")}
        onConfirm={() => rollback && run(activateKnowledgeVersionAction(rollback.id), () => { toast.success(t("aicc.gsk.restored", { n: rollback.version })); setRollback(null); })} />
    </div>
  );
}

type T = (k: string, v?: Record<string, string | number>) => string;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 rounded-xl bg-raised px-3.5 py-3"><p className="mb-1.5 text-xs text-muted">{label}</p>{children}</div>;
}

function RuleRow({ r, t, fmt, source, byId, checked, onCheck, pending, onReview, onEdit, onHistory }: {
  r: RuleView; t: T; fmt: (s: string | null) => string; source: SourceView | null; byId: Map<string, RuleView>; checked: boolean; onCheck: () => void;
  pending: boolean; onReview: (to: string) => void; onEdit: () => void; onHistory: () => void;
}) {
  const scope = r.scopeKind === "global" ? t("aicc.gsk.scope.global") : `${t(`aicc.gsk.scope.${r.scopeKind}`)}: ${r.scopeValues.slice(0, 4).join(", ")}${r.scopeValues.length > 4 ? "…" : ""}`;
  return (
    <li className="rounded-xl border border-line px-3 py-2.5" data-gsk-rule={r.id} data-status={r.status}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" checked={checked} onChange={onCheck} aria-label={r.title} />
        <details className="min-w-0 flex-1">
          <summary className="cursor-pointer list-none">
            <span className="block break-words text-[13px] font-semibold">{r.title}</span>
            <span className="mt-1 flex flex-wrap gap-1">
              <Badge tone={STATUS_TONE[r.status]}>{t(`aicc.gsk.status.${r.status}`)}</Badge>
              <Badge tone={r.delivery === "knowledge" ? "accent" : "neutral"}>{t(`aicc.gsk.delivery.${r.delivery}`)}</Badge>
              <Badge tone={r.scopeKind === "global" ? "neutral" : "info"}>{scope}</Badge>
              {r.stages.length > 0 && <Badge tone="neutral">{r.stages.map((s) => t(`aicc.gsv2.role.${s}`)).join(" · ")}</Badge>}
              {r.isCorrection && <Badge tone="warning">{t("aicc.gsk.correction")}{r.date ? ` · ${fmt(r.date)}` : ""}</Badge>}
              {r.inActive && <Badge tone="success" dot>{t("aicc.gsk.inActive")}</Badge>}
              {r.conflictsWith.length > 0 && <Badge tone="danger">{t("aicc.gsk.conflicts", { n: r.conflictsWith.length })}</Badge>}
              <Badge tone="neutral">{t(`aicc.gsk.topic.${r.topic}`)}</Badge>
            </span>
          </summary>
          <div className="mt-2 space-y-1.5 text-[12.5px]">
            <p className="whitespace-pre-line break-words leading-relaxed text-ink">{r.body}</p>
            <p className="text-xs text-muted">
              {t("aicc.gsk.origin", { section: r.section ?? "—", source: source ? `${source.title} v${source.version} (${source.format.toUpperCase()})` : t(`aicc.gsk.originKind.${r.origin}`), date: fmt(r.date), rev: r.revision })}
              {r.page ? ` · ${t("aicc.gsk.page", { n: r.page })}` : ""}
            </p>
            {r.supersedes.length > 0 && (
              <p className="text-xs text-muted">{t("aicc.gsk.supersedes")}: {r.supersedes.map((id) => byId.get(id)?.title ?? id.slice(0, 8)).join("; ")}</p>
            )}
            {r.conflictsWith.length > 0 && (
              <p className="text-xs text-danger">{t("aicc.gsk.conflictsWith")}: {r.conflictsWith.map((id) => byId.get(id)?.title ?? id.slice(0, 8)).join("; ")}</p>
            )}
            <p className="text-xs text-faint">{t(`aicc.gsk.deliveryHelp.${r.delivery}`)}</p>
            {r.reviewNote && <p className="text-xs text-muted">{t("aicc.gsk.note")}: {r.reviewNote}</p>}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {r.status === "pending" && <>
                <Button size="sm" disabled={pending} onClick={() => onReview("approved")}>{t("aicc.gsk.approve")}</Button>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => onReview("rejected")}>{t("aicc.gsk.reject")}</Button>
                <Button size="sm" variant="ghost" onClick={onEdit}>{t("aicc.gsk.edit")}</Button>
              </>}
              {r.status === "approved" && <>
                <Button size="sm" variant="secondary" onClick={onEdit}>{t("aicc.gsk.revise")}</Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => onReview("retired")}>{t("aicc.gsk.retire")}</Button>
              </>}
              {(r.status === "retired" || r.status === "superseded") && <Button size="sm" variant="secondary" disabled={pending} onClick={() => onReview("approved")}>{t("aicc.gsk.reinstate")}</Button>}
              {r.status === "rejected" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => onReview("pending")}>{t("aicc.gsk.reopen")}</Button>}
              <Button size="sm" variant="ghost" onClick={onHistory}>{t("aicc.gsk.history")}</Button>
            </div>
          </div>
        </details>
      </div>
    </li>
  );
}

function SourceCard({ s, t, fmt, pending, onShow, onApproveAll }: { s: SourceView; t: T; fmt: (x: string | null) => string; pending: boolean; onShow: () => void; onApproveAll: () => void }) {
  return (
    <Card className="p-4" data-gsk-source={s.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-[13.5px] font-semibold">{s.title}</p>
          <p className="text-xs text-muted">{s.setName}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge tone="neutral">v{s.version} · {s.format.toUpperCase()}</Badge>
          <Badge tone={s.role === "primary" ? "accent" : "neutral"}>{t(`aicc.gsk.role.${s.role}`)}</Badge>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">{t("aicc.gsk.docDate")}</dt><dd className="text-right">{fmt(s.date)}</dd>
        <dt className="text-muted">{t("aicc.gsk.author")}</dt><dd className="text-right">{s.author ?? "—"}</dd>
        <dt className="text-muted">{t("aicc.gsk.added")}</dt><dd className="text-right">{fmt(s.createdAt)}{s.createdBy ? ` · ${s.createdBy}` : ""}</dd>
        <dt className="text-muted">{t("aicc.gsk.size")}</dt><dd className="text-right tabular-nums">{t("aicc.gsk.chars", { n: s.chars })}</dd>
        <dt className="text-muted">sha256</dt><dd className="truncate text-right font-mono" title={s.sha256 ?? ""}>{s.sha256 ? s.sha256.slice(0, 12) : "—"}</dd>
      </dl>
      <p className="mt-3 text-xs tabular-nums" data-gsk-source-counts>
        {t("aicc.gsk.sourceCounts", { total: s.counts.total, pending: s.counts.pending, approved: s.counts.approved, sent: s.counts.delivered, active: s.counts.inActive })}
      </p>
      {s.stages.length > 0 && <p className="mt-1 text-xs text-muted">{t("aicc.gsk.stagesUsed")}: {s.stages.map((x) => t(`aicc.gsv2.role.${x}`)).join(", ")}</p>}
      {s.scopes.length > 0 && <p className="mt-1 break-words text-xs text-muted">{t("aicc.gsk.scopesUsed")}: {s.scopes.join(", ")}</p>}
      {s.note && <p className="mt-1 text-xs text-faint">{s.note}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onShow}>{t("aicc.gsk.showRules")}</Button>
        {s.counts.pending > 0 && <Button size="sm" disabled={pending} onClick={onApproveAll}>{t("aicc.gsk.approveAll", { n: s.counts.pending })}</Button>}
      </div>
    </Card>
  );
}

function CaseRow({ c, t, fmt, pending, onStatus, onCategory, onRule }: {
  c: TestCaseView; t: T; fmt: (x: string | null) => string; pending: boolean; onStatus: (s: string) => void; onCategory: (c: string) => void; onRule: () => void;
}) {
  const [cat, setCat] = useState(c.category ?? "");
  return (
    <li className="rounded-xl border border-line p-3" data-gsk-case={c.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{c.category ?? "—"} {c.rating !== null && <span className="text-muted">· {c.rating}/5</span>}</p>
          <p className="text-xs text-muted">{fmt(c.createdAt)} · {c.author ?? "—"}{c.rules > 0 ? ` · ${t("aicc.gsk.caseRules", { n: c.rules })}` : ""}</p>
        </div>
        <Badge tone={STATUS_TONE[c.status === "approved" ? "approved" : c.status === "rejected" ? "rejected" : "pending"]}>{t(`aicc.gsk.status.${c.status}`)}</Badge>
      </div>
      {(c.refUrl || c.genUrl) && (
        <div className="mt-2 flex gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {c.refUrl && <img src={c.refUrl} alt={t("aicc.gsk.caseRef")} className="h-20 w-20 rounded-lg object-cover" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {c.genUrl && <img src={c.genUrl} alt={t("aicc.gsk.caseResult")} className="h-20 w-20 rounded-lg object-cover" />}
        </div>
      )}
      <div className="mt-2 space-y-1 text-xs">
        {c.description && <p className="break-words">{c.description}</p>}
        {c.worked && <p><span className="text-success">{t("aicc.gsk.worked")}:</span> {c.worked}</p>}
        {c.failed && <p><span className="text-danger">{t("aicc.gsk.failed")}:</span> {c.failed}</p>}
        {c.correction && <p><span className="text-warning">{t("aicc.gsk.correctionLabel")}:</span> {c.correction}</p>}
        {c.prompt && <details><summary className="cursor-pointer text-muted">{t("aicc.gsk.casePrompt")}</summary><p className="mt-1 whitespace-pre-line break-words font-mono text-[11px]">{c.prompt}</p></details>}
        {c.rating !== null && c.rating <= 2 && <p className="text-faint">{t("aicc.gsk.negativeNote")}</p>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {c.status !== "approved" && <Button size="sm" disabled={pending} onClick={() => onStatus("approved")}>{t("aicc.gsk.accept")}</Button>}
        {c.status !== "rejected" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => onStatus("rejected")}>{t("aicc.gsk.reject")}</Button>}
        {c.correction && <Button size="sm" variant="secondary" onClick={onRule}>{t("aicc.gsk.toRule")}</Button>}
        <Input className="h-9 max-w-[12rem]" value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t("aicc.gsk.category")} />
        {cat.trim() && cat !== c.category && <Button size="sm" variant="ghost" disabled={pending} onClick={() => onCategory(cat)}>{t("aicc.gsk.changeCategory")}</Button>}
      </div>
    </li>
  );
}

function UploadModal({ open, onClose, sets, t, onDone }: { open: boolean; onClose: () => void; sets: KnowledgeAdmin["sets"]; t: T; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [setId, setSetId] = useState<string>(sets.find((s) => s.scope === "grovshot_v2")?.id ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.set("target", "grovshot_v2");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/knowledge/import", { method: "POST", body: fd });
      const out = await res.json().catch(() => ({ ok: false, error: "generic" })) as { ok: boolean; error?: string; inserted?: number; duplicates?: number; revisions?: number; conflicts?: number; found?: number };
      if (!out.ok) { toast.error(t(`aicc.gsk.err.${out.error ?? "generic"}`)); return; }
      toast.success(t("aicc.gsk.imported", { found: out.found ?? 0, inserted: out.inserted ?? 0, dup: out.duplicates ?? 0, rev: out.revisions ?? 0, conf: out.conflicts ?? 0 }));
      onDone();
    } finally { setBusy(false); }
  }
  return (
    <Modal portal wide open={open} onClose={onClose} title={t("aicc.gsk.add")}>
      <form ref={formRef} onSubmit={submit} className="space-y-3" data-gsk-upload>
        <p className="text-xs leading-relaxed text-muted">{t("aicc.gsk.addHelp")}</p>
        <div><Label htmlFor="gsk-file">{t("aicc.gsk.file")}</Label><Input id="gsk-file" name="file" type="file" accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf" required /></div>
        <div><Label htmlFor="gsk-title">{t("aicc.gsk.docTitle")}</Label><Input id="gsk-title" name="title" placeholder={t("aicc.gsk.docTitlePh")} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="gsk-set">{t("aicc.gsk.set")}</Label>
            <Select id="gsk-set" name="set_id" value={setId} onChange={(e) => setSetId(e.target.value)}>
              <option value="">{t("aicc.gsk.newSet")}</option>
              {sets.map((s) => <option key={s.id} value={s.id}>{s.name}{s.scope === "grovshot_v2" ? " · V2" : ""}</option>)}
            </Select>
          </div>
          {!setId && <div><Label htmlFor="gsk-setname">{t("aicc.gsk.setName")}</Label><Input id="gsk-setname" name="set_name" /></div>}
          <div>
            <Label htmlFor="gsk-role">{t("aicc.gsk.roleLabel")}</Label>
            <Select id="gsk-role" name="role" defaultValue="primary">
              <option value="primary">{t("aicc.gsk.role.primary")}</option>
              <option value="confirmation">{t("aicc.gsk.role.confirmation")}</option>
            </Select>
          </div>
          <div><Label htmlFor="gsk-date">{t("aicc.gsk.docDate")}</Label><Input id="gsk-date" name="source_date" type="date" /></div>
          <div><Label htmlFor="gsk-author">{t("aicc.gsk.author")}</Label><Input id="gsk-author" name="author" placeholder="Kuba" /></div>
        </div>
        <p className="text-xs text-faint">{t("aicc.gsk.addSafety")}</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={busy}>{busy ? t("aicc.gsk.importing") : t("aicc.gsk.importCta")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PublishModal({ open, onClose, t, pending, approved, delivered, onPublish }: {
  open: boolean; onClose: () => void; t: T; pending: boolean; approved: number; delivered: number; onPublish: (log: string) => void;
}) {
  const [log, setLog] = useState("");
  return (
    <Modal portal open={open} onClose={onClose} title={t("aicc.gsk.publish")}>
      <div className="space-y-3">
        <p className="text-[13px]">{t("aicc.gsk.publishBody", { approved, delivered })}</p>
        <div><Label htmlFor="gsk-log">{t("aicc.gsk.changelog")}</Label><Textarea id="gsk-log" rows={3} value={log} onChange={(e) => setLog(e.target.value)} placeholder={t("aicc.gsk.changelogPh")} /></div>
        <p className="text-xs text-faint">{t("aicc.gsk.publishSafety")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={pending || !log.trim()} onClick={() => onPublish(log)}>{t("aicc.gsk.publishCta")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function CaseModal({ open, onClose, t, pending, onSave }: { open: boolean; onClose: () => void; t: T; pending: boolean; onSave: (f: FormData) => void }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <Modal portal wide open={open} onClose={onClose} title={t("aicc.gsk.newCase")}>
      <form ref={ref} className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ref.current) onSave(new FormData(ref.current)); }} data-gsk-case-form>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="gc-cat">{t("aicc.gsk.category")}</Label><Input id="gc-cat" name="category" required placeholder={t("aicc.gsk.categoryPh")} /></div>
          <div>
            <Label htmlFor="gc-rating">{t("aicc.gsk.rating")}</Label>
            <Select id="gc-rating" name="rating" defaultValue="">
              <option value="">—</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}/5</option>)}
            </Select>
          </div>
        </div>
        <div><Label htmlFor="gc-desc">{t("aicc.gsk.caseDescription")}</Label><Textarea id="gc-desc" name="description" rows={2} required /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="gc-ref">{t("aicc.gsk.caseRef")}</Label><Input id="gc-ref" name="reference" type="file" accept="image/jpeg,image/png,image/webp" /></div>
          <div><Label htmlFor="gc-res">{t("aicc.gsk.caseResult")}</Label><Input id="gc-res" name="result" type="file" accept="image/jpeg,image/png,image/webp" /></div>
        </div>
        <div><Label htmlFor="gc-prompt">{t("aicc.gsk.casePrompt")}</Label><Textarea id="gc-prompt" name="prompt" rows={3} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="gc-worked">{t("aicc.gsk.worked")}</Label><Textarea id="gc-worked" name="worked" rows={2} /></div>
          <div><Label htmlFor="gc-failed">{t("aicc.gsk.failed")}</Label><Textarea id="gc-failed" name="failed" rows={2} /></div>
        </div>
        <div><Label htmlFor="gc-fix">{t("aicc.gsk.correctionLabel")}</Label><Textarea id="gc-fix" name="correction" rows={2} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="gc-scope">{t("aicc.gsk.scopeLabel")}</Label>
            <Select id="gc-scope" name="scope_kind" defaultValue="category">
              {KNOWLEDGE_SCOPES.map((s) => <option key={s} value={s}>{t(`aicc.gsk.scope.${s}`)}</option>)}
            </Select>
          </div>
          <div><Label htmlFor="gc-scopev">{t("aicc.gsk.scopeValues")}</Label><Input id="gc-scopev" name="scope_values" placeholder={t("aicc.gsk.scopeValuesPh")} /></div>
        </div>
        <fieldset className="flex flex-wrap gap-3 text-xs">
          <legend className="mb-1 text-xs text-muted">{t("aicc.gsk.stagesLabel")}</legend>
          {STAGE_ROLES.map((s) => <label key={s} className="flex items-center gap-1.5"><input type="checkbox" name="stages" value={s} defaultChecked={s === "plan" || s === "prompt"} />{t(`aicc.gsv2.role.${s}`)}</label>)}
        </fieldset>
        <p className="text-xs text-faint">{t("aicc.gsk.caseSafety")}</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" disabled={pending}>{t("common.save")}</Button></div>
      </form>
    </Modal>
  );
}

function RuleModal({ mode, t, pending, onClose, onSave }: {
  mode: EditMode; t: T; pending: boolean; onClose: () => void;
  onSave: (patch: { title: string; body: string; topic: string; stages: string[]; scope_kind: string; scope_values: string[]; delivery: string; is_correction: boolean }) => void;
}) {
  const r = mode.kind === "case" ? null : mode.rule;
  const c = mode.kind === "case" ? mode.c : null;
  const scope = (c?.scope ?? {}) as { kind?: string; values?: string[]; stages?: string[] };
  const [title, setTitle] = useState(r?.title ?? (c ? `Korekta z testu: ${c.category ?? ""}` : ""));
  const [body, setBody] = useState(r?.body ?? c?.correction ?? "");
  const [topic, setTopic] = useState<string>(r?.topic ?? "errors");
  const [stages, setStages] = useState<string[]>(r?.stages ?? (scope.stages?.length ? scope.stages : ["plan", "prompt"]));
  const [scopeKind, setScopeKind] = useState<string>(r?.scopeKind ?? scope.kind ?? (c ? "category" : "global"));
  const [scopeValues, setScopeValues] = useState((r?.scopeValues ?? scope.values ?? (c?.category ? [c.category.toLowerCase()] : [])).join(", "));
  const [delivery, setDelivery] = useState<string>(r?.delivery ?? "knowledge");
  const [correction, setCorrection] = useState(r?.isCorrection ?? Boolean(c));
  const titleKey = mode.kind === "edit" ? "aicc.gsk.edit" : mode.kind === "revise" ? "aicc.gsk.revise" : mode.kind === "case" ? "aicc.gsk.toRule" : "aicc.gsk.newRule";
  return (
    <Modal portal wide open onClose={onClose} title={t(titleKey)}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave({ title, body, topic, stages, scope_kind: scopeKind, scope_values: scopeValues.split(",").map((v) => v.trim()).filter(Boolean), delivery, is_correction: correction }); }} data-gsk-rule-form>
        {mode.kind === "revise" && <p className="text-xs text-muted">{t("aicc.gsk.reviseHelp")}</p>}
        <div><Label htmlFor="gr-title">{t("aicc.gsk.ruleTitle")}</Label><Input id="gr-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} /></div>
        <div><Label htmlFor="gr-body">{t("aicc.gsk.ruleBody")}</Label><Textarea id="gr-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} required maxLength={4000} /></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label htmlFor="gr-topic">{t("aicc.gsk.topicLabel")}</Label>
            <Select id="gr-topic" value={topic} onChange={(e) => setTopic(e.target.value)}>{KNOWLEDGE_TOPICS.map((x) => <option key={x} value={x}>{t(`aicc.gsk.topic.${x}`)}</option>)}</Select></div>
          <div><Label htmlFor="gr-scope">{t("aicc.gsk.scopeLabel")}</Label>
            <Select id="gr-scope" value={scopeKind} onChange={(e) => setScopeKind(e.target.value)}>{KNOWLEDGE_SCOPES.map((x) => <option key={x} value={x}>{t(`aicc.gsk.scope.${x}`)}</option>)}</Select></div>
          <div><Label htmlFor="gr-delivery">{t("aicc.gsk.deliveryLabel")}</Label>
            <Select id="gr-delivery" value={delivery} onChange={(e) => setDelivery(e.target.value)}>{KNOWLEDGE_DELIVERIES.map((x) => <option key={x} value={x}>{t(`aicc.gsk.delivery.${x}`)}</option>)}</Select></div>
        </div>
        {scopeKind !== "global" && <div><Label htmlFor="gr-sv">{t("aicc.gsk.scopeValues")}</Label><Input id="gr-sv" value={scopeValues} onChange={(e) => setScopeValues(e.target.value)} placeholder={t("aicc.gsk.scopeValuesPh")} /></div>}
        <fieldset className="flex flex-wrap gap-3 text-xs">
          <legend className="mb-1 text-xs text-muted">{t("aicc.gsk.stagesLabel")}</legend>
          {STAGE_ROLES.map((s) => (
            <label key={s} className="flex items-center gap-1.5">
              <input type="checkbox" checked={stages.includes(s)} onChange={(e) => setStages((cur) => e.target.checked ? [...cur, s] : cur.filter((x) => x !== s))} />
              {t(`aicc.gsv2.role.${s}`)}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={correction} onChange={(e) => setCorrection(e.target.checked)} />{t("aicc.gsk.isCorrection")}</label>
        <p className={cn("text-xs", delivery === "knowledge" && stages.length === 0 ? "text-danger" : "text-faint")}>{t(`aicc.gsk.deliveryHelp.${delivery}`)}</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" disabled={pending}>{t("common.save")}</Button></div>
      </form>
    </Modal>
  );
}
