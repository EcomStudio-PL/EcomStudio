"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import {
  toggleProviderAction, updateModelCostAction, updatePlanAction,
  saveSystemTemplateAction, toggleTemplateAction, saveSettingAction,
} from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Res = { ok: boolean; error?: string };

function useRun() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (p: Promise<Res>, done?: () => void) =>
    start(async () => {
      const res = await p;
      if (res.ok) { toast.success(t("common.save")); done?.(); router.refresh(); }
      else toast.error(t("common.error"));
    });
  return { pending, run };
}

export function ProviderToggle({ providerId, active }: { providerId: string; active: boolean }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant={active ? "secondary" : "primary"} disabled={pending}
      onClick={() => run(toggleProviderAction(providerId, !active))}>
      {active ? t("admin.deactivate") : t("admin.activate")}
    </Button>
  );
}

export function ModelCostEditor({ modelId, cost }: { modelId: string; cost: number }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="ghost" disabled={pending}
      onClick={() => {
        const raw = prompt(t("admin.costPrompt"), String(cost));
        if (raw === null) return;
        const v = parseInt(raw, 10);
        if (!Number.isInteger(v) || v < 0) { toast.error(t("common.error")); return; }
        run(updateModelCostAction(modelId, v));
      }}>
      ± {t("admin.creditCost")}
    </Button>
  );
}

export function PlanEditor({ plan }: {
  plan: { id: string; name: string; price_cents: number; monthly_credits: number; sort_order: number; active: boolean };
}) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const [form, setForm] = useState({
    name: plan.name,
    price: String(plan.price_cents / 100),
    credits: String(plan.monthly_credits),
    order: String(plan.sort_order),
    active: plan.active,
  });
  return (
    <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-6">
      <div className="col-span-2 sm:col-span-2">
        <Label>{t("common.name")}</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <Label>{t("admin.priceCol")} (PLN)</Label>
        <Input type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
      </div>
      <div>
        <Label>{t("nav.credits")}</Label>
        <Input type="number" min={0} value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} />
      </div>
      <div>
        <Label>{t("admin.order")}</Label>
        <Input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} />
      </div>
      <div className="flex items-center gap-2 pb-2.5">
        <input id={`act-${plan.id}`} type="checkbox" checked={form.active}
          onChange={(e) => setForm({ ...form, active: e.target.checked })}
          className="h-4 w-4 accent-[rgb(var(--accent))]" />
        <label htmlFor={`act-${plan.id}`} className="text-sm">{t("admin.active")}</label>
        <Button size="sm" className="ml-auto" disabled={pending}
          onClick={() => run(updatePlanAction(plan.id, {
            name: form.name.trim(),
            price_cents: Math.round(parseFloat(form.price || "0") * 100),
            monthly_credits: parseInt(form.credits || "0", 10),
            sort_order: parseInt(form.order || "0", 10),
            active: form.active,
          }))}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

type Tpl = {
  id?: string; name: string; shot_type: string; template: string;
  format: string; style: string | null; priority: number; active: boolean;
};

export function TemplateManager({ templates }: { templates: Tpl[] }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const [editing, setEditing] = useState<Tpl | null>(null);

  const blank: Tpl = { name: "", shot_type: "custom", template: "", format: "1:1", style: null, priority: templates.length + 1, active: true };

  if (editing) {
    return (
      <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>{t("common.name")}</Label>
            <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div>
            <Label>{t("admin.shotType")}</Label>
            <Input value={editing.shot_type} onChange={(e) => setEditing({ ...editing, shot_type: e.target.value })} />
          </div>
          <div>
            <Label>{t("admin.category")}</Label>
            <Input value={editing.style ?? ""} onChange={(e) => setEditing({ ...editing, style: e.target.value || null })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Format</Label>
              <Select value={editing.format} onChange={(e) => setEditing({ ...editing, format: e.target.value })}>
                {["1:1", "4:5", "16:9", "9:16"].map((f) => <option key={f}>{f}</option>)}
              </Select>
            </div>
            <div>
              <Label>{t("admin.order")}</Label>
              <Input type="number" value={editing.priority}
                onChange={(e) => setEditing({ ...editing, priority: parseInt(e.target.value || "0", 10) })} />
            </div>
          </div>
        </div>
        <div>
          <Label>{t("admin.templateBody")}</Label>
          <Textarea rows={5} value={editing.template} onChange={(e) => setEditing({ ...editing, template: e.target.value })} />
          <p className="mt-1 text-xs text-muted">{"{{product_name}} {{category}} {{instructions}}"}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
          <Button disabled={pending || !editing.name.trim() || !editing.template.trim()}
            onClick={() => run(saveSystemTemplateAction(editing), () => setEditing(null))}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing(blank)}>+ {t("admin.newTemplate")}</Button>
      </div>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {templates.map((tpl) => (
          <li key={tpl.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
            <span className="w-8 text-center font-display text-sm text-faint">{tpl.priority}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{tpl.name}</p>
              <p className="truncate text-xs text-muted">{tpl.shot_type} · {tpl.format}{tpl.style ? ` · ${tpl.style}` : ""}</p>
            </div>
            <Badge tone={tpl.active ? "green" : "amber"}>{tpl.active ? t("admin.active") : t("admin.inactive")}</Badge>
            <Button size="sm" variant="ghost" onClick={() => setEditing(tpl)}>{t("common.edit")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing({ ...tpl, id: undefined, name: `${tpl.name} (copy)` })}>
              ⧉
            </Button>
            <Button size="sm" variant="secondary" disabled={pending}
              onClick={() => tpl.id && run(toggleTemplateAction(tpl.id, !tpl.active))}>
              {tpl.active ? t("admin.deactivate") : t("admin.activate")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SettingsEditor({ sections }: { sections: { key: string; value: Record<string, unknown> }[] }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const [state, setState] = useState<Record<string, Record<string, unknown>>>(
    Object.fromEntries(sections.map((s) => [s.key, { ...s.value }]))
  );
  return (
    <div className="space-y-5">
      {sections.map((s) => (
        <div key={s.key} className="rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide">{t(`admin.settings.${s.key}`)}</h2>
            <Button size="sm" disabled={pending} onClick={() => run(saveSettingAction(s.key, state[s.key]))}>
              {t("common.save")}
            </Button>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {Object.entries(state[s.key]).map(([field, val]) => (
              <div key={field} className={typeof val === "boolean" ? "flex items-center gap-2" : ""}>
                {typeof val === "boolean" ? (
                  <>
                    <input id={`${s.key}-${field}`} type="checkbox" checked={val}
                      onChange={(e) => setState({ ...state, [s.key]: { ...state[s.key], [field]: e.target.checked } })}
                      className="h-4 w-4 accent-[rgb(var(--accent))]" />
                    <label htmlFor={`${s.key}-${field}`} className="text-sm">{field}</label>
                  </>
                ) : (
                  <>
                    <Label htmlFor={`${s.key}-${field}`}>{field}</Label>
                    <Input id={`${s.key}-${field}`} type={typeof val === "number" ? "number" : "text"}
                      value={String(val ?? "")}
                      onChange={(e) => setState({
                        ...state,
                        [s.key]: {
                          ...state[s.key],
                          [field]: typeof val === "number" ? Number(e.target.value || 0) : e.target.value,
                        },
                      })} />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
