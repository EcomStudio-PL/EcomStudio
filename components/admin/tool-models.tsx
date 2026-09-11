"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { saveToolConfigAction, saveToolModelsAction } from "@/app/actions/ai-tools";
import type { ToolConfigValues } from "@/components/admin/tool-basics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PickableModel = {
  id: string;
  name: string;
  providerName: string;
  active: boolean;
  credits: number;
};

/**
 * MODELE — what this tool runs on.
 *
 * Primary, one optional fallback, and — when the customer is allowed to
 * choose — the list they may choose from. A fallback identical to the primary
 * is refused by the action: it is not a fallback, it is the same request to
 * the same provider for the same money.
 */
export function ToolModelPicker({ toolKey, models, initial, config }: {
  toolKey: string;
  models: PickableModel[];
  initial: { primaryId: string | null; fallbackId: string | null; allowedIds: string[] };
  config: ToolConfigValues;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [primaryId, setPrimary] = useState(initial.primaryId ?? "");
  const [fallbackId, setFallback] = useState(initial.fallbackId ?? "");
  const [allowed, setAllowed] = useState<Set<string>>(new Set(initial.allowedIds));
  const [choice, setChoice] = useState(config.allowModelChoice);
  const [fallbackOn, setFallbackOn] = useState(config.fallbackEnabled);

  function save() {
    start(async () => {
      const models = await saveToolModelsAction({
        toolKey,
        primaryModelId: primaryId || null,
        fallbackModelId: fallbackOn ? fallbackId || null : null,
        allowedModelIds: choice ? [...allowed] : [],
      });
      if (!models.ok) {
        toast.error(models.error === "same_model" ? t("aicc.err.sameModel") : t("common.error"));
        return;
      }
      const cfg = await saveToolConfigAction({
        ...config, allowModelChoice: choice, fallbackEnabled: fallbackOn,
      });
      if (!cfg.ok) { toast.error(t("common.error")); return; }
      toast.success(t("common.saved"));
      router.refresh();
    });
  }

  const options = models.map((m) => (
    <option key={m.id} value={m.id}>
      {m.name} · {m.providerName}{m.active ? "" : ` — ${t("admin.inactive")}`}
    </option>
  ));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="primary">{t("aicc.models.primary")}</Label>
          <Select id="primary" value={primaryId} onChange={(e) => setPrimary(e.target.value)}>
            <option value="">{t("aicc.models.none")}</option>
            {options}
          </Select>
          <p className="mt-1 text-xs text-faint">{t("aicc.models.primaryHint")}</p>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="fallback">{t("aicc.models.fallback")}</Label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={fallbackOn} onChange={(e) => setFallbackOn(e.target.checked)}
                className="size-3.5 accent-[rgb(var(--accent))]" />
              {t("aicc.models.fallbackEnable")}
            </label>
          </div>
          <Select id="fallback" value={fallbackId} disabled={!fallbackOn}
            onChange={(e) => setFallback(e.target.value)}>
            <option value="">{t("aicc.models.none")}</option>
            {options}
          </Select>
          <p className="mt-1 text-xs text-faint">{t("aicc.models.fallbackHint")}</p>
        </div>
      </div>

      <div className="panel rounded-2xl p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={choice} onChange={(e) => setChoice(e.target.checked)}
            className="mt-0.5 size-4 accent-[rgb(var(--accent))]" />
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">{t("aicc.models.customerChoice")}</span>
            <span className="mt-0.5 block text-xs leading-snug text-muted">{t("aicc.models.customerChoiceHint")}</span>
          </span>
        </label>

        {choice && (
          <ul className="mt-3 grid gap-1.5 border-t border-line pt-3 sm:grid-cols-2">
            {models.map((m) => {
              const on = allowed.has(m.id);
              return (
                <li key={m.id}>
                  <label className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
                    on ? "bg-accent-soft/40" : "hover:bg-raised",
                  )}>
                    <input type="checkbox" checked={on} className="size-4 accent-[rgb(var(--accent))]"
                      onChange={() => setAllowed((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                        return next;
                      })} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{m.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-faint">{m.credits} kr.</span>
                    {!m.active && <Badge tone="neutral">{t("admin.inactive")}</Badge>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex justify-end">
        <Button disabled={pending} onClick={save}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}
