"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { CheckCircle2, CircleAlert, FlaskConical, TriangleAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  dryRunEngineAction, saveKnowledgeStrategyAction, type DryRunCheck,
} from "@/app/actions/ai-engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Testuj konfigurację" — a DRY RUN. The server compiles what production
 * would compile and checks every dependency; no provider is called and no
 * credit moves. A paid test is a deliberate act: the admin runs the tool
 * itself, from their own account.
 */
export function EngineDryRun({ toolKey, toolPath }: { toolKey: string; toolPath: string }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [checks, setChecks] = useState<DryRunCheck[] | null>(null);

  function run() {
    start(async () => {
      const res = await dryRunEngineAction(toolKey);
      if (!res.ok || !res.checks) { toast.error(t("common.error")); return; }
      setChecks(res.checks);
    });
  }

  const fails = checks?.filter((c) => c.status === "fail").length ?? 0;
  return (
    <div className="space-y-3" data-dry-run>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={run} disabled={pending}>
          <FlaskConical size={14} aria-hidden />
          {pending ? t("aicc.test.running") : t("aicc.test.run")}
        </Button>
        <span className="text-xs text-muted">{t("aicc.test.dryNote")}</span>
      </div>
      {checks && (
        <>
          <p className={cn("text-[13px] font-semibold", fails ? "text-danger" : "text-success")} data-dry-verdict>
            {fails ? t("aicc.test.verdictFail", { n: fails }) : t("aicc.test.verdictOk")}
          </p>
          <ul className="divide-y divide-line rounded-xl bg-raised">
            {checks.map((c, i) => (
              <li key={i} className="flex items-start gap-2.5 px-3.5 py-2.5 text-[13px]" data-check={c.key} data-status={c.status}>
                {c.status === "ok" ? <CheckCircle2 size={15} aria-hidden className="mt-0.5 shrink-0 text-success" />
                  : c.status === "warn" ? <TriangleAlert size={15} aria-hidden className="mt-0.5 shrink-0 text-warning" />
                  : <CircleAlert size={15} aria-hidden className="mt-0.5 shrink-0 text-danger" />}
                <span className="min-w-0 break-words">{t(`aicc.test.check.${c.key}`, c.params ?? {})}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {toolPath && <p className="text-xs leading-relaxed text-faint">{t("aicc.test.liveNote", { path: toolPath })}</p>}
    </div>
  );
}

/** "Preferuj sprawdzone wyniki" vs "Więcej różnorodności". */
export function KnowledgeStrategyForm({ toolKey, initial }: { toolKey: string; initial: "proven" | "diverse" }) {
  const { t } = useI18n();
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(initial);
  function save() {
    start(async () => {
      const res = await saveKnowledgeStrategyAction(toolKey, value);
      if (res.ok) { toast.success(t("common.saved")); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }
  return (
    <fieldset className="space-y-2" data-strategy>
      <legend className="mb-1 text-sm font-semibold">{t("aicc.strategy.title")}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(["proven", "diverse"] as const).map((s) => (
          <label key={s} className={cn(
            "flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors",
            value === s ? "border-accent bg-accent-soft/40" : "border-line hover:border-accent/50",
          )}>
            <input type="radio" name={`${id}-strategy`} checked={value === s} onChange={() => setValue(s)}
              className="mt-0.5 size-4 shrink-0 accent-[rgb(var(--accent))]" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">{t(`aicc.strategy.${s}`)}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted">{t(`aicc.strategy.${s}Hint`)}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <Button disabled={pending || value === initial} onClick={save}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </fieldset>
  );
}
