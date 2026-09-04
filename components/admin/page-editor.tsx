"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  saveCmsBlockAction, moveCmsBlockAction, duplicateCmsBlockAction, deleteCmsBlockAction,
  seedHomeBlocksAction,
} from "@/app/actions/admin-b2b";
import { publishPublicPageAction, unpublishPublicPageAction } from "@/app/actions/public-pages";
import { SECTION_TYPES, type CmsBlockContent, type CmsItem, type LocaleText } from "@/lib/cms";
import { fieldsFor, readField, writeField, type FieldDef } from "@/lib/cms-schema";
import { MediaPicker } from "@/components/admin/media-picker";
import { Modal, ConfirmModal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";

/**
 * ONE EDITOR FOR EVERY PUBLIC PAGE.
 *
 * The page is a list of sections; a section is a type plus a bag of content.
 * Which inputs a section shows comes from lib/cms-schema.ts, so adding a
 * section type is a table entry rather than another editor — and the launch
 * page, which used to have a completely separate screen, is just the page
 * whose one section happens to be of type `launch`.
 *
 * Everything typed here is a DRAFT. The public site renders the snapshot
 * taken by "Publikuj", so an admin can leave a page half-rewritten without a
 * visitor ever seeing it.
 */

type BlockRow = {
  id: string; type: string; sort_order: number; visible: boolean; content: CmsBlockContent;
};
type Draft = BlockRow | { id?: undefined; type: string; visible: boolean; content: CmsBlockContent };

const LOCALES = ["pl", "en", "de"] as const;
type Locale = (typeof LOCALES)[number];

export function PageEditor({ pageId, slug, kind, status, publishedAt, blocks }: {
  pageId: string;
  slug: string;
  /** `launch` pages hold exactly one section and never reorder. */
  kind: string;
  status: string;
  publishedAt: string | null;
  blocks: BlockRow[];
}) {
  const { t, locale: uiLocale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<BlockRow | null>(null);
  const [locale, setLocale] = useState<Locale>("pl");
  const [adding, setAdding] = useState(false);

  const isLaunch = kind === "launch";
  const published = status === "published";

  const run = (p: Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      const res = await p;
      if (res.ok) { done?.(); router.refresh(); }
      else toast.error(t("common.error"));
    });

  function saveSection() {
    if (!editing) return;
    run(saveCmsBlockAction({
      id: editing.id, pageId, type: editing.type,
      content: editing.content as never, visible: editing.visible,
    }), () => { setEditing(null); toast.success(t("common.saved")); });
  }

  const previewHref = `/admin/www/${slug}/preview`;
  // The launch page is reachable at "/" only while it is the active homepage;
  // its own slug always 404s, so it must never be offered as a link.
  const publicHref = slug === "home" || isLaunch ? "/" : `/${slug}`;
  const showPublicLink = isLaunch ? false : published;

  return (
    <div data-page-editor>
      {/* ── Status + the three things you do to a page ─────────────────── */}
      <div className="panel mb-4 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3">
        <Badge tone={published ? "green" : "amber"}>
          {published ? t("cms.published") : t("cms.draft")}
        </Badge>
        {publishedAt && (
          <span className="text-[12px] text-muted">{formatDate(publishedAt, uiLocale)}</span>
        )}
        <span className="hidden flex-1 sm:block" />
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <a href={previewHref} target="_blank" rel="noreferrer" data-page-preview
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium transition-colors hover:bg-raised">
            {t("cms.preview")}
            <ExternalLink size={13} aria-hidden />
          </a>
          {showPublicLink && (
            <a href={publicHref} target="_blank" rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
              {t("cms.openPublic")}
            </a>
          )}
          <Button size="sm" disabled={pending} data-page-publish
            onClick={() => run(publishPublicPageAction(pageId), () => toast.success(t("cms.publishedToast")))}>
            {t("cms.publish")}
          </Button>
          {published && (
            <Button size="sm" variant="ghost" disabled={pending}
              onClick={() => run(unpublishPublicPageAction(pageId), () => toast.success(t("common.saved")))}>
              {t("cms.unpublish")}
            </Button>
          )}
        </div>
        <p className="w-full text-[12px] leading-relaxed text-faint">{t("cms.draftHint")}</p>
      </div>

      {/* ── The sections ───────────────────────────────────────────────── */}
      {blocks.length === 0 ? (
        <div className="panel rounded-2xl p-8 text-center sm:p-10">
          <p className="text-sm font-semibold">{t("cms.emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{t("cms.emptyBody")}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {slug === "home" && (
              <Button size="sm" variant="secondary" disabled={pending}
                onClick={() => run(seedHomeBlocksAction(pageId), () => toast.success(t("common.saved")))}>
                {t("cms.seed")}
              </Button>
            )}
            {!isLaunch && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus size={14} aria-hidden />{t("cms.addBlock")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {blocks.map((b, i) => (
            <li key={b.id}
              className={cn("panel rounded-2xl px-4 py-3", !b.visible && "opacity-55")}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-display text-xs tabular-nums text-faint">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{sectionName(t, b.type)}</span>
                  <span className="block truncate text-[12px] text-muted">{summarize(b, locale) || "—"}</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => setEditing(b)}>
                  {t("common.edit")}
                </Button>
              </div>
              {!isLaunch && (
                <div className="mt-2 flex items-center gap-0.5 border-t border-line pt-2">
                  <IconBtn title={t("cms.moveUp")} disabled={pending || i === 0}
                    onClick={() => run(moveCmsBlockAction(b.id, "up"))}><ArrowUp size={15} /></IconBtn>
                  <IconBtn title={t("cms.moveDown")} disabled={pending || i === blocks.length - 1}
                    onClick={() => run(moveCmsBlockAction(b.id, "down"))}><ArrowDown size={15} /></IconBtn>
                  <IconBtn title={b.visible ? t("cms.hide") : t("cms.show")} disabled={pending}
                    onClick={() => run(saveCmsBlockAction({
                      id: b.id, pageId, type: b.type, content: b.content as never, visible: !b.visible,
                    }))}>
                    {b.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                  </IconBtn>
                  <IconBtn title={t("cms.duplicate")} disabled={pending}
                    onClick={() => run(duplicateCmsBlockAction(b.id))}><Copy size={15} /></IconBtn>
                  <span className="flex-1" />
                  <IconBtn title={t("common.delete")} disabled={pending}
                    onClick={() => setDeleting(b)}><Trash2 size={15} /></IconBtn>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {blocks.length > 0 && !isLaunch && (
        <div className="mt-4">
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden />{t("cms.addBlock")}
          </Button>
        </div>
      )}

      {/* ── Add: pick a section type by its name, not its slug ─────────── */}
      <Modal open={adding} onClose={() => setAdding(false)} title={t("cms.addBlock")} wide>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SECTION_TYPES.map((type) => (
            <li key={type}>
              <button type="button"
                onClick={() => { setAdding(false); setEditing({ type, visible: true, content: {} }); }}
                className="panel panel-interactive w-full rounded-xl px-3 py-3 text-left text-[13px] font-medium">
                {sectionName(t, type)}
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      {/* ── Edit one section ───────────────────────────────────────────── */}
      <Modal open={!!editing} onClose={() => setEditing(null)}
        title={editing ? sectionName(t, editing.type) : ""} wide>
        {editing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg bg-sunken/80 p-1">
                {LOCALES.map((l) => (
                  <button key={l} type="button" onClick={() => setLocale(l)}
                    className={cn("rounded-md px-3 py-1.5 text-[11.5px] font-semibold uppercase transition-colors",
                      l === locale ? "bg-surface text-accent shadow-e1" : "text-muted hover:text-ink")}>
                    {l}
                  </button>
                ))}
              </div>
              {!isLaunch && (
                <label className="ml-auto flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={editing.visible}
                    className="h-4 w-4 accent-[rgb(var(--accent))]"
                    onChange={(e) => setEditing({ ...editing, visible: e.target.checked })} />
                  {t("cms.visible")}
                </label>
              )}
            </div>

            {fieldsFor(editing.type).map((def) => (
              <Field key={def.key} def={def} locale={locale} content={editing.content}
                onChange={(content) => setEditing({ ...editing, content })}
                onChangeWith={(update) =>
                  setEditing((prev) => (prev ? { ...prev, content: update(prev.content) } : prev))} />
            ))}

            {/* The action row is inside the scrolling sheet, so on a phone it
                is reached by scrolling rather than hidden under the dock. */}
            <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:backdrop-blur-none">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
              <Button disabled={pending} onClick={saveSection} data-section-save>
                {t("cms.saveSection")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)}
        onConfirm={() => { if (deleting) run(deleteCmsBlockAction(deleting.id), () => setDeleting(null)); }}
        title={t("common.delete")} body={t("common.confirmDelete")}
        confirmLabel={t("common.delete")} danger pending={pending} />
    </div>
  );
}

/** One schema-driven input. Every branch renders a real label — never a key. */
function Field({ def, locale, content, onChange, onChangeWith }: {
  def: FieldDef; locale: Locale; content: CmsBlockContent;
  onChange: (content: CmsBlockContent) => void;
  /** Apply an edit to the LATEST content, for fields that write twice. */
  onChangeWith: (update: (content: CmsBlockContent) => CmsBlockContent) => void;
}) {
  const { t } = useI18n();
  const label = t(`cms.label.${def.label}`);
  const hint = def.hint ? t(`cms.label.${def.hint}`) : undefined;
  const value = readField(content, def, locale);
  const set = (next: string) => onChange(writeField(content, def, locale, next));
  const localized = def.kind === "text" || def.kind === "textarea";
  const id = `cms-${def.key.replace(/\./g, "-")}`;

  if (def.kind === "items") {
    return <ItemsField label={label} locale={locale} content={content} onChange={onChange} />;
  }

  if (def.kind === "media") {
    // The picker can set the URL and the alt text in the same tick (choosing a
    // library image seeds its alt). Both writes must build on the SAME latest
    // content or the second silently discards the first — hence the functional
    // updater rather than two independent writeField calls.
    const altDef: FieldDef = { ...def, key: "alt", kind: "text" };
    return (
      <div>
        <MediaPicker
          value={value}
          onChange={(url) => onChangeWith((c) => writeField(c, def, locale, url))}
          label={label}
          kind={def.key === "posterUrl" ? "image" : "any"}
          alt={def.key === "mediaUrl" ? readField(content, altDef, locale) : undefined}
          onAltChange={def.key === "mediaUrl"
            ? (next) => onChangeWith((c) => writeField(c, altDef, locale, next))
            : undefined}
        />
        {hint && <p className="mt-1.5 text-[11.5px] text-faint">{hint}</p>}
      </div>
    );
  }

  if (def.kind === "align") {
    return (
      <div>
        <Label htmlFor={id}>{label}</Label>
        <Select id={id} value={value || "right"} onChange={(e) => set(e.target.value)}>
          <option value="right">{t("cms.alignRight")}</option>
          <option value="left">{t("cms.alignLeft")}</option>
        </Select>
      </div>
    );
  }

  return (
    <div>
      <Label htmlFor={id} hint={localized ? locale.toUpperCase() : undefined}>{label}</Label>
      {def.kind === "textarea"
        ? <Textarea id={id} rows={3} value={value} onChange={(e) => set(e.target.value)} />
        : <Input id={id} value={value} inputMode={def.kind === "url" ? "url" : undefined}
            placeholder={def.kind === "url" ? "https://…" : undefined}
            onChange={(e) => set(e.target.value)} />}
      {hint && <p className="mt-1.5 text-[11.5px] text-faint">{hint}</p>}
    </div>
  );
}

/** The repeatable list — cards, steps, questions, contact rows. */
function ItemsField({ label, locale, content, onChange }: {
  label: string; locale: Locale; content: CmsBlockContent;
  onChange: (content: CmsBlockContent) => void;
}) {
  const { t } = useI18n();
  const items: CmsItem[] = content.items ?? [];
  const setItems = (next: CmsItem[]) => onChange({ ...content, items: next });
  const patch = (i: number, part: Partial<CmsItem>) =>
    setItems(items.map((x, j) => (j === i ? { ...x, ...part } : x)));
  const text = (item: CmsItem, key: "title" | "description") =>
    ((item[key] ?? {}) as LocaleText)[locale] ?? "";
  const setText = (i: number, key: "title" | "description", value: string) =>
    patch(i, { [key]: { ...((items[i][key] ?? {}) as LocaleText), [locale]: value } });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <Button size="sm" variant="secondary" onClick={() => setItems([...items, {}])}>
          <Plus size={13} aria-hidden />{t("cms.addItem")}
        </Button>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="rounded-xl border border-line bg-sunken/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
                {i + 1}
              </span>
              <div className="flex items-center gap-0.5">
                <IconBtn title={t("cms.moveUp")} disabled={i === 0}
                  onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setItems(n); }}>
                  <ArrowUp size={14} />
                </IconBtn>
                <IconBtn title={t("cms.moveDown")} disabled={i === items.length - 1}
                  onClick={() => { const n = [...items]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setItems(n); }}>
                  <ArrowDown size={14} />
                </IconBtn>
                <IconBtn title={t("common.delete")}
                  onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </IconBtn>
              </div>
            </div>
            <div className="space-y-2">
              <Input placeholder={t("cms.label.itemTitle")} value={text(item, "title")}
                onChange={(e) => setText(i, "title", e.target.value)} />
              <Textarea rows={2} placeholder={t("cms.label.itemBody")} value={text(item, "description")}
                onChange={(e) => setText(i, "description", e.target.value)} />
              <div className="grid gap-2 sm:grid-cols-3">
                <Input placeholder={t("cms.label.itemMedia")} value={item.mediaUrl ?? ""}
                  onChange={(e) => patch(i, { mediaUrl: e.target.value || undefined })} />
                <Input placeholder={t("cms.label.itemUrl")} value={item.url ?? ""}
                  onChange={(e) => patch(i, { url: e.target.value || undefined })} />
                {/* Stats sections render this instead of a title — dropping it
                    would make that section type impossible to author. */}
                <Input placeholder={t("cms.label.itemValue")} value={item.value ?? ""}
                  onChange={(e) => patch(i, { value: e.target.value || undefined })} />
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-faint">
            {t("cms.noItems")}
          </p>
        )}
      </div>
    </div>
  );
}

function sectionName(t: (k: string) => string, type: string): string {
  return type === "launch" ? t("cms.sectionTypeLaunch") : t(`cms.sectionType.${type}`);
}

/** A one-line hint of what is in a section, so the list is scannable. */
function summarize(block: BlockRow, locale: string): string {
  const c = block.content;
  const pick = (text: LocaleText | undefined) =>
    (text as Record<string, string | undefined> | undefined)?.[locale] ?? text?.pl ?? "";
  const direct = pick(c.title) || pick(c.subtitle) || pick(c.description);
  if (direct) return direct;
  const bag = c.fields ?? {};
  return pick(bag["hero.h1"]) || pick(bag["hero.badge"]) || "";
}

function IconBtn({ children, onClick, disabled, title }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; title: string;
}) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-35">
      {children}
    </button>
  );
}
