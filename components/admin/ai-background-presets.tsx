"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { saveAiBackgroundPresetsAction } from "@/app/actions/ai-background-presets";
import {
  PRESET_KEY_RE, PRESET_LABEL_MAX, PRESET_LIMIT, PRESET_PROMPT_MAX, type AiBackgroundPreset,
} from "@/lib/images/ai-background-presets";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

/**
 * "DODAJ TŁO AI" — THE SCENE PRESETS, EDITED.
 *
 * One row per scene: its key (fixed once saved — the panel sends it back),
 * the name a seller sees in three languages, and the scene text that goes to
 * Photoroom. The scene text is GrovBase's own wording: it is shown here, to an
 * operator, and nowhere else. Nothing is saved until "Zapisz".
 */
export function AiBackgroundPresetsEditor({ initial }: { initial: AiBackgroundPreset[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<AiBackgroundPreset[]>(initial);
  const saved = new Set(initial.map((p) => p.key));
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);

  const keys = rows.map((r) => r.key);
  const problem = (r: AiBackgroundPreset): string | null => {
    if (!PRESET_KEY_RE.test(r.key)) return t("aicc.presets.errKey");
    if (keys.filter((k) => k === r.key).length > 1) return t("aicc.presets.errDuplicate");
    if (!r.label.pl.trim()) return t("aicc.presets.errLabel");
    if (!r.prompt.trim()) return t("aicc.presets.errPrompt");
    return null;
  };
  const valid = rows.every((r) => problem(r) === null);

  const patch = (i: number, next: Partial<AiBackgroundPreset>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const move = (i: number, by: -1 | 1) => setRows((prev) => {
    const j = i + by;
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  function add() {
    setRows((prev) => [...prev, {
      key: `scene_${prev.length + 1}`, label: { pl: "", en: "", de: "" }, prompt: "", expandPrompt: false, enabled: true,
    }]);
  }

  function save() {
    start(async () => {
      const res = await saveAiBackgroundPresetsAction(rows);
      if (res.ok) { toast.success(t("common.saved")); router.refresh(); }
      else toast.error(res.error === "invalid" ? t("aicc.presets.errInvalid") : t("common.error"));
    });
  }

  return (
    <div className="space-y-3" data-presets-editor>
      {rows.length === 0 && <p className="text-[13px] text-muted">{t("aicc.presets.empty")}</p>}
      <ol className="space-y-3">
        {rows.map((r, i) => {
          const err = problem(r);
          return (
            <li key={i} className="rounded-xl border border-line p-3" data-preset={r.key}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs tabular-nums text-faint">{i + 1}.</span>
                <Input value={r.key} disabled={saved.has(r.key)} maxLength={40} aria-label={t("aicc.presets.key")}
                  onChange={(e) => patch(i, { key: e.target.value.trim().toLowerCase() })}
                  className="h-9 w-44 font-mono text-xs" />
                <label className="flex items-center gap-1.5 text-[12.5px]">
                  <input type="checkbox" checked={r.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })}
                    className="h-4 w-4 accent-[rgb(var(--accent))]" />
                  {t("aicc.presets.enabled")}
                </label>
                <label className="flex items-center gap-1.5 text-[12.5px]" title={t("aicc.presets.expandHint")}>
                  <input type="checkbox" checked={r.expandPrompt} onChange={(e) => patch(i, { expandPrompt: e.target.checked })}
                    className="h-4 w-4 accent-[rgb(var(--accent))]" />
                  {t("aicc.presets.expand")}
                </label>
                <span className="ml-auto flex gap-1">
                  <IconButton label={t("aicc.presets.up")} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={14} aria-hidden /></IconButton>
                  <IconButton label={t("aicc.presets.down")} onClick={() => move(i, 1)} disabled={i === rows.length - 1}><ArrowDown size={14} aria-hidden /></IconButton>
                  <IconButton label={t("common.remove")} onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden /></IconButton>
                </span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {(["pl", "en", "de"] as const).map((lang) => (
                  <Input key={lang} value={r.label[lang]} maxLength={PRESET_LABEL_MAX}
                    placeholder={`${t("aicc.presets.label")} (${lang.toUpperCase()})`}
                    aria-label={`${t("aicc.presets.label")} (${lang.toUpperCase()})`}
                    onChange={(e) => patch(i, { label: { ...r.label, [lang]: e.target.value } })} className="h-9 text-[13px]" />
                ))}
              </div>
              <Textarea value={r.prompt} maxLength={PRESET_PROMPT_MAX} rows={2}
                placeholder={t("aicc.presets.prompt")} aria-label={t("aicc.presets.prompt")}
                onChange={(e) => patch(i, { prompt: e.target.value })} className="mt-2 text-[13px]" />
              <p className="mt-1 flex justify-between gap-2 text-[11px]">
                <span className="text-danger">{err ?? ""}</span>
                <span className="tabular-nums text-faint">{r.prompt.length} / {PRESET_PROMPT_MAX}</span>
              </p>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={add} disabled={rows.length >= PRESET_LIMIT}>
          <Plus size={14} aria-hidden /> {t("aicc.presets.add")}
        </Button>
        <Button type="button" onClick={save} disabled={!dirty || !valid || pending}>
          {t("common.save")}
        </Button>
        <span className="text-xs text-faint">{t("aicc.presets.note")}</span>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40">
      {children}
    </button>
  );
}
