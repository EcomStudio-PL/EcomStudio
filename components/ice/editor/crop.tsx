"use client";
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { IceAsset, IceCrop, IceSlotSpec } from "@/lib/ice/types";
// Type only: the 9 values are checked against the slot registry at compile
// time without pulling the whole catalogue (lib/media-slots) into this chunk.
import type { ObjectPosition } from "@/lib/media-slots";
import { cls, cropStyle, previewUrl, ratioNumber, type T } from "./shared";
import s from "./editor.module.css";

/**
 * THE FRAMING CONTROLS — a crop editor for slots the page paints with a focal
 * point and a zoom, and the 9-cell position picker for slots painted by the
 * frozen shared tool-card renderer (object-position only).
 *
 * A crop never touches the file: it is the same rule the page applies at
 * render time (shared.tsx cropStyle — object-position x% y%, then
 * scale(zoom) about that same point, object-fit cover), so what the frame
 * here shows is what the page paints.
 */

/** The database's ceiling (media_crop_ok: zoom 1–2.5). */
export const MAX_ZOOM = 2.5;
export const CENTER: IceCrop = { x: 50, y: 50, zoom: 1 };

/** A phone frame is at most ~1080 device pixels wide (390 CSS px × 3), the
 *  reference for how far a phone file may be enlarged. */
export const PHONE_REF_WIDTH = 1080;

/** How far a file may be enlarged in a slot before it turns soft: its width
 *  over the slot's recommended width, between 1 and 2.5. Unknown width → the
 *  database ceiling. */
export function zoomCap(asset: Pick<IceAsset, "width">, spec: Pick<IceSlotSpec, "width">): number {
  if (!asset.width || !spec.width) return MAX_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(1, asset.width / spec.width));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const isCenter = (c: IceCrop) => c.x === 50 && c.y === 50 && c.zoom === 1;

/** A frame at `ratio`, never taller than about half the screen: a tall frame
 *  (9:16) in the phone's bottom sheet would otherwise fill it, and a frame
 *  takes no scroll gesture (it is the drag surface). */
export function frameBox(ratio: string): CSSProperties {
  return { aspectRatio: ratio, width: `min(100%, ${(55 * ratioNumber(ratio)).toFixed(2)}dvh)`, marginInline: "auto" };
}

/** One file painted in a frame the way the page paints it: with a crop
 *  (focal point + zoom), or — for position-only slots — an object-position. */
export function MediaPaint({ asset, crop, fit = "cover", position, min = 640 }: {
  asset: IceAsset; crop?: IceCrop | null; fit?: "cover" | "contain"; position?: string; min?: number;
}) {
  const style = position !== undefined ? { objectFit: fit, objectPosition: position } : cropStyle(crop, fit);
  return asset.kind === "video"
    ? <video src={asset.url} poster={asset.posterUrl ?? undefined} muted playsInline loop autoPlay style={style} />
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={previewUrl(asset, min)} alt="" draggable={false} style={style} />;
}

/**
 * How many frame pixels the painted picture overhangs the frame, per axis, at
 * `zoom`. Moving the focal point by d% shifts the picture by −d/100 × that
 * overhang (object-position spreads the overhang; scale(zoom) about the same
 * point multiplies it), so a pointer move of N px maps to N / overhang × 100 %
 * — the picture follows the finger 1:1 at any zoom.
 */
function overhang(box: DOMRect, natural: { w: number; h: number } | null, zoom: number, fit: "cover" | "contain") {
  const nw = natural?.w || box.width;
  const nh = natural?.h || box.height;
  const k = fit === "contain" ? Math.min(box.width / nw, box.height / nh) : Math.max(box.width / nw, box.height / nh);
  return { x: zoom * nw * k - box.width, y: zoom * nh * k - box.height };
}

export function CropEditor({ asset, crop, onChange, ratio, fit = "cover", t, maxZoom = MAX_ZOOM, label }: {
  asset: IceAsset;
  crop: IceCrop;
  onChange: (crop: IceCrop) => void;
  /** CSS aspect-ratio of the frame ("1080/1350"). */
  ratio: string;
  fit?: "cover" | "contain";
  t: T;
  /** zoomCap(asset, spec) — a stored zoom above it stays reachable. */
  maxZoom?: number;
  label?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; from: IceCrop } | null>(null);
  // The file's real pixel size, read when it loads (the library's numbers
  // may be missing); keyed by asset so a new file never uses the old size.
  const [natural, setNatural] = useState<{ id: string; w: number; h: number } | null>(null);
  const hintId = useId();
  const zoomId = useId();
  const xId = useId();
  const yId = useId();
  const cap = clamp(Math.max(maxZoom, crop.zoom), 1, MAX_ZOOM);
  const size = natural?.id === asset.id ? natural
    : asset.width && asset.height ? { id: asset.id, w: asset.width, h: asset.height } : null;

  const emit = (c: IceCrop) => onChange({ x: r2(clamp(c.x, 0, 100)), y: r2(clamp(c.y, 0, 100)), zoom: r3(clamp(c.zoom, 1, cap)) });

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // A finger scrolls the sheet (the frame fills half a phone screen); the
    // sliders below move the frame on a touch screen.
    if (e.pointerType === "touch") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: crop };
    e.preventDefault();
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const box = frame.current?.getBoundingClientRect();
    if (!d || d.id !== e.pointerId || !box || box.width === 0) return;
    const ov = overhang(box, size, d.from.zoom, fit);
    // No overhang on an axis (same shape, no zoom): that axis cannot move.
    const x = Math.abs(ov.x) < 0.5 ? d.from.x : d.from.x - ((e.clientX - d.x) / ov.x) * 100;
    const y = Math.abs(ov.y) < 0.5 ? d.from.y : d.from.y - ((e.clientY - d.y) / ov.y) * 100;
    emit({ x, y, zoom: d.from.zoom });
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  // Arrows move the PICTURE the way a drag would (right arrow = picture
  // right = focal point left); + / − zoom.
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 1;
    const next: Record<string, IceCrop> = {
      ArrowRight: { ...crop, x: crop.x - step },
      ArrowLeft: { ...crop, x: crop.x + step },
      ArrowDown: { ...crop, y: crop.y - step },
      ArrowUp: { ...crop, y: crop.y + step },
      "+": { ...crop, zoom: crop.zoom + 0.05 },
      "=": { ...crop, zoom: crop.zoom + 0.05 },
      "-": { ...crop, zoom: crop.zoom - 0.05 },
      _: { ...crop, zoom: crop.zoom - 0.05 },
    };
    const c = next[e.key];
    if (!c) return;
    e.preventDefault();
    emit(c);
  };

  return (
    <div className={s.field}>
      <div ref={frame} className={cls(s.frame, s.grab, s.cropFrame)} style={frameBox(ratio)}
        tabIndex={0} role="group" aria-label={label ?? t("ice.crop.frame")} aria-describedby={hintId}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
        {asset.kind === "video"
          ? <video key={asset.id} src={asset.url} poster={asset.posterUrl ?? undefined} muted playsInline loop autoPlay style={cropStyle(crop, fit)}
              onLoadedMetadata={(e) => setNatural({ id: asset.id, w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img key={asset.id} src={previewUrl(asset, 1024)} alt="" draggable={false} style={cropStyle(crop, fit)}
              onLoad={(e) => setNatural({ id: asset.id, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
        <span className={s.crosshair} style={{ left: `${crop.x}%`, top: `${crop.y}%` }} aria-hidden="true" />
      </div>
      <p id={hintId} className={s.meta}>{t("ice.crop.hint")}</p>
      <div className={s.cropTools}>
        <label className={s.label} htmlFor={zoomId}>{t("ice.crop.zoom")}</label>
        <input id={zoomId} type="range" className={s.zoomRange} min={1} max={cap} step={0.01} value={crop.zoom}
          disabled={cap <= 1} aria-valuetext={`${crop.zoom.toFixed(2)}×`}
          onChange={(e) => emit({ ...crop, zoom: Number(e.target.value) })} />
        <span className={s.meta} aria-hidden="true">{crop.zoom.toFixed(2)}×</span>
        <button type="button" className={cls(s.btn, s.small)} disabled={isCenter(crop)} onClick={() => onChange(CENTER)}>
          {t("ice.crop.center")}
        </button>
      </div>
      <div className={s.cropTools}>
        <label className={s.label} htmlFor={xId}>{t("ice.crop.x")}</label>
        <input id={xId} type="range" className={s.zoomRange} min={0} max={100} step={1} value={crop.x}
          aria-valuetext={`${Math.round(crop.x)}%`} onChange={(e) => emit({ ...crop, x: Number(e.target.value) })} />
        <label className={s.label} htmlFor={yId}>{t("ice.crop.y")}</label>
        <input id={yId} type="range" className={s.zoomRange} min={0} max={100} step={1} value={crop.y}
          aria-valuetext={`${Math.round(crop.y)}%`} onChange={(e) => emit({ ...crop, y: Number(e.target.value) })} />
      </div>
      {cap <= 1 && <p className={s.meta}>{t("ice.crop.noZoom")}</p>}
    </div>
  );
}

/* ── the 9-cell picker (position-only slots) ─────────────────────────── */

export const POSITIONS = [
  "left top", "center top", "right top",
  "left center", "center center", "right center",
  "left bottom", "center bottom", "right bottom",
] as const satisfies readonly ObjectPosition[];

/** Compile-time proof the list covers every value the renderer knows. */
type AllCovered<X extends never> = X;
export type PositionsCoverAll = AllCovered<Exclude<ObjectPosition, (typeof POSITIONS)[number]>>;

export const isPosition = (v: unknown): v is ObjectPosition =>
  typeof v === "string" && (POSITIONS as readonly string[]).includes(v);

/** "left top" → "leftTop" (the label key). */
const posKey = (v: string) => v.split(" ").map((p, i) => (i ? p[0].toUpperCase() + p.slice(1) : p)).join("");

export function PositionGrid({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: T }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, POSITIONS.findIndex((p) => p === value));
  // A radio group: one tab stop, arrows move within the 3 × 3 grid.
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const d: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 };
    if (!(e.key in d)) return;
    e.preventDefault();
    const next = clamp(at + d[e.key], 0, 8);
    onChange(POSITIONS[next]);
    refs.current[next]?.focus();
  };
  return (
    <div className={s.posGrid} role="radiogroup" aria-label={t("ice.crop.position")} onKeyDown={key}>
      {POSITIONS.map((p, i) => (
        <button key={p} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === p}
          tabIndex={i === at ? 0 : -1} title={t(`ice.crop.pos.${posKey(p)}`)} aria-label={t(`ice.crop.pos.${posKey(p)}`)}
          className={cls(s.posCell, value === p && s.posCellOn)} onClick={() => onChange(p)} />
      ))}
    </div>
  );
}
