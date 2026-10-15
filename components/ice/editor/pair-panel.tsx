"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { IceElement, IceSlotSpec } from "@/lib/ice/types";
import { CENTER, CropEditor, MediaPaint, frameBox, zoomCap } from "./crop";
import {
  AltEditor, AssetChooser, AssetLine, SlotFacts, SlotHistory, Warnings, altInvalid, draftOf, mainKind, sameWrite,
  useSlotStates, useSlotWriter, writeOf, type Draft, type SlotRef,
} from "./media-panel";
import { Btn, Sheet, cls, errorText, fitWarnings, roleLabel, sectionLabel, type EditorCtx } from "./shared";
import s from "./editor.module.css";

/**
 * "EDYTUJ PORÓWNANIE" — one before/after pair: both halves side by side, a
 * live preview with the same divider the page has, and one save for both.
 *
 * The two writes go in ONE slotSave: the server compares-and-sets both rows
 * in one transaction, so the page never shows a new "before" next to an old
 * "after" — either both change or neither does.
 */
export function PairPanel({ ctx, element, onClose }: { ctx: EditorCtx; element: IceElement; onClose: () => void }) {
  const [before, after] = element.slots ?? [];
  if (!before || !after) {
    return (
      <Sheet t={ctx.t} title={ctx.t("ice.pair.title")} onClose={onClose}>
        <p className={s.error}>{errorText(ctx.t, "unknown_slot")}</p>
      </Sheet>
    );
  }
  return <PairEditor ctx={ctx} element={element} specs={[before, after]} onClose={onClose} />;
}

type Two<X> = [X, X];
const SIDES = [0, 1] as const;

function PairEditor({ ctx, element, specs, onClose }: {
  ctx: EditorCtx; element: IceElement; specs: Two<IceSlotSpec>; onClose: () => void;
}) {
  const { t } = ctx;
  const { states, error: loadError, load } = useSlotStates(ctx, specs.map((x) => x.key));
  const st0 = states?.find((x) => x.key === specs[0].key);
  const st1 = states?.find((x) => x.key === specs[1].key);
  const refs: Two<SlotRef> | null = st0 && st1 ? [{ spec: specs[0], state: st0 }, { spec: specs[1], state: st1 }] : null;
  const base: Two<Draft> | null = refs ? [draftOf(refs[0].state), draftOf(refs[1].state)] : null;
  const [drafts, setDrafts] = useState<Two<Draft> | null>(null);
  const view = drafts ?? base;
  const edit = (i: 0 | 1, fn: (d: Draft) => Draft) =>
    setDrafts((cur) => {
      const from = cur ?? base;
      if (!from) return cur;
      const next: Two<Draft> = [from[0], from[1]];
      next[i] = fn(from[i]);
      return next;
    });
  const writer = useSlotWriter(ctx, load, onClose);
  const [pos, setPos] = useState(50);
  const [overlay, setOverlay] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  useEffect(() => {
    if (showHistory) historyRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [showHistory]);

  const tags: Two<string> = [t("ice.pair.before"), t("ice.pair.after")];
  const crumbs = [ctx.pageLabel, sectionLabel(t, ctx.info, element.id), roleLabel(t, element)].filter(Boolean).join(" · ");
  const group = ctx.info.kind === "registry" ? ctx.info.page.bulk?.find((g) => g.slots.includes(specs[0].key)) : undefined;

  const writes = refs && view ? SIDES.map((i) => writeOf(specs[i], view[i], refs[i].state)) : null;
  const dirty = Boolean(refs && writes && SIDES.some((i) => !sameWrite(writes[i], writeOf(specs[i], draftOf(refs[i].state), refs[i].state))));
  const invalid = view ? altInvalid(view[0].alt) || altInvalid(view[1].alt) : false;
  const both = Boolean(view?.[0].media && view[1].media);
  const half = Boolean(view && Boolean(view[0].media) !== Boolean(view[1].media));
  // Lining up needs both halves; removing one turns the see-through view off.
  const blend = overlay && both;

  // A mouse drags the divider anywhere on the preview. A finger scrolls the
  // sheet there (as on the page, a swipe must not be swallowed) and moves the
  // divider with the range below — the same value, also for the keyboard and
  // screen readers.
  const moveTo = (clientX: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setPos(Math.round(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100))));
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (blend || e.pointerType !== "mouse" || e.button !== 0) return;
    dragging.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    moveTo(e.clientX);
    e.preventDefault();
  };
  const move = (e: PointerEvent<HTMLDivElement>) => { if (dragging.current === e.pointerId) moveTo(e.clientX); };
  const up = () => { dragging.current = null; };

  const footer = refs && view && writes ? (
    <>
      <Btn small kind="ghost" onClick={() => setShowHistory((v) => !v)}>{showHistory ? t("ice.history.hide") : t("ice.history.title")}</Btn>
      <Btn small kind="ghost" disabled={writer.busy || !(refs[0].state.exists || refs[1].state.exists)} onClick={() => void writer.restorePrevious(refs)}>
        {t("ice.media.restorePrev")}
      </Btn>
      <Btn small kind="danger" disabled={writer.busy || !(refs[0].state.media || refs[1].state.media)} onClick={() => void writer.clear(refs, "ice.pair.confirmClear")}>
        {t("ice.pair.clear")}
      </Btn>
      <span className={s.grow} />
      <Btn onClick={onClose} disabled={writer.busy}>{t("ice.cancel")}</Btn>
      <Btn kind="primary" disabled={writer.busy || !dirty || invalid} onClick={() => void writer.commit(writes, "save")}>
        {writer.busy ? t("ice.media.saving") : t("ice.pair.save")}
      </Btn>
    </>
  ) : undefined;

  return (
    <Sheet t={t} title={t("ice.pair.title")} crumbs={crumbs} onClose={onClose} footer={footer} wide>
      {!refs && (loadError
        ? <>
          <p className={s.error}>{errorText(t, loadError)}</p>
          <div><Btn small onClick={() => void load()}>{t("ice.media.retry")}</Btn></div>
        </>
        : <p className={s.meta}>{t("ice.media.loading")}</p>)}
      {refs && view && (
        <>
          <SlotFacts spec={specs[0]} t={t} locale={ctx.locale} />
          {writer.problem && <p className={s.error} role="alert">{writer.problem}</p>}
          {half && <p className={s.warn}>{t("ice.pair.warnHalf")}</p>}

          <div className={s.field}>
            <span className={s.label}>{t("ice.pair.preview")}</span>
            <div ref={frame} className={cls(s.frame, !blend && s.splitFrame)} style={{ ...frameBox(specs[0].ratio), touchAction: "pan-y" }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
              {view[0].media
                ? <MediaPaint asset={view[0].media} crop={view[0].crop} fit={refs[0].state.fit} />
                : <span className={s.frameEmpty} style={{ right: "50%" }}>{t("ice.pair.emptyBefore")}</span>}
              {/* AFTER over BEFORE: clipped to the divider, or half see-through to line the two up. */}
              <div className={cls(s.layer, !view[1].media && s.layerEmpty)}
                style={blend ? { opacity: 0.5 } : { clipPath: `inset(0 0 0 ${pos}%)` }}>
                {view[1].media
                  ? <MediaPaint asset={view[1].media} crop={view[1].crop} fit={refs[1].state.fit} />
                  : <span className={s.frameEmpty} style={{ left: "50%" }}>{t("ice.pair.emptyAfter")}</span>}
              </div>
              {!blend && <span className={s.divider} style={{ left: `${pos}%` }} aria-hidden="true" />}
              <span className={cls(s.badge, s.badgeLeft)} aria-hidden="true">{tags[0]}</span>
              <span className={cls(s.badge, s.badgeRight)} aria-hidden="true">{tags[1]}</span>
            </div>
            <input type="range" className={s.range} min={0} max={100} step={1} value={pos} disabled={blend}
              aria-label={t("ice.pair.divider")} aria-valuetext={`${pos}%`} onChange={(e) => setPos(Number(e.target.value))} />
          </div>

          <div className={s.field}>
            <span className={s.label}>{t("ice.pair.align")}</span>
            <div className={s.row}>
              <Btn small disabled={!both} onClick={() => edit(1, (d) => ({ ...d, crop: view[0].crop }))}>{t("ice.pair.copyToAfter")}</Btn>
              <Btn small disabled={!both} onClick={() => edit(0, (d) => ({ ...d, crop: view[1].crop }))}>{t("ice.pair.copyToBefore")}</Btn>
              <label className={s.check}>
                <input type="checkbox" checked={blend} disabled={!both} onChange={(e) => setOverlay(e.target.checked)} />
                {t("ice.pair.overlay")}
              </label>
            </div>
            <p className={s.meta}>{t("ice.pair.alignHint")}</p>
          </div>

          <div className={s.pairCols}>
            {SIDES.map((i) => {
              const spec = specs[i];
              const d = view[i];
              const st = refs[i].state;
              return (
                <section key={spec.key} className={s.pairCol} aria-label={tags[i]}>
                  <h3 className={s.pairHead}>{tags[i]}</h3>
                  {d.media
                    ? <CropEditor asset={d.media} crop={d.crop} onChange={(c) => edit(i, (x) => ({ ...x, crop: c }))}
                        ratio={spec.ratio} fit={st.fit} t={t} maxZoom={zoomCap(d.media, spec)} label={t("ice.pair.frame", { side: tags[i] })} />
                    : <div className={s.frame} style={frameBox(spec.ratio)}><span className={s.frameEmpty}>{t("ice.media.empty")}</span></div>}
                  <AssetChooser ctx={ctx} kind={mainKind(spec)} sample={spec.sample}
                    onPick={(a) => edit(i, (x) => ({
                      ...x, media: a, crop: CENTER, poster: a.kind === "video" ? x.poster : null,
                      alt: x.alt.pl.trim() || !a.alt ? x.alt : { ...x.alt, pl: a.alt },
                    }))}
                    onRemove={d.media ? () => edit(i, (x) => ({ ...x, media: null, poster: null, crop: CENTER })) : undefined} />
                  {d.media && <AssetLine asset={d.media} />}
                  {d.media && <Warnings items={fitWarnings(t, d.media, spec)} />}
                  <AltEditor t={t} value={d.alt} initial={ctx.locale} onChange={(l, v) => edit(i, (x) => ({ ...x, alt: { ...x.alt, [l]: v } }))} />
                </section>
              );
            })}
          </div>

          {group && (
            <div className={s.between}>
              <span className={s.meta}>{t("ice.media.bulkHint")}</span>
              <Btn small onClick={() => ctx.openBulk(group.key)}>{t("ice.media.bulk")}</Btn>
            </div>
          )}

          {showHistory && (
            <div ref={historyRef} className={s.field}>
              <span className={s.label}>{t("ice.history.title")}</span>
              <SlotHistory ctx={ctx} busy={writer.busy}
                slots={[{ ...refs[0], tag: tags[0] }, { ...refs[1], tag: tags[1] }]}
                onRestore={(item) => void writer.restore([item])} />
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
