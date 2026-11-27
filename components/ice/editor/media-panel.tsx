"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  IceAsset, IceCrop, IceElement, IceFrame, IceLocale, IcePhoneRatio, IceResult, IceSlotSpec, IceSlotState, IceSlotWrite, IceTransport, IceVersion,
} from "@/lib/ice/types";
import { ICE_LOCALES, ICE_PHONE_RATIOS } from "@/lib/ice/types";
import { altProblem, normaliseText } from "@/lib/ice/validate";
import { ICE_GIF_MIME, ICE_MAX_SAMPLE_BYTES, isIceMime } from "@/lib/ice/sniff";
import { BANNER_FRAME, BANNER_PHONE_5_4, ratioOf } from "@/lib/seller-home-config";
import { notify } from "@/lib/notify";
import { CENTER, CropEditor, MediaPaint, PHONE_REF_WIDTH, PositionGrid, frameBox, isCenter, isPosition, zoomCap } from "./crop";
import { LibraryPicker } from "./library";
import { uploadOne } from "./upload";
import { makeStill } from "./poster";
import {
  Btn, LocaleTabs, Sheet, bytes, call, cls, errorText, fitWarnings, previewUrl, roleLabel, sectionLabel, when,
  type EditorCtx, type T,
} from "./shared";
import s from "./editor.module.css";

/**
 * ONE PICTURE (OR CLIP) SLOT — and the parts the pair and samples panels
 * reuse: the draft a panel edits, the write it becomes, the file chooser, the
 * per-language alt text, and the slot's history.
 *
 * Nothing here is saved until "Zapisz": the panel edits a DRAFT of the slot's
 * state, and every write carries the slot's updatedAt as `base`, so a change
 * made meanwhile elsewhere (another admin, Admin → Media) is refused as a
 * conflict instead of being overwritten. Files are never deleted from here —
 * "Usuń przypisanie" empties the slot, the file stays in the library.
 */

/* ── drafts and writes ────────────────────────────────────────────────── */

export type AltDraft = Record<IceLocale, string>;

export type Draft = {
  media: IceAsset | null;
  mobile: IceAsset | null;
  /** A banner's tablet file (27.11.2026). */
  tablet: IceAsset | null;
  poster: IceAsset | null;
  alt: AltDraft;
  position: string;
  crop: IceCrop;
  /** The phone file's own frame (crop.m). */
  cropM: IceCrop;
  /** The tablet file's own frame (crop.t). */
  cropT: IceCrop;
  /** A banner's phone shape (crop.pr) and dimming in % (crop.ov). */
  phoneRatio: IcePhoneRatio;
  overlay: number;
};

/** The dimming a banner has always had (the shipped gradient, unscaled). */
export const OVERLAY_DEFAULT = 100;

const plain = (c: IceCrop): IceCrop => ({ x: c.x, y: c.y, zoom: c.zoom });

export function draftOf(st: IceSlotState): Draft {
  return {
    media: st.media,
    mobile: st.mobile,
    poster: st.poster,
    // The Polish alt is the single legacy alt_text whenever there is one: the
    // editor writes both equal, and Admin → Media updates only alt_text — so
    // when they differ, alt_text is the newer one.
    // For an existing row alt_text is the Polish alt even when empty (Admin →
    // Media clearing it must not bring the editor's old one back).
    alt: { pl: st.exists ? st.alt ?? "" : st.altI18n.pl ?? "", en: st.altI18n.en ?? "", de: st.altI18n.de ?? "" },
    position: st.position,
    crop: st.crop ? plain(st.crop) : CENTER,
    cropM: st.crop?.m ? plain(st.crop.m) : CENTER,
    tablet: st.tablet,
    cropT: st.crop?.t ? plain(st.crop.t) : CENTER,
    phoneRatio: st.crop?.pr ?? "1:1",
    overlay: st.crop?.ov ?? OVERLAY_DEFAULT,
  };
}

/** A GIF where the slot takes one: its first frame is the "poster". */
const isGif = (a: IceAsset | null | undefined) => a?.mime === ICE_GIF_MIME;
/** The still a write carries: a clip's poster, or a GIF's first frame. */
const stillAllowed = (spec: IceSlotSpec, media: IceAsset | null) => media?.kind === "video" || (Boolean(spec.gif) && isGif(media));

/** The slot's frame as stored: every part only where the slot has it, and
 *  nothing at all when it is all default (what the renderers paint anyway). */
export function draftFrame(spec: IceSlotSpec, d: Pick<Draft, "crop" | "cropM" | "cropT" | "phoneRatio" | "overlay">, has: { mobile: boolean; tablet: boolean }): IceFrame | null {
  const pr = spec.banner && d.phoneRatio !== "1:1" ? d.phoneRatio : undefined;
  const ov = spec.banner && d.overlay !== OVERLAY_DEFAULT ? Math.round(Math.min(100, Math.max(0, d.overlay))) : undefined;
  const trivial = isCenter(d.crop) && (!has.mobile || isCenter(d.cropM)) && (!has.tablet || isCenter(d.cropT)) && pr === undefined && ov === undefined;
  if (trivial) return null;
  return {
    ...d.crop,
    ...(has.mobile ? { m: d.cropM } : {}),
    ...(has.tablet ? { t: d.cropT } : {}),
    ...(pr ? { pr } : {}),
    ...(ov !== undefined ? { ov } : {}),
  };
}

export function cleanAlt(alt: AltDraft): Partial<Record<IceLocale, string>> {
  const out: Partial<Record<IceLocale, string>> = {};
  for (const l of ICE_LOCALES) {
    const v = normaliseText(alt[l]);
    if (v) out[l] = v;
  }
  return out;
}

export const altInvalid = (alt: AltDraft) => ICE_LOCALES.some((l) => altProblem(normaliseText(alt[l])) !== null);

/**
 * The write a draft makes. A centred, unzoomed frame is stored as no crop
 * (what the renderers paint by default), so an untouched draft makes exactly
 * the write its state would — that equality is the panel's "changed" test.
 */
export function writeOf(spec: IceSlotSpec, d: Draft, st: IceSlotState): IceSlotWrite {
  const media = d.media;
  const video = media?.kind === "video";
  const mobile = media && spec.mobile ? d.mobile : null;
  const tablet = media && spec.tablet ? d.tablet : null;
  const altI18n = cleanAlt(d.alt);
  // Position-only slots are painted by the frozen tool-card renderer, which
  // knows no crop: the server refuses one there.
  const crop: IceSlotWrite["crop"] = media && !spec.positionOnly ? draftFrame(spec, d, { mobile: Boolean(mobile), tablet: Boolean(tablet) }) : null;
  return {
    key: spec.key,
    mediaType: video ? "video" : "image",
    mediaId: media?.id ?? null,
    mobileMediaId: mobile?.id ?? null,
    // Only a slot with its own tablet file names one (older slots: the server keeps it).
    ...(spec.tablet ? { tabletMediaId: tablet?.id ?? null } : {}),
    posterMediaId: stillAllowed(spec, media) ? d.poster?.id ?? null : null,
    alt: altI18n.pl ?? null,
    altI18n,
    fit: st.fit,
    position: d.position,
    crop,
    base: st.updatedAt,
  };
}

export const sameWrite = (a: IceSlotWrite, b: IceSlotWrite) => JSON.stringify(a) === JSON.stringify(b);

/* ── history snapshots (content_versions, target 'slot') ──────────────── */

/** One side of a version row: the slot's columns as they were. null = the
 *  row did not exist (or was deleted). */
export type Snap = {
  mediaType: "image" | "video";
  mediaId: string | null;
  mobileId: string | null;
  tabletId: string | null;
  posterId: string | null;
  altI18n: Partial<Record<IceLocale, string>>;
  fit: "cover" | "contain" | null;
  position: string | null;
  crop: IceFrame | null;
  updatedAt: string | null;
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

function cropValue(v: unknown): IceCrop | null {
  if (!v || typeof v !== "object") return null;
  const { x, y, zoom } = v as Record<string, unknown>;
  return typeof x === "number" && typeof y === "number" && typeof zoom === "number" ? { x, y, zoom } : null;
}

export function readSnapshot(v: unknown): Snap | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const altI18n: Partial<Record<IceLocale, string>> = {};
  if (o.alt_i18n && typeof o.alt_i18n === "object" && !Array.isArray(o.alt_i18n)) {
    for (const l of ICE_LOCALES) {
      const a = str((o.alt_i18n as Record<string, unknown>)[l]);
      if (a) altI18n[l] = a;
    }
  }
  // As in draftOf: alt_text is the Polish alt (an empty one included).
  const legacy = str(o.alt_text);
  if (legacy) altI18n.pl = legacy;
  else delete altI18n.pl;
  const main = cropValue(o.crop);
  const raw = (main ? o.crop : {}) as Record<string, unknown>;
  const m = main ? cropValue(raw.m) : null;
  const tc = main ? cropValue(raw.t) : null;
  const pr = (ICE_PHONE_RATIOS as readonly unknown[]).includes(raw.pr) ? raw.pr as IcePhoneRatio : null;
  const ov = typeof raw.ov === "number" && Number.isInteger(raw.ov) && raw.ov >= 0 && raw.ov <= 100 ? raw.ov : null;
  return {
    mediaType: o.media_type === "video" ? "video" : "image",
    mediaId: str(o.media_id),
    mobileId: str(o.mobile_media_id),
    tabletId: str(o.tablet_media_id),
    posterId: str(o.poster_media_id),
    altI18n,
    fit: o.object_fit === "contain" || o.object_fit === "cover" ? o.object_fit : null,
    position: str(o.object_position),
    crop: main ? { ...main, ...(m ? { m } : {}), ...(tc ? { t: tc } : {}), ...(pr ? { pr } : {}), ...(ov !== null ? { ov } : {}) } : null,
    updatedAt: str(o.updated_at),
  };
}

/** The write that puts a slot back to a snapshot. No snapshot (the row did
 *  not exist then) = an empty slot. The tablet file is the server's to keep. */
export function snapshotWrite(spec: IceSlotSpec, snap: Snap | null, st: IceSlotState): IceSlotWrite {
  const mediaId = snap?.mediaId ?? null;
  const video = mediaId !== null && snap?.mediaType === "video";
  // The snapshot's own phone file, also for a slot the editor frames without
  // one (a tool card's file from Admin → Media); its crop.m only where the
  // editor frames phone files.
  const mobile = mediaId ? snap?.mobileId ?? null : null;
  const tablet = mediaId && spec.tablet ? snap?.tabletId ?? null : null;
  const altI18n = { ...(snap?.altI18n ?? {}) };
  const c = snap?.crop ?? null;
  // crop.m only with a phone file, crop.t only with a tablet file, the phone
  // shape and the dimming only on a banner — what the server accepts.
  const frame: IceFrame | null = !mediaId || spec.positionOnly || !c ? null : {
    ...plain(c),
    ...(c.m && mobile && spec.mobile ? { m: c.m } : {}),
    ...(c.t && tablet ? { t: c.t } : {}),
    ...(c.pr && spec.banner ? { pr: c.pr } : {}),
    ...(c.ov !== undefined && spec.banner ? { ov: c.ov } : {}),
  };
  // A snapshot's still: a clip's poster, or (in a GIF slot) an image's still.
  const posterId = mediaId && (video || spec.gif) ? snap?.posterId ?? null : null;
  return {
    key: spec.key,
    mediaType: video ? "video" : "image",
    mediaId,
    mobileMediaId: mobile,
    ...(spec.tablet ? { tabletMediaId: tablet } : {}),
    posterMediaId: posterId,
    alt: altI18n.pl ?? null,
    altI18n,
    fit: snap?.fit ?? st.fit,
    position: isPosition(snap?.position) ? snap.position : st.position,
    crop: frame,
    base: st.updatedAt,
  };
}

const idsOf = (w: IceSlotWrite) => [w.mediaId, w.mobileMediaId, w.tabletMediaId ?? null, w.posterMediaId];

function refused<R>(r: IceResult<R>): r is { ok: false; error: string; current?: unknown } {
  return !r.ok;
}

/** Library files by id (in pages of 60, the action's cap). An id missing
 *  from the map is a file that no longer exists. */
export async function resolveAssets(transport: IceTransport, ids: (string | null | undefined)[]): Promise<IceResult<Map<string, IceAsset>>> {
  const want = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const out = new Map<string, IceAsset>();
  for (let i = 0; i < want.length; i += 60) {
    const res = await call(transport.assets(want.slice(i, i + 60)));
    if (refused(res)) return res;
    for (const a of res.data) out.set(a.id, a);
  }
  return { ok: true, data: out };
}

/* ── loading and writing ──────────────────────────────────────────────── */

export function useSlotStates(ctx: EditorCtx, keys: readonly string[]) {
  const { transport } = ctx;
  const joined = keys.join("\n");
  const [states, setStates] = useState<IceSlotState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    const res = await call(transport.slotState(joined.split("\n")));
    if (!live.current) return;
    if (refused(res)) setError(res.error);
    else {
      setError(null);
      setStates(res.data);
    }
  }, [joined, transport]);
  useEffect(() => {
    void load();
  }, [load]);
  return { states, error, load };
}

export type SlotRef = { spec: IceSlotSpec; state: IceSlotState };

/**
 * Every write a slot panel makes — one slotSave each, all slots or none.
 * On a conflict the box says so and the state is re-read; the draft stays,
 * so saving again overwrites knowingly.
 */
export function useSlotWriter(ctx: EditorCtx, reload: () => Promise<void>, done: () => void) {
  const { t, transport } = ctx;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const commit = async (writes: IceSlotWrite[], action: "save" | "restore" | "clear") => {
    setBusy(true);
    setProblem(null);
    const res = await call(transport.slotSave({ writes, action }));
    setBusy(false);
    if (refused(res)) {
      setProblem(errorText(t, res.error));
      if (res.error === "conflict") void reload();
      return;
    }
    notify.success(t(action === "clear" ? "ice.media.cleared" : action === "restore" ? "ice.history.restored" : "ice.saved"));
    void ctx.reload();
    done();
  };

  /** Back to snapshots — refused before any write when a file they name is
   *  gone from the library. */
  const restore = async (items: (SlotRef & { snap: Snap | null })[]) => {
    setBusy(true);
    setProblem(null);
    const writes = items.map((i) => snapshotWrite(i.spec, i.snap, i.state));
    const found = await resolveAssets(transport, writes.flatMap(idsOf));
    if (refused(found) || writes.some((w) => idsOf(w).some((id) => id && !found.data.has(id)))) {
      setBusy(false);
      setProblem(refused(found) ? errorText(t, found.error) : t("ice.history.fileGone"));
      return;
    }
    await commit(writes, "restore");
  };

  /** "Przywróć poprzednie": each slot as it was before its last change. */
  const restorePrevious = async (slots: SlotRef[]) => {
    setBusy(true);
    setProblem(null);
    const res = await Promise.all(slots.map((x) => call(transport.history({ target: "slot", key: x.spec.key, limit: 1 }))));
    const bad = res.find(refused);
    if (bad) {
      setBusy(false);
      setProblem(errorText(t, bad.error));
      return;
    }
    // "The last change" of a pair or a bulk is ONE write: every slot it
    // changed got a history row with the same time (one transaction). A slot
    // whose newest row is older was not part of it and is left as it is —
    // rolling it back too would undo an earlier, unrelated change.
    const newest = res.map((r) => (r.ok ? r.data[0] : undefined));
    const last = newest.reduce<string | null>((m, v) => (v && (!m || v.createdAt > m) ? v.createdAt : m), null);
    const items = slots.flatMap((x, i) => {
      const v = newest[i];
      return v && v.createdAt === last ? [{ ...x, snap: readSnapshot(v.before) }] : [];
    });
    if (items.length === 0) {
      setBusy(false);
      notify.info(t("ice.history.nothing"));
      return;
    }
    await restore(items);
  };

  /** Empty the slots (the files stay in the library). */
  const clear = async (slots: SlotRef[], confirmKey: string) => {
    if (!window.confirm(t(confirmKey))) return;
    await commit(slots.map(({ spec, state }) => ({
      ...writeOf(spec, draftOf(state), state), mediaType: "image", mediaId: null, mobileMediaId: null, posterMediaId: null, crop: null,
      ...(spec.tablet ? { tabletMediaId: null } : {}),
    })), "clear");
  };

  return { busy, problem, commit, restore, restorePrevious, clear };
}

/* ── small shared pieces ──────────────────────────────────────────────── */

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** "1080/1350" → "4:5"; an awkward one → "1,34:1". */
export function ratioText(ratio: string, locale: IceLocale): string {
  const [w, h] = ratio.split("/").map(Number);
  if (!(w > 0 && h > 0)) return ratio;
  const g = gcd(w, h);
  if (w / g <= 32 && h / g <= 32) return `${w / g}:${h / g}`;
  const n = (w / h).toFixed(2);
  return `${locale === "en" ? n : n.replace(".", ",")}:1`;
}

export function SlotFacts({ spec, t, locale }: { spec: IceSlotSpec; t: T; locale: IceLocale }) {
  return (
    <div className={s.row}>
      <span className={s.chip}>{t("ice.media.size", { w: spec.width, h: spec.height })}</span>
      <span className={s.chip}>{t("ice.media.ratio", { ratio: ratioText(spec.ratio, locale) })}</span>
      <span className={s.chip}>{t(spec.gif ? "ice.media.kindAnyGif" : spec.video && !spec.sample ? "ice.media.kindAny" : "ice.media.kindImage")}</span>
    </div>
  );
}

export function AssetThumb({ asset }: { asset: IceAsset }) {
  if (asset.kind === "video") {
    return asset.posterUrl
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={asset.posterUrl} alt="" loading="lazy" />
      : <video src={asset.url} muted playsInline preload="metadata" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={previewUrl(asset, 160)} alt="" loading="lazy" />;
}

export function AssetLine({ asset }: { asset: IceAsset }) {
  return (
    <p className={s.meta}>
      {asset.title ?? "—"}{asset.width && asset.height ? ` · ${asset.width}×${asset.height} px` : ""} · {bytes(asset.sizeBytes)}
    </p>
  );
}

export function Warnings({ items }: { items: string[] }) {
  return <>{items.map((w) => <p key={w} className={s.warn}>{w}</p>)}</>;
}

/** Why a library file cannot fill this place — the server checks again. */
function pickProblem(a: IceAsset, kind: "image" | "video" | undefined, sample: boolean, gif = false): string | null {
  if (a.kind === "file" || (kind && a.kind !== kind)) return "asset_kind";
  // A GIF only where the place takes one (a /home carousel tile, never a sample).
  if (!a.mime || !(isIceMime(a.mime) || (gif && !sample && a.mime === ICE_GIF_MIME))) return "asset_format";
  if (sample && a.sizeBytes !== null && a.sizeBytes > ICE_MAX_SAMPLE_BYTES) return "asset_too_large";
  return null;
}

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
const VIDEO_ACCEPT = "video/mp4,video/webm";

/** "Wgraj nowe" + "Wybierz z biblioteki" (+ "Usuń" when given) for one file. */
export function AssetChooser({ ctx, kind, sample, gif = false, onPick, onRemove, disabled }: {
  ctx: EditorCtx;
  /** Only this kind may be chosen; none = picture or clip. */
  kind?: "image" | "video";
  sample?: boolean;
  /** The place takes an animated GIF too (a /home carousel tile). */
  gif?: boolean;
  /** `file`: the file just uploaded (read locally for a still), absent for a
   *  library pick. */
  onPick: (asset: IceAsset, file?: File) => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const { t } = ctx;
  const [library, setLibrary] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const take = (a: IceAsset, file?: File): boolean => {
    const problem = pickProblem(a, kind, Boolean(sample), gif);
    if (problem) notify.error(errorText(t, problem));
    else onPick(a, file);
    return !problem;
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const res = await uploadOne(ctx.transport, file, { sample, kind, gif });
    setUploading(false);
    if (res.ok) take(res.asset, file);
    else notify.error(`${file.name}: ${errorText(t, res.error)}`);
  };

  return (
    <div className={s.row}>
      <Btn small onClick={() => fileRef.current?.click()} disabled={disabled || uploading}>
        {uploading ? t("ice.media.uploading") : t("ice.media.upload")}
      </Btn>
      <input ref={fileRef} type="file" hidden aria-label={t("ice.media.upload")}
        accept={`${kind === "video" ? VIDEO_ACCEPT : kind === "image" ? IMAGE_ACCEPT : `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`}${gif && kind !== "video" ? ",image/gif" : ""}`}
        onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      <Btn small onClick={() => setLibrary(true)} disabled={disabled || uploading}>{t("ice.media.fromLibrary")}</Btn>
      {onRemove && <Btn small kind="ghost" onClick={onRemove} disabled={disabled || uploading}>{t("ice.media.remove")}</Btn>}
      {library && (
        <LibraryPicker ctx={ctx} kind={kind} sample={sample} gif={gif} onClose={() => setLibrary(false)}
          onPick={(a) => { if (take(a)) setLibrary(false); }} />
      )}
    </div>
  );
}

/** Alt text per language: plain, one line, ≤ 300 (lib/ice/validate). */
export function AltEditor({ value, onChange, t, initial }: {
  value: AltDraft; onChange: (locale: IceLocale, v: string) => void; t: T; initial: IceLocale;
}) {
  const [loc, setLoc] = useState<IceLocale>(initial);
  const id = useId();
  const filled = new Set(ICE_LOCALES.filter((l) => value[l].trim() !== ""));
  const problems = ICE_LOCALES.flatMap((l) => {
    const p = altProblem(normaliseText(value[l]));
    return p ? [{ l, p }] : [];
  });
  return (
    <div className={s.field}>
      <div className={s.between}>
        <label className={s.label} htmlFor={id}>{t("ice.media.alt")}</label>
        <span className={s.meta}>{value[loc].length}/300</span>
      </div>
      <LocaleTabs value={loc} onChange={setLoc} marked={filled} t={t} />
      <input id={id} className={s.input} value={value[loc]} maxLength={300} lang={loc}
        aria-invalid={problems.some((x) => x.l === loc)} onChange={(e) => onChange(loc, e.target.value)} />
      <p className={s.meta}>{t("ice.media.altHint")}</p>
      {problems.map(({ l, p }) => <p key={l} className={s.error}>{t(`ice.locale.${l}`)}: {errorText(t, `alt_${p}`)}</p>)}
    </div>
  );
}

const ACTIONS = new Set(["save", "reset", "restore", "clear", "bulk", "external"]);

function SnapThumb({ snap, files, label, t }: { snap: Snap | null; files: Map<string, IceAsset> | null; label: string; t: T }) {
  const id = snap?.mediaId ?? null;
  const a = id && files ? files.get(id) : undefined;
  return (
    <span className={s.histThumb} title={label}>
      <span className={s.srOnly}>{label}</span>
      {!id ? t("ice.history.noFile") : a ? <AssetThumb asset={a} /> : files ? t("ice.history.goneShort") : null}
    </span>
  );
}

/** A slot's versions (several slots: merged, newest first), each with what
 *  was there before and after, and "Przywróć tę wersję". */
export function SlotHistory({ ctx, slots, busy, onRestore }: {
  ctx: EditorCtx;
  slots: (SlotRef & { tag?: string })[];
  busy: boolean;
  onRestore: (item: SlotRef & { snap: Snap | null }) => void;
}) {
  const { t, transport } = ctx;
  const [rows, setRows] = useState<{ key: string; v: IceVersion }[] | null>(null);
  const [files, setFiles] = useState<Map<string, IceAsset> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const keys = slots.map((x) => x.spec.key).join("\n");

  useEffect(() => {
    let live = true;
    void (async () => {
      const list = keys.split("\n");
      const res = await Promise.all(list.map((key) => call(transport.history({ target: "slot", key, limit: 20 }))));
      if (!live) return;
      const bad = res.find(refused);
      if (bad) {
        setProblem(bad.error);
        return;
      }
      const merged = res.flatMap((r, i) => (r.ok ? r.data.map((v) => ({ key: list[i], v })) : []))
        .sort((a, b) => Date.parse(b.v.createdAt) - Date.parse(a.v.createdAt));
      setRows(merged);
      const snaps = merged.flatMap(({ v }) => [readSnapshot(v.before), readSnapshot(v.after)]);
      const found = await resolveAssets(transport, snaps.flatMap((x) => (x ? [x.mediaId, x.mobileId, x.tabletId, x.posterId] : [])));
      if (!live) return;
      if (refused(found)) setProblem(found.error);
      else setFiles(found.data);
    })();
    return () => {
      live = false;
    };
  }, [keys, transport]);

  if (problem) return <p className={s.error}>{errorText(t, problem)}</p>;
  if (!rows) return <p className={s.meta}>{t("ice.history.loading")}</p>;
  if (rows.length === 0) return <p className={s.meta}>{t("ice.history.empty")}</p>;
  return (
    <ul className={s.list}>
      {rows.map(({ key, v }) => {
        const slot = slots.find((x) => x.spec.key === key);
        if (!slot) return null;
        const before = readSnapshot(v.before);
        const after = readSnapshot(v.after);
        const restoreIds = after
          ? [after.mediaId, slot.spec.mobile ? after.mobileId : null, slot.spec.tablet ? after.tabletId : null, after.mediaType === "video" || slot.spec.gif ? after.posterId : null]
          : [];
        const gone = files !== null && restoreIds.some((id) => id && !files.has(id));
        const current = Boolean(after?.updatedAt && slot.state.updatedAt && Date.parse(after.updatedAt) === Date.parse(slot.state.updatedAt));
        return (
          <li key={v.id} className={s.item}>
            <div className={s.between}>
              <div className={s.row}>
                <span className={cls(s.chip, s.chipAccent)}>{t(`ice.history.action.${ACTIONS.has(v.action) ? v.action : "external"}`)}</span>
                {slot.tag && <span className={s.chip}>{slot.tag}</span>}
                {current && <span className={cls(s.chip, s.ok)}>{t("ice.history.current")}</span>}
              </div>
              <span className={s.meta}>{when(v.createdAt, ctx.locale)}</span>
            </div>
            <span className={s.meta}>{v.author ? t("ice.history.by", { name: v.author }) : t("ice.history.byUnknown")}</span>
            <div className={s.histThumbs}>
              <SnapThumb snap={before} files={files} label={t("ice.history.before")} t={t} />
              <span aria-hidden="true">→</span>
              <SnapThumb snap={after} files={files} label={t("ice.history.after")} t={t} />
            </div>
            {gone
              ? <p className={s.warn}>{t("ice.history.fileGone")}</p>
              : !current && (
                <div className={s.row}>
                  <Btn small disabled={busy || files === null} onClick={() => onRestore({ spec: slot.spec, state: slot.state, snap: after })}>
                    {t("ice.history.restore")}
                  </Btn>
                </div>
              )}
          </li>
        );
      })}
    </ul>
  );
}

/** The kind a slot's main file may be: samples and picture slots → image. */
export const mainKind = (spec: IceSlotSpec): "image" | undefined => (spec.video && !spec.sample ? undefined : "image");

/* ── the panel ────────────────────────────────────────────────────────── */

export function MediaPanel({ ctx, element, spec, onClose, onBack, onDone, label }: {
  ctx: EditorCtx;
  element: IceElement;
  /** Defaults to the element's only slot (the samples panel passes one). */
  spec?: IceSlotSpec;
  onClose: () => void;
  /** Shows "back" (to the samples grid); also what "Anuluj" does then. */
  onBack?: () => void;
  /** After a successful write (default: onClose). */
  onDone?: () => void;
  /** Replaces the element's role label (a sample's number). */
  label?: string;
}) {
  const slot = spec ?? element.slots?.[0];
  if (!slot) {
    return (
      <Sheet t={ctx.t} title={label ?? roleLabel(ctx.t, element)} onClose={onClose}>
        <p className={s.error}>{errorText(ctx.t, "unknown_slot")}</p>
      </Sheet>
    );
  }
  return <SlotPanel ctx={ctx} element={element} spec={slot} onClose={onClose} onBack={onBack} onDone={onDone ?? onClose} label={label} />;
}

type Device = "desktop" | "tablet" | "phone";

/**
 * A /home banner's LIVE PREVIEW on the page itself (27.11.2026): the dimming
 * (the overlay layer's opacity) and the phone shape (the frame's --ar-phone),
 * while the panel is open. Nothing is written until "Zapisz"; closing the
 * panel puts the page back exactly as it was (after a save the page is
 * re-rendered with the saved values anyway).
 */
function useBannerPreview(dom: string | undefined, on: boolean, overlay: number, phoneRatio: IcePhoneRatio) {
  const original = useRef<{ overlay: string; ar: string } | null>(null);
  useEffect(() => {
    if (!on || !dom) return;
    const root = document.querySelector<HTMLElement>(dom);
    const layer = root?.querySelector<HTMLElement>("[data-promo-overlay]");
    const frame = root?.querySelector<HTMLElement>("[data-promo-frame]");
    if (!original.current) original.current = { overlay: layer?.style.opacity ?? "", ar: frame?.style.getPropertyValue("--ar-phone") ?? "" };
    if (layer) layer.style.opacity = String(Math.min(100, Math.max(0, overlay)) / 100);
    if (frame) frame.style.setProperty("--ar-phone", ratioOf(phoneRatio === "5:4" ? BANNER_PHONE_5_4 : BANNER_FRAME.phone));
  }, [dom, on, overlay, phoneRatio]);
  useEffect(() => () => {
    const was = original.current;
    if (!was || !dom) return;
    const root = document.querySelector<HTMLElement>(dom);
    const layer = root?.querySelector<HTMLElement>("[data-promo-overlay]");
    const frame = root?.querySelector<HTMLElement>("[data-promo-frame]");
    if (layer) layer.style.opacity = was.overlay;
    if (frame) frame.style.setProperty("--ar-phone", was.ar);
  }, [dom]);
}

function SlotPanel({ ctx, element, spec, onClose, onBack, onDone, label }: {
  ctx: EditorCtx; element: IceElement; spec: IceSlotSpec; onClose: () => void; onBack?: () => void; onDone: () => void; label?: string;
}) {
  const { t } = ctx;
  const { states, error: loadError, load } = useSlotStates(ctx, [spec.key]);
  const state = states?.find((x) => x.key === spec.key) ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const view = draft ?? (state ? draftOf(state) : null);
  const edit = (fn: (d: Draft) => Draft) =>
    setDraft((d) => {
      const from = d ?? (state ? draftOf(state) : null);
      return from ? fn(from) : d;
    });
  const writer = useSlotWriter(ctx, load, onDone);
  const [showHistory, setShowHistory] = useState(false);
  const [device, setDevice] = useState<Device>("desktop");
  const [stilling, setStilling] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showHistory) historyRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [showHistory]);
  const overlayId = useId();
  useBannerPreview(element.dom, Boolean(spec.banner && view), view?.overlay ?? OVERLAY_DEFAULT, view?.phoneRatio ?? "1:1");

  const role = roleLabel(t, element);
  const title = label ?? role;
  const crumbs = [ctx.pageLabel, sectionLabel(t, ctx.info, element.id), role, label].filter(Boolean).join(" · ");
  const group = ctx.info.kind === "registry" ? ctx.info.page.bulk?.find((g) => g.slots.includes(spec.key)) : undefined;
  // A banner's phone frame follows the shape chosen in the draft.
  const phoneRatio = spec.banner
    ? ratioOf(view?.phoneRatio === "5:4" ? BANNER_PHONE_5_4 : BANNER_FRAME.phone)
    : spec.frames?.find((f) => f.label === "phone")?.ratio ?? spec.ratio;
  const tabletRatio = spec.frames?.find((f) => f.label === "tablet")?.ratio ?? spec.ratio;
  const media = view?.media ?? null;
  const mobile = spec.mobile && media ? view?.mobile ?? null : null;
  const tablet = spec.tablet && media ? view?.tablet ?? null : null;

  const write = state && view ? writeOf(spec, view, state) : null;
  const dirty = Boolean(state && write && !sameWrite(write, writeOf(spec, draftOf(state), state)));
  const invalid = view ? altInvalid(view.alt) : false;

  /** A clip's poster / a GIF's first frame, made in the browser and put in
   *  the library (./poster.ts) — once, when the file is chosen. */
  const autoStill = async (a: IceAsset, file?: File) => {
    setStilling(true);
    const res = await makeStill(ctx.transport, a, file);
    setStilling(false);
    if (res.ok) edit((d) => (d.media?.id === a.id ? { ...d, poster: res.poster } : d));
    else notify.error(t("ice.media.posterFailed"));
  };

  const setMain = (a: IceAsset, file?: File) => {
    edit((d) => {
      const keepMobile = d.mobile?.kind === a.kind;
      const keepTablet = d.tablet?.kind === a.kind;
      return {
        ...d,
        media: a,
        // A new file starts centred: the old frame was chosen for another picture.
        crop: CENTER,
        // A new file gets its own still (made below); a phone / tablet file
        // must be the same kind as the main one.
        poster: null,
        mobile: keepMobile ? d.mobile : null,
        cropM: keepMobile ? d.cropM : CENTER,
        tablet: keepTablet ? d.tablet : null,
        cropT: keepTablet ? d.cropT : CENTER,
        alt: d.alt.pl.trim() || !a.alt ? d.alt : { ...d.alt, pl: a.alt },
      };
    });
    if (a.kind === "video" || (spec.gif && isGif(a))) void autoStill(a, file);
  };

  const footer = state && view ? (
    <>
      <Btn small kind="ghost" onClick={() => setShowHistory((v) => !v)}>{showHistory ? t("ice.history.hide") : t("ice.history.title")}</Btn>
      <Btn small kind="ghost" disabled={writer.busy || !state.exists} onClick={() => void writer.restorePrevious([{ spec, state }])}>
        {t("ice.media.restorePrev")}
      </Btn>
      <Btn small kind="danger" disabled={writer.busy || !state.media} onClick={() => void writer.clear([{ spec, state }], "ice.media.confirmClear")}>
        {t("ice.media.clear")}
      </Btn>
      <span className={s.grow} />
      <Btn onClick={onBack ?? onClose} disabled={writer.busy}>{t("ice.cancel")}</Btn>
      <Btn kind="primary" disabled={writer.busy || stilling || !dirty || invalid || !media} onClick={() => { if (write) void writer.commit([write], "save"); }}>
        {writer.busy ? t("ice.media.saving") : t("ice.save")}
      </Btn>
    </>
  ) : undefined;

  /** One device's own file of a banner: chooser, its frame, or the note that
   *  the desktop file stands in (shown in that device's shape). */
  const deviceFile = (which: "tablet" | "phone") => {
    if (!view || !state) return null;
    const own = which === "tablet" ? tablet : mobile;
    const ratio = which === "tablet" ? tabletRatio : phoneRatio;
    const crop = which === "tablet" ? view.cropT : view.cropM;
    return (
      <div className={s.field} data-banner-device={which}>
        <p className={s.meta}>{t(which === "tablet" ? "ice.media.tabletHint" : "ice.media.phoneHint", { ratio: ratioText(ratio, ctx.locale) })}</p>
        <AssetChooser ctx={ctx} kind={media?.kind === "video" ? "video" : "image"} disabled={!media}
          onPick={(a) => edit((d) => (which === "tablet" ? { ...d, tablet: a, cropT: CENTER } : { ...d, mobile: a, cropM: CENTER }))}
          onRemove={own ? () => edit((d) => (which === "tablet" ? { ...d, tablet: null, cropT: CENTER } : { ...d, mobile: null, cropM: CENTER })) : undefined} />
        {!media && <p className={s.meta}>{t("ice.media.mobileNeedsMain")}</p>}
        {own ? (
          <>
            <AssetLine asset={own} />
            <CropEditor asset={own} crop={crop} onChange={(c) => edit((d) => (which === "tablet" ? { ...d, cropT: c } : { ...d, cropM: c }))}
              ratio={ratio} fit={state.fit} t={t} maxZoom={zoomCap(own, which === "tablet" ? { width: BANNER_FRAME.tablet.width } : { width: PHONE_REF_WIDTH })}
              label={t(which === "tablet" ? "ice.crop.frameTablet" : "ice.crop.framePhone")} />
            <Warnings items={fitWarnings(t, own, { width: 0, height: 0, ratio })} />
          </>
        ) : media && (
          <>
            <p className={s.note}>{t("ice.media.deviceInherits")}</p>
            <div className={s.frame} style={frameBox(ratio)}>
              <MediaPaint asset={media} crop={view.crop} fit={state.fit} min={640} />
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <Sheet t={t} title={title} crumbs={crumbs} onClose={onClose} footer={footer}>
      {onBack && <div><Btn small kind="ghost" onClick={onBack}>{t("ice.samples.back")}</Btn></div>}
      {!state && (loadError
        ? <>
          <p className={s.error}>{errorText(t, loadError)}</p>
          <div><Btn small onClick={() => void load()}>{t("ice.media.retry")}</Btn></div>
        </>
        : <p className={s.meta}>{t("ice.media.loading")}</p>)}
      {state && view && (
        <>
          <SlotFacts spec={spec} t={t} locale={ctx.locale} />
          {spec.sharedWith && <p className={s.note}>{t("ice.media.shared", { page: spec.sharedWith })}</p>}
          {spec.inherits && <p className={s.note}>{t("ice.media.inherits")}</p>}
          {spec.positionOnly && <p className={s.note}>{t("ice.media.positionOnly")}</p>}
          {spec.sample && <p className={s.note}>{t("ice.samples.note")}</p>}
          {!state.enabled && <p className={s.warn}>{t("ice.media.disabled")}</p>}
          {writer.problem && <p className={s.error} role="alert">{writer.problem}</p>}

          {spec.banner && (
            <div className={s.row} role="tablist" aria-label={t("ice.media.devices")} data-banner-devices>
              {(["desktop", "tablet", "phone"] as const).map((d) => (
                <Btn key={d} small kind={device === d ? "primary" : "ghost"} onClick={() => setDevice(d)}
                  aria-selected={device === d} role="tab" data-device={d}>
                  {t(`ice.media.device.${d}`)}
                </Btn>
              ))}
            </div>
          )}

          {spec.banner && device === "tablet" ? deviceFile("tablet") : spec.banner && device === "phone" ? (
            <>
              <div className={s.field}>
                <span className={s.label}>{t("ice.media.phoneRatio")}</span>
                <div className={s.row} data-phone-ratio>
                  {ICE_PHONE_RATIOS.map((r) => (
                    <Btn key={r} small kind={view.phoneRatio === r ? "primary" : "ghost"} aria-pressed={view.phoneRatio === r}
                      onClick={() => edit((d) => ({ ...d, phoneRatio: r }))} data-ratio={r}>
                      {t(r === "5:4" ? "ice.media.phoneRatio54" : "ice.media.phoneRatio11")}
                    </Btn>
                  ))}
                </div>
              </div>
              {deviceFile("phone")}
            </>
          ) : (
            <>
              {!media ? (
                <div className={s.frame} style={frameBox(spec.ratio)}>
                  <span className={s.frameEmpty}>{t("ice.media.empty")}</span>
                </div>
              ) : spec.positionOnly ? (
                <div className={s.posWrap}>
                  <div className={cls(s.frame, s.posPreview)} style={{ aspectRatio: spec.ratio }}>
                    <MediaPaint asset={media} fit={state.fit} position={view.position} />
                  </div>
                  <div className={s.field}>
                    <span className={s.label}>{t("ice.crop.position")}</span>
                    <PositionGrid value={view.position} onChange={(p) => edit((d) => ({ ...d, position: p }))} t={t} />
                  </div>
                </div>
              ) : (
                <CropEditor asset={media} crop={view.crop} onChange={(c) => edit((d) => ({ ...d, crop: c }))}
                  ratio={spec.ratio} fit={state.fit} t={t} maxZoom={zoomCap(media, spec)} />
              )}

              {media && spec.frames && spec.frames.length > 0 && (
                <div className={s.field}>
                  <span className={s.label}>{t("ice.media.frames")}</span>
                  <div className={s.frames}>
                    {spec.frames.map((f) => {
                      // A device with its own file paints it, with its own frame.
                      const own = f.label === "phone" ? mobile : f.label === "tablet" && spec.tablet ? tablet : null;
                      const ratio = f.label === "phone" ? phoneRatio : f.ratio;
                      const crop = own ? (f.label === "phone" ? view.cropM : view.cropT) : view.crop;
                      return (
                        <figure key={f.label} className={s.figure}>
                          <div className={s.frame} style={{ aspectRatio: ratio }}>
                            {spec.positionOnly
                              ? <MediaPaint asset={media} fit={state.fit} position={view.position} min={320} />
                              : <MediaPaint asset={own ?? media} crop={crop} fit={state.fit} min={320} />}
                          </div>
                          <figcaption className={s.frameCaption}>{t(`ice.media.frame.${f.label}`)}</figcaption>
                        </figure>
                      );
                    })}
                  </div>
                </div>
              )}

              <AssetChooser ctx={ctx} kind={mainKind(spec)} sample={spec.sample} gif={spec.gif} onPick={setMain} />
              {media && <AssetLine asset={media} />}
              {media && <Warnings items={fitWarnings(t, media, spec)} />}

              {media && stillAllowed(spec, media) && (
                <div className={s.field} data-slot-still>
                  <span className={s.label}>{t(media.kind === "video" ? "ice.media.poster" : "ice.media.gifStill")}</span>
                  <div className={s.assetRow}>
                    <span className={s.histThumb}>{view.poster ? <AssetThumb asset={view.poster} /> : stilling ? t("ice.media.posterMaking") : t("ice.history.noFile")}</span>
                    <AssetChooser ctx={ctx} kind="image" onPick={(a) => edit((d) => ({ ...d, poster: a }))}
                      onRemove={view.poster ? () => edit((d) => ({ ...d, poster: null })) : undefined} disabled={stilling} />
                    <Btn small kind="ghost" disabled={stilling} onClick={() => void autoStill(media)}>{t("ice.media.posterMake")}</Btn>
                  </div>
                  {!view.poster && !stilling && <p className={s.warn}>{t(spec.gif ? "ice.media.posterMissingTile" : "ice.media.posterMissing")}</p>}
                  {media.kind === "video" && <p className={s.meta}>{t("ice.media.videoNote")}</p>}
                </div>
              )}

              {spec.mobile && !spec.banner && (
                <div className={s.field}>
                  <span className={s.label}>{t("ice.media.mobile")}</span>
                  <p className={s.meta}>{t("ice.media.mobileHint", { ratio: ratioText(phoneRatio, ctx.locale) })}</p>
                  <AssetChooser ctx={ctx} kind={media?.kind === "video" ? "video" : "image"} disabled={!media}
                    onPick={(a) => edit((d) => ({ ...d, mobile: a, cropM: CENTER }))}
                    onRemove={mobile ? () => edit((d) => ({ ...d, mobile: null, cropM: CENTER })) : undefined} />
                  {!media && <p className={s.meta}>{t("ice.media.mobileNeedsMain")}</p>}
                  {mobile && (
                    <>
                      <AssetLine asset={mobile} />
                      <CropEditor asset={mobile} crop={view.cropM} onChange={(c) => edit((d) => ({ ...d, cropM: c }))}
                        ratio={phoneRatio} fit={state.fit} t={t} maxZoom={zoomCap(mobile, { width: PHONE_REF_WIDTH })} label={t("ice.crop.framePhone")} />
                      {/* No recommended phone size in the registry: the shape is what matters. */}
                      <Warnings items={fitWarnings(t, mobile, { width: 0, height: 0, ratio: phoneRatio })} />
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {spec.banner && (
            <div className={s.field} data-banner-overlay>
              <div className={s.between}>
                <label className={s.label} htmlFor={overlayId}>{t("ice.media.overlay")}</label>
                <span className={s.meta} data-overlay-value>{t("ice.media.overlayValue", { n: view.overlay })}</span>
              </div>
              <input id={overlayId} type="range" min={0} max={100} step={1} value={view.overlay}
                onChange={(e) => edit((d) => ({ ...d, overlay: Number(e.target.value) }))}
                aria-valuetext={t("ice.media.overlayValue", { n: view.overlay })} />
              <p className={s.meta}>{t("ice.media.overlayHint")}</p>
              {view.overlay !== OVERLAY_DEFAULT && (
                <div><Btn small kind="ghost" onClick={() => edit((d) => ({ ...d, overlay: OVERLAY_DEFAULT }))}>{t("ice.media.overlayReset")}</Btn></div>
              )}
            </div>
          )}

          <AltEditor t={t} value={view.alt} initial={ctx.locale} onChange={(l, v) => edit((d) => ({ ...d, alt: { ...d.alt, [l]: v } }))} />

          {group && (
            <div className={s.between}>
              <span className={s.meta}>{t("ice.media.bulkHint")}</span>
              <Btn small onClick={() => ctx.openBulk(group.key)}>{t("ice.media.bulk")}</Btn>
            </div>
          )}

          {showHistory && (
            <div ref={historyRef} className={s.field}>
              <span className={s.label}>{t("ice.history.title")}</span>
              <SlotHistory ctx={ctx} slots={[{ spec, state }]} busy={writer.busy} onRestore={(item) => void writer.restore([item])} />
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
