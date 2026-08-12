"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { savePromptBlockAction, deletePromptBlockAction } from "@/app/actions/admin";
import { Modal, ConfirmModal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const BLOCK_CATEGORIES = ["style", "scene", "format", "cta", "fidelity", "restrictions", "extra"] as const;

export type PromptBlock = {
  id?: string; category: string; name: string; content: string;
  active: boolean; sort_order: number;
};

/** Admin library of reusable prompt building blocks. Active blocks are
 *  appended to every generated prompt in fixed category order, so admins
 *  compose global style/fidelity/restriction rules without touching
 *  individual templates. */
export function PromptBlocksManager({ blocks }: { blocks: PromptBlock[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<PromptBlock | null>(null);
  const [deleting, setDeleting] = useState<PromptBlock | null>(null);

  const blank: PromptBlock = { category: "style", name: "", content: "", active: true, sort_order: blocks.length };

  function save() {
    if (!editing) return;
    start(async () => {
      const res = await savePromptBlockAction(editing);
      if (res.ok) { toast.success(t("common.save")); setEditing(null); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }
  function remove() {
    if (!deleting?.id) return;
    start(async () => {
      const res = await deletePromptBlockAction(deleting.id!);
      if (res.ok) { toast.success(t("common.delete")); setDeleting(null); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  const byCategory = BLOCK_CATEGORIES
    .map((c) => ({ category: c, items: blocks.filter((b) => b.category === c).sort((a, b) => a.sort_order - b.sort_order) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{t("admin.blocksSub")}</p>
        <Button size="sm" onClick={() => setEditing(blank)}>+ {t("admin.newBlock")}</Button>
      </div>
      {byCategory.length === 0 ? (
        <div className="panel rounded-2xl p-8 text-center">
          <p className="text-sm font-semibold">{t("admin.noBlocksTitle")}</p>
          <p className="mt-1 text-sm text-muted">{t("admin.noBlocksBody")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {byCategory.map((g) => (
            <div key={g.category} className="panel rounded-2xl">
              <p className="border-b border-line px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
                {t(`admin.blockCat.${g.category}`)}
              </p>
              <ul className="divide-y divide-line">
                {g.items.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{b.name}</p>
                      <p className="truncate text-xs text-muted">{b.content}</p>
                    </div>
                    <Badge tone={b.active ? "green" : "amber"}>{b.active ? t("admin.active") : t("admin.inactive")}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>{t("common.edit")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(b)}>✕</Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t("common.edit") : t("admin.newBlock")} wide>
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>{t("admin.category")}</Label>
                <Select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  {BLOCK_CATEGORIES.map((c) => <option key={c} value={c}>{t(`admin.blockCat.${c}`)}</option>)}
                </Select>
              </div>
              <div>
                <Label>{t("common.name")}</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <Label>{t("admin.order")}</Label>
                <Input type="number" value={editing.sort_order}
                  onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value || "0", 10) })} />
              </div>
            </div>
            <div>
              <Label>{t("admin.blockContent")}</Label>
              <Textarea rows={4} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.active} className="h-4 w-4 accent-[rgb(var(--accent))]"
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              {t("admin.active")}
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
              <Button disabled={pending || !editing.name.trim() || !editing.content.trim()} onClick={save}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={t("common.delete")}
        body={t("common.confirmDelete")}
        confirmLabel={t("common.delete")}
        danger
        pending={pending}
      />
    </div>
  );
}
