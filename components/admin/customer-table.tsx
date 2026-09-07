"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileBarChart, ShieldCheck, ShieldOff, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { CustomerRow } from "@/lib/services/admin-crm";
import { bulkSetBlockedAction } from "@/app/actions/admin-crm";
import { CustomerActions } from "@/components/admin/customer-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";

/**
 * THE CUSTOMER LIST.
 *
 * A table on desktop, one card per customer on a phone — the same rows, in the
 * shape each screen can read. Selection exists for exactly two operations,
 * suspend and reactivate, which are each other's undo. There is no bulk
 * delete: a destructive action against a selection nobody re-read is how a
 * customer base disappears by mis-click.
 */

const pln = (cents: number) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(cents / 100);

export function CustomerTable({ rows, adminId, locale }: {
  rows: CustomerRow[]; adminId: string | null; locale: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // An admin cannot suspend themselves, so their row is never selectable —
  // rather than letting the selection include a row the server will drop.
  const selectable = useMemo(() => rows.filter((r) => r.id !== adminId).map((r) => r.id), [rows, adminId]);
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  function bulk(blocked: boolean) {
    start(async () => {
      const res = await bulkSetBlockedAction([...selected], blocked);
      if (res.ok) {
        toast.success(blocked
          ? t("crm.bulkBlocked", { n: res.count ?? 0 })
          : t("crm.bulkUnblocked", { n: res.count ?? 0 }));
        setSelected(new Set());
        router.refresh();
      } else toast.error(t("common.error"));
    });
  }

  if (rows.length === 0) {
    return <div className="panel rounded-2xl px-5 py-12 text-center text-sm text-muted">{t("crm.noMatches")}</div>;
  }

  return (
    <>
      {/* PHONE — one record per card. */}
      <ul className="space-y-2.5 lg:hidden">
        {rows.map((r) => (
          <li key={r.id} className="panel rounded-2xl p-4">
            <div className="flex items-start gap-3">
              {r.id !== adminId && (
                <Check checked={selected.has(r.id)} onChange={() => toggle(r.id)} label={r.email} />
              )}
              <div className="min-w-0 flex-1">
                <Link href={`/admin/users/${r.id}`} className="block truncate text-sm font-semibold hover:text-accent">
                  {r.name ?? r.email}
                </Link>
                <p className="truncate text-xs text-muted">{r.email}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <StatusBadges row={r} t={t} />
                </div>
              </div>
              <CustomerActions userId={r.id} email={r.email} blocked={r.blocked}
                verified={r.verified} isSelf={r.id === adminId} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-y-2 text-[13px]">
              <Field label={t("nav.credits")} value={String(r.credits)} />
              <Field label={t("crm.spentTotal")} value={pln(r.spentCents)} />
              <Field label={t("analytics.generations")} value={String(r.generations)} />
              <Field label={t("crm.lastActive")} value={
                <RelativeTime at={r.lastActive ?? r.createdAt} locale={locale} t={t} />
              } />
            </dl>
          </li>
        ))}
      </ul>

      {/* DESKTOP — the table, scrolling inside its own container. */}
      <div className="panel relative hidden overflow-hidden rounded-2xl lg:block">
        <div className="table-scroll thin-scroll max-h-[70dvh] overflow-y-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface/95 text-left text-[11px] uppercase tracking-[0.08em] text-faint backdrop-blur">
                <th className="w-10 px-4 py-3">
                  <Check checked={allSelected} label={t("crm.selectAll")}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(selectable))} />
                </th>
                {[t("admin.user"), t("common.status"), t("plan.title"), t("nav.credits"),
                  t("crm.spentTotal"), t("analytics.generations"), t("crm.lastActive"), t("common.actions")].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={cn(
                  "border-t border-line transition-colors hover:bg-raised/50",
                  selected.has(r.id) && "bg-accent-soft/25",
                )}>
                  <td className="px-4 py-2.5">
                    {r.id !== adminId && (
                      <Check checked={selected.has(r.id)} onChange={() => toggle(r.id)} label={r.email} />
                    )}
                  </td>
                  <td className="max-w-[260px] px-4 py-2.5">
                    <Link href={`/admin/users/${r.id}`} className="block truncate font-medium hover:text-accent">
                      {r.name ?? r.email}
                    </Link>
                    <p className="truncate text-xs text-muted">{r.email}</p>
                  </td>
                  <td className="px-4 py-2.5"><span className="flex flex-wrap gap-1"><StatusBadges row={r} t={t} /></span></td>
                  <td className="whitespace-nowrap px-4 py-2.5">{r.plan === "free" ? t("crm.planFree") : r.plan}</td>
                  <td className="px-4 py-2.5 tabular-nums">{r.credits}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{pln(r.spentCents)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{r.generations}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                    <RelativeTime at={r.lastActive ?? r.createdAt} locale={locale} t={t} />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-1.5">
                      {/* Two controls, not four: the report, and the menu.
                          Role and credit adjustments belong on the customer's
                          own screen, where the balance being changed is in
                          front of the operator. */}
                      <Link href={`/admin/users/${r.id}`} aria-label={t("admin.report")}
                        className="grid size-9 place-items-center rounded-lg bg-accent2-soft text-accent2 transition-[filter] hover:brightness-110">
                        <FileBarChart size={15} aria-hidden />
                      </Link>
                      <CustomerActions userId={r.id} email={r.email} blocked={r.blocked}
                        verified={r.verified} isSelf={r.id === adminId} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* BULK — only the reversible pair. */}
      {selected.size > 0 && (
        <div className="dock fixed inset-x-3 bottom-[calc(var(--dock-h)+0.5rem+env(safe-area-inset-bottom))] z-30 flex flex-wrap items-center gap-2 rounded-2xl p-3 lg:sticky lg:bottom-4 lg:mt-3">
          <span className="mr-auto text-sm font-medium">{t("crm.selectedCount", { n: selected.size })}</span>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => bulk(true)}>
            <ShieldOff size={14} aria-hidden /> {t("crm.block")}
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => bulk(false)}>
            <ShieldCheck size={14} aria-hidden /> {t("crm.unblock")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X size={14} aria-hidden /> {t("common.clear")}
          </Button>
        </div>
      )}
    </>
  );
}

function StatusBadges({ row, t }: { row: CustomerRow; t: (key: string) => string }) {
  return (
    <>
      {row.blocked && <Badge tone="danger">{t("crm.blocked")}</Badge>}
      {!row.verified && <Badge tone="neutral">{t("crm.unverified")}</Badge>}
      {row.role !== "user" && <Badge tone="info">{row.role}</Badge>}
      {!row.blocked && row.verified && row.role === "user" && <Badge tone="success">{t("crm.active")}</Badge>}
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox" checked={checked} onChange={onChange} aria-label={label}
      className="size-4 shrink-0 cursor-pointer accent-[rgb(var(--accent))]"
    />
  );
}
