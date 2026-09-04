"use client";
import { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Download, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  addSubscriberAction, bulkSubscribersAction, exportSubscribersAction,
} from "@/app/actions/launch";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ConfirmModal } from "@/components/ui/modal";
import { formatDate } from "@/lib/utils";

export type WaitlistRow = {
  id: string; email: string; status: string; source: string; locale: string; created_at: string;
};

/**
 * LISTA OCZEKUJĄCYCH — the admin's view of who is waiting.
 *
 * Filtering, sorting and paging live in the URL so a view can be shared and
 * survives a refresh; only the selection is component state, because it means
 * nothing outside the moment. Every write goes through a server action that
 * re-checks the admin role — nothing here trusts the browser.
 */
export function WaitlistManager({ rows, page, pages, total }: {
  rows: WaitlistRow[];
  page: number;
  pages: number;
  total: number;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(params.get("q") ?? "");
  const [adding, setAdding] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    // Any change to the query resets the page — page 4 of a new filter is
    // almost always empty.
    if (!("page" in patch)) next.delete("page");
    setSelected(new Set());
    router.push(`${pathname}${next.size ? `?${next}` : ""}`);
  }

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)));

  function bulk(op: "delete" | "confirm" | "unsubscribe") {
    start(async () => {
      const res = await bulkSubscribersAction([...selected], op);
      if (res.ok) {
        toast.success(t("launchAdmin.bulkDone"));
        setSelected(new Set());
        setConfirmDelete(false);
        router.refresh();
      } else toast.error(t("common.error"));
    });
  }

  function add() {
    const email = adding.trim();
    if (!email) return;
    start(async () => {
      const res = await addSubscriberAction(email);
      if (res.ok) { toast.success(t("launchAdmin.added")); setAdding(""); router.refresh(); }
      else toast.error(res.error === "duplicate" ? t("launchAdmin.duplicate") : t("common.error"));
    });
  }

  function exportCsv() {
    start(async () => {
      const res = await exportSubscribersAction();
      if (!res.ok) { toast.error(t("common.error")); return; }
      // The CSV is built on the server and handed over as text; the browser
      // only turns it into a file.
      const url = URL.createObjectURL(new Blob([`﻿${res.csv}`], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `grovbase-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const statusTone = (s: string) =>
    s === "confirmed" ? "green" : s === "unsubscribed" ? "neutral" : "amber";
  const statusLabel = (s: string) =>
    s === "confirmed" ? t("launchAdmin.statusConfirmed")
      : s === "unsubscribed" ? t("launchAdmin.statusUnsubscribed")
        : t("launchAdmin.statusPending");

  return (
    <div data-waitlist-manager>
      <div className="mb-4 grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <form className="min-w-0 sm:w-64" onSubmit={(e) => { e.preventDefault(); apply({ q: q.trim() }); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t("launchAdmin.searchPh")} aria-label={t("launchAdmin.searchPh")} />
        </form>
        <div className="min-w-0 sm:w-44">
          <Select value={params.get("status") ?? ""} aria-label={t("launchAdmin.statusAll")}
            onChange={(e) => apply({ status: e.target.value })}>
            <option value="">{t("launchAdmin.statusAll")}</option>
            <option value="pending">{t("launchAdmin.statusPending")}</option>
            <option value="confirmed">{t("launchAdmin.statusConfirmed")}</option>
            <option value="unsubscribed">{t("launchAdmin.statusUnsubscribed")}</option>
          </Select>
        </div>
        <div className="min-w-0 sm:w-44">
          <Select value={params.get("sort") ?? "new"} aria-label={t("launchAdmin.sortNewest")}
            onChange={(e) => apply({ sort: e.target.value === "new" ? "" : e.target.value })}>
            <option value="new">{t("launchAdmin.sortNewest")}</option>
            <option value="old">{t("launchAdmin.sortOldest")}</option>
            <option value="email">{t("launchAdmin.sortEmail")}</option>
          </Select>
        </div>
        <div className="sm:ml-auto">
          <Button size="sm" variant="secondary" disabled={pending} onClick={exportCsv} data-waitlist-export>
            <Download size={14} aria-hidden />
            {t("launchAdmin.exportCsv")}
          </Button>
        </div>
      </div>

      <div className="panel mb-4 flex flex-col gap-2 rounded-2xl p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <Input value={adding} onChange={(e) => setAdding(e.target.value)}
            type="email" inputMode="email" autoComplete="off"
            placeholder={t("launchAdmin.addPlaceholder")} aria-label={t("launchAdmin.addManual")}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        </div>
        <Button size="sm" disabled={pending || !adding.trim()} onClick={add} data-waitlist-add>
          <Plus size={14} aria-hidden />
          {t("launchAdmin.add")}
        </Button>
      </div>

      {selected.size > 0 && (
        <div data-waitlist-bulk
          className="panel mb-4 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3">
          <span className="text-[13px] font-semibold">{t("launchAdmin.selected", { n: selected.size })}</span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t("launchAdmin.clearSelection")}
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => bulk("confirm")}>
            {t("launchAdmin.bulkConfirm")}
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => bulk("unsubscribe")}>
            {t("launchAdmin.bulkUnsubscribe")}
          </Button>
          <Button size="sm" variant="danger" disabled={pending} onClick={() => setConfirmDelete(true)}>
            {t("launchAdmin.bulkDelete")}
          </Button>
        </div>
      )}

      <AdminTable
        primary={1}
        headers={[
          "", t("launchAdmin.colEmail"), t("launchAdmin.colStatus"),
          t("launchAdmin.colSource"), t("launchAdmin.colDate"),
        ]}
        empty={t("launchAdmin.empty")}
        rows={rows.map((r) => [
          <label key="s" className="flex items-center gap-2">
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
              aria-label={r.email} className="h-4 w-4 accent-[rgb(var(--accent))]" />
            <span className="sr-only">{r.email}</span>
          </label>,
          <span key="e" className="break-all font-medium">{r.email}</span>,
          <Badge key="st" tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>,
          <span key="src" className="text-muted">{r.source}</span>,
          formatDate(r.created_at, locale),
        ])}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
        <button type="button" onClick={toggleAll} disabled={rows.length === 0}
          className="font-medium transition-colors hover:text-ink disabled:opacity-40">
          {allOnPage ? t("launchAdmin.clearSelection") : t("launchAdmin.selectAll")}
        </button>
        <div className="flex items-center gap-3">
          <span className="tabular-nums">{t("launchAdmin.pageOf", { a: page, b: pages })} · {total}</span>
          <Button size="sm" variant="ghost" disabled={page <= 1}
            onClick={() => apply({ page: String(page - 1) })}>‹</Button>
          <Button size="sm" variant="ghost" disabled={page >= pages}
            onClick={() => apply({ page: String(page + 1) })}>›</Button>
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => bulk("delete")}
        title={t("launchAdmin.confirmDeleteTitle")}
        body={t("launchAdmin.confirmDeleteBody")}
        confirmLabel={t("launchAdmin.bulkDelete")}
        danger
        pending={pending}
      />
    </div>
  );
}
