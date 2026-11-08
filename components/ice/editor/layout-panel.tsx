"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";
import {
  GRID_LISTS, HOME_LOCALES, LIST_SECTION, NAME_MAX, SECTION_TOOL, SUB_MAX,
  addEntry, cleanHref, cleanText, entriesOf, gridSlotKey, isHomeSectionId, layoutKey, moveEntry, moveSection,
  refSlotKey, removeEntry, sectionItem, setEntryHidden, setSectionHidden, setSectionItem, updateEntry,
  type GridListKey, type HomeLayout, type HomeListKey, type HomeLocale, type HomePairEntry, type HomeSectionId,
  type HomeText, type HomeToolEntry, type ListEntry,
} from "@/lib/home-layout";
import { INDUSTRIES, UPLOAD_TOOLS } from "@/lib/seller-home-config";
import { CATALOG_ITEMS } from "@/lib/tool-cards";
import { CATEGORIES } from "@/lib/categories";
import type { IceAsset, IceHomeLayout, IceLocale, IceTransport } from "@/lib/ice/types";
import { clientPreviewStateAction, setClientPreviewAction } from "@/app/actions/features";
import { toolLabel, toolLine } from "@/components/seller-home/home-view";
import { UI_ATTR } from "./scan";
import { AssetThumb, useSlotStates, useSlotWriter } from "./media-panel";
import { Btn, LocaleTabs, Sheet, call, cls, errorText, type EditorCtx, type T } from "./shared";
import s from "./editor.module.css";

/**
 * „UKŁAD STRONY” — /home's sections and lists in „Edytuj stronę”
 * (lib/home-layout.ts, stored in public.home_layout, 0170).
 *
 *   the store     one document, the state the editor last read; every change
 *                 is a pure operation on it (lib/home-layout.ts), saved WHOLE
 *                 with the updated_at it was read at — one save at a time, in
 *                 order; a newer change from another tab is a conflict: the
 *                 store takes what is there now and says so, nothing is
 *                 overwritten. Every save is a history row (content_versions,
 *                 target "layout"); „Cofnij” saves the document before the
 *                 last change of this session back (action "restore").
 *   the panel     sections (visible, order, the button's tool, their items),
 *                 a list's items (order by drag or buttons, hide, edit,
 *                 remove with a confirmation and an undo, add), one item's
 *                 form (tool, own name/description per language, link,
 *                 industry, visibility; its pictures through the existing
 *                 picture panels — a grid photo also its product photo).
 *   the overlay   a small toolbar on every section of the page and, under a
 *                 mouse, on the item under it — the same operations in place.
 *
 * Removing an item takes it off the page only: the files stay in the
 * library, the tool and every generation are untouched, the slot number is
 * never reused (so its pictures come back with an undo).
 */

/* ── the store ─────────────────────────────────────────────────────────── */

export type HomeLayoutStore = {
  state: IceHomeLayout | null;
  error: string | null;
  busy: boolean;
  canUndo: boolean;
  /** Apply one operation to the CURRENT layout and save it. null = nothing to do. */
  apply: (op: (l: HomeLayout) => HomeLayout | null, done?: string) => Promise<HomeLayout | null>;
  undo: () => Promise<void>;
  /** Save a whole document from the history back (action "restore"). */
  restore: (doc: unknown) => Promise<boolean>;
  load: () => Promise<void>;
};

export function useHomeLayoutStore(transport: IceTransport, t: T, enabled: boolean, afterSave: () => Promise<void>): HomeLayoutStore {
  const [state, setState] = useState<IceHomeLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);
  const stateRef = useRef<IceHomeLayout | null>(null);
  const undoStack = useRef<HomeLayout[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  stateRef.current = state;

  const load = useCallback(async () => {
    if (!enabled || typeof transport.homeLayoutState !== "function") return;
    const res = await call(transport.homeLayoutState());
    if (res.ok) {
      setState(res.data);
      setError(null);
    } else setError(errorText(t, res.error));
  }, [enabled, t, transport]);
  useEffect(() => {
    void load();
  }, [load]);

  /** One save, after every save before it (each starts from the result of the last). */
  const save = useCallback((next: (cur: IceHomeLayout) => HomeLayout | null, action: "save" | "restore", done?: string, undoable = true) => {
    const run = queue.current.then(async (): Promise<HomeLayout | null> => {
      const cur = stateRef.current;
      if (!cur) return null;
      const doc = next(cur);
      if (!doc || layoutKey(doc) === layoutKey(cur.layout)) return null;
      setBusy(true);
      const res = await call(transport.homeLayoutSave({ doc, base: cur.updatedAt, action }));
      setBusy(false);
      if (!res.ok) {
        if (res.error === "conflict" && res.current && typeof res.current === "object") {
          // Another tab or admin changed the layout: show what is there now.
          stateRef.current = res.current as IceHomeLayout;
          setState(res.current as IceHomeLayout);
        }
        if (res.error !== "noop") notify.error(errorText(t, res.error));
        return null;
      }
      if (undoable) {
        undoStack.current.push(cur.layout);
        if (undoStack.current.length > 50) undoStack.current.shift();
        setUndoDepth(undoStack.current.length);
      }
      stateRef.current = res.data;
      setState(res.data);
      if (done) notify.success(done);
      await afterSave();
      return res.data.layout;
    });
    queue.current = run.catch(() => null);
    return run;
  }, [afterSave, t, transport]);

  const apply = useCallback((op: (l: HomeLayout) => HomeLayout | null, done?: string) => save((cur) => op(cur.layout), "save", done), [save]);
  const undo = useCallback(async () => {
    const prev = undoStack.current.pop();
    setUndoDepth(undoStack.current.length);
    if (!prev) return;
    const out = await save(() => prev, "restore", t("ice.layout.undone"), false);
    if (!out) {
      undoStack.current.push(prev);
      setUndoDepth(undoStack.current.length);
    }
  }, [save, t]);
  const restore = useCallback(async (doc: unknown) => {
    if (!doc || typeof doc !== "object") return false;
    return (await save(() => doc as HomeLayout, "restore", t("ice.restored"))) !== null;
  }, [save, t]);

  return { state, error, busy, canUndo: undoDepth > 0, apply, undo, restore, load };
}

/* ── labels and small helpers ─────────────────────────────────────────── */

export type LayoutView =
  | { at: "sections" }
  | { at: "list"; list: HomeListKey }
  | { at: "item"; list: HomeListKey; id: string };

/** The list a section's items live in. */
const SECTION_LIST: Partial<Record<HomeSectionId, HomeListKey>> = Object.fromEntries(
  (Object.entries(LIST_SECTION) as [HomeListKey, HomeSectionId][]).map(([k, sec]) => [sec, k]),
);
const isGrid = (k: HomeListKey): k is GridListKey => (GRID_LISTS as readonly string[]).includes(k);
const isToolList = (k: HomeListKey): k is "carousel" | "featured" => k === "carousel" || k === "featured";
const BULK_GROUP: Partial<Record<HomeListKey, string>> = { thumbnails: "thumbnails", sessions: "sessions", showcase: "showcase", beforeAfter: "beforeAfter" };

function entryLabel(t: T, k: HomeListKey, e: ListEntry, locale: string, index: number): string {
  if (k === "pills") return t(UPLOAD_TOOLS.find((u) => u.key === e.id)?.pillKey ?? "ice.role.pill");
  if (isGrid(k)) return t("ice.layout.photoN", { n: index + 1 });
  const named = e as HomeToolEntry | HomePairEntry;
  const own = named.name?.[locale as HomeLocale];
  if (own) return own;
  if (k === "beforeAfter") return `${t("ice.layout.pairN", { n: index + 1 })} · ${toolLabel(named.item, t)}`;
  if (named.from) return t(k === "carousel" ? `sellerHome.tool.${named.from}.name` : `sellerHome.featured.${named.from}.name`);
  return toolLabel(named.item, t);
}

/** The editor element (registry id) of an item's picture, as the page has it. */
function mediaUid(k: HomeListKey, e: ListEntry): string | null {
  if (isGrid(k)) return `m:${gridSlotKey(k, (e as { n: number }).n)}`;
  if (k === "beforeAfter") return `m:pair:${(e as HomePairEntry).n}`;
  return null;
}

/** Does the page show this item flagged „Narzędzie ukryte”? (edit mode marks it) */
const toolHiddenOnPage = (k: HomeListKey, id: string) =>
  typeof document !== "undefined" && Boolean(document.querySelector(`[data-home-item="${k}:${id}"] [data-home-flag="tool"], [data-home-item="${k}:${id}"][data-home-flag="tool"]`));

function Chevron({ dir }: { dir: "up" | "down" | "left" | "right" }) {
  const d = { up: "m6 15 6-6 6 6", down: "m6 9 6 6 6-6", left: "m15 6-6 6 6 6", right: "m9 6 6 6-6 6" }[dir];
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d={d} /></svg>;
}
function Eye({ off }: { off: boolean }) {
  return off
    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /></svg>
    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function Grip() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

const IconBtn = ({ label, onClick, disabled, children, data }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; data?: string }) => (
  <button type="button" className={cls(s.btn, s.ghost, s.bulkIconBtn)} aria-label={label} title={label} disabled={disabled} onClick={onClick} data-layout-op={data}>
    {children}
  </button>
);

/** A tool picker: the catalogue's items, then its categories. */
function ToolSelect({ value, onChange, t, taken, id, sectionDefault }: {
  value: string; onChange: (v: string) => void; t: T; taken?: ReadonlySet<string>; id?: string; sectionDefault?: string;
}) {
  return (
    <select id={id} className={s.input} value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label={t("ice.layout.groupTools")}>
        {CATALOG_ITEMS.map((c) => (
          <option key={c.key} value={c.key} disabled={taken?.has(c.key) && c.key !== value}>
            {sectionDefault === c.key ? t("ice.layout.toolDefault", { name: toolLabel(c.key, t) }) : toolLabel(c.key, t)}
            {taken?.has(c.key) && c.key !== value ? ` ${t("ice.layout.form.toolTaken")}` : ""}
          </option>
        ))}
      </optgroup>
      {!sectionDefault && (
        <optgroup label={t("ice.layout.groupCats")}>
          {CATEGORIES.map((c) => {
            const key = `cat:${c.key}`;
            return (
              <option key={key} value={key} disabled={taken?.has(key) && key !== value}>
                {toolLabel(key, t)}{taken?.has(key) && key !== value ? ` ${t("ice.layout.form.toolTaken")}` : ""}
              </option>
            );
          })}
        </optgroup>
      )}
    </select>
  );
}

/** HTML5 drag & drop over a list's rows (buttons do the same for touch and keyboard). */
function useRowDrag(onDrop: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const props = (i: number, id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLLIElement>) => {
      setDrag(i);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    },
    onDragOver: (e: DragEvent<HTMLLIElement>) => {
      if (drag === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== i) setOver(i);
    },
    onDrop: (e: DragEvent<HTMLLIElement>) => {
      if (drag === null) return;
      e.preventDefault();
      if (drag !== i) onDrop(drag, i);
      setDrag(null);
      setOver(null);
    },
    onDragEnd: () => {
      setDrag(null);
      setOver(null);
    },
  });
  const rowCls = (i: number) => cls(s.galleryRow, s.layoutRow, drag === i && s.galleryRowDragging, over === i && drag !== null && drag !== i && s.galleryRowOver);
  return { props, rowCls };
}

/* ── the panel ─────────────────────────────────────────────────────────── */

export function LayoutPanel({ ctx, store, view, onView, onOpenUid, onTexts, onClose }: {
  ctx: EditorCtx;
  store: HomeLayoutStore;
  view: LayoutView;
  onView: (v: LayoutView) => void;
  /** Open an element's own panel (a picture, a text), coming back here after. */
  onOpenUid: (uid: string) => void;
  /** The elements list, searched for a section's texts. */
  onTexts: (query: string) => void;
  onClose: () => void;
}) {
  const { t } = ctx;
  const layout = store.state?.layout ?? null;
  const title = view.at === "sections" ? t("ice.layout.title")
    : t("ice.layout.listTitle", { section: t(`ice.sec.${LIST_SECTION[view.list]}`) });
  const head = (
    <div className={s.row}>
      {view.at !== "sections" && (
        <Btn small kind="ghost" onClick={() => onView(view.at === "item" ? { at: "list", list: view.list } : { at: "sections" })}>
          ← {t("ice.layout.back")}
        </Btn>
      )}
      <Btn small kind="ghost" disabled={!store.canUndo || store.busy} title={t("ice.layout.undoHint")} onClick={() => void store.undo()}>
        ↶ {t("ice.layout.undo")}
      </Btn>
      <PreviewToggle t={t} />
    </div>
  );
  return (
    <Sheet t={t} wide title={view.at === "item" ? t("ice.layout.form.title") : title} crumbs={ctx.pageLabel} onClose={onClose}>
      {head}
      {store.error && <p className={s.error}>{store.error}</p>}
      {!layout && !store.error && <p className={s.meta}>{t("ice.loading")}</p>}
      {layout && view.at === "sections" && <SectionsView ctx={ctx} store={store} layout={layout} onView={onView} onTexts={onTexts} />}
      {layout && view.at === "list" && <ListView ctx={ctx} store={store} layout={layout} list={view.list} onView={onView} />}
      {layout && view.at === "item" && (
        <ItemForm key={`${view.list}:${view.id}`} ctx={ctx} store={store} layout={layout} list={view.list} id={view.id}
          onOpenUid={onOpenUid} onDone={() => onView({ at: "list", list: view.list })} />
      )}
    </Sheet>
  );
}

/** „Podgląd jako klient”: the existing admin switch (app/actions/features.ts). */
function PreviewToggle({ t }: { t: T }) {
  const router = useRouter();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void clientPreviewStateAction().then(setOn).catch(() => setOn(false));
  }, []);
  if (on === null) return null;
  const flip = async () => {
    setBusy(true);
    const res = await setClientPreviewAction(!on).catch(() => ({ ok: false as const }));
    setBusy(false);
    if (!res.ok) {
      notify.error(t("ice.error.generic"));
      return;
    }
    setOn(!on);
    router.refresh();
  };
  return (
    <Btn small kind={on ? "primary" : "ghost"} disabled={busy} title={t("ice.layout.previewNote")} onClick={() => void flip()}>
      {on ? t("ice.layout.previewOff") : t("ice.layout.preview")}
    </Btn>
  );
}

function SectionsView({ ctx, store, layout, onView, onTexts }: {
  ctx: EditorCtx; store: HomeLayoutStore; layout: HomeLayout; onView: (v: LayoutView) => void; onTexts: (q: string) => void;
}) {
  const { t } = ctx;
  const n = layout.sections.length;
  const { props, rowCls } = useRowDrag((from, to) => {
    const id = layout.sections[from].id;
    void store.apply((l) => moveSection(l, id, to));
  });
  return (
    <>
      <p className={s.meta}>{t("ice.layout.sub")}</p>
      <ol className={s.list} aria-label={t("ice.layout.sections")} data-layout-sections="">
        {layout.sections.map((sec, i) => {
          const name = t(`ice.sec.${sec.id}`);
          const list = SECTION_LIST[sec.id];
          const tool = SECTION_TOOL[sec.id];
          return (
            <li key={sec.id} className={rowCls(i)} {...props(i, sec.id)} data-layout-section={sec.id}>
              <span className={s.dragHandle} aria-hidden="true" title={t("ice.layout.dragHint")}><Grip /></span>
              <span className={s.bulkInfo} style={{ gridColumn: "span 2" }}>
                <span className={s.tileName} style={{ opacity: sec.hidden ? 0.6 : 1 }}>{name}</span>
                <span className={s.row}>
                  {sec.hidden && <span className={cls(s.chip, s.bulkChipWarn)}>{t("ice.layout.hiddenChip")}</span>}
                  {tool && (
                    <label className={s.meta} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {t("ice.layout.tool")}
                      <ToolSelect t={t} value={sectionItem(layout, sec.id) ?? tool} sectionDefault={tool}
                        onChange={(v) => void store.apply((l) => setSectionItem(l, sec.id, v), t("ice.layout.saved"))} />
                    </label>
                  )}
                </span>
              </span>
              <span className={s.bulkTools}>
                <IconBtn label={t("ice.layout.up")} disabled={i === 0 || store.busy} data={`${sec.id}|up`}
                  onClick={() => void store.apply((l) => moveSection(l, sec.id, i - 1))}><Chevron dir="up" /></IconBtn>
                <IconBtn label={t("ice.layout.down")} disabled={i === n - 1 || store.busy} data={`${sec.id}|down`}
                  onClick={() => void store.apply((l) => moveSection(l, sec.id, i + 1))}><Chevron dir="down" /></IconBtn>
                <label className={s.check} data-layout-visible={sec.id}>
                  <input type="checkbox" checked={!sec.hidden} disabled={store.busy}
                    onChange={(e) => void store.apply((l) => setSectionHidden(l, sec.id, !e.target.checked))} />
                  {t("ice.layout.visible")}
                </label>
                {list && <Btn small onClick={() => onView({ at: "list", list })}>{t("ice.layout.items", { n: entriesOf(layout, list).length })}</Btn>}
                {sec.id !== "campaign" && <Btn small kind="ghost" onClick={() => onTexts(name)}>{t("ice.layout.texts")}</Btn>}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function ListView({ ctx, store, layout, list, onView }: {
  ctx: EditorCtx; store: HomeLayoutStore; layout: HomeLayout; list: HomeListKey; onView: (v: LayoutView) => void;
}) {
  const { t, locale } = ctx;
  const entries = entriesOf(layout, list);
  const keys = useMemo(() => thumbKeys(list, entries), [list, entries]);
  const thumbs = useThumbs(ctx, keys);
  const { props, rowCls } = useRowDrag((from, to) => {
    const id = entries[from].id;
    void store.apply((l) => moveEntry(l, list, id, to));
  });

  const add = async () => {
    let made: string | null = null;
    let problem: string | null = null;
    const out = await store.apply((l) => {
      const r = addEntry(l, list);
      if ("error" in r) {
        problem = r.error;
        return null;
      }
      made = r.id;
      return r.layout;
    }, t("ice.layout.added"));
    if (problem) notify.message(t(problem === "limit" ? "ice.layout.addLimit" : problem === "slots" ? "ice.layout.addSlots" : "ice.layout.addExists"));
    if (out && made) onView({ at: "item", list, id: made });
  };
  const remove = async (e: ListEntry, index: number) => {
    if (!window.confirm(t("ice.layout.confirmRemove"))) return;
    const out = await store.apply((l) => removeEntry(l, list, e.id));
    if (!out) return;
    notify.success(t("ice.layout.removed"), {
      action: {
        label: t("ice.layout.undo"),
        // Put back exactly that item, where it was — whatever changed since.
        onClick: () => void store.apply((l) => {
          if (entriesOf(l, list).some((x) => x.id === e.id)) return null;
          const next = JSON.parse(JSON.stringify(l)) as HomeLayout;
          const arr = entriesOf(next, list);
          arr.splice(Math.min(index, arr.length), 0, e);
          (next[list] as ListEntry[]) = arr;
          return next;
        }, t("ice.layout.undone")),
      },
    });
  };

  const bulk = BULK_GROUP[list];
  return (
    <>
      {entries.length === 0 && <p className={s.note}>{t("ice.layout.empty")}</p>}
      <ol className={s.list} data-layout-list={list}>
        {entries.map((e, i) => {
          const label = entryLabel(t, list, e, locale, i);
          const toolOff = toolHiddenOnPage(list, e.id);
          const thumb = thumbs.get(firstKey(list, e) ?? "");
          const ref = isGrid(list) ? thumbs.get(refSlotKey(gridSlotKey(list, (e as { n: number }).n))) : undefined;
          return (
            <li key={e.id} className={rowCls(i)} {...props(i, e.id)} data-layout-item={`${list}:${e.id}`}>
              <span className={s.dragHandle} aria-hidden="true" title={t("ice.layout.dragHint")}><Grip /></span>
              <span className={s.layoutThumb}>{thumb ? <AssetThumb asset={thumb} /> : null}</span>
              <span className={s.bulkInfo}>
                <span className={s.tileName} style={{ opacity: e.hidden ? 0.6 : 1 }}>{label}</span>
                <span className={s.row}>
                  {e.hidden && <span className={cls(s.chip, s.bulkChipWarn)}>{t("ice.layout.itemHiddenChip")}</span>}
                  {toolOff && <span className={cls(s.chip, s.bulkChipWarn)}>{t("ice.layout.toolHiddenChip")}</span>}
                  {ref && <span className={s.chip}>{t("ice.layout.withRef")}</span>}
                  {!thumb && (isGrid(list) || list === "beforeAfter") && <span className={s.chip}>{t("ice.layout.noPhoto")}</span>}
                </span>
              </span>
              <span className={s.bulkTools}>
                <IconBtn label={t("ice.layout.earlier")} disabled={i === 0 || store.busy} data={`${e.id}|up`}
                  onClick={() => void store.apply((l) => moveEntry(l, list, e.id, i - 1))}><Chevron dir="up" /></IconBtn>
                <IconBtn label={t("ice.layout.later")} disabled={i === entries.length - 1 || store.busy} data={`${e.id}|down`}
                  onClick={() => void store.apply((l) => moveEntry(l, list, e.id, i + 1))}><Chevron dir="down" /></IconBtn>
                <IconBtn label={e.hidden ? t("ice.layout.show") : t("ice.layout.hide")} disabled={store.busy} data={`${e.id}|hide`}
                  onClick={() => void store.apply((l) => setEntryHidden(l, list, e.id, !e.hidden))}><Eye off={Boolean(e.hidden)} /></IconBtn>
                <Btn small onClick={() => onView({ at: "item", list, id: e.id })}>{t("ice.layout.edit")}</Btn>
                {list !== "pills" && (
                  <IconBtn label={t("ice.layout.remove")} disabled={store.busy} data={`${e.id}|remove`} onClick={() => void remove(e, i)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </IconBtn>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <div className={s.row}>
        {(list !== "pills" || entries.length < UPLOAD_TOOLS.length) && (
          <Btn small kind="primary" disabled={store.busy} onClick={() => void add()}>{t("ice.layout.add")}</Btn>
        )}
        {bulk && <Btn small kind="ghost" onClick={() => ctx.openBulk(bulk)}>{t("ice.layout.bulk")}</Btn>}
      </div>
    </>
  );
}

/** The slot keys whose pictures a list's rows show (the first of a pair; a grid photo and its product photo). */
function thumbKeys(list: HomeListKey, entries: ListEntry[]): string[] {
  if (isGrid(list)) return entries.flatMap((e) => { const k = gridSlotKey(list, (e as { n: number }).n); return [k, refSlotKey(k)]; });
  if (list === "beforeAfter") return entries.map((e) => `homeMedia.beforeAfter.${(e as HomePairEntry).n}.after`);
  return [];
}
const firstKey = (list: HomeListKey, e: ListEntry): string | null =>
  isGrid(list) ? gridSlotKey(list, (e as { n: number }).n) : list === "beforeAfter" ? `homeMedia.beforeAfter.${(e as HomePairEntry).n}.after` : null;

/** The filled pictures of those slots (read 60 at a time — the server's bound). */
function useThumbs(ctx: EditorCtx, keys: string[]) {
  const [map, setMap] = useState<Map<string, IceAsset>>(new Map());
  const joined = keys.join("\n");
  useEffect(() => {
    let live = true;
    const all = joined ? joined.split("\n") : [];
    void (async () => {
      const out = new Map<string, IceAsset>();
      for (let i = 0; i < all.length; i += 60) {
        const res = await call(ctx.transport.slotState(all.slice(i, i + 60)));
        if (!res.ok) continue;
        for (const st of res.data) if (st.media && st.exists) out.set(st.key, st.media);
      }
      if (live) setMap(out);
    })();
    return () => {
      live = false;
    };
  }, [ctx.transport, joined]);
  return map;
}

/* ── one item ─────────────────────────────────────────────────────────── */

type TextDraft = Record<HomeLocale, string>;
const draftText = (v: HomeText | undefined): TextDraft => ({ pl: v?.pl ?? "", en: v?.en ?? "", de: v?.de ?? "" });
const typedText = (d: TextDraft): Record<string, string> => Object.fromEntries(HOME_LOCALES.filter((l) => d[l].trim()).map((l) => [l, d[l]]));
/** The draft's text, or "bad" when something typed would not survive the server's check. */
function checkedText(d: TextDraft, max: number): HomeText | undefined | "bad" {
  const typed = typedText(d);
  const clean = cleanText(typed, max);
  return Object.keys(typed).length !== Object.keys(clean ?? {}).length ? "bad" : clean;
}

function ItemForm({ ctx, store, layout, list, id, onOpenUid, onDone }: {
  ctx: EditorCtx; store: HomeLayoutStore; layout: HomeLayout; list: HomeListKey; id: string;
  onOpenUid: (uid: string) => void; onDone: () => void;
}) {
  const { t } = ctx;
  const entry = entriesOf(layout, list).find((e) => e.id === id) ?? null;
  const tool = entry && "item" in entry ? (entry as HomeToolEntry | HomePairEntry) : null;
  const [item, setItem] = useState(tool?.item ?? "");
  const [industry, setIndustry] = useState(list === "beforeAfter" && entry ? (entry as HomePairEntry).industry : "home_garden");
  const [hidden, setHidden] = useState(Boolean(entry?.hidden));
  const [name, setName] = useState<TextDraft>(draftText(tool?.name));
  const [sub, setSub] = useState<TextDraft>(draftText(isToolList(list) ? (entry as HomeToolEntry | null)?.sub : undefined));
  const [href, setHref] = useState(isToolList(list) ? (entry as HomeToolEntry | null)?.href ?? "" : "");
  const [loc, setLoc] = useState<HomeLocale>(ctx.locale as HomeLocale);
  const [problem, setProblem] = useState<string | null>(null);

  if (!entry) return <p className={s.error}>{t("ice.layout.form.gone")}</p>;
  const taken = new Set(isToolList(list) ? entriesOf(layout, list).filter((e) => e.id !== id).map((e) => (e as HomeToolEntry).item) : []);
  // A default tile's name and line are the page's own texts; a changed tool
  // drops that link (the old tool's words would no longer fit).
  const from = tool?.from && item === tool.item ? tool.from : undefined;
  // The default tile's page texts (literal namespaces for the i18n scope scan).
  const textUid = (part: "name" | "line") => (list === "carousel"
    ? `t:sellerHome.tool.${from}.${part === "name" ? "name" : "desc"}`
    : `t:sellerHome.featured.${from}.${part === "name" ? "name" : "sub"}`);

  const save = async () => {
    setProblem(null);
    const n = checkedText(name, NAME_MAX);
    const sb = checkedText(sub, SUB_MAX);
    if (n === "bad" || sb === "bad") {
      setProblem(t("ice.layout.form.badText"));
      return;
    }
    const link = href.trim() ? cleanHref(href) : undefined;
    if (href.trim() && !link) {
      setProblem(t("ice.layout.form.badHref"));
      return;
    }
    const out = await store.apply((l) => {
      const cur = entriesOf(l, list).find((e) => e.id === id);
      if (!cur) return null;
      let next: ListEntry;
      if (isToolList(list)) {
        const c = cur as HomeToolEntry;
        next = {
          id, item, ...(hidden ? { hidden: true } : {}), ...(n ? { name: n } : {}), ...(sb ? { sub: sb } : {}),
          ...(link ? { href: link } : {}), ...(c.from && c.item === item ? { from: c.from } : {}),
        };
      } else if (list === "beforeAfter") {
        const c = cur as HomePairEntry;
        next = {
          id, item, industry: industry as HomePairEntry["industry"], n: c.n, ...(hidden ? { hidden: true } : {}), ...(n ? { name: n } : {}),
          ...(c.from && c.item === item ? { from: c.from } : {}),
        };
      } else {
        next = { ...cur, ...(hidden ? { hidden: true } : {}) } as ListEntry;
        if (!hidden) delete (next as { hidden?: boolean }).hidden;
      }
      return updateEntry(l, list, next);
    }, t("ice.layout.saved"));
    if (out) onDone();
  };

  const textField = (label: string, hint: string, value: TextDraft, set: (d: TextDraft) => void, max: number) => (
    <div className={s.field}>
      <span className={s.between}><span className={s.label}>{label}</span><span className={s.meta}>{value[loc].length}/{max}</span></span>
      <LocaleTabs value={loc as IceLocale} onChange={(l) => setLoc(l as HomeLocale)} marked={new Set(HOME_LOCALES.filter((l) => value[l].trim()) as IceLocale[])} t={t} />
      <input className={s.input} value={value[loc]} maxLength={max} lang={loc} onChange={(e) => set({ ...value, [loc]: e.target.value })} />
      <span className={s.meta}>{hint}</span>
    </div>
  );

  return (
    <div data-layout-form={`${list}:${id}`} style={{ display: "grid", gap: 16 }}>
      {tool && (
        <div className={s.field}>
          <label className={s.label} htmlFor="layout-tool">{t("ice.layout.form.tool")}</label>
          <ToolSelect id="layout-tool" t={t} value={item} taken={taken} onChange={setItem} />
          <span className={s.meta}>{t("ice.layout.form.toolNote")}</span>
        </div>
      )}
      {list === "beforeAfter" && (
        <div className={s.field}>
          <label className={s.label} htmlFor="layout-industry">{t("ice.layout.form.industry")}</label>
          <select id="layout-industry" className={s.input} value={industry} onChange={(e) => setIndustry(e.target.value as HomePairEntry["industry"])}>
            {INDUSTRIES.map((k) => <option key={k} value={k}>{t(`sellerHome.industry.${k}`)}</option>)}
          </select>
        </div>
      )}
      {tool && from && isToolList(list) && (
        <div className={s.field}>
          <p className={s.meta}>{t("ice.layout.form.pageTexts")}</p>
          <div className={s.row}>
            <Btn small onClick={() => onOpenUid(textUid("name"))}>{t("ice.layout.form.editName")}</Btn>
            <Btn small onClick={() => onOpenUid(textUid("line"))}>{t("ice.layout.form.editSub")}</Btn>
          </div>
        </div>
      )}
      {tool && !from && textField(list === "beforeAfter" ? t("ice.layout.form.caption") : t("ice.layout.form.name"),
        t("ice.layout.form.nameHint", { name: toolLabel(item, t) }), name, setName, NAME_MAX)}
      {tool && !from && isToolList(list) && textField(t("ice.layout.form.sub"), `${t("ice.layout.form.subHint")} ${toolLine(item, t)}`.trim(), sub, setSub, SUB_MAX)}
      {isToolList(list) && (
        <div className={s.field}>
          <label className={s.label} htmlFor="layout-href">{t("ice.layout.form.href")}</label>
          <input id="layout-href" className={s.input} value={href} maxLength={200} placeholder="/…" onChange={(e) => setHref(e.target.value)} />
          <span className={s.meta}>{t("ice.layout.form.hrefHint")}</span>
        </div>
      )}
      {list === "pills" && <p className={s.meta}>{t("ice.layout.form.pillNote")}</p>}
      <label className={s.check}>
        <input type="checkbox" checked={!hidden} onChange={(e) => setHidden(!e.target.checked)} />
        {t("ice.layout.form.visible")}
      </label>

      {isToolList(list) && (
        <div className={s.field}>
          <span className={s.label}>{t("ice.layout.form.tileImage")}</span>
          <span className={s.meta}>{t("ice.layout.form.tileImageNote")}</span>
          <div className={s.row}>
            <Btn small disabled={item !== tool?.item} onClick={() => onOpenUid(`m:${tileElementId(ctx, list, entry as HomeToolEntry)}`)}>
              {t("ice.layout.form.choose")}
            </Btn>
          </div>
        </div>
      )}
      {list === "beforeAfter" && (
        <div className={s.field}>
          <span className={s.label}>{t("ice.layout.form.pairImages")}</span>
          <div className={s.row}><Btn small onClick={() => onOpenUid(mediaUid(list, entry)!)}>{t("ice.layout.form.choose")}</Btn></div>
        </div>
      )}
      {isGrid(list) && <GridPhotos ctx={ctx} list={list} n={(entry as { n: number }).n} onOpenUid={onOpenUid} />}

      {problem && <p className={s.error}>{problem}</p>}
      <div className={s.row}>
        <Btn kind="primary" disabled={store.busy} onClick={() => void save()}>{t("ice.layout.form.save")}</Btn>
      </div>
    </div>
  );
}

/** The registry element of a tool tile's picture: the one framed by its config key. */
function tileElementId(ctx: EditorCtx, list: "carousel" | "featured", e: HomeToolEntry): string {
  const dom = `[data-config-key="homeMedia.${list}.${e.from ?? e.id}"]`;
  if (ctx.info.kind === "registry") {
    for (const sec of ctx.info.page.sections) for (const el of sec.elements) if (el.dom === dom) return el.id;
  }
  return "";
}

/** A grid photo and its optional product photo, through the existing picture panel. */
function GridPhotos({ ctx, list, n, onOpenUid }: { ctx: EditorCtx; list: GridListKey; n: number; onOpenUid: (uid: string) => void }) {
  const { t } = ctx;
  const main = gridSlotKey(list, n);
  const ref = refSlotKey(main);
  const { states, load } = useSlotStates(ctx, [main, ref]);
  const writer = useSlotWriter(ctx, load, () => void load());
  const st = (k: string) => states?.find((x) => x.key === k) ?? null;
  const refState = st(ref);
  const refSpec = ctx.info.kind === "registry"
    ? ctx.info.page.sections.flatMap((sec) => sec.elements).find((e) => e.id === ref)?.slots?.[0] ?? null : null;
  const box = (label: string, key: string, extra?: ReactNode) => {
    const media = st(key)?.media ?? null;
    return (
      <div className={s.field}>
        <span className={s.label}>{label}</span>
        <div className={s.row} style={{ alignItems: "center" }}>
          <span className={s.layoutThumb}>{media ? <AssetThumb asset={media} /> : null}</span>
          {!media && <span className={s.meta}>{t("ice.layout.form.empty")}</span>}
          <Btn small onClick={() => onOpenUid(`m:${key}`)}>{t("ice.layout.form.choose")}</Btn>
          {extra}
        </div>
      </div>
    );
  };
  return (
    <>
      {box(t("ice.layout.form.photo"), main)}
      {box(t("ice.layout.form.productPhoto"), ref, refState?.media && refSpec ? (
        <Btn small kind="danger" disabled={writer.busy}
          onClick={() => void writer.clear([{ spec: refSpec, state: refState }], "ice.layout.form.confirmUnlink")}>
          {t("ice.layout.form.unlink")}
        </Btn>
      ) : null)}
      <p className={s.meta}>{t("ice.layout.form.productPhotoHint")}</p>
      {writer.problem && <p className={s.error}>{writer.problem}</p>}
    </>
  );
}

/* ── on the page: a toolbar per section, one on the item under the mouse ── */

type Box = { id: string; top: number; left: number; width: number; height: number };

export function LayoutOverlay({ t, store, onView }: { t: T; store: HomeLayoutStore; onView: (v: LayoutView) => void }) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [item, setItem] = useState<{ list: HomeListKey; id: string; top: number; left: number; small: boolean } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Where every section is, in page coordinates (so scrolling moves nothing).
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const out: Box[] = [];
        document.querySelectorAll<HTMLElement>("[data-home-section]").forEach((el) => {
          const id = el.getAttribute("data-home-section") ?? "";
          if (!isHomeSectionId(id)) return;
          const r = el.getBoundingClientRect();
          out.push({ id, top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height });
        });
        setBoxes(out);
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    const mo = new MutationObserver((records) => {
      if (records.every((r) => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest(`[${UI_ATTR}]`))) return;
      measure();
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-home-hidden", "class"] });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // A mouse over an item: its toolbar, at its corner (fixed: a hover, gone on scroll).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("[data-layout-itembar]")) return;
      const host = el?.closest<HTMLElement>("[data-home-item]");
      const raw = host?.getAttribute("data-home-item") ?? "";
      const at = raw.indexOf(":");
      const list = raw.slice(0, at) as HomeListKey;
      if (!host || at < 1 || !(["carousel", "featured", "beforeAfter", "pills", ...GRID_LISTS] as string[]).includes(list)) {
        setItem(null);
        return;
      }
      const r = host.getBoundingClientRect();
      const small = r.height < 90;
      setItem((cur) => (cur && cur.list === list && cur.id === raw.slice(at + 1) && Math.abs(cur.top - r.top) < 1 && Math.abs(cur.left - r.left) < 1
        ? cur : { list, id: raw.slice(at + 1), top: small ? r.top - 34 : r.top + 6, left: r.left + 6, small }));
    };
    const onScroll = () => setItem(null);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  const layout = store.state?.layout;
  if (!mounted || !layout) return null;
  const order = layout.sections.map((x) => x.id);
  const entries = item ? entriesOf(layout, item.list) : [];
  const at = item ? entries.findIndex((e) => e.id === item.id) : -1;
  const entry = at >= 0 ? entries[at] : null;
  const horizontal = item ? item.list !== "pills" && !isGrid(item.list) : false;

  return createPortal(
    <div {...{ [UI_ATTR]: "" }} data-layout-overlay="">
      {boxes.map((b) => {
        const i = order.indexOf(b.id as HomeSectionId);
        const sec = layout.sections[i];
        if (!sec) return null;
        const list = SECTION_LIST[sec.id];
        return (
          <div key={b.id} className={s.layoutBar} data-layout-sectionbar={b.id}
            style={{ top: b.top + 6, left: b.left + b.width - 6 }} role="toolbar" aria-label={t("ice.layout.sectionMenu", { name: t(`ice.sec.${b.id}`) })}>
            <span className={s.layoutBarName}>{t(`ice.sec.${b.id}`)}</span>
            <IconBtn label={t("ice.layout.up")} disabled={i <= 0 || store.busy} onClick={() => void store.apply((l) => moveSection(l, sec.id, i - 1))}><Chevron dir="up" /></IconBtn>
            <IconBtn label={t("ice.layout.down")} disabled={i >= order.length - 1 || store.busy} onClick={() => void store.apply((l) => moveSection(l, sec.id, i + 1))}><Chevron dir="down" /></IconBtn>
            <IconBtn label={sec.hidden ? t("ice.layout.show") : t("ice.layout.hide")} disabled={store.busy}
              onClick={() => void store.apply((l) => setSectionHidden(l, sec.id, !sec.hidden))}><Eye off={Boolean(sec.hidden)} /></IconBtn>
            {list && <Btn small onClick={() => onView({ at: "list", list })}>{t("ice.layout.items", { n: entriesOf(layout, list).length })}</Btn>}
          </div>
        );
      })}
      {item && entry && (
        <div className={s.layoutItemBar} data-layout-itembar={`${item.list}:${item.id}`} role="toolbar" aria-label={t("ice.layout.itemMenu")}
          style={{ top: Math.max(4, item.top), left: item.left }}>
          <Btn small onClick={() => onView({ at: "item", list: item.list, id: item.id })}>{t("ice.layout.edit")}</Btn>
          <IconBtn label={t("ice.layout.earlier")} disabled={at === 0 || store.busy}
            onClick={() => void store.apply((l) => moveEntry(l, item.list, item.id, at - 1))}><Chevron dir={horizontal ? "left" : "up"} /></IconBtn>
          <IconBtn label={t("ice.layout.later")} disabled={at === entries.length - 1 || store.busy}
            onClick={() => void store.apply((l) => moveEntry(l, item.list, item.id, at + 1))}><Chevron dir={horizontal ? "right" : "down"} /></IconBtn>
          <IconBtn label={entry.hidden ? t("ice.layout.show") : t("ice.layout.hide")} disabled={store.busy}
            onClick={() => void store.apply((l) => setEntryHidden(l, item.list, item.id, !entry.hidden))}><Eye off={Boolean(entry.hidden)} /></IconBtn>
        </div>
      )}
    </div>,
    document.body,
  );
}
