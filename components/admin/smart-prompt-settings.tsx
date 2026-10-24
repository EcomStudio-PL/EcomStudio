"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { Switch } from "@/components/ui/record";
import { saveSmartPromptSettingsAction } from "@/app/actions/smart-prompt";
import {
  SMART_PROMPT_INSTRUCTION_MAX, SMART_PROMPT_PROVIDERS, type SmartPromptProvider,
} from "@/lib/smart-prompt";

const field = "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px] focus:border-accent focus:outline-none disabled:opacity-50";

export type SmartPromptFormValue = {
  enabled: boolean; credits: number; provider: SmartPromptProvider; model: string; instruction: string;
};

/**
 * INTELIGENTNY PROMPT — the operator's settings: on/off and price (the
 * catalogue row the charge is taken from), the text model, and an optional
 * instruction. An empty instruction means the built-in one, which is shown
 * here for reference and can be copied in to edit. Validated again by the
 * action with the parser the server reads with.
 */
export function SmartPromptSettingsForm({ initial, defaultInstruction }: {
  initial: SmartPromptFormValue; defaultInstruction: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<SmartPromptFormValue>(initial);
  const [creditsRaw, setCreditsRaw] = useState(String(initial.credits));
  const [showDefault, setShowDefault] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof SmartPromptFormValue>(k: K, value: SmartPromptFormValue[K]) => setV((p) => ({ ...p, [k]: value }));

  function save() {
    const credits = Number(creditsRaw);
    startTransition(async () => {
      const res = await saveSmartPromptSettingsAction({ ...v, credits, model: v.provider === "auto" ? "" : v.model });
      if (res.ok) { toast.success(t("aicc.smart.saved")); router.refresh(); }
      else if (res.field) toast.error(t("aicc.smart.invalidField", { field: t(`aicc.smart.field.${res.field}`) }));
      else toast.error(t(`aicc.smart.err.${res.error ?? "generic"}`));
    });
  }

  // What an EMPTY field really runs: OpenAI walks gpt-5 → gpt-4.1 → gpt-4o,
  // Google uses gemini-flash-latest (lib/ai/engine/vision.ts).
  const modelPlaceholder = v.provider === "openai" ? "gpt-5" : v.provider === "google" ? "gemini-flash-latest" : "";
  return (
    <div className="space-y-4 text-[13px]" data-smart-prompt-settings>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised/50 px-3 py-2.5">
        <span>
          <span className="block font-semibold">{t("aicc.smart.field.enabled")}</span>
          <span className="block text-[11.5px] text-muted">{t("aicc.smart.enabledHint")}</span>
        </span>
        <Switch checked={v.enabled} onChange={(next) => set("enabled", next)} label={t("aicc.smart.field.enabled")} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Label text={t("aicc.smart.field.credits")} hint={t("aicc.smart.creditsHint")}>
          <input className={`${field} tabular-nums`} inputMode="numeric" value={creditsRaw}
            onChange={(e) => setCreditsRaw(e.target.value.replace(/[^\d]/g, "").slice(0, 4))} />
        </Label>
        <Label text={t("aicc.smart.field.provider")}>
          {/* A model id belongs to its provider: switching clears it, so a
              Gemini id is never sent to OpenAI (or the other way round). */}
          <select className={field} value={v.provider}
            onChange={(e) => setV((p) => ({ ...p, provider: e.target.value as SmartPromptProvider, model: "" }))}>
            {SMART_PROMPT_PROVIDERS.map((p) => <option key={p} value={p}>{t(`aicc.smart.provider.${p}`)}</option>)}
          </select>
        </Label>
        <Label text={t("aicc.smart.field.model")} hint={v.provider === "auto" ? t("aicc.smart.modelAutoHint") : t("aicc.smart.modelHint")}>
          <input className={`${field} font-mono text-[12px]`} value={v.provider === "auto" ? "" : v.model}
            placeholder={modelPlaceholder} disabled={v.provider === "auto"} spellCheck={false}
            onChange={(e) => set("model", e.target.value.slice(0, 80))} />
        </Label>
      </div>

      <Label text={t("aicc.smart.field.instruction")} hint={t("aicc.smart.instructionHint")}>
        <textarea className="thin-scroll min-h-[9rem] w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-[12.5px] leading-relaxed focus:border-accent focus:outline-none"
          value={v.instruction} maxLength={SMART_PROMPT_INSTRUCTION_MAX} spellCheck={false}
          placeholder={t("aicc.smart.instructionPh")}
          onChange={(e) => set("instruction", e.target.value)} />
      </Label>
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
        <span className="flex flex-wrap gap-3">
          <button type="button" className="font-semibold text-accent hover:opacity-75" onClick={() => setShowDefault((s) => !s)}>
            {showDefault ? t("aicc.smart.hideDefault") : t("aicc.smart.showDefault")}
          </button>
          <button type="button" className="font-semibold text-accent hover:opacity-75" onClick={() => set("instruction", defaultInstruction)}>
            {t("aicc.smart.copyDefault")}
          </button>
          {v.instruction && (
            <button type="button" className="font-semibold text-muted hover:text-ink" onClick={() => set("instruction", "")}>
              {t("aicc.smart.useDefault")}
            </button>
          )}
        </span>
        <span className="tabular-nums text-faint">{v.instruction.length}/{SMART_PROMPT_INSTRUCTION_MAX}</span>
      </div>
      {showDefault && (
        <pre data-smart-default className="thin-scroll max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-sunken/60 p-3 text-[11.5px] leading-relaxed text-muted">
          {defaultInstruction}
        </pre>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={pending}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60">
          {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}

function Label({ text, hint, children }: { text: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] font-medium text-muted">{text}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}
