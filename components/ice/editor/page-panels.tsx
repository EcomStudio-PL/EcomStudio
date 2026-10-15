"use client";
import { useEffect, useMemo, useState } from "react";
import { notify } from "@/lib/notify";
import type { IceCmsField, IceElement, IceVersion } from "@/lib/ice/types";
import type { Target } from "./scan";
import { cmsFieldLabel } from "./cms-panel";
import { Btn, Sheet, call, errorText, roleLabel, when, type EditorCtx } from "./shared";
import s from "./editor.module.css";

/**
 * THE PAGE-LEVEL PANELS: the list of every editable element (also the way in
 * for a keyboard, and for an element hidden in a carousel or behind a tab),
 * the page's change history, and the bulk-upload groups.
 */

type Entry = { uid: string; label: string; section: string; found: boolean; kind: string };

export function entriesOf(ctx: EditorCtx, targets: Target[]): Entry[] {
  const { t, info } = ctx;
  const found = new Set(targets.map((x) => x.uid));
  if (info.kind === "registry") {
    return info.page.sections.flatMap((sec) => sec.elements.map((e) => {
      const uid = e.kind === "text" ? `t:${e.text!.key}` : `m:${e.id}`;
      return { uid, label: roleLabel(t, e), section: t(`ice.sec.${sec.key}`), found: found.has(uid), kind: e.kind };
    }));
  }
  return info.cms.fields
    .filter((f) => (f.kind === "text" ? Object.values(f.values).some((v) => v && v.trim()) : Boolean(f.url)))
    .map((f) => {
      const uid = f.kind === "text" ? `c:${f.id}` : `cm:${f.id}`;
      return { uid, label: cmsFieldLabel(t, f), section: t(`ice.block.${f.blockType}`), found: found.has(uid), kind: f.kind };
    });
}

export function ElementsPanel({ ctx, targets, onPick, onClose }: {
  ctx: EditorCtx; targets: Target[]; onPick: (uid: string) => void; onClose: () => void;
}) {
  const { t } = ctx;
  const [q, setQ] = useState("");
  const entries = useMemo(() => entriesOf(ctx, targets), [ctx, targets]);
  const shown = entries.filter((e) => !q.trim() || `${e.section} ${e.label}`.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = new Map<string, Entry[]>();
  for (const e of shown) groups.set(e.section, [...(groups.get(e.section) ?? []), e]);
  return (
    <Sheet t={t} title={t("ice.elements.title")} crumbs={t("ice.elements.sub", { n: entries.filter((e) => e.found).length, total: entries.length })} onClose={onClose}>
      <input className={s.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ice.elements.search")} aria-label={t("ice.elements.search")} />
      {[...groups].map(([section, list]) => (
        <div key={section} className={s.field}>
          <span className={s.label}>{section}</span>
          <ul className={s.list}>
            {list.map((e) => (
              <li key={e.uid}>
                <button type="button" className={s.btn} style={{ width: "100%", justifyContent: "space-between" }}
                  onClick={() => onPick(e.uid)} title={e.found ? undefined : t("ice.elements.notShown")}>
                  <span style={{ opacity: e.found ? 1 : 0.65 }}>{e.label}</span>
                  <span className={s.chip}>{t(`ice.kind.${e.kind}`)}{e.found ? "" : " · —"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className={s.meta}>{t("ice.elements.hint")}</p>
    </Sheet>
  );
}

const valueOf = (v: unknown): string | null =>
  v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string" ? (v as { value: string }).value : null;

type PageVersion = IceVersion & { target: string; key: string };

export function PageHistoryPanel({ ctx, onOpen, onClose }: { ctx: EditorCtx; onOpen: (uid: string) => void; onClose: () => void }) {
  const { t, transport, info } = ctx;
  const [rows, setRows] = useState<PageVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await call(transport.pageHistory(ctx.path));
    if (res.ok) setRows(res.data);
    else setError(errorText(t, res.error));
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elements = new Map<string, IceElement>();
  if (info.kind === "registry") {
    for (const sec of info.page.sections) for (const e of sec.elements) {
      if (e.kind === "text" && e.text) elements.set(e.text.key, e);
      for (const sl of e.slots ?? []) elements.set(sl.key, e);
    }
  }
  const cmsField = (key: string): IceCmsField | undefined => {
    if (info.kind !== "cms") return undefined;
    const [, blockId, path] = key.split(":");
    return info.cms.fields.find((f) => f.blockId === blockId && path.startsWith(f.path.join(".")));
  };

  const labelOf = (v: PageVersion) => {
    if (v.target === "cms") {
      const f = cmsField(v.key);
      return f ? cmsFieldLabel(t, f) : v.key;
    }
    const e = elements.get(v.key);
    return e ? roleLabel(t, e) : v.key;
  };
  const uidOf = (v: PageVersion): string | null => {
    if (v.target === "text") return `t:${v.key}`;
    if (v.target === "slot") {
      const e = elements.get(v.key);
      return e ? `m:${e.id}` : null;
    }
    const f = cmsField(v.key);
    return f ? (f.kind === "text" ? `c:${f.id}` : `cm:${f.id}`) : null;
  };

  /** Undo one text change: back to the value before it (null = default). */
  const undoText = async (v: PageVersion) => {
    if (!v.locale) return;
    setBusy(true);
    const state = await call(transport.textState(v.key));
    const current = state.ok ? state.data.states.find((st) => st.locale === v.locale) : undefined;
    const res = current
      ? await call(transport.textSave({ key: v.key, locale: v.locale, value: valueOf(v.before), base: current.updatedAt, action: "restore" }))
      : state;
    setBusy(false);
    if (!res.ok) {
      notify.error(errorText(t, res.error));
      return;
    }
    notify.success(t("ice.restored"));
    void load();
  };

  return (
    <Sheet t={t} title={t("ice.history.pageTitle")} crumbs={ctx.pageLabel} onClose={onClose}>
      {error && <p className={s.error}>{error}</p>}
      {!rows && !error && <p className={s.meta}>{t("ice.loading")}</p>}
      {rows && rows.length === 0 && <p className={s.meta}>{t("ice.history.empty")}</p>}
      {rows && rows.length > 0 && (
        <ul className={s.list}>
          {rows.map((v) => {
            const uid = uidOf(v);
            return (
              <li key={v.id} className={s.item}>
                <span className={s.between}>
                  <strong>{labelOf(v)}</strong>
                  <span className={s.chip}>{t(`ice.history.target.${v.target}`)}{v.locale ? ` · ${v.locale.toUpperCase()}` : ""}</span>
                </span>
                <span className={s.meta}>{when(v.createdAt, ctx.locale)}{v.author ? ` · ${v.author}` : ""} · {t(`ice.history.action.${v.action}`)}</span>
                {v.target !== "slot" && (
                  <div className={s.diff}>
                    <b>{t("ice.history.before")}</b><span>{valueOf(v.before) ?? (v.target === "text" ? t("ice.text.defaultShort") : "—")}</span>
                    <b>{t("ice.history.after")}</b><span>{valueOf(v.after) ?? (v.target === "text" ? t("ice.text.defaultShort") : "—")}</span>
                  </div>
                )}
                <div className={s.row}>
                  {uid && <Btn small onClick={() => onOpen(uid)}>{t("ice.history.open")}</Btn>}
                  {v.target === "text" && <Btn small kind="ghost" disabled={busy} onClick={() => void undoText(v)}>{t("ice.history.undoThis")}</Btn>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

export function BulkGroupsPanel({ ctx, onPick, onClose }: { ctx: EditorCtx; onPick: (key: string) => void; onClose: () => void }) {
  const { t, info } = ctx;
  const groups = info.kind === "registry" ? info.page.bulk ?? [] : [];
  return (
    <Sheet t={t} title={t("ice.bulk.groupsTitle")} crumbs={ctx.pageLabel} onClose={onClose}>
      <ul className={s.list}>
        {groups.map((g) => (
          <li key={g.key}>
            <button type="button" className={s.btn} style={{ width: "100%", justifyContent: "space-between" }} onClick={() => onPick(g.key)}>
              <span>{t(`ice.bulk.group.${g.key.split(".")[0]}`)}{g.key.includes(".") ? ` · ${g.key.split(".")[1]}` : ""}</span>
              <span className={s.chip}>{g.pairs ? t("ice.bulk.pairsCount", { n: g.slots.length / 2 }) : t("ice.bulk.slotsCount", { n: g.slots.length })}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
