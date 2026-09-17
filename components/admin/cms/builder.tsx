"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import {
  ArrowLeft, Check, ChevronDown, Copy, ExternalLink, Eye, EyeOff, GripVertical,
  BookmarkPlus, History, Loader2, Maximize2, Monitor, Plus, Redo2, Rows3, Search, Settings2,
  Smartphone, Tablet, Trash2, Undo2, X as XIcon,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  saveBlockAction, reorderBlocksAction, duplicateBlockAction, deleteBlockAction,
  publishPageAction, unpublishPageAction, applySectionTemplateAction,
  saveSectionTemplateAction,
} from "@/app/actions/cms";
import { SECTION_GROUPS, type CmsBlockContent, type CmsCode, type SectionStyle } from "@/lib/cms";
import { DEVICE_PRESETS, type DeviceKind } from "@/lib/cms-style";
import { fieldsFor, splitFields } from "@/lib/cms-schema";
import type { BlockRow, PageRow, SectionTemplateRow } from "@/lib/services/cms";
import { Button } from "@/components/ui/button";
import { Modal, ConfirmModal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Field, LocaleTabs, type Locale } from "./fields";
import { StylePanel, ResponsivePanel } from "./style-panel";
import { CodePanel } from "./code-panel";
import { cn, formatDate } from "@/lib/utils";

/**
 * THE PAGE BUILDER.
 *
 * Three columns on a desktop — the section list, the page as a visitor sees
 * it, and the settings for whatever is selected. One column at a time on a
 * phone, because a three-column layout squeezed onto 390px is three unusable
 * columns rather than one workable screen.
 *
 * THE PREVIEW IS A REAL IFRAME pointed at the real draft route. That is the
 * only way a preview can answer "does this work on a phone": a container
 * scaled with a transform looks the part and still reports the desktop
 * viewport, so every media query in the page lies. The frame is resized to
 * true device widths from lib/cms-style.ts, and what renders inside it is
 * exactly what /podglad/<slug> renders.
 *
 * AUTOSAVE is debounced and per section. It saves the section being edited a
 * second or so after typing stops — not on every keystroke, and never the
 * whole page. The status line says which of the three things is true:
 * zapisywanie, zapisano, or błąd zapisu, and an error is never silent.
 *
 * NOTHING HERE IS PUBLIC. This module and everything it imports are loaded by
 * the admin route only; the public renderer shares the section components and
 * none of this.
 */

type Tab = "content" | "style" | "responsive" | "code";
type Pane = "tree" | "editor" | "preview";

const SAVE_DELAY = 1200;
/** Far more undo than anyone uses, and still bounded. */
const HISTORY_LIMIT = 60;

type Draft = {
  id: string;
  type: string;
  visible: boolean;
  content: CmsBlockContent;
  style: SectionStyle;
  code: CmsCode;
  analyticsId: string | null;
  anchor: string | null;
  showFrom: string | null;
  showUntil: string | null;
  audience: string;
};

const toDraft = (b: BlockRow): Draft => ({
  id: b.id,
  type: b.type,
  visible: b.visible,
  content: b.content ?? {},
  style: b.style ?? {},
  code: b.code ?? {},
  analyticsId: b.analytics_id ?? null,
  anchor: b.anchor ?? null,
  showFrom: b.show_from ?? null,
  showUntil: b.show_until ?? null,
  audience: b.audience ?? "everyone",
});

export function Builder({ page, blocks: initial, templates = [], previewPath }: {
  page: PageRow;
  blocks: BlockRow[];
  /** Sections saved earlier with "Zapisz jako szablon", offered in the
   *  picker under «Moje sekcje». */
  templates?: SectionTemplateRow[];
  /** /podglad/<slug> — the draft, rendered as a visitor would see it. */
  previewPath: string;
}) {
  const { t, locale: uiLocale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [blocks, setBlocks] = useState<Draft[]>(() => initial.map(toDraft));
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>("content");
  const [locale, setLocale] = useState<Locale>("pl");
  const [device, setDevice] = useState<DeviceKind>("desktop");
  const [width, setWidth] = useState<number>(DEVICE_PRESETS.desktop[0]);
  const [pane, setPane] = useState<Pane>("tree");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  /** Quick edit: the rarely-used half of a section's fields, folded away. */
  const [showAdvanced, setShowAdvanced] = useState(false);
  /** The section list, and the picker, both searchable once a page is long. */
  const [treeQuery, setTreeQuery] = useState("");
  const [pickQuery, setPickQuery] = useState("");
  /** Compact hides the summary line, so a thirty-section page reorders in
   *  one screen instead of three. */
  const [compact, setCompact] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);

  /** Undo/redo over the whole section list. Snapshots are taken BEFORE a
   *  change, so undo restores the state the person was looking at. */
  const past = useRef<Draft[][]>([]);
  const future = useRef<Draft[][]>([]);
  const [historyTick, setHistoryTick] = useState(0);

  const active = blocks.find((b) => b.id === activeId) ?? null;

  // Every section opens on its quick fields. Leaving "advanced" latched on
  // from the previous section is how the wall of inputs comes back.
  useEffect(() => { setShowAdvanced(false); }, [activeId]);

  const remember = useCallback((snapshot: Draft[]) => {
    past.current = [...past.current.slice(-HISTORY_LIMIT + 1), snapshot];
    future.current = [];
    setHistoryTick((n) => n + 1);
  }, []);

  /* ── SAVING ───────────────────────────────────────────────────────────── */

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<Draft | null>(null);

  const persist = useCallback(async (draft: Draft) => {
    setSaveState("saving");
    const res = await saveBlockAction({
      id: draft.id,
      pageId: page.id,
      type: draft.type,
      content: draft.content,
      style: draft.style,
      code: draft.code,
      visible: draft.visible,
      analyticsId: draft.analyticsId,
      anchor: draft.anchor,
      showFrom: draft.showFrom,
      showUntil: draft.showUntil,
      audience: draft.audience,
    });
    if (res.ok) {
      setSaveState("saved");
      // The preview reads the database, so it only becomes correct once the
      // save has landed.
      setPreviewNonce((n) => n + 1);
    } else {
      setSaveState("error");
      toast.error(t(`cms.err.${res.error}`));
    }
  }, [page.id, t]);

  /** Queue a section for saving. Restarting the timer on each edit is what
   *  makes this "a moment after typing stops" rather than per keystroke. */
  const scheduleSave = useCallback((draft: Draft) => {
    queued.current = draft;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = queued.current;
      queued.current = null;
      if (next) void persist(next);
    }, SAVE_DELAY);
  }, [persist]);

  /** Write the pending edit out now — before leaving the page, and when the
   *  admin presses Publish. An autosave that had not fired yet must not be
   *  the difference between what is on screen and what is published. */
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const next = queued.current;
    queued.current = null;
    if (next) await persist(next);
  }, [persist]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => {
    // A tab closed mid-edit loses at most the last second of typing, and the
    // browser is told there is something unsaved.
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!queued.current) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  /** Apply an edit to the active section: update the list, remember the
   *  previous state for undo, and queue the save. */
  const edit = useCallback((part: Partial<Draft>) => {
    setBlocks((prev) => {
      remember(prev);
      const next = prev.map((b) => (b.id === activeId ? { ...b, ...part } : b));
      const updated = next.find((b) => b.id === activeId);
      if (updated) scheduleSave(updated);
      return next;
    });
  }, [activeId, remember, scheduleSave]);

  function undo() {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(blocks);
    setBlocks(previous);
    setHistoryTick((n) => n + 1);
    const restored = previous.find((b) => b.id === activeId);
    if (restored) scheduleSave(restored);
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(blocks);
    setBlocks(next);
    setHistoryTick((n) => n + 1);
    const restored = next.find((b) => b.id === activeId);
    if (restored) scheduleSave(restored);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      // Inside a text field the browser's own undo is the right one.
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ── SERVER OPERATIONS ────────────────────────────────────────────────── */

  const run = (p: Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      const res = await p;
      if (res.ok) { done?.(); setPreviewNonce((n) => n + 1); router.refresh(); }
      else toast.error(t(`cms.err.${res.error ?? "generic"}`));
    });

  function addSection(type: string) {
    setAdding(false);
    start(async () => {
      const res = await saveBlockAction({
        pageId: page.id, type, content: {}, visible: true,
        style: {}, code: {},
      });
      if (!res.ok || !res.data) { toast.error(t(`cms.err.${res.ok ? "generic" : res.error}`)); return; }
      const created: Draft = {
        id: res.data.id, type, visible: true, content: {}, style: {}, code: {},
        analyticsId: null, anchor: null,
        showFrom: null, showUntil: null, audience: "everyone",
      };
      setBlocks((prev) => { remember(prev); return [...prev, created]; });
      setActiveId(created.id);
      setTab("content");
      setPane("editor");
      setPreviewNonce((n) => n + 1);
    });
  }

  /** The picker, filtered. Matching the translated NAME is the point: the
   *  admin is looking for "Odliczanie", not for `countdown`. */
  const pickedGroups = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    return SECTION_GROUPS
      .map((g) => ({
        key: g.key,
        types: g.types.filter((type) =>
          !q || t(`cms.sectionType.${type}`).toLowerCase().includes(q) || type.includes(q)),
      }))
      .filter((g) => g.types.length > 0);
  }, [pickQuery, t]);

  const matchingTemplates = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((tpl) => tpl.name.toLowerCase().includes(q));
  }, [templates, pickQuery]);

  /** Drop a saved section onto this page. */
  function addFromTemplate(templateId: string) {
    setAdding(false);
    setPickQuery("");
    start(async () => {
      const res = await applySectionTemplateAction({ pageId: page.id, templateId });
      if (!res.ok) { toast.error(t(`cms.err.${res.error}`)); return; }
      setPreviewNonce((n) => n + 1);
      router.refresh();
    });
  }

  /** Keep this section for the next page. */
  function saveAsTemplate(block: Draft) {
    const name = window.prompt(t("cms.templateNamePrompt"),
      t(`cms.sectionType.${block.type}`));
    if (!name?.trim()) return;
    start(async () => {
      const res = await saveSectionTemplateAction({ name, blockId: block.id });
      if (res.ok) { toast.success(t("cms.templateSaved")); router.refresh(); }
      else toast.error(t(`cms.err.${res.error}`));
    });
  }

  /**
   * DELETING A SECTION IS UNDOABLE FOR A FEW SECONDS.
   *
   * The confirmation stops the accident; the toast catches the confirmed
   * mistake, which is the more common one. Undo re-creates the block from
   * the copy held here and puts it back where it was — same content, same
   * style, same code, same position. Only the id changes, and nothing
   * pointed at the old one.
   */
  function removeSection(block: Draft) {
    const index = blocks.findIndex((b) => b.id === block.id);
    run(deleteBlockAction(block.id), () => {
      setBlocks((prev) => { remember(prev); return prev.filter((b) => b.id !== block.id); });
      if (activeId === block.id) setActiveId(null);
      setDeleting(null);
      toast.success(t("cms.sectionDeleted"), {
        action: {
          label: t("cms.undoDelete"),
          onClick: () => restoreSection(block, index),
        },
      });
    });
  }

  function restoreSection(block: Draft, index: number) {
    start(async () => {
      const res = await saveBlockAction({
        pageId: page.id, type: block.type, content: block.content,
        style: block.style, code: block.code, visible: block.visible,
        analyticsId: block.analyticsId, anchor: block.anchor,
        showFrom: block.showFrom, showUntil: block.showUntil, audience: block.audience,
      });
      if (!res.ok || !res.data) { toast.error(t(`cms.err.${res.ok ? "generic" : res.error}`)); return; }
      const restored: Draft = { ...block, id: res.data.id };
      const next = [...blocks];
      next.splice(Math.max(0, Math.min(index, next.length)), 0, restored);
      setBlocks(next);
      setActiveId(restored.id);
      // It came back last in the database; put the order back to what it was.
      await reorderBlocksAction(page.id, next.map((b) => b.id));
      setPreviewNonce((n) => n + 1);
      router.refresh();
    });
  }

  function commitOrder(ordered: Draft[]) {
    setBlocks((prev) => { remember(prev); return ordered; });
    run(reorderBlocksAction(page.id, ordered.map((b) => b.id)));
  }

  function move(id: string, delta: number) {
    const from = blocks.findIndex((b) => b.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    [next[from], next[to]] = [next[to], next[from]];
    commitOrder(next);
  }

  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = blocks.findIndex((b) => b.id === dragId);
    const to = blocks.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDragId(null);
    commitOrder(next);
  }

  function publish() {
    start(async () => {
      // Whatever is still queued goes first, so Publish never ships the
      // version from a second ago.
      await flush();
      const res = await publishPageAction(page.id);
      if (res.ok) { toast.success(t("cms.publishedToast")); setPreviewNonce((n) => n + 1); router.refresh(); }
      else toast.error(t(`cms.err.${res.error}`));
    });
  }

  const published = page.status === "published";
  const previewSrc = `${previewPath}?v=${previewNonce}`;
  const widths = DEVICE_PRESETS[device];

  useEffect(() => { setWidth(DEVICE_PRESETS[device][0]); }, [device]);

  const fields = useMemo(() => (active ? fieldsFor(active.type) : []), [active]);
  const { quick, advanced } = useMemo(
    () => (active ? splitFields(active.type, fields) : { quick: [], advanced: [] }),
    [active, fields],
  );

  /** The sections a search in the left column leaves standing. Matching the
   *  TYPE NAME as well as the text is what makes "faq" find the FAQ. */
  const visibleBlocks = useMemo(() => {
    const q = treeQuery.trim().toLowerCase();
    if (!q) return blocks;
    return blocks.filter((b) =>
      t(`cms.sectionType.${b.type}`).toLowerCase().includes(q)
      || b.type.includes(q)
      || summarize(b, locale).toLowerCase().includes(q));
  }, [blocks, treeQuery, t, locale]);

  /* ── RENDER ───────────────────────────────────────────────────────────── */

  return (
    <div data-cms-builder className="min-w-0">
      {/* ── TOOLBAR ────────────────────────────────────────────────────── */}
      <div className="panel mb-3 rounded-2xl px-3 py-2.5" data-builder-toolbar>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/www" aria-label={t("cms.pagesTitle")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
            <ArrowLeft size={16} aria-hidden />
          </Link>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{page.title}</span>
            <span className="block text-[11px] text-faint">
              /{page.slug === "home" ? "" : page.slug}
            </span>
          </span>

          <Badge tone={published ? "success" : "accent"}>
            {t(`cms.status.${page.status}`)}
          </Badge>
          {page.publishedAt && (
            <span className="hidden text-[11.5px] text-faint xl:inline">
              {formatDate(page.publishedAt, uiLocale)}
            </span>
          )}

          <span className="flex-1" />

          <SaveStatus state={saveState} t={t} />

          <div className="hidden items-center gap-0.5 xl:flex">
            <IconBtn title={t("cms.undo")} disabled={past.current.length === 0} onClick={undo}>
              <Undo2 size={15} />
            </IconBtn>
            <IconBtn title={t("cms.redo")} disabled={future.current.length === 0} onClick={redo}>
              <Redo2 size={15} />
            </IconBtn>
          </div>

          <Link href={`/admin/www/${page.slug}/ustawienia`} title={t("cms.pageSettings")}
            aria-label={t("cms.pageSettings")} data-page-settings
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
            <Settings2 size={15} aria-hidden />
          </Link>
          <Link href={`/admin/www/${page.slug}/historia`} title={t("cms.history")}
            aria-label={t("cms.history")} data-page-history
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
            <History size={15} aria-hidden />
          </Link>
          <a href={previewPath} target="_blank" rel="noreferrer" data-page-preview
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium transition-colors hover:bg-raised">
            {t("cms.preview")}<ExternalLink size={12} aria-hidden />
          </a>
          <Button size="sm" disabled={pending} onClick={publish} data-page-publish>
            {pending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : null}
            {t("cms.publish")}
          </Button>
          {published && (
            <Button size="sm" variant="ghost" disabled={pending}
              onClick={() => run(unpublishPageAction(page.id), () => toast.success(t("common.saved")))}>
              {t("cms.unpublish")}
            </Button>
          )}
        </div>

        {/* Which panel is on screen below xl, where three columns do not fit. */}
        <div className="mt-2.5 flex rounded-lg bg-sunken/80 p-1 xl:hidden" data-pane-switch>
          {(["tree", "editor", "preview"] as Pane[]).map((p) => (
            <button key={p} type="button" onClick={() => setPane(p)} aria-pressed={pane === p}
              className={cn("flex-1 rounded-md px-3 py-2 text-[12px] font-semibold transition-colors",
                pane === p ? "bg-surface text-accent shadow-e1" : "text-muted hover:text-ink")}>
              {t(`cms.pane.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* ── THE THREE COLUMNS ──────────────────────────────────────────── */}
      <div className="grid min-w-0 gap-3 xl:grid-cols-[clamp(240px,18vw,300px)_minmax(0,1fr)_clamp(320px,24vw,400px)]">

        {/* LEFT — the sections, in order */}
        <aside className={cn("min-w-0", pane === "tree" ? "" : "hidden xl:block")}>
          <div className="panel rounded-2xl p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">
                {t("cms.sections")}
              </h2>
              <span className="flex items-center gap-1">
                <TinyBtn title={t(compact ? "cms.viewDetailed" : "cms.viewCompact")}
                  onClick={() => setCompact((v) => !v)}>
                  <Rows3 size={13} />
                </TinyBtn>
                <span className="text-[11px] tabular-nums text-faint">{blocks.length}</span>
              </span>
            </div>

            {/* A thirty-section page is exactly when "scroll and look" stops
                working. Matching the type name too is what makes "faq" find
                the FAQ on a page whose FAQ heading is still empty. */}
            {blocks.length > 6 && (
              <div className="relative mb-2">
                <Search size={13} aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input value={treeQuery} onChange={(e) => setTreeQuery(e.target.value)}
                  data-section-search placeholder={t("cms.searchSections")}
                  aria-label={t("cms.searchSections")}
                  className="h-9 w-full rounded-lg border border-line bg-sunken/50 pl-8 pr-7 text-[12.5px] outline-none transition-colors focus:border-[rgb(var(--accent)/0.5)]" />
                {treeQuery && (
                  <button type="button" onClick={() => setTreeQuery("")}
                    aria-label={t("common.clear")}
                    className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-faint hover:bg-raised hover:text-ink">
                    <XIcon size={12} aria-hidden />
                  </button>
                )}
              </div>
            )}

            <ul className="space-y-1" data-section-tree>
              {visibleBlocks.map((b, i) => (
                <li key={b.id}
                  draggable
                  onDragStart={() => setDragId(b.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropOn(b.id)}
                  className={cn(
                    "group flex items-center gap-1.5 rounded-xl border px-2 py-2 transition-colors",
                    b.id === activeId ? "border-accent/45 bg-accent-soft/35" : "border-transparent hover:bg-raised",
                    dragId === b.id && "opacity-50",
                    !b.visible && "opacity-55",
                  )}
                  data-section-item={b.type}>
                  <span aria-hidden className="cursor-grab text-faint active:cursor-grabbing">
                    <GripVertical size={14} />
                  </span>
                  <button type="button" className="min-w-0 flex-1 text-left"
                    onClick={() => { setActiveId(b.id); setTab("content"); setPane("editor"); }}>
                    <span className="block truncate text-[13px] font-medium">
                      {t(`cms.sectionType.${b.type}`)}
                    </span>
                    {!compact && (
                      <span className="block truncate text-[11px] text-faint">
                        {summarize(b, locale) || `#${i + 1}`}
                      </span>
                    )}
                  </button>
                  <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <TinyBtn title={b.visible ? t("cms.hide") : t("cms.show")}
                      onClick={() => {
                        setBlocks((prev) => { remember(prev); return prev; });
                        const next = { ...b, visible: !b.visible };
                        setBlocks((prev) => prev.map((x) => (x.id === b.id ? next : x)));
                        void persist(next);
                      }}>
                      {b.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </TinyBtn>
                    <TinyBtn title={t("cms.duplicate")} disabled={pending}
                      onClick={() => run(duplicateBlockAction(b.id))}>
                      <Copy size={13} />
                    </TinyBtn>
                    <TinyBtn title={t("cms.saveAsTemplate")} disabled={pending}
                      onClick={() => saveAsTemplate(b)}>
                      <BookmarkPlus size={13} />
                    </TinyBtn>
                    <TinyBtn title={t("common.delete")} onClick={() => setDeleting(b)}>
                      <Trash2 size={13} />
                    </TinyBtn>
                  </span>
                </li>
              ))}
            </ul>

            {blocks.length === 0 && (
              <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-faint">
                {t("cms.emptyBody")}
              </p>
            )}
            {blocks.length > 0 && visibleBlocks.length === 0 && (
              <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-faint">
                {t("cms.searchNothing")}
              </p>
            )}

            <Button size="sm" variant="secondary" className="mt-2 w-full"
              onClick={() => setAdding(true)} data-add-section>
              <Plus size={14} aria-hidden />{t("cms.addBlock")}
            </Button>

            {/* Reordering by keyboard, and on a touch screen where a drag is
                a scroll. Same operation, reachable two ways. */}
            {active && blocks.length > 1 && (
              <div className="mt-2 flex gap-1.5 border-t border-line pt-2">
                <Button size="sm" variant="ghost" className="flex-1"
                  disabled={blocks[0]?.id === active.id}
                  onClick={() => move(active.id, -1)}>↑ {t("cms.moveUp")}</Button>
                <Button size="sm" variant="ghost" className="flex-1"
                  disabled={blocks[blocks.length - 1]?.id === active.id}
                  onClick={() => move(active.id, 1)}>↓ {t("cms.moveDown")}</Button>
              </div>
            )}
          </div>
        </aside>

        {/* CENTRE — the page itself */}
        <section className={cn("min-w-0", pane === "preview" ? "" : "hidden xl:block")}>
          <div className="panel overflow-hidden rounded-2xl">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <div className="flex rounded-lg bg-sunken/80 p-1">
                {(["desktop", "tablet", "mobile"] as DeviceKind[]).map((d) => (
                  <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d}
                    title={t(`cms.device.${d}`)} aria-label={t(`cms.device.${d}`)}
                    className={cn("rounded-md px-2.5 py-1.5 transition-colors",
                      device === d ? "bg-surface text-accent shadow-e1" : "text-muted hover:text-ink")}>
                    {d === "desktop" ? <Monitor size={15} aria-hidden />
                      : d === "tablet" ? <Tablet size={15} aria-hidden />
                      : <Smartphone size={15} aria-hidden />}
                  </button>
                ))}
              </div>
              {/* ONE WIDTH AT A TIME. Seven buttons side by side was a row of
                  numbers to decode; the device is the choice, the exact width
                  is a refinement of it. */}
              <select value={width} onChange={(e) => setWidth(Number(e.target.value))}
                aria-label={t("cms.previewWidth")} data-preview-width
                className="h-8 rounded-lg border border-line bg-surface px-2 text-[11.5px] font-medium tabular-nums text-muted outline-none">
                {widths.map((w) => <option key={w} value={w}>{w} px</option>)}
              </select>
              <span className="ml-auto flex items-center gap-1.5">
                <span className="hidden text-[11px] text-faint sm:inline">{t("cms.previewDraft")}</span>
                <IconBtn title={t("cms.fullscreenPreview")} onClick={() => setFullscreen(true)}>
                  <Maximize2 size={14} />
                </IconBtn>
              </span>
            </div>

            {/* The frame is the real page at a real width. Centred and
                horizontally scrollable, because 1920 does not fit in a column
                on a 1440 screen and shrinking it would be the lie. */}
            <div className="thin-scroll overflow-x-auto bg-sunken/40 p-3">
              <iframe
                key={previewNonce}
                src={previewSrc}
                title={t("cms.preview")}
                data-cms-frame
                style={{ width, height: "min(74vh, 900px)" }}
                className="mx-auto block rounded-xl border border-line bg-bg shadow-e1"
              />
            </div>
          </div>
        </section>

        {/* RIGHT — the selected section */}
        <aside className={cn("min-w-0", pane === "editor" ? "" : "hidden xl:block")}>
          <div className="panel rounded-2xl">
            {!active ? (
              <p className="px-4 py-10 text-center text-[13px] text-muted">{t("cms.selectSection")}</p>
            ) : (
              <>
                {/* ← WSZYSTKIE SEKCJE. One tap back to the list on a phone,
                    where the list and the editor are the same column. */}
                <button type="button" onClick={() => setPane("tree")} data-back-to-sections
                  className="flex w-full items-center gap-1.5 border-b border-line px-3 py-2 text-[12px] font-semibold text-muted transition-colors hover:text-ink xl:hidden">
                  <ArrowLeft size={14} aria-hidden />{t("cms.allSections")}
                </button>

                <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                  <Settings2 size={15} aria-hidden className="text-faint" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                    {t(`cms.sectionType.${active.type}`)}
                  </span>
                  <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
                    <input type="checkbox" checked={active.visible}
                      className="h-3.5 w-3.5 accent-[rgb(var(--accent))]"
                      onChange={(e) => edit({ visible: e.target.checked })} />
                    {t("cms.visible")}
                  </label>
                </div>

                <div className="flex gap-0.5 border-b border-line px-2 py-1.5">
                  {(["content", "style", "responsive", "code"] as Tab[]).map((k) => (
                    <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
                      data-settings-tab={k}
                      className={cn("flex-1 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold transition-colors",
                        tab === k ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-ink")}>
                      {t(`cms.tab.${k}`)}
                    </button>
                  ))}
                </div>

                <div className="thin-scroll max-h-[calc(100dvh-16rem)] space-y-4 overflow-y-auto p-3.5">
                  {tab === "content" && (
                    <>
                      <LocaleTabs locale={locale} onChange={setLocale} />
                      {fields.length === 0 && (
                        <p className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-[12px] text-faint">
                          {t("cms.noContentFields")}
                        </p>
                      )}
                      {quick.map((def) => (
                        <Field key={def.key} def={def} locale={locale} content={active.content}
                          onChange={(content) => edit({ content })}
                          onChangeWith={(update) => edit({ content: update(active.content) })} />
                      ))}

                      {/* WIĘCEJ USTAWIEŃ. The rest of the fields exist and
                          nothing was taken away — they are simply not the
                          thing you came here to change. */}
                      {advanced.length > 0 && (
                        <div className="border-t border-line pt-3">
                          <button type="button" onClick={() => setShowAdvanced((v) => !v)}
                            aria-expanded={showAdvanced} data-more-settings
                            className="flex w-full items-center justify-between rounded-lg px-1 py-2 text-[12.5px] font-semibold text-muted transition-colors hover:text-ink">
                            <span>{t("cms.moreSettings")}</span>
                            <ChevronDown size={15} aria-hidden
                              className={cn("transition-transform", showAdvanced && "rotate-180")} />
                          </button>
                          {showAdvanced && (
                            <div className="mt-2 space-y-4">
                              {advanced.map((def) => (
                                <Field key={def.key} def={def} locale={locale} content={active.content}
                                  onChange={(content) => edit({ content })}
                                  onChangeWith={(update) => edit({ content: update(active.content) })} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {tab === "style" && (
                    <StylePanel style={active.style} onChange={(style) => edit({ style })} />
                  )}

                  {tab === "responsive" && (
                    <ResponsivePanel style={active.style} onChange={(style) => edit({ style })} />
                  )}

                  {tab === "code" && (
                    <>
                      {active.type === "custom_code" ? (
                        <CodePanel code={active.code} sectionId={active.id}
                          onChange={(code) => edit({ code })} />
                      ) : (
                        <p className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-[12px] leading-relaxed text-faint">
                          {t("cms.code.onlyCustom")}
                        </p>
                      )}
                      {/* Available on EVERY section: an anchor and an event
                          name are page plumbing, not code. */}
                      <div className="space-y-3 border-t border-line pt-4">
                        <div>
                          <label htmlFor="cms-anchor" className="mb-1.5 block text-[12px] font-medium text-muted">
                            {t("cms.anchor")}
                          </label>
                          <Input id="cms-anchor" value={active.anchor ?? ""} spellCheck={false}
                            placeholder="cennik" onChange={(e) => edit({ anchor: e.target.value })} />
                          <p className="mt-1.5 text-[11px] text-faint">{t("cms.anchorHint")}</p>
                        </div>
                        <div>
                          <label htmlFor="cms-analytics" className="mb-1.5 block text-[12px] font-medium text-muted">
                            {t("cms.analyticsId")}
                          </label>
                          <Input id="cms-analytics" value={active.analyticsId ?? ""} spellCheck={false}
                            placeholder="homepage.hero.generate_click"
                            onChange={(e) => edit({ analyticsId: e.target.value })} />
                          <p className="mt-1.5 text-[11px] text-faint">{t("cms.analyticsHint")}</p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* ── ADD A SECTION ──────────────────────────────────────────────── */}
      <Modal open={adding} onClose={() => { setAdding(false); setPickQuery(""); }}
        title={t("cms.addBlock")} wide>
        <div className="space-y-5">
          <div className="relative">
            <Search size={14} aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} autoFocus
              data-picker-search placeholder={t("cms.searchSectionTypes")}
              aria-label={t("cms.searchSectionTypes")}
              className="h-10 w-full rounded-xl border border-line bg-sunken/50 pl-9 pr-3 text-[13px] outline-none transition-colors focus:border-[rgb(var(--accent)/0.5)]" />
          </div>

          {/* MOJE SEKCJE first, because a section you saved is one you meant
              to use again. Empty until something has been saved, and then it
              is the shortest path there is. */}
          {templates.length > 0 && matchingTemplates.length > 0 && (
            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
                {t("cms.myTemplates")}
              </h3>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {matchingTemplates.map((tpl) => (
                  <li key={tpl.id}>
                    <button type="button" onClick={() => addFromTemplate(tpl.id)}
                      data-template-choice={tpl.id}
                      className="panel panel-interactive w-full rounded-xl px-3 py-3 text-left">
                      <span className="block truncate text-[13px] font-medium">{tpl.name}</span>
                      <span className="block truncate text-[11px] text-faint">
                        {tpl.sectionType ? t(`cms.sectionType.${tpl.sectionType}`) : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pickedGroups.map((group) => (
            <div key={group.key}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
                {t(`cms.sectionGroup.${group.key}`)}
              </h3>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.types.map((type) => (
                  <li key={type}>
                    <button type="button" onClick={() => addSection(type)}
                      data-section-choice={type}
                      className="panel panel-interactive w-full rounded-xl px-3 py-3 text-left text-[13px] font-medium">
                      {t(`cms.sectionType.${type}`)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {pickedGroups.length === 0 && matchingTemplates.length === 0 && (
            <p className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-[12.5px] text-faint">
              {t("cms.searchNothing")}
            </p>
          )}
        </div>
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)}
        onConfirm={() => { if (deleting) removeSection(deleting); }}
        title={t("common.delete")} body={t("common.confirmDelete")}
        confirmLabel={t("common.delete")} danger pending={pending} />

      {/* ── FULL-SCREEN PREVIEW ─────────────────────────────────────────
          On a phone the preview column is a postage stamp inside an editor
          inside a panel. This is the same frame, at the width the device
          actually is, with nothing else on screen. */}
      {fullscreen && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-bg" data-preview-fullscreen>
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="text-[12.5px] font-semibold">{t("cms.preview")}</span>
            <span className="text-[11px] tabular-nums text-faint">{width} px</span>
            <span className="flex-1" />
            <button type="button" onClick={() => setFullscreen(false)}
              aria-label={t("cms.closePreview")} data-close-fullscreen
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
              <XIcon size={16} aria-hidden />
            </button>
          </div>
          <div className="thin-scroll flex-1 overflow-auto bg-sunken/40 p-2">
            <iframe key={`fs-${previewNonce}`} src={previewSrc} title={t("cms.preview")}
              data-cms-frame-full
              style={{ width, height: "100%", minHeight: "100%" }}
              className="mx-auto block rounded-lg border border-line bg-bg" />
          </div>
        </div>
      )}

      {/* Referenced so the history buttons re-render when the stacks change;
          refs do not trigger renders on their own. */}
      <span hidden data-history-tick={historyTick} />
    </div>
  );
}

/** Zapisywanie… / Zapisano / Błąd zapisu. Never silent, and never a lie: the
 *  state is set by the save itself, not by the fact that a key was pressed. */
function SaveStatus({ state, t }: { state: string; t: (k: string) => string }) {
  if (state === "idle") return null;
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted" data-save-state="saving">
        <Loader2 size={13} aria-hidden className="animate-spin" />{t("cms.saving")}
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted" data-save-state="saved">
        <Check size={13} aria-hidden className="text-accent" />{t("cms.saved")}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-medium text-danger" data-save-state="error">
      {t("cms.saveError")}
    </span>
  );
}

/** A one-line hint of what is in a section, so the tree is scannable. */
function summarize(block: Draft, locale: string): string {
  const c = block.content;
  const pick = (text: unknown) => {
    const bag = (text ?? {}) as Record<string, string | undefined>;
    return bag[locale] ?? bag.pl ?? "";
  };
  return pick(c.title) || pick(c.subtitle) || pick(c.description) || pick(c.html).slice(0, 60);
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

function TinyBtn({ children, onClick, disabled, title }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; title: string;
}) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-35">
      {children}
    </button>
  );
}
