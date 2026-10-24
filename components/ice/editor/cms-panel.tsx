"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { notify } from "@/lib/notify";
import { hasInvisible } from "@/lib/ice/stega";
import { ALLOWED_TOKENS, disallowedTokens } from "@/lib/launch/fields";
import { CONTACT_TOKENS, linkValueOk } from "@/lib/contact-page";
import type { IceAsset, IceCmsField, IceLocale, IceVersion } from "@/lib/ice/types";
import type { Target } from "./scan";
import { livePreview } from "./preview";
import { LibraryPicker } from "./library";
import { uploadOne } from "./upload";
import { Btn, LocaleTabs, Sheet, call, errorText, when, type EditorCtx, type T } from "./shared";
import s from "./editor.module.css";

/**
 * ONE FIELD OF A PUBLISHED CMS PAGE — a heading, a paragraph, a button label,
 * a picture. The change goes live at once through cms_inline_patch: the page
 * gets a new version (as publishing does), the draft and the published copy
 * get the same one-field change, and nothing else on the page — no pending
 * draft of another section — is published along with it.
 */

type CmsText = Extract<Target, { kind: "cms" }>;
type CmsMedia = Extract<Target, { kind: "cmsMedia" }>;

const valueOf = (v: unknown): string | null =>
  v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string" ? (v as { value: string }).value : null;

export function cmsFieldLabel(t: T, f: IceCmsField): string {
  const block = t(`ice.block.${f.blockType}`);
  if (f.blockType === "launch") return `${block} · ${t(`ice.launchField.${f.path[1].replace(/\./g, "_")}`)}`;
  // Kontakt V2: the section's own words, a channel, a FAQ link, the company.
  if (f.blockType === "contact_page") {
    const last = f.path[f.path.length - 1];
    if (f.path[0] === "fields") return `${block} · ${t(`ice.contactField.${f.path[1].replace(/\./g, "_")}`)}`;
    if (f.path[0] === "items") return `${block} · ${t("ice.contact.channel", { n: Number(f.path[1]) + 1 })} · ${t(`ice.contact.f.${last}`)}`;
    if (f.path[0] === "tiles") return `${block} · ${t("ice.contact.faqLink", { n: Number(f.path[1]) + 1 })} · ${t(`ice.contact.f.${last}`)}`;
    if (f.path[0] === "company") return `${block} · ${t("ice.contact.company")} · ${t(`ice.contact.company_${last}`)}`;
  }
  const item = f.path[0] === "items" ? Number(f.path[1]) + 1 : null;
  // An audience card's point: "Dla kogo · Element 1 · Punkt 2 · Tytuł".
  const point = item && f.path[2] === "points" ? Number(f.path[3]) + 1 : null;
  const field = t(`ice.field.${f.path[f.path.length - 1]}`);
  if (item && point) return `${block} · ${t("ice.field.item", { n: item })} · ${t("ice.field.point", { n: point })} · ${field}`;
  return item ? `${block} · ${t("ice.field.item", { n: item })} · ${field}` : `${block} · ${field}`;
}

function historyKey(ctx: EditorCtx, f: IceCmsField, locale: IceLocale | null): string {
  const pageId = ctx.info.kind === "cms" ? ctx.info.cms.pageId : "";
  return `${pageId}:${f.blockId}:${[...f.path, ...(locale ? [locale] : [])].join(".")}`;
}

/** A launch line's key ("hero.offer"), or null for any other CMS field. */
const launchKey = (f: IceCmsField): string | null => (f.blockType === "launch" && f.path[0] === "fields" ? f.path[1] : null);

/** The `{tokens}` a contact text may carry (lib/contact-page.ts). */
function contactTokens(f: IceCmsField): readonly string[] | null {
  if (f.blockType !== "contact_page") return null;
  const key = f.path[0] === "fields" ? f.path[1] : f.path.join(".");
  return (CONTACT_TOKENS as Record<string, readonly string[] | undefined>)[key] ?? [];
}

/**
 * Launch lines that may be left empty — the page then shows nothing there.
 * The inline editor never saves an empty line (`text_empty`), so these are
 * cleared in Strony WWW, and the panel says so where it matters.
 */
const OPTIONAL_LAUNCH = new Set(["feature.1b", "feature.2b", "feature.3b", "creators.signature", "final.sub"]);

function localProblem(value: string, multiline: boolean, key: string | null, allowed: readonly string[] | null = null): string | null {
  if (!value.trim()) return "text_empty";
  if (value.length > 2000) return "text_too_long";
  if (hasInvisible(value)) return "text_invisible";
  if (/[<>]/.test(value)) return "text_markup";
  if (!multiline && /\n/.test(value)) return "text_newline";
  // The server refuses it too (lib/server/ice/actions.ts cmsSave).
  if (key && disallowedTokens(key, value).length > 0) return "text_token";
  if (allowed && [...value.matchAll(/\{([a-zA-Z_]+)\}/g)].some((m) => !allowed.includes(m[1]))) return "text_token";
  return null;
}

/** The field as the page definition holds it NOW: after a save or a
 *  conflict the editor reloads the definition, and the panel must compare
 *  against that fresh value and base — never the one it was opened with. */
function liveField(ctx: EditorCtx, opened: IceCmsField): IceCmsField {
  return (ctx.info.kind === "cms" ? ctx.info.cms.fields.find((f) => f.id === opened.id) : undefined) ?? opened;
}

function useHistory(ctx: EditorCtx, key: string) {
  const [versions, setVersions] = useState<IceVersion[] | null>(null);
  useEffect(() => {
    let live = true;
    setVersions(null);
    void call(ctx.transport.history({ target: "cms", key, limit: 20 })).then((r) => {
      if (live) setVersions(r.ok ? r.data : []);
    });
    return () => {
      live = false;
    };
  }, [ctx.transport, key]);
  return versions;
}

export function CmsTextPanel({ ctx, target, onClose }: { ctx: EditorCtx; target: CmsText; onClose: () => void }) {
  const { t, transport } = ctx;
  const field = liveField(ctx, target.field);
  const [tab, setTab] = useState<IceLocale>(ctx.locale);
  const [drafts, setDrafts] = useState<Partial<Record<IceLocale, string>>>(() => ({ ...field.values }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const preview = useMemo(() => livePreview(target.runs), [target]);
  const saved = useRef(false);
  const versions = useHistory(ctx, historyKey(ctx, field, tab));
  // Chosen once: switching between <input> and <textarea> while typing would
  // remount the control and lose the caret.
  const [wide] = useState(() => field.multiline || Object.values(field.values).some((v) => (v ?? "").length > 120));

  useEffect(() => () => {
    if (!saved.current) preview.restore();
  }, [preview]);

  const live = field.values[tab] ?? null;
  const draft = drafts[tab] ?? "";
  const clean = field.multiline
    ? draft.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[\t ]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim()
    : draft.replace(/[\t ]+/g, " ").trim();
  const key = launchKey(field);
  const contactAllowed = contactTokens(field);
  const problem = localProblem(clean, field.multiline, key, contactAllowed);
  const changed = clean !== (live ?? "");
  const tokens = key ? ALLOWED_TOKENS[key] ?? [] : contactAllowed ?? [];
  // A field painted as several paragraphs is previewed after saving only —
  // and so is a launch line with a {token}: the page shows it with the
  // approved value in place (or not at all), never the raw token.
  const canPreview = tab === ctx.locale && !field.multiline && target.runs.length > 0 && !/\{[a-zA-Z_]+\}/.test(clean);

  useEffect(() => {
    if (canPreview && !problem) preview.show(clean);
  }, [canPreview, clean, problem, preview]);

  const write = async (value: string, action: "save" | "restore") => {
    if (action !== "save") preview.restore();
    setBusy(true);
    setError(null);
    const res = await call(transport.cmsSave({
      blockId: field.blockId, path: field.path, locale: tab, value, expected: live, base: field.base, action,
    }));
    setBusy(false);
    if (!res.ok) {
      setError(errorText(t, res.error));
      if (res.error === "conflict") void ctx.reload();
      return;
    }
    saved.current = action === "save" && tab === ctx.locale;
    if (!saved.current) preview.restore();
    notify.success(t(action === "save" ? "ice.saved" : "ice.restored"));
    void ctx.reload();
    onClose();
  };

  // The editor's history only knows the editor's own changes (a publish from
  // Strony WWW writes none). "Undo" is offered only while the newest of them
  // is still what the page shows; "original" only when the whole history is
  // in hand (fewer rows than were asked for).
  const latest = versions?.[0];
  const undoTo = latest && valueOf(latest.after) === live ? valueOf(latest.before) : null;
  const first = versions && versions.length && versions.length < 20 ? versions[versions.length - 1] : null;
  const original = first ? valueOf(first.before) : null;

  return (
    <Sheet t={t} title={cmsFieldLabel(t, field)} crumbs={`${ctx.pageLabel} · ${t("ice.cms.live")}`}
      onClose={() => { preview.restore(); onClose(); }}
      footer={
        <>
          <Btn kind="primary" disabled={!changed || Boolean(problem) || busy} onClick={() => void write(clean, "save")}>
            {busy ? t("ice.saving") : t("ice.cms.publish")}
          </Btn>
          <Btn onClick={() => { preview.restore(); onClose(); }}>{t("ice.cancel")}</Btn>
          <span className={s.grow} />
          {undoTo && (
            <Btn kind="ghost" small disabled={busy} onClick={() => void write(undoTo, "restore")}>{t("ice.text.undo")}</Btn>
          )}
          {original && original !== live && (
            <Btn kind="ghost" small disabled={busy} onClick={() => void write(original, "restore")}>{t("ice.cms.original")}</Btn>
          )}
        </>
      }
    >
      {error && <p className={s.error} role="alert">{error}</p>}
      <LocaleTabs t={t} value={tab} onChange={setTab} />
      <div className={s.field}>
        <span className={s.label}>{t("ice.text.current")}</span>
        <p className={s.current}>{live ?? t("ice.cms.missing")}</p>
      </div>
      <label className={s.field}>
        <span className={s.label}>{t("ice.text.new")}</span>
        {wide ? (
          <textarea className={s.textarea} value={draft}
            onChange={(e) => setDrafts({ ...drafts, [tab]: field.multiline ? e.target.value : e.target.value.replace(/[\r\n]+/g, " ") })} />
        ) : (
          <input className={s.input} value={draft} onChange={(e) => setDrafts({ ...drafts, [tab]: e.target.value })} />
        )}
        <span className={s.between}>
          <span className={s.meta}>{t("ice.text.count", { n: clean.length, max: 2000 })}</span>
          {canPreview && <span className={s.meta}>{t("ice.text.previewOn")}</span>}
        </span>
      </label>
      {field.multiline && <p className={s.note}>{t("ice.cms.paragraphs")}</p>}
      {tokens.length > 0 && <p className={s.note}>{t("ice.cms.tokens", { tokens: tokens.map((x) => `{${x}}`).join(", ") })}</p>}
      {key && OPTIONAL_LAUNCH.has(key) && <p className={s.note}>{t("ice.cms.optionalLine")}</p>}
      {problem && changed && <p className={s.error}>{t(`ice.error.${problem}`)}</p>}
      <p className={s.meta}>{t("ice.cms.versionNote")}</p>
      <div className={s.between}>
        <span className={s.label}>{t("ice.history.title")}</span>
        <Btn small kind="ghost" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? t("ice.history.hide") : t("ice.history.show", { n: versions?.length ?? 0 })}
        </Btn>
      </div>
      {showHistory && (versions && versions.length ? (
        <ul className={s.list}>
          {versions.map((v) => (
            <li key={v.id} className={s.item}>
              <span className={s.meta}>{when(v.createdAt, ctx.locale)}{v.author ? ` · ${v.author}` : ""} · {t(`ice.history.action.${v.action}`)}</span>
              <div className={s.diff}>
                <b>{t("ice.history.before")}</b><span>{valueOf(v.before) ?? "—"}</span>
                <b>{t("ice.history.after")}</b><span>{valueOf(v.after) ?? "—"}</span>
              </div>
              <div className={s.row}>
                {valueOf(v.after) && <Btn small disabled={busy} onClick={() => void write(valueOf(v.after)!, "restore")}>{t("ice.history.restoreAfter")}</Btn>}
                {valueOf(v.before) && <Btn small kind="ghost" disabled={busy} onClick={() => void write(valueOf(v.before)!, "restore")}>{t("ice.history.restoreBefore")}</Btn>}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className={s.meta}>{t("ice.history.empty")}</p>)}
    </Sheet>
  );
}

export function CmsMediaPanel({ ctx, target, onClose }: { ctx: EditorCtx; target: CmsMedia; onClose: () => void }) {
  const { t, transport } = ctx;
  const field = liveField(ctx, target.field);
  const [picked, setPicked] = useState<IceAsset | null>(null);
  const [library, setLibrary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const versions = useHistory(ctx, historyKey(ctx, field, null));
  const live = field.url ?? "";
  const frame = target.els[0]?.getBoundingClientRect();
  const ratio = frame && frame.width > 0 && frame.height > 0 ? `${Math.round(frame.width)}/${Math.round(frame.height)}` : "4/3";

  const write = async (value: string, action: "save" | "restore") => {
    setBusy(true);
    setError(null);
    const res = await call(transport.cmsSave({ blockId: field.blockId, path: field.path, locale: null, value, expected: live || null, base: field.base, action }));
    setBusy(false);
    if (!res.ok) {
      setError(errorText(t, res.error));
      if (res.error === "conflict") void ctx.reload();
      return;
    }
    notify.success(t(action === "save" ? "ice.saved" : "ice.restored"));
    void ctx.reload();
    onClose();
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const res = await uploadOne(transport, file, { kind: "image" });
    setBusy(false);
    if (res.ok) setPicked(res.asset);
    else setError(errorText(t, res.error));
  };

  const shown = picked?.url ?? live;
  return (
    <>
      <Sheet t={t} title={cmsFieldLabel(t, field)} crumbs={`${ctx.pageLabel} · ${t("ice.cms.live")}`} onClose={onClose}
        footer={
          <>
            <Btn kind="primary" disabled={!picked || picked.url === live || busy} onClick={() => picked && void write(picked.url, "save")}>
              {busy ? t("ice.saving") : t("ice.cms.publish")}
            </Btn>
            <Btn onClick={onClose}>{t("ice.cancel")}</Btn>
            <span className={s.grow} />
            {versions && versions[0] && valueOf(versions[0].after) === (live || null) && valueOf(versions[0].before) && (
              <Btn kind="ghost" small disabled={busy} onClick={() => void write(valueOf(versions[0].before)!, "restore")}>{t("ice.media.restorePrev")}</Btn>
            )}
          </>
        }
      >
        {error && <p className={s.error} role="alert">{error}</p>}
        <div className={s.frame} style={{ aspectRatio: ratio }}>
          {shown
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={shown} alt="" />
            : <span className={s.frameEmpty}>{t("ice.media.empty")}</span>}
        </div>
        <div className={s.row}>
          <Btn onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? t("ice.media.uploading") : t("ice.media.upload")}</Btn>
          <Btn onClick={() => setLibrary(true)} disabled={busy}>{t("ice.media.pick")}</Btn>
          <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        {picked && <p className={s.meta}>{picked.title} · {picked.width && picked.height ? `${picked.width}×${picked.height} px` : ""}</p>}
        <p className={s.note}>{t("ice.cms.mediaNote")}</p>
        {versions && versions.length > 0 && (
          <ul className={s.list}>
            {versions.slice(0, 8).map((v) => (
              <li key={v.id} className={s.item}>
                <span className={s.meta}>{when(v.createdAt, ctx.locale)}{v.author ? ` · ${v.author}` : ""}</span>
                <div className={s.row}>
                  {valueOf(v.before) && <Btn small disabled={busy} onClick={() => void write(valueOf(v.before)!, "restore")}>{t("ice.history.restoreBefore")}</Btn>}
                  {valueOf(v.after) && <Btn small kind="ghost" disabled={busy} onClick={() => void write(valueOf(v.after)!, "restore")}>{t("ice.history.restoreAfter")}</Btn>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
      {library && (
        <LibraryPicker ctx={ctx} kind="image" onClose={() => setLibrary(false)}
          onPick={(a) => { setPicked(a); setLibrary(false); }} />
      )}
    </>
  );
}

type CmsLink = Extract<Target, { kind: "cmsLink" }>;

/**
 * KONTAKT V2 — ONE ADDRESS OF THE CONTACT SECTION: a channel's profile, the
 * Messenger link, a FAQ link, the company's NIP or e-mail. Not localised,
 * never painted as text, live at once (cms_inline_patch) with a page version.
 * Empty takes the element off the page; anything else must be what its
 * format says — the server checks the same rule again.
 */
export function CmsLinkPanel({ ctx, target, onClose }: { ctx: EditorCtx; target: CmsLink; onClose: () => void }) {
  const { t, transport } = ctx;
  const field = liveField(ctx, target.field);
  const live = field.url ?? "";
  const [draft, setDraft] = useState(live);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versions = useHistory(ctx, historyKey(ctx, field, null));
  const clean = draft.trim();
  const ok = field.format ? linkValueOk(field.format, clean, field.channel) : false;
  const changed = clean !== live.trim();

  const write = async (value: string, action: "save" | "restore") => {
    setBusy(true);
    setError(null);
    const res = await call(transport.cmsSave({
      blockId: field.blockId, path: field.path, locale: null, value, expected: live || null, base: field.base, action,
    }));
    setBusy(false);
    if (!res.ok) {
      setError(errorText(t, res.error));
      if (res.error === "conflict") void ctx.reload();
      return;
    }
    notify.success(t(action === "save" ? "ice.saved" : "ice.restored"));
    void ctx.reload();
    onClose();
  };

  return (
    <Sheet t={t} title={cmsFieldLabel(t, field)} crumbs={`${ctx.pageLabel} · ${t("ice.cms.live")}`} onClose={onClose}
      footer={
        <>
          <Btn kind="primary" disabled={!changed || !ok || busy} onClick={() => void write(clean, "save")}>
            {busy ? t("ice.saving") : t("ice.cms.publish")}
          </Btn>
          <Btn onClick={onClose}>{t("ice.cancel")}</Btn>
        </>
      }
    >
      {error && <p className={s.error} role="alert">{error}</p>}
      <div className={s.field}>
        <span className={s.label}>{t("ice.text.current")}</span>
        <p className={s.current}>{live || t("ice.contact.linkEmpty")}</p>
      </div>
      <label className={s.field}>
        <span className={s.label}>{t("ice.text.new")}</span>
        <input className={s.input} value={draft} inputMode={field.format === "nip" ? "text" : "url"} spellCheck={false}
          data-ice-link={field.id} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <p className={s.note}>{t(`ice.contact.linkHint.${field.format === "channel" ? `channel_${field.channel ?? "x"}` : field.format ?? "x"}`)}</p>
      {changed && !ok && <p className={s.error}>{t("ice.error.link_invalid")}</p>}
      <p className={s.meta}>{t("ice.contact.linkEmptyNote")}</p>
      {versions && versions.length > 0 && (
        <ul className={s.list}>
          {versions.slice(0, 8).map((v) => (
            <li key={v.id} className={s.item}>
              <span className={s.meta}>{when(v.createdAt, ctx.locale)}{v.author ? ` · ${v.author}` : ""}</span>
              <div className={s.diff}>
                <b>{t("ice.history.before")}</b><span>{valueOf(v.before) || "—"}</span>
                <b>{t("ice.history.after")}</b><span>{valueOf(v.after) || "—"}</span>
              </div>
              {valueOf(v.before) !== null && valueOf(v.before) !== live && (
                <div className={s.row}>
                  <Btn small disabled={busy} onClick={() => void write(valueOf(v.before) ?? "", "restore")}>{t("ice.history.restoreBefore")}</Btn>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
