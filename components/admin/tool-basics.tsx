"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { saveToolConfigAction } from "@/app/actions/ai-tools";
import { ENGINE_MODES, type EngineMode } from "@/lib/services/ai-tools";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * PODSTAWOWE + SILNIK — the two forms that write `ai_tools`.
 *
 * They share one save action because they are one row; which fields are shown
 * is the caller's decision, so the engine tab does not repeat the service
 * picker and the basics tab does not repeat the engine modes.
 */

export type ToolConfigValues = {
  toolKey: string;
  engineMode: EngineMode;
  serviceSlug: string | null;
  allowModelChoice: boolean;
  fallbackEnabled: boolean;
  timeoutMs: number;
  maxAttempts: number;
  notes: string | null;
};

export function ToolConfigForm({ initial, services, section }: {
  initial: ToolConfigValues;
  services: { slug: string; name: string; credits: number }[];
  /** "basics" shows the catalogue link and the note; "engine" shows the mode
   *  and the request policy. */
  section: "basics" | "engine";
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  function save() {
    start(async () => {
      const res = await saveToolConfigAction(form);
      if (res.ok) { toast.success(t("common.saved")); router.refresh(); }
      else toast.error(res.error === "unknown_service" ? t("aicc.err.unknownService") : t("common.error"));
    });
  }

  return (
    <div className="space-y-5">
      {section === "basics" ? (
        <>
          <div>
            <Label htmlFor="svc">{t("aicc.basics.service")}</Label>
            <Select id="svc" value={form.serviceSlug ?? ""}
              onChange={(e) => setForm({ ...form, serviceSlug: e.target.value || null })}>
              <option value="">{t("aicc.basics.noService")}</option>
              {services.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name} — {s.credits === 0 ? t("tools.free") : `${s.credits} kr.`}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-faint">{t("aicc.basics.serviceHint")}</p>
          </div>
          <div>
            <Label htmlFor="notes">{t("aicc.basics.notes")}</Label>
            <Textarea id="notes" rows={3} value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <p className="mt-1 text-xs text-faint">{t("aicc.basics.notesHint")}</p>
          </div>
        </>
      ) : (
        <>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t("aicc.engine.legend")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ENGINE_MODES.map((mode) => (
                <label key={mode}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors",
                    form.engineMode === mode
                      ? "border-accent bg-accent-soft/40"
                      : "border-line hover:border-accent/50",
                  )}>
                  <input type="radio" name="engine-mode" value={mode} checked={form.engineMode === mode}
                    onChange={() => setForm({ ...form, engineMode: mode })}
                    className="mt-0.5 size-4 shrink-0 accent-[rgb(var(--accent))]" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold">{t(`aicc.engine.${mode}`)}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted">
                      {t(`aicc.engine.${mode}Hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="timeout">{t("aicc.engine.timeout")}</Label>
              <Input id="timeout" type="number" min={5} max={600} value={Math.round(form.timeoutMs / 1000)}
                onChange={(e) => setForm({ ...form, timeoutMs: (Number(e.target.value) || 120) * 1000 })} />
            </div>
            <div>
              <Label htmlFor="attempts">{t("aicc.engine.attempts")}</Label>
              <Input id="attempts" type="number" min={1} max={3} value={form.maxAttempts}
                onChange={(e) => setForm({ ...form, maxAttempts: Number(e.target.value) || 1 })} />
              {/* An extra attempt is an extra invoice from the provider. */}
              <p className="mt-1 text-xs text-faint">{t("aicc.engine.attemptsHint")}</p>
            </div>
          </div>
        </>
      )}

      <div className="flex justify-end">
        <Button disabled={pending || !dirty} onClick={save}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}
