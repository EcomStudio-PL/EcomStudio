"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pin, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  blockUserAction, assignManagerAction, saveCrmNoteAction, deleteCrmNoteAction,
} from "@/app/actions/admin-b2b";
import { Button } from "@/components/ui/button";
import { Textarea, Select, Label, Input } from "@/components/ui/input";
import { ConfirmModal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";

function useRun() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (p: Promise<{ ok: boolean }>, done?: () => void) =>
    start(async () => {
      const res = await p;
      if (res.ok) { toast.success(t("common.save")); done?.(); router.refresh(); }
      else toast.error(t("common.error"));
    });
  return { pending, run };
}

export function BlockUserButton({ userId, blocked, isSelf }: { userId: string; blocked: boolean; isSelf: boolean }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  if (isSelf) return null;
  return (
    <>
      <Button size="sm" variant={blocked ? "secondary" : "danger"} disabled={pending}
        onClick={() => (blocked ? run(blockUserAction(userId, false)) : setConfirming(true))}>
        {blocked ? t("crm.unblock") : t("crm.block")}
      </Button>
      <ConfirmModal
        open={confirming} onClose={() => setConfirming(false)}
        onConfirm={() => run(blockUserAction(userId, true), () => setConfirming(false))}
        title={t("crm.block")} body={t("crm.blockBody")} confirmLabel={t("crm.block")} danger pending={pending}
      />
    </>
  );
}

export function ManagerSelect({ userId, current, managers }: {
  userId: string; current: string | null; managers: { id: string; label: string }[];
}) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return (
    <div className="min-w-40">
      <Label>{t("crm.accountManager")}</Label>
      <Select value={current ?? ""} disabled={pending}
        onChange={(e) => run(assignManagerAction(userId, e.target.value || null))}>
        <option value="">—</option>
        {managers.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </Select>
    </div>
  );
}

export function CrmNotes({ userId, notes }: {
  userId: string;
  notes: { id: string; body: string; pinned: boolean; reminder_date: string | null; created_at: string; author?: string | null }[];
}) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const [body, setBody] = useState("");
  const [reminder, setReminder] = useState("");
  return (
    <div>
      <div className="space-y-2">
        <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("crm.notePh")} />
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label>{t("crm.reminder")}</Label>
            <Input type="date" value={reminder} onChange={(e) => setReminder(e.target.value)} />
          </div>
          <Button size="sm" disabled={pending || !body.trim()}
            onClick={() => run(saveCrmNoteAction({ userId, body, pinned: false, reminderDate: reminder || null }), () => { setBody(""); setReminder(""); })}>
            + {t("crm.addNote")}
          </Button>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {notes.length === 0 && <li className="py-4 text-center text-sm text-muted">{t("admin.noData")}</li>}
        {notes.map((n) => (
          <li key={n.id} className={`rounded-xl border border-line p-3 ${n.pinned ? "bg-accent-soft/40" : "bg-surface"}`}>
            <p className="whitespace-pre-wrap text-sm">{n.body}</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted">
              {n.author && <span>{n.author}</span>}
              <span>{new Date(n.created_at).toLocaleDateString("pl-PL")}</span>
              {n.reminder_date && <Badge tone="amber">⏰ {n.reminder_date}</Badge>}
              <span className="ml-auto flex gap-1">
                <button type="button" disabled={pending} title={t("crm.pin")}
                  className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink"
                  onClick={() => run(saveCrmNoteAction({ id: n.id, userId, body: n.body, pinned: !n.pinned, reminderDate: n.reminder_date }))}>
                  <Pin size={13} className={n.pinned ? "text-accent" : ""} />
                </button>
                <button type="button" disabled={pending} title={t("common.delete")}
                  className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-red-500"
                  onClick={() => run(deleteCrmNoteAction(n.id, userId))}>
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
