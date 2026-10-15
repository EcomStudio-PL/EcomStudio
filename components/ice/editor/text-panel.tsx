"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { notify } from "@/lib/notify";
import { normaliseText, softLimit, textProblem } from "@/lib/ice/validate";
import { placeholdersOf } from "@/lib/i18n/overrides";
import type { IceLocale, IceTextInfo, IceTextState, IceVersion } from "@/lib/ice/types";
import type { Target } from "./scan";
import { livePreview } from "./preview";
import { Btn, LocaleTabs, Sheet, call, errorText, roleLabel, sectionLabel, when, type EditorCtx } from "./shared";
import s from "./editor.module.css";

/**
 * ONE TEXT OF A CODE-RENDERED PAGE (/home, /plany, /tools, a tool's page).
 *
 * The shipped dictionary text is the default; what the admin saves is stored
 * as an override for that key and language only — saving the default back is
 * the same as restoring it. Plain text, one paragraph, the same {variables},
 * a length cap; the page is previewed in place while typing.
 */

type TextTarget = Extract<Target, { kind: "text" }>;

const valueOf = (v: unknown): string | null =>
  v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string" ? (v as { value: string }).value : null;

export function TextPanel({ ctx, target, onClose }: { ctx: EditorCtx; target: TextTarget; onClose: () => void }) {
  const { t, transport } = ctx;
  const key = target.key;
  const [info, setInfo] = useState<IceTextInfo | null>(null);
  const [tab, setTab] = useState<IceLocale>(ctx.locale);
  const [drafts, setDrafts] = useState<Partial<Record<IceLocale, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<IceVersion[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const preview = useMemo(() => livePreview(target.runs), [target]);
  const saved = useRef(false);

  const load = async () => {
    const res = await call(transport.textState(key));
    if (!res.ok) {
      setError(errorText(t, res.error));
      return;
    }
    setInfo(res.data);
    setDrafts(Object.fromEntries(res.data.states.map((st) => [st.locale, st.override ?? st.defaultValue])));
  };
  const loadHistory = async (locale: IceLocale) => {
    const res = await call(transport.history({ target: "text", key, locale, limit: 20 }));
    setVersions(res.ok ? res.data : []);
  };

  useEffect(() => {
    void load();
    return () => {
      if (!saved.current) preview.restore();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    void loadHistory(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tab]);

  const state: IceTextState | undefined = info?.states.find((st) => st.locale === tab);
  const draft = drafts[tab] ?? "";
  const effective = state ? state.override ?? state.defaultValue : "";
  const clean = normaliseText(draft);
  const problem = state && clean !== state.defaultValue ? textProblem(key, clean, state.defaultValue, info?.maxLength ?? 240) : null;
  const changed = Boolean(state) && clean !== effective;
  const long = state ? clean.length > softLimit(state.defaultValue) : false;
  const vars = state ? placeholdersOf(state.defaultValue) : [];
  const multiline = (info?.maxLength ?? 0) > 240;

  // The page shows one language: preview only that tab, and never a text
  // with {variables} (the page paints them filled in).
  useEffect(() => {
    if (tab !== ctx.locale || vars.length > 0 || !state) return;
    if (problem) return;
    preview.show(clean || state.defaultValue);
  }, [clean, tab, ctx.locale, vars.length, state, problem, preview]);

  const write = async (value: string | null, action: "save" | "reset" | "restore") => {
    if (!state) return;
    // Only a save keeps the preview up (the page re-renders with that very
    // text); anything else puts the page back first.
    if (action !== "save") preview.restore();
    setBusy(true);
    setError(null);
    const res = await call(transport.textSave({ key, locale: tab, value, base: state.updatedAt, action }));
    setBusy(false);
    if (!res.ok) {
      setError(errorText(t, res.error));
      if (res.error === "conflict" && Array.isArray(res.current) && info) {
        setInfo({ ...info, states: res.current as IceTextState[] });
      }
      return;
    }
    saved.current = action === "save" && tab === ctx.locale;
    if (!saved.current) preview.restore();
    notify.success(t(action === "save" ? "ice.saved" : "ice.restored"));
    onClose();
  };

  const last = versions?.[0];
  const crumbs = `${ctx.pageLabel} · ${sectionLabel(t, ctx.info, target.element.id)}`;

  return (
    <Sheet t={t} title={roleLabel(t, target.element)} crumbs={crumbs} onClose={() => { preview.restore(); onClose(); }}
      footer={
        <>
          <Btn kind="primary" disabled={!changed || Boolean(problem) || busy} onClick={() => void write(clean === state?.defaultValue ? null : clean, "save")}>
            {busy ? t("ice.saving") : t("ice.save")}
          </Btn>
          <Btn onClick={() => { preview.restore(); onClose(); }}>{t("ice.cancel")}</Btn>
          <span className={s.grow} />
          {last && (
            <Btn kind="ghost" small disabled={busy} onClick={() => void write(valueOf(last.before), "restore")}>
              {t("ice.text.undo")}
            </Btn>
          )}
          {state?.override !== null && state?.override !== undefined && (
            <Btn kind="ghost" small disabled={busy} onClick={() => void write(null, "reset")}>{t("ice.text.reset")}</Btn>
          )}
        </>
      }
    >
      {!info && !error && <p className={s.meta}>{t("ice.loading")}</p>}
      {error && <p className={s.error} role="alert">{error}</p>}
      {info && state && (
        <>
          <LocaleTabs t={t} value={tab} onChange={setTab}
            marked={new Set(info.states.filter((st) => st.override !== null).map((st) => st.locale))} />
          <div className={s.field}>
            <span className={s.label}>{t("ice.text.current")}</span>
            <p className={s.current}>{effective}</p>
            {state.override !== null && <span className={s.meta}>{t("ice.text.default")}: {state.defaultValue}</span>}
          </div>
          <label className={s.field}>
            <span className={s.label}>{t("ice.text.new")}</span>
            {multiline ? (
              <textarea className={s.textarea} value={draft} maxLength={info.maxLength + 50}
                onChange={(e) => setDrafts({ ...drafts, [tab]: e.target.value.replace(/[\r\n]+/g, " ") })} />
            ) : (
              <input className={s.input} value={draft} maxLength={info.maxLength + 50}
                onChange={(e) => setDrafts({ ...drafts, [tab]: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter" && changed && !problem && !busy) void write(clean === state.defaultValue ? null : clean, "save"); }} />
            )}
            <span className={s.between}>
              <span className={s.meta}>{t("ice.text.count", { n: clean.length, max: info.maxLength })}</span>
              {tab === ctx.locale && vars.length === 0 && <span className={s.meta}>{t("ice.text.previewOn")}</span>}
            </span>
          </label>
          {vars.length > 0 && <p className={s.note}>{t("ice.text.vars", { vars: vars.map((v) => `{${v}}`).join(", ") })}</p>}
          {problem && <p className={s.error}>{t(`ice.error.text_${problem}`)}</p>}
          {!problem && long && <p className={s.warn}>{t("ice.text.long")}</p>}
          {info.pages.length > 1 && <p className={s.note}>{t("ice.text.shared", { pages: info.pages.join(", ") })}</p>}
          <div className={s.between}>
            <span className={s.label}>{t("ice.history.title")}</span>
            <Btn small kind="ghost" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? t("ice.history.hide") : t("ice.history.show", { n: versions?.length ?? 0 })}
            </Btn>
          </div>
          {showHistory && (
            versions && versions.length > 0 ? (
              <ul className={s.list}>
                {versions.map((v) => (
                  <li key={v.id} className={s.item}>
                    <span className={s.meta}>{when(v.createdAt, ctx.locale)}{v.author ? ` · ${v.author}` : ""} · {t(`ice.history.action.${v.action}`)}</span>
                    <div className={s.diff}>
                      <b>{t("ice.history.before")}</b><span>{valueOf(v.before) ?? t("ice.text.defaultShort")}</span>
                      <b>{t("ice.history.after")}</b><span>{valueOf(v.after) ?? t("ice.text.defaultShort")}</span>
                    </div>
                    <div className={s.row}>
                      <Btn small disabled={busy} onClick={() => void write(valueOf(v.after), "restore")}>{t("ice.history.restoreAfter")}</Btn>
                      <Btn small kind="ghost" disabled={busy} onClick={() => void write(valueOf(v.before), "restore")}>{t("ice.history.restoreBefore")}</Btn>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className={s.meta}>{t("ice.history.empty")}</p>
          )}
        </>
      )}
    </Sheet>
  );
}
