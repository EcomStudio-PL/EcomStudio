"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { Panel } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Select, Label } from "@/components/ui/input";
import { saveGenerationPriorityAction, saveGrovshotPlannerAction, savePlannerConfigAction } from "@/app/actions/admin-generation";

export type PriorityModelOption = { key: string; label: string };

/**
 * DOMYŚLNY MODEL ZDJĘĆ + kolejność fallbacków — the router configuration
 * that caused the production incident, now explicit and editable. The value
 * is the ordered provider_priority list the concept router follows; "—"
 * simply shortens the chain.
 */
export function GenerationPriority({ options, current, planner, grovshotPlanner }: {
  options: PriorityModelOption[];
  current: string[];
  planner: { primary: string; fallback: string };
  /** GrovShot's own planner (Claude); null = the shared chain above. */
  grovshotPlanner: { provider: string; model: string; effort: string } | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [slots, setSlots] = useState<string[]>([current[0] ?? "", current[1] ?? "", current[2] ?? ""]);
  const [plannerPrimary, setPlannerPrimary] = useState(planner.primary || "openai");
  const [plannerFallback, setPlannerFallback] = useState(planner.fallback ?? "");
  const [gsProvider, setGsProvider] = useState(grovshotPlanner?.provider ?? "");
  const [gsModel, setGsModel] = useState(grovshotPlanner?.model ?? "claude-sonnet-5-5");
  const [gsEffort, setGsEffort] = useState(grovshotPlanner?.effort ?? "medium");

  function saveGrovshotPlanner() {
    start(async () => {
      const res = await saveGrovshotPlannerAction(gsProvider, gsModel, gsEffort);
      if (res.ok) { toast.success(t("common.save")); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  function savePlanner() {
    start(async () => {
      const res = await savePlannerConfigAction(plannerPrimary, plannerFallback);
      if (res.ok) { toast.success(t("common.save")); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

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
    
      {/* PLANNER — its own provider chain, independent of image models. */}
      <div className="mt-5 border-t border-line pt-4">
        <h3 className="font-display text-[14px] font-semibold tracking-tight">{t("admin.planner.title")}</h3>
        <p className="mb-3 mt-0.5 text-[13px] text-muted">{t("admin.planner.sub")}</p>
        <div className="grid gap-3 [&>*]:min-w-0 sm:grid-cols-3">
          <div>
            <Label>{t("admin.planner.primary")}</Label>
            <Select value={plannerPrimary} onChange={(e) => setPlannerPrimary(e.target.value)}>
              <option value="openai">OpenAI</option>
              <option value="google">Google Gemini</option>
            </Select>
          </div>
          <div>
            <Label>{t("admin.planner.fallback")}</Label>
            <Select value={plannerFallback} onChange={(e) => setPlannerFallback(e.target.value)}>
              <option value="">{t("admin.planner.off")}</option>
              {plannerPrimary !== "openai" && <option value="openai">OpenAI</option>}
              {plannerPrimary !== "google" && <option value="google">Google Gemini</option>}
            </Select>
          </div>
          <div className="flex items-end">
            <Button size="sm" disabled={pending} onClick={savePlanner}>{t("common.save")}</Button>
          </div>
        </div>
      </div>

      {/* GROVSHOT'S OWN PLANNER — Claude, only for GrovShot (no fallback). */}
      <div className="mt-5 border-t border-line pt-4" data-grovshot-planner={gsProvider || "shared"}>
        <h3 className="font-display text-[14px] font-semibold tracking-tight">{t("admin.planner.gsTitle")}</h3>
        <p className="mb-3 mt-0.5 text-[13px] text-muted">{t("admin.planner.gsSub")}</p>
        <div className="grid gap-3 [&>*]:min-w-0 sm:grid-cols-4">
          <div>
            <Label>{t("admin.planner.gsProvider")}</Label>
            <Select value={gsProvider} onChange={(e) => setGsProvider(e.target.value)}>
              <option value="">{t("admin.planner.gsShared")}</option>
              <option value="anthropic">Anthropic (Claude)</option>
            </Select>
          </div>
          {gsProvider === "anthropic" && (
            <>
              <div>
                <Label>{t("admin.planner.gsModel")}</Label>
                <Select value={gsModel} onChange={(e) => setGsModel(e.target.value)}>
                  <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option>
                  <option value="claude-haiku-5-5">Claude Haiku 5.5</option>
                  <option value="claude-opus-5-5">Claude Opus 5.5</option>
                </Select>
              </div>
              <div>
                <Label>{t("admin.planner.gsEffort")}</Label>
                <Select value={gsEffort} onChange={(e) => setGsEffort(e.target.value)}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </Select>
              </div>
            </>
          )}
          <div className="flex items-end">
            <Button size="sm" disabled={pending} onClick={saveGrovshotPlanner}>{t("common.save")}</Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
