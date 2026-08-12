"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  saveCmsBlockAction, moveCmsBlockAction, duplicateCmsBlockAction,
  deleteCmsBlockAction, publishCmsPageAction, seedHomeBlocksAction,
} from "@/app/actions/admin-b2b";
import { BLOCK_TYPES, type CmsBlockContent, type CmsItem, type LocaleText } from "@/lib/cms";
import { Modal, ConfirmModal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BlockRow = { id: string; type: string; sort_order: number; visible: boolean; content: CmsBlockContent };
const LOCALES = ["pl", "en", "de"] as const;

function useRun() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (p: Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      const res = await p;
      if (res.ok) { done?.(); router.refresh(); }
      else toast.error(t("common.error"));
    });
  return { pending, run };
}

export function CmsPageEditor({ pageId, slug, status, publishedAt, blocks, isEmpty }: {
  pageId: string; slug: string; status: string; publishedAt: string | null;
  blocks: BlockRow[]; isEmpty: boolean;
}) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const [editing, setEditing] = useState<BlockRow | { id?: undefined; type: string; visible: boolean; content: CmsBlockContent } | null>(null);
  const [deleting, setDeleting] = useState<BlockRow | null>(null);
  const [locale, setLocale] = useState<(typeof LOCALES)[number]>("pl");

  const setText = (key: keyof CmsBlockContent, value: string) => {
    if (!editing) return;
    const prev = (editing.content[key] ?? {}) as LocaleText;
    setEditing({ ...editing, content: { ...editing.content, [key]: { ...prev, [locale]: value } } });
  };
  const getText = (key: keyof CmsBlockContent) =>
    ((editing?.content[key] ?? {}) as LocaleText)[locale] ?? "";
  const setPlain = (key: keyof CmsBlockContent, value: string) => {
    if (!editing) return;
    setEditing({ ...editing, content: { ...editing.content, [key]: value || undefined } });
  };
  const items: CmsItem[] = editing?.content.items ?? [];
  const setItems = (next: CmsItem[]) => {
    if (!editing) return;
    setEditing({ ...editing, content: { ...editing.content, items: next } });
  };

  function save() {
    if (!editing) return;
    run(saveCmsBlockAction({
      id: editing.id, pageId, type: editing.type,
      content: editing.content as never, visible: editing.visible,
    }), () => { setEditing(null); toast.success(t("common.save")); });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={status === "published" ? "green" : "amber"}>
            {status === "published" ? t("cms.published") : t("cms.draft")}
          </Badge>
          {publishedAt && <span className="text-xs text-muted">{new Date(publishedAt).toLocaleString("pl-PL")}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {isEmpty && slug === "home" && (
            <Button size="sm" variant="secondary" disabled={pending}
              onClick={() => run(seedHomeBlocksAction(pageId), () => toast.success(t("common.save")))}>
              {t("cms.seed")}
            </Button>
          )}
          <a href={`/admin/www/${slug}/preview`} target="_blank"
            className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-raised">
            {t("cms.preview")}
          </a>
          <Button size="sm" disabled={pending}
            onClick={() => run(publishCmsPageAction(pageId), () => toast.success(t("cms.publishedToast")))}>
            {t("cms.publish")}
          </Button>
          <Button size="sm" variant="secondary"
            onClick={() => setEditing({ type: "text_image", visible: true, content: {} })}>
            + {t("cms.addBlock")}
          </Button>
        </div>
      </div>

      {blocks.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center">
          <p className="text-sm font-semibold">{t("cms.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted">{t("cms.emptyBody")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {blocks.map((b, i) => (
            <li key={b.id} className={cn("glass flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3", !b.visible && "opacity-50")}>
              <span className="w-6 text-center font-display text-xs text-faint">{i + 1}</span>
              <Badge tone="indigo">{b.type}</Badge>
              <span className="min-w-0 flex-1 truncate text-sm">
                {((b.content.title ?? {}) as LocaleText).pl ?? ((b.content.title ?? {}) as LocaleText).en ?? "—"}
              </span>
              <span className="flex items-center gap-0.5">
                <IconBtn title={t("cms.moveUp")} disabled={pending || i === 0} onClick={() => run(moveCmsBlockAction(b.id, "up"))}><ArrowUp size={14} /></IconBtn>
                <IconBtn title={t("cms.moveDown")} disabled={pending || i === blocks.length - 1} onClick={() => run(moveCmsBlockAction(b.id, "down"))}><ArrowDown size={14} /></IconBtn>
                <IconBtn title={b.visible ? t("cms.hide") : t("cms.show")} disabled={pending}
                  onClick={() => run(saveCmsBlockAction({ id: b.id, pageId, type: b.type, content: b.content as never, visible: !b.visible }))}>
                  {b.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </IconBtn>
                <IconBtn title={t("cms.duplicate")} disabled={pending} onClick={() => run(duplicateCmsBlockAction(b.id))}><Copy size={14} /></IconBtn>
                <IconBtn title={t("common.delete")} disabled={pending} onClick={() => setDeleting(b)}><Trash2 size={14} /></IconBtn>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>{t("common.edit")}</Button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t("cms.editBlock") : t("cms.addBlock")} wide>
        {editing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-40">
                <Label>{t("common.type")}</Label>
                <Select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                  {BLOCK_TYPES.map((x) => <option key={x}>{x}</option>)}
                </Select>
              </div>
              <div className="flex gap-1">
                {LOCALES.map((l) => (
                  <button key={l} type="button" onClick={() => setLocale(l)}
                    className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold uppercase transition-colors",
                      l === locale ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised")}>
                    {l}
                  </button>
                ))}
              </div>
              <label className="ml-auto flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.visible} className="h-4 w-4 accent-[rgb(var(--accent))]"
                  onChange={(e) => setEditing({ ...editing, visible: e.target.checked })} />
                {t("cms.visible")}
              </label>
            </div>

            {(["badge", "title", "subtitle"] as const).map((k) => (
              <div key={k}>
                <Label>{t(`cms.f.${k}`)} ({locale.toUpperCase()})</Label>
                <Input value={getText(k)} onChange={(e) => setText(k, e.target.value)} />
              </div>
            ))}
            <div>
              <Label>{t("cms.f.description")} ({locale.toUpperCase()})</Label>
              <Textarea rows={2} value={getText("description")} onChange={(e) => setText("description", e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>CTA ({locale.toUpperCase()})</Label>
                <Input value={getText("ctaLabel")} onChange={(e) => setText("ctaLabel", e.target.value)} />
              </div>
              <div>
                <Label>CTA URL</Label>
                <Input value={(editing.content.ctaUrl as string) ?? ""} onChange={(e) => setPlain("ctaUrl", e.target.value)} />
              </div>
              <div>
                <Label>{t("cms.f.media")} URL</Label>
                <Input placeholder="https://…" value={(editing.content.mediaUrl as string) ?? ""} onChange={(e) => setPlain("mediaUrl", e.target.value)} />
              </div>
              <div>
                <Label>{t("cms.f.media2")} URL</Label>
                <Input placeholder="https://…" value={(editing.content.media2Url as string) ?? ""} onChange={(e) => setPlain("media2Url", e.target.value)} />
              </div>
              <div>
                <Label>{t("media.poster")} URL</Label>
                <Input placeholder="https://…" value={(editing.content.posterUrl as string) ?? ""} onChange={(e) => setPlain("posterUrl", e.target.value)} />
              </div>
              <div>
                <Label>{t("cms.f.alignment")}</Label>
                <Select value={editing.content.alignment ?? "right"}
                  onChange={(e) => setEditing({ ...editing, content: { ...editing.content, alignment: e.target.value as "left" | "right" } })}>
                  <option value="right">right</option>
                  <option value="left">left</option>
                </Select>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>{t("cms.f.items")}</Label>
                <Button size="sm" variant="secondary" onClick={() => setItems([...items, {}])}>+ {t("cms.addItem")}</Button>
              </div>
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                    <Input placeholder={`${t("cms.f.title")} (${locale})`} value={(it.title ?? {})[locale] ?? ""}
                      onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, title: { ...(x.title ?? {}), [locale]: e.target.value } } : x))} />
                    <Input placeholder={`${t("cms.f.description")} (${locale})`} value={(it.description ?? {})[locale] ?? ""}
                      onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, description: { ...(x.description ?? {}), [locale]: e.target.value } } : x))} />
                    <Input placeholder="https:// / value" value={it.mediaUrl ?? it.value ?? ""}
                      onChange={(e) => setItems(items.map((x, j) => j === i
                        ? (e.target.value.startsWith("http") ? { ...x, mediaUrl: e.target.value, value: undefined } : { ...x, value: e.target.value, mediaUrl: undefined })
                        : x))} />
                    <button type="button" aria-label={t("common.delete")} className="rounded-lg p-2 text-muted hover:bg-raised hover:text-red-500"
                      onClick={() => setItems(items.filter((_, j) => j !== i))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
              <Button disabled={pending} onClick={save}>{t("common.save")}</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)}
        onConfirm={() => { if (deleting) run(deleteCmsBlockAction(deleting.id), () => setDeleting(null)); }}
        title={t("common.delete")} body={t("common.confirmDelete")} confirmLabel={t("common.delete")} danger pending={pending} />
    </div>
  );
}

function IconBtn({ children, onClick, disabled, title }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; title: string;
}) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className="rounded-lg p-1.5 text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40">
      {children}
    </button>
  );
}
