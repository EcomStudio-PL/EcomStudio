"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ban, ShieldOff } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { formatDate } from "@/lib/utils";
import { SUPPRESSION_REASONS } from "@/lib/newsletter";
import { addSuppressionAction, removeSuppressionAction } from "@/app/actions/newsletter";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";

/**
 * THE BLOCK LIST.
 *
 * FOUR REASONS, AND THEY ARE NOT INTERCHANGEABLE. "Wypisanie" is the contact's
 * own decision, "twarde odbicie" and "zgłoszenie spamu" are the mail system's,
 * and "blokada ręczna" is an operator's. The column is not decoration: it is
 * what an operator needs before they lift one, which is why unblocking asks for
 * a confirmation that spells out what lifting does and does not do — an address
 * whose owner unsubscribed stays unmailable afterwards, because only they can
 * consent again.
 *
 * AN ADDRESS CAN BE BLOCKED BEFORE IT IS A CONTACT. Suppression is keyed on the
 * address, not on a contact row, so "never write to this person again" can be
 * acted on the moment somebody asks — and it survives the contact being deleted
 * and re-imported from a CSV six months later.
 */

export type SuppressionRow = {
  email: string;
  reason: string;
  note: string | null;
  createdAt: string;
};

export function SuppressionList({ rows, total, page, pages }: {
  rows: SuppressionRow[];
  total: number;
  page: number;
  pages: number;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState<string>("blocked");
  const [note, setNote] = useState("");
  const [removing, setRemoving] = useState<SuppressionRow | null>(null);

  const fail = (error: string) => toast.error(t(`newsletter.err.${error}`));

  function goToPage(next: number) {
    const query = new URLSearchParams(params.toString());
    if (next > 1) query.set("page", String(next)); else query.delete("page");
    router.push(`${pathname}${query.size ? `?${query}` : ""}`);
  }

  function add() {
    start(async () => {
      const res = await addSuppressionAction({ email, reason, note: note || null });
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("newsletter.suppressions.added"));
      setEmail(""); setNote(""); setReason("blocked"); setAdding(false);
      router.refresh();
    });
  }

  function remove() {
    if (!removing) return;
    const address = removing.email;
    start(async () => {
      const res = await removeSuppressionAction(address);
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("newsletter.suppressions.removed"));
      setRemoving(null);
      router.refresh();
    });
  }

  /** An operator's own block is the one that is straightforwardly undone; the
   *  other three carry somebody else's decision, so they read as facts. */
  const reasonTone = (value: string) =>
    value === "blocked" ? "accent" : value === "unsubscribed" ? "neutral" : "warning";

  const headers = [
    t("newsletter.col.email"),
    t("admin.reason"),
    t("newsletter.col.created"),
    t("newsletter.col.note"),
    t("common.actions"),
  ];

  return (
    <div data-suppression-list className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] leading-relaxed text-muted">
          {t("newsletter.suppressions.addHint")}
        </p>
        <Button size="sm" data-suppression-add onClick={() => setAdding(true)}>
          <Ban size={14} aria-hidden />{t("newsletter.suppressions.add")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ShieldOff}
          title={t("newsletter.suppressions.none")}
          body={t("newsletter.suppressions.sub")}
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Ban size={14} aria-hidden />{t("newsletter.suppressions.add")}
            </Button>
          }
        />
      ) : (
        <>
          <AdminTable
            headers={headers}
            empty={t("newsletter.suppressions.none")}
            rows={rows.map((row) => [
              <span key="email" className="break-all font-medium">{row.email}</span>,
              <Badge key="reason" tone={reasonTone(row.reason)}>
                {t(`newsletter.reason.${row.reason}`)}
              </Badge>,
              // No `whitespace-nowrap` on a date: on a phone these cells sit in
              // a two-column grid, and a string that refuses to wrap takes the
              // whole page sideways with it.
              <span key="date" className="text-muted">
                {formatDate(row.createdAt, locale)}
              </span>,
              <span key="note" className="text-muted">{row.note ?? "—"}</span>,
              <Button key="act" size="sm" variant="ghost" disabled={pending}
                onClick={() => setRemoving(row)}>
                {t("newsletter.suppressions.remove")}
              </Button>,
            ])}
          />

          <div className="flex flex-wrap items-center justify-end gap-3 text-[13px] text-muted">
            <span className="tabular-nums">
              {t("common.pageOf", { a: page, b: pages })} · {total}
            </span>
            <Button size="sm" variant="ghost" disabled={page <= 1}
              onClick={() => goToPage(page - 1)}>‹</Button>
            <Button size="sm" variant="ghost" disabled={page >= pages}
              onClick={() => goToPage(page + 1)}>›</Button>
          </div>
        </>
      )}

      <Modal open={adding} onClose={() => setAdding(false)}
        title={t("newsletter.suppressions.add")}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="sup-email">{t("newsletter.col.email")}</Label>
            <Input id="sup-email" type="email" inputMode="email" autoComplete="off"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sup-reason">{t("admin.reason")}</Label>
            <Select id="sup-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {SUPPRESSION_REASONS.map((r) => (
                <option key={r} value={r}>{t(`newsletter.reason.${r}`)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sup-note">{t("newsletter.col.note")}</Label>
            <Input id="sup-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="text-[11.5px] leading-relaxed text-muted">
            {t("newsletter.suppressions.addHint")}
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
          <Button disabled={pending || !email.trim()} onClick={add}>
            {pending ? t("common.saving") : t("newsletter.suppressions.add")}
          </Button>
        </div>
      </Modal>

      <ConfirmModal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title={t("newsletter.suppressions.removeTitle")}
        body={t("newsletter.suppressions.removeBody")}
        confirmLabel={t("newsletter.suppressions.remove")}
        pending={pending}
      />
    </div>
  );
}
