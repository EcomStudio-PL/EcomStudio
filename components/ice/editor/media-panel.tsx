"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  IceAsset, IceCrop, IceElement, IceLocale, IceResult, IceSlotSpec, IceSlotState, IceSlotWrite, IceTransport, IceVersion,
} from "@/lib/ice/types";
import { ICE_LOCALES } from "@/lib/ice/types";
import { altProblem, normaliseText } from "@/lib/ice/validate";
import { ICE_MAX_SAMPLE_BYTES, isIceMime } from "@/lib/ice/sniff";
import { notify } from "@/lib/notify";
import { CENTER, CropEditor, MediaPaint, PHONE_REF_WIDTH, PositionGrid, frameBox, isCenter, isPosition, zoomCap } from "./crop";
import { LibraryPicker } from "./library";
import { uploadOne } from "./upload";
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
  poster: IceAsset | null;
  alt: AltDraft;
  position: string;
  crop: IceCrop;
  /** The phone file's own frame (crop.m). */
  cropM: IceCrop;
};

const plain = (c: IceCrop): IceCrop => ({ x: c.x, y: c.y, zoom: c.zoom });

export function draftOf(st: IceSlotState): Draft {
  return {
    media: st.media,
    mobile: st.mobile,
    poster: st.poster,
    // The Polish alt is the single legacy alt_text whenever there is one: the
    // editor writes both equal, and Admin → Media updates only alt_text — so
    // when they differ, alt_text is the newer one.
    alt: { pl: st.alt ?? st.altI18n.pl ?? "", en: st.altI18n.en ?? "", de: st.altI18n.de ?? "" },
    position: st.position,
    crop: st.crop ? plain(st.crop) : CENTER,
    cropM: st.crop?.m ? plain(st.crop.m) : CENTER,
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
  const altI18n = cleanAlt(d.alt);
  let crop: IceSlotWrite["crop"] = null;
  // Position-only slots are painted by the frozen tool-card renderer, which
  // knows no crop: the server refuses one there.
  if (media && !spec.positionOnly) {
    if (mobile) crop = isCenter(d.crop) && isCenter(d.cropM) ? null : { ...d.crop, m: d.cropM };
    else crop = isCenter(d.crop) ? null : d.crop;
  }
  return {
    key: spec.key,
    mediaType: video ? "video" : "image",
    mediaId: media?.id ?? null,
    mobileMediaId: mobile?.id ?? null,
    posterMediaId: video ? d.poster?.id ?? null : null,
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
  posterId: string | null;
  altI18n: Partial<Record<IceLocale, string>>;
  fit: "cover" | "contain" | null;
  position: string | null;
  crop: (IceCrop & { m?: IceCrop }) | null;
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
  // As in draftOf: the legacy alt_text is the Polish alt when present.
  const legacy = str(o.alt_text);
  if (legacy) altI18n.pl = legacy;
  const main = cropValue(o.crop);
  const m = main ? cropValue((o.crop as Record<string, unknown>).m) : null;
  return {
    mediaType: o.media_type === "video" ? "video" : "image",
    mediaId: str(o.media_id),
    mobileId: str(o.mobile_media_id),
    posterId: str(o.poster_media_id),
    altI18n,
    fit: o.object_fit === "contain" || o.object_fit === "cover" ? o.object_fit : null,
    position: str(o.object_position),
    crop: main ? (m ? { ...main, m } : main) : null,
    updatedAt: str(o.updated_at),
  };
}

/** The write that puts a slot back to a snapshot. No snapshot (the row did
 *  not exist then) = an empty slot. The tablet file is the server's to keep. */
export function snapshotWrite(spec: IceSlotSpec, snap: Snap | null, st: IceSlotState): IceSlotWrite {
  const mediaId = snap?.mediaId ?? null;
  const video = mediaId !== null && snap?.mediaType === "video";
  const mobile = mediaId && spec.mobile ? snap?.mobileId ?? null : null;
  const altI18n = { ...(snap?.altI18n ?? {}) };
  const c = snap?.crop ?? null;
  return {
    key: spec.key,
    mediaType: video ? "video" : "image",
    mediaId,
    mobileMediaId: mobile,
    posterMediaId: video ? snap?.posterId ?? null : null,
    alt: altI18n.pl ?? null,
    altI18n,
    fit: snap?.fit ?? st.fit,
    position: isPosition(snap?.position) ? snap.position : st.position,
    // crop.m is only accepted together with a phone file.
    crop: !mediaId || spec.positionOnly || !c ? null : mobile ? c : plain(c),
    base: st.updatedAt,
  };
}

const idsOf = (w: IceSlotWrite) => [w.mediaId, w.mobileMediaId, w.posterMediaId];

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
      <span className={s.chip}>{t(spec.video && !spec.sample ? "ice.media.kindAny" : "ice.media.kindImage")}</span>
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
function pickProblem(a: IceAsset, kind: "image" | "video" | undefined, sample: boolean): string | null {
  if (a.kind === "file" || (kind && a.kind !== kind)) return "asset_kind";
  if (!a.mime || !isIceMime(a.mime)) return "asset_format";
  if (sample && a.sizeBytes !== null && a.sizeBytes > ICE_MAX_SAMPLE_BYTES) return "asset_too_large";
  return null;
}

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
const VIDEO_ACCEPT = "video/mp4,video/webm";

/** "Wgraj nowe" + "Wybierz z biblioteki" (+ "Usuń" when given) for one file. */
export function AssetChooser({ ctx, kind, sample, onPick, onRemove, disabled }: {
  ctx: EditorCtx;
  /** Only this kind may be chosen; none = picture or clip. */
  kind?: "image" | "video";
  sample?: boolean;
  onPick: (asset: IceAsset) => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const { t } = ctx;
  const [library, setLibrary] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const take = (a: IceAsset): boolean => {
    const problem = pickProblem(a, kind, Boolean(sample));
    if (problem) notify.error(errorText(t, problem));
    else onPick(a);
    return !problem;
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const res = await uploadOne(ctx.transport, file, { sample, kind });
    setUploading(false);
    if (res.ok) take(res.asset);
    else notify.error(`${file.name}: ${errorText(t, res.error)}`);
  };

  return (
    <div className={s.row}>
      <Btn small onClick={() => fileRef.current?.click()} disabled={disabled || uploading}>
        {uploading ? t("ice.media.uploading") : t("ice.media.upload")}
      </Btn>
      <input ref={fileRef} type="file" hidden aria-label={t("ice.media.upload")}
        accept={kind === "video" ? VIDEO_ACCEPT : kind === "image" ? IMAGE_ACCEPT : `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`}
        onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      <Btn small onClick={() => setLibrary(true)} disabled={disabled || uploading}>{t("ice.media.fromLibrary")}</Btn>
      {onRemove && <Btn small kind="ghost" onClick={onRemove} disabled={disabled || uploading}>{t("ice.media.remove")}</Btn>}
      {library && (
        <LibraryPicker ctx={ctx} kind={kind} sample={sample} onClose={() => setLibrary(false)}
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
      const found = await resolveAssets(transport, snaps.flatMap((x) => (x ? [x.mediaId, x.mobileId, x.posterId] : [])));
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
          ? [after.mediaId, slot.spec.mobile ? after.mobileId : null, after.mediaType === "video" ? after.posterId : null]
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
  const historyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showHistory) historyRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [showHistory]);

  const role = roleLabel(t, element);
  const title = label ?? role;
  const crumbs = [ctx.pageLabel, sectionLabel(t, ctx.info, element.id), role, label].filter(Boolean).join(" · ");
  const group = ctx.info.kind === "registry" ? ctx.info.page.bulk?.find((g) => g.slots.includes(spec.key)) : undefined;
  const phoneRatio = spec.frames?.find((f) => f.label === "phone")?.ratio ?? spec.ratio;
  const media = view?.media ?? null;
  const mobile = spec.mobile && media ? view?.mobile ?? null : null;

  const write = state && view ? writeOf(spec, view, state) : null;
  const dirty = Boolean(state && write && !sameWrite(write, writeOf(spec, draftOf(state), state)));
  const invalid = view ? altInvalid(view.alt) : false;

  const setMain = (a: IceAsset) => edit((d) => {
    const keepMobile = d.mobile?.kind === a.kind;
    return {
      ...d,
      media: a,
      // A new file starts centred: the old frame was chosen for another picture.
      crop: CENTER,
      // A clip keeps its cover; a phone file must be the same kind as the main one.
      poster: a.kind === "video" ? d.poster : null,
      mobile: keepMobile ? d.mobile : null,
      cropM: keepMobile ? d.cropM : CENTER,
      alt: d.alt.pl.trim() || !a.alt ? d.alt : { ...d.alt, pl: a.alt },
    };
  });

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
      <Btn kind="primary" disabled={writer.busy || !dirty || invalid || !media} onClick={() => { if (write) void writer.commit([write], "save"); }}>
        {writer.busy ? t("ice.media.saving") : t("ice.save")}
      </Btn>
    </>
  ) : undefined;

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
          {spec.positionOnly && <p className={s.note}>{t("ice.media.positionOnly")}</p>}
          {spec.sample && <p className={s.note}>{t("ice.samples.note")}</p>}
          {!state.enabled && <p className={s.warn}>{t("ice.media.disabled")}</p>}
          {writer.problem && <p className={s.error} role="alert">{writer.problem}</p>}

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
                  // The phone frame paints the phone file, with its own frame, when there is one.
                  const phone = f.label === "phone" && mobile !== null;
                  return (
                    <figure key={f.label} className={s.figure}>
                      <div className={s.frame} style={{ aspectRatio: f.ratio }}>
                        {spec.positionOnly
                          ? <MediaPaint asset={media} fit={state.fit} position={view.position} min={320} />
                          : <MediaPaint asset={phone && mobile ? mobile : media} crop={phone ? view.cropM : view.crop} fit={state.fit} min={320} />}
                      </div>
                      <figcaption className={s.frameCaption}>{t(`ice.media.frame.${f.label}`)}</figcaption>
                    </figure>
                  );
                })}
              </div>
            </div>
          )}

          <AssetChooser ctx={ctx} kind={mainKind(spec)} sample={spec.sample} onPick={setMain} />
          {media && <AssetLine asset={media} />}
          {media && <Warnings items={fitWarnings(t, media, spec)} />}

          {media?.kind === "video" && (
            <div className={s.field}>
              <span className={s.label}>{t("ice.media.poster")}</span>
              <div className={s.assetRow}>
                <span className={s.histThumb}>{view.poster ? <AssetThumb asset={view.poster} /> : t("ice.history.noFile")}</span>
                <AssetChooser ctx={ctx} kind="image" onPick={(a) => edit((d) => ({ ...d, poster: a }))}
                  onRemove={view.poster ? () => edit((d) => ({ ...d, poster: null })) : undefined} />
              </div>
              <p className={s.meta}>{t("ice.media.videoNote")}</p>
            </div>
          )}

          {spec.mobile && (
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
