"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IceAsset, IceUsage } from "@/lib/ice/types";
import { notify } from "@/lib/notify";
import { UI_ATTR } from "./scan";
import { Btn, bytes, call, cls, errorText, previewUrl, type EditorCtx } from "./shared";
import { uploadOne } from "./upload";
import s from "./editor.module.css";

/**
 * THE MEDIA LIBRARY, as the editor shows it — the same media_assets every
 * other screen uses. A grid with search and a kind filter; each file with its
 * name, size in pixels and bytes, and where it is used. Deleting files stays
 * in Admin → Media, where the usage warning lives; nothing here removes a file.
 */
export function LibraryPicker({ ctx, kind, sample, onPick, onClose }: {
  ctx: EditorCtx;
  /** Only this kind can be picked (a picture slot, a clip slot). */
  kind?: "image" | "video";
  sample?: boolean;
  onPick: (asset: IceAsset) => void;
  onClose: () => void;
}) {
  const { t, transport } = ctx;
  const [filter, setFilter] = useState<"all" | "image" | "video">(kind ?? "all");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<IceAsset[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<IceAsset | null>(null);
  const [usage, setUsage] = useState<IceUsage[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (offset: number) => {
    setBusy(true);
    const res = await call(transport.library({ kind: filter === "all" ? undefined : filter, q: q.trim() || undefined, offset }));
    setBusy(false);
    if (!res.ok) {
      notify.error(errorText(t, res.error));
      return;
    }
    setItems((prev) => (offset === 0 ? res.data : [...prev, ...res.data]));
    setMore(res.data.length === 60);
  }, [filter, q, t, transport]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(0), q ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [load, q]);

  useEffect(() => {
    setUsage(null);
    if (!chosen) return;
    let live = true;
    void call(transport.usage(chosen.id)).then((r) => {
      if (live && r.ok) setUsage(r.data);
    });
    return () => {
      live = false;
    };
  }, [chosen, transport]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const allowed = (a: IceAsset) => (!kind || a.kind === kind) && a.kind !== "file";

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let last: IceAsset | null = null;
    for (const file of Array.from(files)) {
      const res = await uploadOne(transport, file, { sample, kind });
      if (res.ok) last = res.asset;
      else notify.error(`${file.name}: ${errorText(t, res.error)}`);
    }
    setUploading(false);
    if (last) {
      await load(0);
      setChosen(last);
    }
  };

  return (
    <div className={s.backdrop} {...{ [UI_ATTR]: "" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.modal} role="dialog" aria-label={t("ice.library.title")}>
        <div className={s.sheetHead}>
          <div style={{ minWidth: 0 }}>
            <h2>{t("ice.library.title")}</h2>
            <p className={s.crumbs}>{t("ice.library.sub")}</p>
          </div>
          <button type="button" className={cls(s.btn, s.ghost, s.icon, s.closeBtn)} onClick={onClose} aria-label={t("ice.close")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className={s.sheetBody}>
          <div className={s.row}>
            <input className={s.input} style={{ flex: "1 1 220px" }} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t("ice.library.search")} aria-label={t("ice.library.search")} />
            {!kind && (
              <div className={s.tabs} role="tablist">
                {(["all", "image", "video"] as const).map((f) => (
                  <button key={f} type="button" role="tab" aria-selected={filter === f} className={cls(s.tab, filter === f && s.tabOn)} onClick={() => setFilter(f)}>
                    {t(`ice.library.filter.${f}`)}
                  </button>
                ))}
              </div>
            )}
            <Btn onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? t("ice.media.uploading") : t("ice.media.upload")}</Btn>
            <input ref={fileRef} type="file" hidden multiple
              accept={kind === "video" ? "video/mp4,video/webm" : kind === "image" ? "image/jpeg,image/png,image/webp,image/avif" : "image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm"}
              onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
          </div>
          {chosen && (
            <div className={s.item}>
              <div className={s.row} style={{ alignItems: "flex-start" }}>
                <div className={s.thumb} style={{ width: 160, flex: "none" }}>
                  {chosen.kind === "video"
                    ? <video src={chosen.url} poster={chosen.posterUrl ?? undefined} muted playsInline controls />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={previewUrl(chosen, 320)} alt={chosen.alt ?? ""} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className={s.tileName}>{chosen.title ?? "—"}</p>
                  <p className={s.meta}>
                    {chosen.width && chosen.height ? `${chosen.width}×${chosen.height} px · ` : ""}{bytes(chosen.sizeBytes)} · {chosen.mime ?? chosen.kind}
                  </p>
                  <p className={s.meta}>
                    {usage === null ? t("ice.library.usageLoading")
                      : usage.length === 0 ? t("ice.library.unused")
                      : t("ice.library.usedIn", { n: usage.length })}
                  </p>
                  {usage && usage.length > 0 && (
                    <ul className={s.meta} style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                      {usage.slice(0, 6).map((u) => <li key={`${u.kind}:${u.key}:${u.label}`}>{u.key}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className={s.grid} aria-busy={busy}>
            {items.map((a) => (
              <button key={a.id} type="button" className={cls(s.tile, chosen?.id === a.id && s.tileOn)} disabled={!allowed(a)}
                onClick={() => setChosen(a)} onDoubleClick={() => allowed(a) && onPick(a)} aria-pressed={chosen?.id === a.id}>
                <span className={s.thumb}>
                  {a.kind === "video"
                    ? (a.posterUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={a.posterUrl} alt="" loading="lazy" />
                      : <video src={a.url} muted playsInline preload="metadata" />)
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={previewUrl(a, 320)} alt="" loading="lazy" />}
                </span>
                <span className={s.tileName}>{a.title ?? "—"}</span>
                <span className={s.tileMeta}>
                  {a.width && a.height ? `${a.width}×${a.height} · ` : ""}{bytes(a.sizeBytes)}
                </span>
                <span className={s.tileMeta}>{a.usage > 0 ? t("ice.library.usedIn", { n: a.usage }) : t("ice.library.unused")}</span>
              </button>
            ))}
          </div>
          {!busy && items.length === 0 && <p className={s.meta}>{t("ice.library.empty")}</p>}
          {more && <Btn onClick={() => void load(items.length)} disabled={busy}>{t("ice.library.more")}</Btn>}
        </div>
        <div className={s.sheetFoot}>
          <span className={cls(s.meta, s.grow)}>{t("ice.library.deleteNote")}</span>
          <Btn onClick={onClose}>{t("ice.cancel")}</Btn>
          <Btn kind="primary" disabled={!chosen || !allowed(chosen)} onClick={() => chosen && onPick(chosen)}>{t("ice.library.pick")}</Btn>
        </div>
      </div>
    </div>
  );
}
