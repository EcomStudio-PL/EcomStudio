"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { setUserRoleAction, adjustCreditsV2Action } from "@/app/actions/admin";
import { Modal, ConfirmModal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";

const TYPES = ["bonus", "admin_adjustment", "refund", "topup"] as const;

export function UserActions({ userId, role, isSelf, balance }: {
  userId: string; role: string; isSelf: boolean; balance: number | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [confirmNegative, setConfirmNegative] = useState(false);
  const [form, setForm] = useState({ amount: "", type: "bonus" as (typeof TYPES)[number], reason: "", note: "" });

  const amount = parseInt(form.amount || "0", 10);
  const valid = Number.isInteger(amount) && amount !== 0 && form.reason.trim().length > 0;
  const newBalance = balance !== null ? balance + (Number.isInteger(amount) ? amount : 0) : null;
  const nextRole = role === "admin" ? "user" : "admin";

  function submit() {
    start(async () => {
      const res = await adjustCreditsV2Action({
        userId, amount, type: form.type, reason: form.reason, note: form.note,
      });
      if (res.ok) {
        toast.success(amount > 0 ? t("admin.creditsAdded", { n: amount }) : t("admin.creditsRemoved", { n: Math.abs(amount) }));
        setCreditsOpen(false);
        setConfirmNegative(false);
        setForm({ amount: "", type: "bonus", reason: "", note: "" });
        router.refresh();
      } else {
        toast.error(res.error === "insufficient" ? t("admin.insufficient") : t("common.error"));
        setConfirmNegative(false);
      }
    });
  }

  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="secondary" disabled={pending || isSelf} onClick={() => setRoleOpen(true)}>
        {role === "admin" ? t("admin.removeAdmin") : t("admin.makeAdmin")}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setCreditsOpen(true)}>
        ± {t("nav.credits")}
      </Button>

      <ConfirmModal open={roleOpen} onClose={() => setRoleOpen(false)} pending={pending}
        title={t("admin.role")} body={t("admin.confirmRole", { role: nextRole })}
        confirmLabel={role === "admin" ? t("admin.removeAdmin") : t("admin.makeAdmin")}
        danger={role === "admin"}
        onConfirm={() => start(async () => {
          const res = await setUserRoleAction(userId, nextRole);
          if (res.ok) { toast.success(t("common.save")); setRoleOpen(false); router.refresh(); }
          else toast.error(res.error === "self_demotion" ? t("admin.selfDemotion") : t("common.error"));
        })} />

      <Modal open={creditsOpen} onClose={() => setCreditsOpen(false)} title={t("admin.adjustCredits")}>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-raised px-4 py-3 text-sm">
            <span className="text-muted">{t("credits.balance")}</span>
            <span className="font-display text-lg font-semibold">{balance ?? "—"}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`amt-${userId}`}>{t("common.amount")}</Label>
              <Input id={`amt-${userId}`} type="number" placeholder="+100 / -25" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`typ-${userId}`}>{t("common.type")}</Label>
              <Select id={`typ-${userId}`} value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as (typeof TYPES)[number] })}>
                {TYPES.map((v) => <option key={v} value={v}>{t(`credits.tt.${v}`)}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor={`rsn-${userId}`}>{t("admin.reason")} *</Label>
            <Textarea id={`rsn-${userId}`} rows={2} value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`nte-${userId}`}>{t("admin.internalNote")}</Label>
            <Input id={`nte-${userId}`} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          {valid && newBalance !== null && (
            <div className="rounded-xl bg-accent-soft px-4 py-3 text-sm">
              <div className="flex justify-between"><span>{t("credits.balance")}</span><span>{balance}</span></div>
              <div className="flex justify-between font-medium"><span>{t("admin.change")}</span><span>{amount > 0 ? `+${amount}` : amount}</span></div>
              <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
                <span>{t("admin.newBalance")}</span><span className="text-accent">{newBalance}</span>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreditsOpen(false)}>{t("common.cancel")}</Button>
            <Button variant={amount < 0 ? "danger" : "primary"} disabled={pending || !valid}
              onClick={() => (amount < 0 ? setConfirmNegative(true) : submit())}>
              {amount < 0
                ? t("admin.removeCredits", { n: Math.abs(amount) })
                : t("admin.addCredits", { n: Number.isInteger(amount) && amount > 0 ? amount : 0 })}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={confirmNegative} onClose={() => setConfirmNegative(false)} danger pending={pending}
        title={t("admin.removeCredits", { n: Math.abs(amount) })}
        body={t("admin.confirmNegative", { n: Math.abs(amount) })}
        confirmLabel={t("admin.removeCredits", { n: Math.abs(amount) })}
        onConfirm={submit} />
    </div>
  );
}
