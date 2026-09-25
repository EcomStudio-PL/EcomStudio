"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { moveCategoryAction, saveCategoryAction, setCategoryActiveAction } from "@/app/actions/grovnews";
import type { CategoryRow } from "@/lib/services/grovnews";

/** The one list of GrovNews categories: add, rename, switch on/off, reorder.
 *  The reader and the editor both read the table — no second list exists. */
export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okKey?: string) => start(async () => {
    const res = await fn();
    if (res.ok) { if (okKey) toast.success(t(okKey)); router.refresh(); }
    else toast.error(t(res.error === "slug_taken" ? "grovnewsAdm.errSlugTaken"
      : res.error === "forbidden" ? "grovnewsAdm.errForbidden" : res.error === "invalid" ? "grovnewsAdm.errName" : "common.error"));
  });

  const iconBtn = "flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40";

  return (
    <div className="space-y-4" data-grovnews-categories>
      <form className="panel flex flex-col gap-2 rounded-2xl p-3 sm:flex-row"
        onSubmit={(e) => { e.preventDefault(); if (newName.trim()) run(() => saveCategoryAction(null, { name: newName, sortOrder: (categories.length + 1) * 10 }), "grovnewsAdm.categoryAdded"); setNewName(""); }}>
        <Input value={newName} maxLength={80} placeholder={t("grovnewsAdm.newCategory")}
          aria-label={t("grovnewsAdm.newCategory")} onChange={(e) => setNewName(e.target.value)} />
        <Button type="submit" disabled={pending || !newName.trim()} className="shrink-0">
          <Plus size={15} aria-hidden />{t("grovnewsAdm.add")}
        </Button>
      </form>

      <ul className="space-y-1.5">
        {categories.map((c, i) => (
          <li key={c.id} className="panel flex min-w-0 items-center gap-2 rounded-2xl px-3 py-2" data-grovnews-category={c.slug}>
            <div className="flex shrink-0 flex-col">
              <button type="button" className={iconBtn} disabled={pending || i === 0}
                aria-label={t("grovnewsAdm.moveUp")} onClick={() => run(() => moveCategoryAction(c.id, "up"))}>
                <ArrowUp size={14} aria-hidden />
              </button>
              <button type="button" className={iconBtn} disabled={pending || i === categories.length - 1}
                aria-label={t("grovnewsAdm.moveDown")} onClick={() => run(() => moveCategoryAction(c.id, "down"))}>
                <ArrowDown size={14} aria-hidden />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              {editing === c.id ? (
                <form className="flex items-center gap-1"
                  onSubmit={(e) => { e.preventDefault(); run(() => saveCategoryAction(c.id, { name: editName, slug: c.slug }), "grovnewsAdm.saved"); setEditing(null); }}>
                  <Input value={editName} maxLength={80} autoFocus aria-label={t("grovnewsAdm.rename")}
                    onChange={(e) => setEditName(e.target.value)} />
                  <button type="submit" className={iconBtn} aria-label={t("grovnewsAdm.save")}><Check size={15} aria-hidden /></button>
                  <button type="button" className={iconBtn} aria-label={t("common.cancel")} onClick={() => setEditing(null)}><X size={15} aria-hidden /></button>
                </form>
              ) : (
                <>
                  <p className="truncate text-sm font-semibold">{c.name}</p>
                  <p className="truncate font-mono text-[11px] text-faint">{c.slug}</p>
                </>
              )}
            </div>
            {editing !== c.id && (
              <button type="button" className={iconBtn} aria-label={t("grovnewsAdm.rename")}
                onClick={() => { setEditing(c.id); setEditName(c.name); }}>
                <Pencil size={14} aria-hidden />
              </button>
            )}
            <button type="button" disabled={pending}
              onClick={() => run(() => setCategoryActiveAction(c.id, !c.is_active))}
              aria-pressed={c.is_active}
              className="shrink-0 rounded-lg px-1 py-1 transition-opacity disabled:opacity-50">
              <Badge tone={c.is_active ? "success" : "neutral"} dot>
                {t(c.is_active ? "grovnewsAdm.active" : "grovnewsAdm.inactive")}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
