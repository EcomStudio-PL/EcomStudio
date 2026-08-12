"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { saveFlagAction, deleteFlagAction } from "@/app/actions/admin-b2b";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type FlagRow = {
  id?: string; flag: string; enabled: boolean; plans: string[] | null; roles: string[] | null;
  rollout_percent: number | null; description: string | null;
};

export function FlagManager({ flags }: { flags: FlagRow[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<FlagRow | null>(null);
  const [plansText, setPlansText] = useState("");
  const [rolesText, setRolesText] = useState("");

  const blank: FlagRow = { flag: "", enabled: false, plans: null, roles: null, rollout_percent: null, description: null };
  const open = (f: FlagRow) => {
    setEditing(f); setPlansText((f.plans ?? []).join(", ")); setRolesText((f.roles ?? []).join(", "));
  };
  const csv = (s: string) => { const a = s.split(",").map((x) => x.trim()).filter(Boolean); return a.length ? a : null; };

  function save() {
    if (!editing) return;
    start(async () => {
      const res = await saveFlagAction({ ...editing, plans: csv(plansText), roles: csv(rolesText) });
      if (res.ok) { toast.success(t("common.save")); setEditing(null); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => open(blank)}>+ {t("flags.new")}</Button>
      </div>
      {flags.length === 0 ? (
        <p className="rounded-2xl border border-line py-8 text-center text-sm text-muted">{t("admin.noData")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {flags.map((f) => (
            <li key={f.flag} className="flex flex-wrap items-center gap-2 px-5 py-3">
              <code className="text-sm font-semibold">{f.flag}</code>
              <Badge tone={f.enabled ? "green" : "neutral"}>{f.enabled ? "ON" : "OFF"}</Badge>
              {f.plans && <Badge tone="indigo">{f.plans.join(",")}</Badge>}
              {f.roles && <Badge tone="blue">{f.roles.join(",")}</Badge>}
              {f.rollout_percent != null && <Badge tone="amber">{f.rollout_percent}%</Badge>}
              {f.description && <span className="text-xs text-muted">{f.description}</span>}
              <span className="ml-auto flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => open(f)}>{t("common.edit")}</Button>
                <Button size="sm" variant="secondary" disabled={pending}
                  onClick={() => start(async () => {
                    const res = await saveFlagAction({ ...f, enabled: !f.enabled });
                    if (res.ok) router.refresh(); else toast.error(t("common.error"));
                  })}>
                  {f.enabled ? t("admin.deactivate") : t("admin.activate")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t("common.edit") : t("flags.new")}>
        {editing && (
          <div className="space-y-4">
            <div>
              <Label>Flag</Label>
              <Input value={editing.flag} disabled={!!editing.id} onChange={(e) => setEditing({ ...editing, flag: e.target.value })} />
            </div>
            <div>
              <Label>{t("common.description")}</Label>
              <Input value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value || null })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("flags.plans")}</Label>
                <Input value={plansText} placeholder="pro, business" onChange={(e) => setPlansText(e.target.value)} />
              </div>
              <div>
                <Label>{t("flags.roles")}</Label>
                <Input value={rolesText} placeholder="admin" onChange={(e) => setRolesText(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>{t("flags.rollout")} (%)</Label>
              <Input type="number" min={0} max={100} value={editing.rollout_percent ?? ""}
                onChange={(e) => setEditing({ ...editing, rollout_percent: e.target.value === "" ? null : parseInt(e.target.value, 10) })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.enabled} className="h-4 w-4 accent-[rgb(var(--accent))]"
                onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
              {t("admin.active")}
            </label>
            <div className="flex justify-between gap-2">
              {editing.id ? (
                <Button variant="danger" size="sm" disabled={pending}
                  onClick={() => start(async () => {
                    const res = await deleteFlagAction(editing.id!);
                    if (res.ok) { setEditing(null); router.refresh(); } else toast.error(t("common.error"));
                  })}>
                  {t("common.delete")}
                </Button>
              ) : <span />}
              <span className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
                <Button disabled={pending || !editing.flag.trim()} onClick={save}>{t("common.save")}</Button>
              </span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
