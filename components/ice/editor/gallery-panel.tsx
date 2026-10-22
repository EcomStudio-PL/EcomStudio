"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { notify } from "@/lib/notify";
import { useFileDrop } from "@/components/ui/file-drop";
import {
  GALLERY_CAPTION_MAX, GALLERY_KEYS, GALLERY_MAX_ITEMS, captionFor, incompletePairs, isCompletePair,
  type GalleryCrop, type GalleryHalf, type GalleryItem, type GalleryKey,
} from "@/lib/launch/gallery";
import { GALLERY_BULK_ACCEPT, galleryIdentity, moveBy, moveItem, planGalleryBulk } from "@/lib/ice/gallery";
import type { BulkProblemReason } from "@/lib/ice/pairs";
import { hasInvisible } from "@/lib/ice/stega";
import type { IceAsset, IceGallery, IceGalleryState, IceGalleryVersion, IceLocale, IceResult } from "@/lib/ice/types";
import { CENTER, CropEditor, MediaPaint, frameBox, isCenter, zoomCap } from "./crop";
import { AssetChooser, AssetLine, Warnings } from "./media-panel";
import { UI_ATTR } from "./scan";
import { Btn, LocaleTabs, Sheet, call, cls, errorText, fitWarnings, previewUrl, when, type EditorCtx, type T } from "./shared";
import { uploadOne } from "./upload";
import s from "./editor.module.css";

/**
 * "GALERIE PRZED/PO" — the launch page's three before/after galleries
 * (MINIATURKI, RETUSZ, MODA), edited on the page itself.
 *
 * Unlike every other panel of the editor this one works on a DRAFT. A gallery
 * is a list of pairs in a CMS block (lib/launch/gallery.ts): "Zapisz szkic"
 * stores it, "Opublikuj" publishes the launch page through the CMS's own
 * publish — with a version in the page history — and "Historia" brings an
 * earlier state back INTO THE DRAFT. Until then visitors see what they saw.
 *
 * What it offers, per gallery:
 *   · the pairs in order — dragged with the mouse, or moved with ↑ / ↓ (which
 *     are always there: a keyboard and a touch screen cannot drag);
 *   · one pair at a time: both halves from the library or a fresh upload,
 *     each framed 1:1 with the same crop the page paints, a 50% overlay to
 *     line the two up, "copy the frame to the other half", captions PL/EN/DE;
 *   · many files at once: "buty-przed.jpg" + "buty-po.jpg" become one pair,
 *     anything that does not pair is listed and left out (lib/ice/gallery.ts);
 *   · the section's switch, a preview of the saved draft at a desktop and a
 *     phone width, and the history.
 *
 * Unsaved edits are kept per gallery while the panel is open — switching tabs
 * loses nothing — and closing with unsaved edits asks first.
 */

type Local = { items: GalleryItem[]; visible: boolean };
type Side = "before" | "after";
type View = { kind: "list" } | { kind: "pair"; id: string } | { kind: "bulk" } | { kind: "history" };
type Confirm =
  | { kind: "remove"; id: string; n: number }
  | { kind: "publish"; launchDraft: boolean }
  | { kind: "discard" }
  | { kind: "close" }
  | { kind: "restore"; version: IceGalleryVersion };

/** The frame every gallery picture is painted in: square, like the slider. */
const SPEC = { ratio: "1/1", width: 1080, height: 1080 } as const;
const SIDES: Side[] = ["before", "after"];
const PREVIEW_PATH = "/?preview=waitlist&draft=1";

const galleryName = (t: T, key: GalleryKey) => t(`ice.gallery.name.${key}`);

/** A half as stored: no crop at all when it is the centre (the default). */
function half(url: string, crop?: GalleryCrop | null): GalleryHalf {
  return crop && !isCenter(crop) ? { url, crop } : { url };
}

/** A frame copied to the other picture keeps its position but never a zoom
 *  that picture's own crop editor would refuse (it would paint soft). */
function capped(crop: GalleryCrop | null | undefined, asset: IceAsset): GalleryCrop | null {
  if (!crop) return null;
  return { ...crop, zoom: Math.min(crop.zoom, zoomCap(asset, SPEC)) };
}

/** A picture the library no longer describes still has to be paintable. */
function fallbackAsset(url: string): IceAsset {
  return {
    id: url, kind: "image", url, posterUrl: null, title: url.split("/").pop() ?? url, alt: null, mime: null,
    sizeBytes: null, width: null, height: null, variants: {}, createdAt: "", usage: 0,
  };
}

const BAD_CAPTION = /[<>]/;

function captionProblem(v: string): string | null {
  if (v.length > GALLERY_CAPTION_MAX) return "text_too_long";
  if (hasInvisible(v)) return "text_invisible";
  if (BAD_CAPTION.test(v)) return "text_markup";
  if (/[\r\n]/.test(v)) return "text_newline";
  return null;
}

const PROBLEM_KEY: Record<BulkProblemReason, string> = {
  noSuffix: "ice.bulk.problem.noSuffix",
  missingBefore: "ice.bulk.problem.missingBefore",
  missingAfter: "ice.bulk.problem.missingAfter",
  duplicate: "ice.bulk.problem.duplicate",
};

/** A refusal as a sentence, with the pair it names when it names one. */
function refusal<R>(t: T, res: IceResult<R>): string {
  if (res.ok) return "";
  const index = res.current && typeof res.current === "object" ? (res.current as { index?: unknown }).index : undefined;
  const base = errorText(t, res.error);
  return typeof index === "number" ? `${base} (${t("ice.gallery.pairN", { n: index })})` : base;
}

export function GalleryPanel({ ctx, focusKey, onClose, onDirtyChange }: {
  ctx: EditorCtx;
  /** The gallery to show first (a section clicked on the page). */
  focusKey: GalleryKey | null;
  onClose: () => void;
  /** Told whenever "is anything unsaved" changes (the editor holds other
   *  panels back meanwhile), and told `false` when the panel goes. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t, transport } = ctx;
  const [state, setState] = useState<IceGalleryState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<GalleryKey>(focusKey ?? "thumbs");
  const [local, setLocal] = useState<Partial<Record<GalleryKey, Local>>>({});
  const [known, setKnown] = useState<Record<string, IceAsset>>({});
  const [view, setView] = useState<View>({ kind: "list" });
  const [busy, setBusy] = useState<"save" | "publish" | "discard" | "restore" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [preview, setPreview] = useState(false);
  const [announce, setAnnounce] = useState("");
  const tabsId = useId();

  // A section clicked on the page while the panel is open: show that one.
  useEffect(() => {
    if (!focusKey) return;
    setActive(focusKey);
    setView({ kind: "list" });
  }, [focusKey]);

  const load = useCallback(async (): Promise<boolean> => {
    const res = await call(transport.galleryState(ctx.path));
    if (!res.ok) {
      setLoadError(res.error);
      return false;
    }
    setLoadError(null);
    setState(res.data);
    return true;
  }, [ctx.path, transport]);

  useEffect(() => {
    void load();
  }, [load]);

  const assets = useMemo(() => ({ ...(state?.assets ?? {}), ...known }), [state, known]);
  const assetOf = (url: string) => assets[url] ?? fallbackAsset(url);
  const serverOf = useCallback((key: GalleryKey): IceGallery | null => state?.galleries.find((g) => g.key === key) ?? null, [state]);
  const baseOf = useCallback((key: GalleryKey): Local => {
    const g = serverOf(key);
    return g ? { items: g.draft, visible: g.visible } : { items: [], visible: true };
  }, [serverOf]);
  const isDirty = useCallback((key: GalleryKey) => {
    const l = local[key];
    if (!l) return false;
    const b = baseOf(key);
    return galleryIdentity(l.visible, l.items) !== galleryIdentity(b.visible, b.items);
  }, [baseOf, local]);

  const server = serverOf(active);
  const current: Local = local[active] ?? baseOf(active);
  const dirty = isDirty(active);
  const anyDirty = GALLERY_KEYS.some(isDirty);
  const room = GALLERY_MAX_ITEMS - current.items.length;

  const dirtyRef = useRef(onDirtyChange);
  dirtyRef.current = onDirtyChange;
  useEffect(() => {
    dirtyRef.current?.(anyDirty);
  }, [anyDirty]);
  useEffect(() => () => dirtyRef.current?.(false), []);
  // A tab closed or reloaded with unsaved pairs: the browser asks first.
  useEffect(() => {
    if (!anyDirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [anyDirty]);

  const edit = (fn: (l: Local) => Local) =>
    setLocal((prev) => ({ ...prev, [active]: fn(prev[active] ?? baseOf(active)) }));
  const setItems = (fn: (items: GalleryItem[]) => GalleryItem[]) => edit((l) => ({ ...l, items: fn(l.items) }));
  const learn = (a: IceAsset) => setKnown((prev) => ({ ...prev, [a.url]: a }));

  /* ── writes ──────────────────────────────────────────────────────────── */

  const forget = (key: GalleryKey) => setLocal((prev) => {
    const next = { ...prev };
    delete next[key];
    return next;
  });

  /** Save one gallery's unsaved edits. A conflict reloads what is stored now
   *  and keeps the edits on screen, so the admin sees both and decides. */
  const saveKey = async (key: GalleryKey): Promise<boolean> => {
    const l = local[key];
    const g = serverOf(key);
    if (!l || !isDirty(key)) return true;
    const res = await call(transport.gallerySave({ key, items: l.items, visible: l.visible, base: g?.updatedAt ?? null }));
    if (!res.ok) {
      if (res.error === "conflict") {
        await load();
        setProblem(t("ice.gallery.conflict", { name: galleryName(t, key) }));
      } else {
        setProblem(`${galleryName(t, key)}: ${refusal(t, res)}`);
      }
      return false;
    }
    await load();
    forget(key);
    return true;
  };

  const save = async () => {
    setBusy("save");
    setProblem(null);
    const ok = await saveKey(active);
    setBusy(null);
    if (ok) notify.success(t("ice.gallery.saved"));
  };

  /** The visible galleries' incomplete pairs, as the server will judge them
   *  (the drafts after saving what is unsaved). */
  const incompleteNow = (): string[] => GALLERY_KEYS.flatMap((key) => {
    const l = local[key] ?? baseOf(key);
    const missing = l.visible ? incompletePairs(l.items) : [];
    return missing.length ? [t("ice.gallery.incompleteIn", { name: galleryName(t, key), pairs: missing.join(", ") })] : [];
  });

  const publish = async (confirmLaunchDraft: boolean) => {
    setConfirm(null);
    setBusy("publish");
    setProblem(null);
    for (const key of GALLERY_KEYS) {
      if (isDirty(key) && !(await saveKey(key))) {
        setBusy(null);
        return;
      }
    }
    const res = await call(transport.galleryPublish({ confirmLaunchDraft }));
    setBusy(null);
    if (!res.ok) {
      if (res.error === "launch_draft") {
        setConfirm({ kind: "publish", launchDraft: true });
        return;
      }
      if (res.error === "incomplete_pairs") {
        const map = ((res.current as { incomplete?: Partial<Record<GalleryKey, number[]>> } | undefined)?.incomplete) ?? {};
        setProblem(`${t("ice.error.incomplete_pairs")} ${GALLERY_KEYS.filter((k) => map[k]?.length)
          .map((k) => t("ice.gallery.incompleteIn", { name: galleryName(t, k), pairs: (map[k] ?? []).join(", ") })).join(" · ")}`);
        return;
      }
      setProblem(refusal(t, res));
      return;
    }
    notify.success(t("ice.gallery.published", { v: res.data.version }));
    setAnnounce(t("ice.gallery.published", { v: res.data.version }));
    await load();
  };

  const askPublish = () => {
    const incomplete = incompleteNow();
    if (incomplete.length) {
      setProblem(`${t("ice.error.incomplete_pairs")} ${incomplete.join(" · ")}`);
      return;
    }
    setConfirm({ kind: "publish", launchDraft: Boolean(state?.unpublishedLaunchDraft) });
  };

  const discard = async () => {
    setConfirm(null);
    setProblem(null);
    const g = serverOf(active);
    forget(active);
    // Only a stored draft that differs from what is live is put back on the
    // server; unsaved edits alone just go away.
    if (!g?.blockId || !g.diverged) {
      setAnnounce(t("ice.gallery.discarded"));
      return;
    }
    setBusy("discard");
    const res = await call(transport.galleryDiscard({ key: active, base: g.updatedAt }));
    setBusy(null);
    if (!res.ok) {
      if (res.error === "conflict") await load();
      setProblem(refusal(t, res));
      return;
    }
    await load();
    notify.success(t("ice.gallery.discarded"));
  };

  const restore = async (v: IceGalleryVersion) => {
    setConfirm(null);
    setProblem(null);
    setBusy("restore");
    const res = await call(transport.galleryRestore({ key: active, version: v.id, base: serverOf(active)?.updatedAt ?? null }));
    setBusy(null);
    if (!res.ok) {
      if (res.error === "conflict") await load();
      setProblem(refusal(t, res));
      return;
    }
    await load();
    forget(active);
    setView({ kind: "list" });
    notify.success(t("ice.gallery.restored", { v: v.version }));
  };

  const close = () => {
    if (anyDirty) setConfirm({ kind: "close" });
    else onClose();
  };

  /* ── the list ────────────────────────────────────────────────────────── */

  const listRef = useRef<HTMLOListElement>(null);
  const refocus = useRef<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  // After ↑ / ↓ the same button keeps the focus, on the pair's new row.
  useEffect(() => {
    const want = refocus.current;
    if (!want || !listRef.current) return;
    refocus.current = null;
    const buttons = Array.from(listRef.current.querySelectorAll<HTMLButtonElement>("button[data-move]"));
    const [id, dir] = want.split("|");
    const find = (d: string) => buttons.find((b) => b.dataset.move === `${id}|${d}` && !b.disabled);
    (find(dir) ?? find(dir === "up" ? "down" : "up"))?.focus();
  });

  const nudge = (index: number, delta: -1 | 1) => {
    const item = current.items[index];
    if (!item) return;
    setItems((items) => moveBy(items, index, delta));
    refocus.current = `${item.id}|${delta < 0 ? "up" : "down"}`;
    setAnnounce(t("ice.gallery.moved", { n: index + 1, to: index + 1 + delta }));
  };

  const dropOn = (to: number) => {
    if (drag === null || drag === to) return;
    setItems((items) => moveItem(items, drag, to));
    setAnnounce(t("ice.gallery.moved", { n: drag + 1, to: to + 1 }));
  };

  const addPair = () => {
    if (room <= 0) return;
    const item: GalleryItem = { id: crypto.randomUUID(), before: null, after: null };
    setItems((items) => [...items, item]);
    setView({ kind: "pair", id: item.id });
  };

  /* ── render ──────────────────────────────────────────────────────────── */

  const pairIndex = view.kind === "pair" ? current.items.findIndex((i) => i.id === view.id) : -1;
  const pair = pairIndex >= 0 ? current.items[pairIndex] : null;

  const status = !server ? "" : dirty ? t("ice.gallery.status.unsaved")
    : server.diverged ? t("ice.gallery.status.diverged")
    : server.blockId ? t("ice.gallery.status.same") : t("ice.gallery.status.new");
  const liveLine = !server || server.publishedVisible === null ? t("ice.gallery.live.none")
    : !server.publishedVisible ? t("ice.gallery.live.hidden")
    : t("ice.gallery.live.pairs", { n: server.published.filter(isCompletePair).length });

  const footer = state ? (
    <>
      <Btn small kind="ghost" onClick={() => setView(view.kind === "history" ? { kind: "list" } : { kind: "history" })}>
        {view.kind === "history" ? t("ice.gallery.backToList") : t("ice.gallery.history")}
      </Btn>
      <Btn small kind="ghost" onClick={() => setPreview(true)}>{t("ice.gallery.preview.open")}</Btn>
      <span className={s.grow} />
      <Btn small kind="danger" disabled={busy !== null || !(dirty || server?.diverged)} onClick={() => setConfirm({ kind: "discard" })}>
        {busy === "discard" ? t("ice.gallery.working") : t("ice.gallery.discard")}
      </Btn>
      <Btn disabled={busy !== null || !dirty} onClick={() => void save()}>
        {busy === "save" ? t("ice.saving") : t("ice.gallery.save")}
      </Btn>
      <Btn kind="primary" disabled={busy !== null} onClick={askPublish}>
        {busy === "publish" ? t("ice.gallery.publishing") : anyDirty ? t("ice.gallery.saveAndPublish") : t("ice.gallery.publish")}
      </Btn>
    </>
  ) : undefined;

  return (
    <>
      <Sheet wide t={t} title={t("ice.gallery.title")} crumbs={`${ctx.pageLabel} · ${t("ice.gallery.crumb")}`} onClose={close} footer={footer}>
        <p className={s.srOnly} aria-live="polite">{announce}</p>
        {!state && (loadError
          ? <>
            <p className={s.error} role="alert">{errorText(t, loadError)}</p>
            <div><Btn small onClick={() => void load()}>{t("ice.media.retry")}</Btn></div>
          </>
          : <p className={s.meta} aria-busy="true">{t("ice.loading")}</p>)}

        {state && (
          <>
            <div className={s.tabs} role="tablist" aria-label={t("ice.gallery.tabs")} id={tabsId} data-gallery-tabs="">
              {GALLERY_KEYS.map((key) => (
                <button key={key} type="button" role="tab" aria-selected={active === key}
                  className={cls(s.tab, active === key && s.tabOn, (isDirty(key) || serverOf(key)?.diverged) && s.tabMark)}
                  onClick={() => { setActive(key); setView({ kind: "list" }); }} data-gallery-tab={key}>
                  {galleryName(t, key)}
                </button>
              ))}
            </div>

            {problem && <p className={s.error} role="alert">{problem}</p>}
            {state.unpublishedLaunchDraft && <p className={s.note}>{t("ice.gallery.launchDraftNote")}</p>}

            <div className={s.between}>
              <span className={cls(s.chip, dirty && s.bulkChipWarn)} data-gallery-status="">{status}</span>
              <span className={s.meta}>{liveLine}</span>
            </div>

            {view.kind === "list" && (
              <PairList ctx={ctx} items={current.items} assets={assetOf} visible={current.visible}
                listRef={listRef} drag={drag} over={over} room={room}
                onVisible={(v) => edit((l) => ({ ...l, visible: v }))}
                onDragStart={setDrag} onDragOver={setOver} onDragEnd={() => { setDrag(null); setOver(null); }}
                onDrop={dropOn} onNudge={nudge}
                onEdit={(id) => setView({ kind: "pair", id })}
                onRemove={(id, n) => setConfirm({ kind: "remove", id, n })}
                onAdd={addPair} onBulk={() => setView({ kind: "bulk" })} />
            )}

            {view.kind === "pair" && pair && (
              <PairEditor ctx={ctx} item={pair} n={pairIndex + 1} assetOf={assetOf} learn={learn}
                onChange={(next) => setItems((items) => items.map((i) => (i.id === next.id ? next : i)))}
                onBack={() => setView({ kind: "list" })} />
            )}
            {view.kind === "pair" && !pair && (
              <div className={s.field}>
                <p className={s.meta}>{t("ice.gallery.pairGone")}</p>
                <div><Btn small onClick={() => setView({ kind: "list" })}>{t("ice.gallery.backToList")}</Btn></div>
              </div>
            )}

            {view.kind === "bulk" && (
              <BulkPairs ctx={ctx} room={room} learn={learn}
                onAdd={(items) => {
                  setItems((list) => [...list, ...items].slice(0, GALLERY_MAX_ITEMS));
                  setView({ kind: "list" });
                  setAnnounce(t("ice.gallery.bulk.added", { n: items.length }));
                }}
                onBack={() => setView({ kind: "list" })} />
            )}

            {view.kind === "history" && (
              <History ctx={ctx} galleryKey={active} busy={busy !== null} dirty={dirty}
                onRestore={(v) => setConfirm({ kind: "restore", version: v })} />
            )}
          </>
        )}
      </Sheet>

      {confirm && (
        <ConfirmDialog t={t}
          title={t(`ice.gallery.confirm.${confirm.kind}.title`)}
          body={confirm.kind === "remove" ? t("ice.gallery.confirm.remove.body", { n: confirm.n })
            : confirm.kind === "publish" ? t(confirm.launchDraft ? "ice.gallery.confirm.publish.bodyLaunch" : "ice.gallery.confirm.publish.body")
            : confirm.kind === "restore" ? t(dirty ? "ice.gallery.confirm.restore.bodyDirty" : "ice.gallery.confirm.restore.body", { v: confirm.version.version })
            : t(`ice.gallery.confirm.${confirm.kind}.body`)}
          action={t(`ice.gallery.confirm.${confirm.kind}.action`)}
          danger={confirm.kind === "remove" || confirm.kind === "discard" || confirm.kind === "close"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm.kind === "remove") {
              setItems((items) => items.filter((i) => i.id !== confirm.id));
              setAnnounce(t("ice.gallery.removed", { n: confirm.n }));
              setConfirm(null);
              setView({ kind: "list" });
            } else if (confirm.kind === "publish") void publish(confirm.launchDraft);
            else if (confirm.kind === "discard") void discard();
            else if (confirm.kind === "restore") void restore(confirm.version);
            else onClose();
          }} />
      )}

      {preview && <PreviewModal t={t} dirty={anyDirty} onClose={() => setPreview(false)} />}
    </>
  );
}

/* ── the list of pairs ─────────────────────────────────────────────────── */

const Chevron = ({ up }: { up: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d={up ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
  </svg>
);

function Mini({ half: h, assetOf, empty }: { half: GalleryHalf | null; assetOf: (url: string) => IceAsset; empty: string }) {
  if (!h) return <span className={s.galleryMiniEmpty} title={empty}>—</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={previewUrl(assetOf(h.url), 160)} alt="" loading="lazy" draggable={false} />;
}

function PairList({
  ctx, items, assets, visible, listRef, drag, over, room,
  onVisible, onDragStart, onDragOver, onDragEnd, onDrop, onNudge, onEdit, onRemove, onAdd, onBulk,
}: {
  ctx: EditorCtx; items: GalleryItem[]; assets: (url: string) => IceAsset; visible: boolean;
  listRef: React.RefObject<HTMLOListElement | null>; drag: number | null; over: number | null; room: number;
  onVisible: (v: boolean) => void;
  onDragStart: (i: number) => void; onDragOver: (i: number) => void; onDragEnd: () => void; onDrop: (i: number) => void;
  onNudge: (i: number, delta: -1 | 1) => void; onEdit: (id: string) => void; onRemove: (id: string, n: number) => void;
  onAdd: () => void; onBulk: () => void;
}) {
  const { t } = ctx;
  const visibleId = useId();
  const incomplete = items.filter((i) => !isCompletePair(i)).length;
  return (
    <>
      <div className={s.field}>
        <label className={s.check} htmlFor={visibleId}>
          <input id={visibleId} type="checkbox" checked={visible} onChange={(e) => onVisible(e.target.checked)} data-gallery-visible="" />
          {t("ice.gallery.visible")}
        </label>
        <p className={s.meta}>{t("ice.gallery.visibleHint")}</p>
      </div>

      <div className={s.between}>
        <span className={s.label}>{t("ice.gallery.pairs", { n: items.length, max: GALLERY_MAX_ITEMS })}</span>
        {incomplete > 0 && <span className={cls(s.chip, s.bulkChipWarn)}>{t("ice.gallery.incompleteCount", { n: incomplete })}</span>}
      </div>
      <div className={s.row}>
        <Btn small disabled={room <= 0} onClick={onAdd}>{t("ice.gallery.add")}</Btn>
        <Btn small disabled={room <= 0} onClick={onBulk}>{t("ice.gallery.bulk.open")}</Btn>
      </div>
      {room <= 0 && <p className={s.note}>{t("ice.gallery.full", { max: GALLERY_MAX_ITEMS })}</p>}
      {items.length === 0 && <p className={s.meta}>{t("ice.gallery.empty")}</p>}
      {items.length > 1 && <p className={s.meta}>{t("ice.gallery.orderHint")}</p>}

      <ol ref={listRef} className={s.list} aria-label={t("ice.gallery.listLabel")} data-gallery-list="">
        {items.map((item, i) => {
          const caption = captionFor(item, ctx.locale);
          const complete = isCompletePair(item);
          return (
            <li key={item.id} className={cls(s.galleryRow, drag === i && s.galleryRowDragging, over === i && drag !== null && drag !== i && s.galleryRowOver)}
              draggable data-gallery-item={item.id}
              onDragStart={(e: DragEvent<HTMLLIElement>) => {
                onDragStart(i);
                e.dataTransfer.effectAllowed = "move";
                // Firefox starts a drag only when something is set.
                e.dataTransfer.setData("text/plain", item.id);
              }}
              onDragOver={(e: DragEvent<HTMLLIElement>) => {
                if (drag === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== i) onDragOver(i);
              }}
              onDrop={(e: DragEvent<HTMLLIElement>) => {
                if (drag === null) return;
                e.preventDefault();
                onDrop(i);
                onDragEnd();
              }}
              onDragEnd={onDragEnd}>
              <span className={s.dragHandle} aria-hidden="true" title={t("ice.gallery.dragHint")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" />
                  <circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
                </svg>
              </span>
              <span className={s.galleryMini}>
                <Mini half={item.before} assetOf={assets} empty={t("ice.pair.emptyBefore")} />
                <Mini half={item.after} assetOf={assets} empty={t("ice.pair.emptyAfter")} />
              </span>
              <span className={s.bulkInfo}>
                <span className={s.tileName}>{t("ice.gallery.pairN", { n: i + 1 })}</span>
                <span className={s.tileMeta}>{caption || t("ice.gallery.noCaption")}</span>
                {!complete && <span className={cls(s.chip, s.bulkChipWarn)}>{t("ice.gallery.incomplete")}</span>}
              </span>
              <span className={s.bulkTools}>
                <button type="button" className={cls(s.btn, s.ghost, s.bulkIconBtn)} data-move={`${item.id}|up`}
                  disabled={i === 0} onClick={() => onNudge(i, -1)} aria-label={t("ice.gallery.up", { n: i + 1 })}>
                  <Chevron up />
                </button>
                <button type="button" className={cls(s.btn, s.ghost, s.bulkIconBtn)} data-move={`${item.id}|down`}
                  disabled={i === items.length - 1} onClick={() => onNudge(i, 1)} aria-label={t("ice.gallery.down", { n: i + 1 })}>
                  <Chevron up={false} />
                </button>
                <Btn small onClick={() => onEdit(item.id)}>{t("ice.gallery.edit")}</Btn>
                <button type="button" className={cls(s.btn, s.ghost, s.bulkIconBtn)} onClick={() => onRemove(item.id, i + 1)}
                  aria-label={t("ice.gallery.remove", { n: i + 1 })}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/* ── one pair ──────────────────────────────────────────────────────────── */

function PairEditor({ ctx, item, n, assetOf, learn, onChange, onBack }: {
  ctx: EditorCtx; item: GalleryItem; n: number; assetOf: (url: string) => IceAsset; learn: (a: IceAsset) => void;
  onChange: (item: GalleryItem) => void; onBack: () => void;
}) {
  const { t } = ctx;
  const [pos, setPos] = useState(50);
  const [overlay, setOverlay] = useState(false);
  const [loc, setLoc] = useState<IceLocale>(ctx.locale);
  const captionId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const tags: Record<Side, string> = { before: t("ice.pair.before"), after: t("ice.pair.after") };
  const both = Boolean(item.before && item.after);
  const blend = overlay && both;

  const setHalf = (side: Side, value: GalleryHalf | null) => onChange({ ...item, [side]: value });
  const cropOf = (side: Side) => item[side]?.crop ?? CENTER;

  const moveTo = (clientX: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setPos(Math.round(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100))));
  };
  // A mouse drags the divider anywhere on the preview; a finger scrolls the
  // sheet there and moves the divider with the range below (as pair-panel).
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (blend || e.pointerType !== "mouse" || e.button !== 0) return;
    dragging.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    moveTo(e.clientX);
    e.preventDefault();
  };
  const move = (e: PointerEvent<HTMLDivElement>) => { if (dragging.current === e.pointerId) moveTo(e.clientX); };
  const up = () => { dragging.current = null; };

  const caption = item.caption?.[loc] ?? "";
  const filled = new Set((["pl", "en", "de"] as IceLocale[]).filter((l) => (item.caption?.[l] ?? "").trim()));
  const captionError = captionProblem(caption);
  const setCaption = (value: string) => {
    const next = { ...(item.caption ?? {}), [loc]: value };
    if (!value) delete next[loc];
    onChange({ ...item, caption: Object.keys(next).length ? next : undefined });
  };

  return (
    <div className={s.field} data-gallery-pair={item.id}>
      <div className={s.between}>
        <h3 className={s.pairHead}>{t("ice.gallery.pairN", { n })}</h3>
        <Btn small kind="ghost" onClick={onBack}>{t("ice.gallery.backToList")}</Btn>
      </div>
      {!both && <p className={s.warn}>{t("ice.gallery.halfMissing")}</p>}

      <div className={s.field}>
        <span className={s.label}>{t("ice.pair.preview")}</span>
        <div ref={frame} className={cls(s.frame, !blend && s.splitFrame)} style={{ ...frameBox(SPEC.ratio), touchAction: "pan-y" }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {item.before
            ? <MediaPaint asset={assetOf(item.before.url)} crop={cropOf("before")} />
            : <span className={s.frameEmpty} style={{ right: "50%" }}>{t("ice.pair.emptyBefore")}</span>}
          {/* AFTER over BEFORE: clipped to the divider, or half see-through to line the two up. */}
          <div className={cls(s.layer, !item.after && s.layerEmpty)}
            style={blend ? { opacity: 0.5 } : { clipPath: `inset(0 0 0 ${pos}%)` }}>
            {item.after
              ? <MediaPaint asset={assetOf(item.after.url)} crop={cropOf("after")} />
              : <span className={s.frameEmpty} style={{ left: "50%" }}>{t("ice.pair.emptyAfter")}</span>}
          </div>
          {!blend && <span className={s.divider} style={{ left: `${pos}%` }} aria-hidden="true" />}
          <span className={cls(s.badge, s.badgeLeft)} aria-hidden="true">{tags.before}</span>
          <span className={cls(s.badge, s.badgeRight)} aria-hidden="true">{tags.after}</span>
        </div>
        <input type="range" className={s.range} min={0} max={100} step={1} value={pos} disabled={blend}
          aria-label={t("ice.pair.divider")} aria-valuetext={`${pos}%`} onChange={(e) => setPos(Number(e.target.value))} />
      </div>

      <div className={s.field}>
        <span className={s.label}>{t("ice.pair.align")}</span>
        <div className={s.row}>
          <Btn small disabled={!both} onClick={() => item.after && setHalf("after", half(item.after.url, capped(cropOf("before"), assetOf(item.after.url))))}>{t("ice.pair.copyToAfter")}</Btn>
          <Btn small disabled={!both} onClick={() => item.before && setHalf("before", half(item.before.url, capped(cropOf("after"), assetOf(item.before.url))))}>{t("ice.pair.copyToBefore")}</Btn>
          <label className={s.check}>
            <input type="checkbox" checked={blend} disabled={!both} onChange={(e) => setOverlay(e.target.checked)} />
            {t("ice.pair.overlay")}
          </label>
        </div>
        <p className={s.meta}>{t("ice.pair.alignHint")}</p>
      </div>

      <div className={s.pairCols}>
        {SIDES.map((side) => {
          const h = item[side];
          const asset = h ? assetOf(h.url) : null;
          return (
            <section key={side} className={s.pairCol} aria-label={tags[side]}>
              <h3 className={s.pairHead}>{tags[side]}</h3>
              {h && asset
                ? <CropEditor asset={asset} crop={cropOf(side)} ratio={SPEC.ratio} t={t} maxZoom={zoomCap(asset, SPEC)}
                    label={t("ice.pair.frame", { side: tags[side] })}
                    onChange={(c) => setHalf(side, half(h.url, c))} />
                : <div className={s.frame} style={frameBox(SPEC.ratio)}><span className={s.frameEmpty}>{t("ice.media.empty")}</span></div>}
              <AssetChooser ctx={ctx} kind="image"
                onPick={(a) => { learn(a); setHalf(side, half(a.url)); }}
                onRemove={h ? () => setHalf(side, null) : undefined} />
              {asset && asset.createdAt && <AssetLine asset={asset} />}
              {h && asset && !asset.createdAt && <p className={s.warn}>{t("ice.gallery.unknownFile")}</p>}
              {asset && <Warnings items={fitWarnings(t, asset, SPEC)} />}
            </section>
          );
        })}
      </div>

      <div className={s.field}>
        <div className={s.between}>
          <label className={s.label} htmlFor={captionId}>{t("ice.gallery.caption")}</label>
          <span className={s.meta}>{caption.length}/{GALLERY_CAPTION_MAX}</span>
        </div>
        <LocaleTabs value={loc} onChange={setLoc} marked={filled} t={t} />
        <input id={captionId} className={s.input} value={caption} maxLength={GALLERY_CAPTION_MAX} lang={loc}
          aria-invalid={Boolean(captionError)} onChange={(e) => setCaption(e.target.value.replace(/[\r\n]+/g, " "))} />
        <p className={s.meta}>{t("ice.gallery.captionHint")}</p>
        {captionError && <p className={s.error}>{errorText(t, captionError)}</p>}
      </div>
    </div>
  );
}

/* ── many files at once ────────────────────────────────────────────────── */

type Picked = { id: string; name: string; type: string; file: File };
let pickSeq = 0;

function BulkPairs({ ctx, room, learn, onAdd, onBack }: {
  ctx: EditorCtx; room: number; learn: (a: IceAsset) => void;
  onAdd: (items: GalleryItem[]) => void; onBack: () => void;
}) {
  const { t, transport } = ctx;
  const [files, setFiles] = useState<Picked[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [failed, setFailed] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const intake = (list: FileList | null) => {
    if (!list?.length || running) return;
    const seen = new Set(files.map((f) => `${f.name}|${f.file.size}`));
    const fresh = Array.from(list)
      .filter((file) => !seen.has(`${file.name}|${file.size}`))
      .map((file) => ({ id: `g${(pickSeq += 1)}`, name: file.name, type: file.type, file }));
    setFiles((prev) => [...prev, ...fresh]);
  };
  // A file released anywhere while this view is open lands here, and never
  // makes the browser leave the page being edited.
  const dropping = useFileDrop({ onFiles: (list) => intake(list), enabled: !running });

  const plan = useMemo(() => planGalleryBulk(files, room), [files, room]);

  const start = async () => {
    if (running || plan.pairs.length === 0) return;
    setRunning(true);
    setFailed([]);
    const total = plan.pairs.length * 2;
    let done = 0;
    setProgress({ done, total });
    const made: GalleryItem[] = [];
    const bad: string[] = [];
    for (const unit of plan.pairs) {
      const urls: string[] = [];
      for (const f of unit.files) {
        const res = await uploadOne(transport, f.file, { kind: "image" });
        if (!alive.current) return;
        done += 1;
        setProgress({ done, total });
        if (res.ok) {
          learn(res.asset);
          urls.push(res.asset.url);
        } else {
          bad.push(`${f.name}: ${errorText(t, res.error)}`);
        }
      }
      // Both halves or nothing: a pair with a failed half is left out (the
      // half that did upload stays in the library).
      if (urls.length === 2) made.push({ id: crypto.randomUUID(), before: { url: urls[0] }, after: { url: urls[1] } });
    }
    setRunning(false);
    setFailed(bad);
    if (bad.length) notify.warning(t("ice.gallery.bulk.someFailed", { n: bad.length }), { description: bad.join("\n") });
    if (made.length) onAdd(made);
  };

  return (
    <div className={s.field} data-gallery-bulk="">
      <div className={s.between}>
        <span className={s.label}>{t("ice.gallery.bulk.title")}</span>
        <Btn small kind="ghost" disabled={running} onClick={onBack}>{t("ice.gallery.backToList")}</Btn>
      </div>
      <p className={s.note}>{t("ice.gallery.bulk.hint")}</p>
      <div className={cls(s.drop, dropping && s.dropOn)}>
        <span>{t("ice.bulk.drop")}</span>
        <Btn onClick={() => fileRef.current?.click()} disabled={running}>{t("ice.bulk.pick")}</Btn>
        <input ref={fileRef} type="file" hidden multiple accept={GALLERY_BULK_ACCEPT} aria-label={t("ice.bulk.pick")}
          onChange={(e) => { intake(e.target.files); e.target.value = ""; }} />
        <span className={s.meta}>{t("ice.gallery.bulk.formats", { room })}</span>
      </div>

      {plan.pairs.length > 0 && (
        <div className={s.field}>
          <span className={s.label}>{t("ice.gallery.bulk.found", { n: plan.pairs.length })}</span>
          <ol className={s.bulkBullets}>
            {plan.pairs.map((u) => (
              <li key={u.id}><span className={s.bulkName}>{u.name}</span> — {u.files.map((f) => f.name).join(" + ")}</li>
            ))}
          </ol>
        </div>
      )}
      {plan.problems.length > 0 && (
        <div className={s.warn}>
          <p className={s.bulkLine}><strong>{t("ice.bulk.problemsTitle")}</strong></p>
          <ul className={s.bulkBullets}>
            {plan.problems.map((p) => (
              <li key={p.file.id}><span className={s.bulkName}>{p.file.name}</span> — {t(PROBLEM_KEY[p.reason], { base: p.base })}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.rejected.length > 0 && (
        <div className={s.warn}>
          <p className={s.bulkLine}><strong>{t("ice.gallery.bulk.rejected")}</strong></p>
          <ul className={s.bulkBullets}>{plan.rejected.map((f) => <li key={f.id}>{f.name}</li>)}</ul>
        </div>
      )}
      {plan.overflow.length > 0 && (
        <p className={s.warn}>{t("ice.gallery.bulk.overflow", { n: plan.overflow.length, max: GALLERY_MAX_ITEMS })}</p>
      )}
      {failed.length > 0 && (
        <div className={s.error} role="alert">
          <ul className={s.bulkBullets}>{failed.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}
      {running && (
        <div className={s.progress} role="progressbar" aria-label={t("ice.bulk.progressLabel")}
          aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
        </div>
      )}
      <div className={s.row}>
        <Btn kind="primary" disabled={running || plan.pairs.length === 0} onClick={() => void start()}>
          {running ? t("ice.gallery.bulk.uploading", { done: progress.done, total: progress.total }) : t("ice.gallery.bulk.add", { n: plan.pairs.length })}
        </Btn>
        {files.length > 0 && <Btn small kind="ghost" disabled={running} onClick={() => setFiles([])}>{t("ice.gallery.bulk.clear")}</Btn>}
      </div>
    </div>
  );
}

/* ── history ───────────────────────────────────────────────────────────── */

function History({ ctx, galleryKey, busy, dirty, onRestore }: {
  ctx: EditorCtx; galleryKey: GalleryKey; busy: boolean; dirty: boolean; onRestore: (v: IceGalleryVersion) => void;
}) {
  const { t, transport } = ctx;
  const [rows, setRows] = useState<IceGalleryVersion[] | null>(null);
  const [assets, setAssets] = useState<Record<string, IceAsset>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    void call(transport.galleryVersions({ key: galleryKey })).then((r) => {
      if (!live) return;
      if (r.ok) {
        setRows(r.data.versions);
        setAssets(r.data.assets);
      } else setError(errorText(t, r.error));
    });
    return () => {
      live = false;
    };
  }, [galleryKey, t, transport]);

  const thumb = (url: string | undefined) => {
    if (!url) return <span className={s.galleryMiniEmpty}>—</span>;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={previewUrl(assets[url] ?? fallbackAsset(url), 160)} alt="" loading="lazy" />;
  };

  return (
    <div className={s.field} data-gallery-history="">
      <span className={s.label}>{t("ice.gallery.historyTitle", { name: galleryName(t, galleryKey) })}</span>
      <p className={s.meta}>{t("ice.gallery.historyHint")}</p>
      {error && <p className={s.error}>{error}</p>}
      {!rows && !error && <p className={s.meta}>{t("ice.loading")}</p>}
      {rows && rows.length === 0 && <p className={s.meta}>{t("ice.gallery.historyEmpty")}</p>}
      {rows && rows.length > 0 && (
        <ul className={s.list}>
          {rows.map((v) => (
            <li key={v.id} className={s.item}>
              <span className={s.between}>
                <strong>{t("ice.gallery.version", { v: v.version })}</strong>
                <span className={s.row}>
                  {v.isPublished && <span className={cls(s.chip, s.chipAccent)}>{t("ice.gallery.isPublished")}</span>}
                  {v.isDraft && <span className={s.chip}>{t("ice.gallery.isDraft")}</span>}
                  {!v.visible && <span className={s.chip}>{t("ice.gallery.hidden")}</span>}
                </span>
              </span>
              <span className={s.meta}>
                {when(v.createdAt, ctx.locale)}{v.author ? ` · ${v.author}` : ""} · {t("ice.gallery.pairsShort", { n: v.items.length })}
                {v.label ? ` · ${v.label}` : ""}
              </span>
              <span className={s.galleryHistThumbs}>
                {v.items.slice(0, 4).map((i) => (
                  <span key={i.id} className={s.galleryMini}>{thumb(i.before?.url)}{thumb(i.after?.url)}</span>
                ))}
              </span>
              <div className={s.row}>
                <Btn small disabled={busy || (v.isDraft && !dirty)} onClick={() => onRestore(v)}>{t("ice.gallery.restore")}</Btn>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── a question before something that cannot be taken back ───────────── */

function ConfirmDialog({ t, title, body, action, danger, onCancel, onConfirm }: {
  t: T; title: string; body: string; action: string; danger?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    ref.current?.focus();
    // Escape answers "no" — and only this dialog (the sheet under it stays).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      cancelRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div className={s.backdrop} {...{ [UI_ATTR]: "" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={cls(s.modal, s.confirmModal)} role="alertdialog" aria-modal="true" aria-label={title}>
        <div className={s.sheetHead}><h2>{title}</h2></div>
        <div className={s.sheetBody}><p style={{ margin: 0 }}>{body}</p></div>
        <div className={s.sheetFoot}>
          <span className={s.grow} />
          <Btn onClick={onCancel}>{t("ice.cancel")}</Btn>
          <button ref={ref} type="button" className={cls(s.btn, danger ? s.danger : s.primary)} onClick={onConfirm}>{action}</button>
        </div>
      </div>
    </div>
  );
}

/* ── the saved draft at a desktop and a phone width ────────────────────── */

const DEVICES = [
  { key: "desktop", width: 1440, height: 900 },
  { key: "phone", width: 390, height: 844 },
] as const;

/**
 * "PODGLĄD PC / TELEFON" — the launch page's DRAFT (/?preview=waitlist&draft=1,
 * admin only, the same route Strony WWW previews) at a true desktop and a
 * true phone width, each scaled to fit. A real iframe at the real width, so
 * the page's own breakpoints decide the layout; scaling only shrinks the
 * picture. Inside it the page is a visitor's view: the inline editor does not
 * start in a frame, and the admin placeholders stay out of a preview.
 */
function PreviewModal({ t, dirty, onClose }: { t: T; dirty: boolean; onClose: () => void }) {
  const [nonce, setNonce] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div className={s.backdrop} {...{ [UI_ATTR]: "" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cls(s.modal, s.previewModal)} role="dialog" aria-modal="true" aria-label={t("ice.gallery.preview.title")}>
        <div className={s.sheetHead}>
          <div style={{ minWidth: 0 }}>
            <h2>{t("ice.gallery.preview.title")}</h2>
            <p className={s.crumbs}>{t("ice.gallery.preview.sub")}</p>
          </div>
          <Btn small kind="ghost" onClick={() => setNonce((n) => n + 1)}>{t("ice.gallery.preview.reload")}</Btn>
          <button ref={closeRef} type="button" className={cls(s.btn, s.ghost, s.icon, s.closeBtn)} onClick={onClose} aria-label={t("ice.close")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className={s.sheetBody}>
          {dirty && <p className={s.warn}>{t("ice.gallery.preview.unsaved")}</p>}
          <div className={s.previewFrames}>
            {DEVICES.map((d) => <ScaledFrame key={d.key} device={d} nonce={nonce} t={t} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScaledFrame({ device, nonce, t }: { device: (typeof DEVICES)[number]; nonce: number; t: T }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / device.width));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [device.width]);
  const label = t(`ice.gallery.preview.${device.key}`, { w: device.width });
  return (
    <figure className={cls(s.previewDevice, device.key === "phone" && s.previewPhone)} data-preview-device={device.key}>
      <figcaption className={s.meta}>{label}</figcaption>
      <div ref={box} className={s.previewViewport} style={{ height: scale ? device.height * scale : 200 }}>
        {scale > 0 && (
          <iframe key={nonce} src={`${PREVIEW_PATH}&v=${nonce}`} title={label} tabIndex={0}
            style={{ width: device.width, height: device.height, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
        )}
      </div>
    </figure>
  );
}
