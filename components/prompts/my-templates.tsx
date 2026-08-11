"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { saveMyTemplateAction, deleteMyTemplateAction, duplicateSystemTemplateAction } from "@/app/actions/prompts";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Tpl = {
  id?: string; name: string; shot_type: string; template: string;
  format: string; style: string | null; priority: number; active: boolean;
};

export function DuplicateTemplateButton({ templateId }: { templateId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending}
      title={t("prompts.duplicateToMine")}
      className="rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
      onClick={() => start(async () => {
        const res = await duplicateSystemTemplateAction(templateId);
        if (res.ok) { toast.success(t("prompts.duplicated")); router.refresh(); }
        else toast.error(t("common.error"));
      })}>
      ⧉ {t("prompts.duplicateToMine")}
    </button>
  );
}

export function MyTemplates({ templates }: { templates: Tpl[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Tpl | null>(null);

  function run(p: Promise<{ ok: boolean }>, done?: () => void) {
    start(async () => {
      const res = await p;
      if (res.ok) { toast.success(t("common.save")); done?.(); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  const blank: Tpl = { name: "", shot_type: "custom", template: "", format: "1:1", style: null, priority: templates.length + 1, active: true };

  return (
    <div>
      {editing ? (
        <div className="space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("common.name")}</Label>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Format</Label>
                <Select value={editing.format} onChange={(e) => setEditing({ ...editing, format: e.target.value })}>
                  {["1:1", "4:5", "16:9", "9:16"].map((f) => <option key={f}>{f}</option>)}
                </Select>
              </div>
              <div>
                <Label>{t("admin.category")}</Label>
                <Input value={editing.style ?? ""} onChange={(e) => setEditing({ ...editing, style: e.target.value || null })} />
              </div>
            </div>
          </div>
          <div>
            <Label>{t("admin.templateBody")}</Label>
            <Textarea rows={4} value={editing.template} onChange={(e) => setEditing({ ...editing, template: e.target.value })} />
            <p className="mt-1 text-xs text-muted">{"{{product_name}} {{category}} {{instructions}}"}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button size="sm" disabled={pending || !editing.name.trim() || !editing.template.trim()}
              onClick={() => run(saveMyTemplateAction(editing), () => setEditing(null))}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {templates.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted">{t("prompts.noMyTemplates")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {templates.map((tpl) => (
                <li key={tpl.id} className="flex items-center gap-2 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{tpl.name}</p>
                    <p className="truncate text-xs text-muted">{tpl.shot_type} · {tpl.format}</p>
                  </div>
                  {!tpl.active && <Badge tone="amber">{t("admin.inactive")}</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(tpl)}>{t("common.edit")}</Button>
                  <Button size="sm" variant="ghost" disabled={pending}
                    onClick={() => {
                      if (tpl.id && confirm(t("common.confirmDelete"))) run(deleteMyTemplateAction(tpl.id));
                    }}>
                    ✕
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line p-4">
            <Button size="sm" variant="secondary" className="w-full" onClick={() => setEditing(blank)}>
              + {t("prompts.newMyTemplate")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
