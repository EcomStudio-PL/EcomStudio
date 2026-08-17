"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { Panel } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Select, Label } from "@/components/ui/input";
import { saveGenerationPriorityAction } from "@/app/actions/admin-generation";

export type PriorityModelOption = { key: string; label: string };

/**
 * DOMYŚLNY MODEL ZDJĘĆ + kolejność fallbacków — the router configuration
 * that caused the production incident, now explicit and editable. The value
 * is the ordered provider_priority list the concept router follows; "—"
 * simply shortens the chain.
 */
export function GenerationPriority({ options, current }: {
  options: PriorityModelOption[];
  current: string[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [slots, setSlots] = useState<string[]>([current[0] ?? "", current[1] ?? "", current[2] ?? ""]);

  function save() {
    start(async () => {
      const res = await saveGenerationPriorityAction(slots.filter(Boolean));
      if (res.ok) { toast.success(t("common.save")); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  const labels = [t("admin.priority.primary"), t("admin.priority.fallback1"), t("admin.priority.fallback2")];

  return (
    <Panel className="mb-4 rounded-2xl p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="font-display text-[15px] font-semibold tracking-tight">{t("admin.priority.title")}</h2>
        <p className="mt-0.5 text-[13px] text-muted">{t("admin.priority.sub")}</p>
      </div>
      <div className="grid gap-3 [&>*]:min-w-0 sm:grid-cols-3">
        {slots.map((value, i) => (
          <div key={i}>
            <Label>{labels[i]}</Label>
            <Select value={value} onChange={(e) => {
              const next = [...slots];
              next[i] = e.target.value;
              setSlots(next);
            }}>
              <option value="">—</option>
              {options.map((o) => (
                <option key={o.key} value={o.key} disabled={slots.includes(o.key) && slots[i] !== o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={pending || !slots[0]} onClick={save}>{t("common.save")}</Button>
      </div>
    </Panel>
  );
}
