"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BadgeCheck, ClipboardCopy, Loader2, Mail, MessageCircle, PencilLine, RefreshCw, RotateCcw, Send, TriangleAlert,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/record";
import type { TemplateDef } from "@/lib/server/message-templates";
import {
  authTemplateHtmlAction, previewTemplateAction, publishTemplateAction,
  resetTemplateAction, saveTemplateDraftAction, syncSupabaseAuthAction,
  type TemplateListEntry, type TemplatePreview,
} from "@/app/actions/templates";
import type { AuthSyncView } from "@/lib/server/supabase-management";

/**
 * SZABLONY WIADOMOŚCI — the admin's template studio.
 *
 * Left: the template being edited. Right: a live preview rendered SERVER-side
 * from sample data and displayed in a sandboxed iframe — stored template text
 * never reaches the page as live markup. On mobile the preview folds behind a
 * toggle.
 *
 * Draft → preview → publish: typing edits only the draft; production reads
 * exclusively the published version, so nothing changes mid-sentence. AUTH
 * templates (rendered by Supabase, not by the app) are honest about it: no
 * publish button, a "requires sync" badge, and a copy-HTML button instead.
 */

type EmailDraft = Extract<TemplateDef, { channel: "email" }>["email"];
type TgDraft = Extract<TemplateDef, { channel: "telegram" }>["telegram"];

const EMPTY_EMAIL: EmailDraft = {
  subject: "", heading: "", body: "", ctaLabel: "", ctaUrl: "", footer: "",
  showLogo: true, showFields: true, showCta: false,
};
const EMPTY_TG: TgDraft = { icon: "", title: "", body: "", footer: "" };

function startDef(entry: TemplateListEntry): TemplateDef {
  const base = entry.draft ?? entry.published ?? entry.defaults;
  if (base) return base;
  return entry.channel === "email"
    ? { channel: "email", email: { ...EMPTY_EMAIL } }
    : { channel: "telegram", telegram: { ...EMPTY_TG } };
}

export function TemplateStudio({ entries, authSync }: {
  entries: TemplateListEntry[];
  authSync: AuthSyncView | null;
}) {
  const { t } = useI18n();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sync, setSync] = useState<AuthSyncView | null>(authSync);
  const selected = entries.find((e) => e.key === selectedKey) ?? null;

  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, TemplateListEntry[]>();
    for (const entry of entries) {
      if (!byGroup.has(entry.groupKey)) { byGroup.set(entry.groupKey, []); order.push(entry.groupKey); }
      byGroup.get(entry.groupKey)!.push(entry);
    }
    return order.map((key) => ({ key, items: byGroup.get(key)! }));
  }, [entries]);

  if (selected) {
    return <TemplateEditor key={selected.key} entry={selected} onBack={() => setSelectedKey(null)} />;
  }

  return (
    <div className="space-y-6">
      <AuthSyncPanel sync={sync} onSync={setSync} />
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-faint">{t(group.key)}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.items.map((entry) => (
              <TemplateTile key={entry.key} entry={entry} sync={sync} onEdit={() => setSelectedKey(entry.key)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ── Supabase Auth sync panel (A11) ─────────────────────────────────────────
 * Four states, never a claim beyond the verified truth:
 *   ● synced   — last sync verified AND nothing changed since
 *   ● pending  — token present, changes not pushed yet
 *   ● error    — last attempt failed (message shown)
 *   ● manual   — no SUPABASE_MANAGEMENT_TOKEN, so only the dashboard works */
function AuthSyncPanel({ sync, onSync }: {
  sync: AuthSyncView | null;
  onSync: (v: AuthSyncView) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!sync) return null;

  const DOT: Record<AuthSyncView["state"], string> = {
    synced: "bg-success",
    pending: "bg-warning",
    error: "bg-danger",
    manual: "bg-warning",
  };
  const LABEL: Record<AuthSyncView["state"], string> = {
    synced: t("tpl.sync.stateSynced"),
    pending: t("tpl.sync.statePending"),
    error: t("tpl.sync.stateError"),
    manual: t("tpl.sync.stateManual"),
  };

  const run = async () => {
    setBusy(true);
    const res = await syncSupabaseAuthAction();
    setBusy(false);
    if (res.view) onSync(res.view);
    if (res.ok) {
      toast.success(res.smtpIncluded ? t("tpl.sync.okSmtpToast") : t("tpl.sync.okToast"));
      router.refresh();
    } else if (res.reason === "no_token") {
      toast.error(t("tpl.sync.noTokenToast"));
    } else {
      toast.error(t("tpl.sync.failToast"));
    }
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[sync.state]}`} />
            {t("tpl.sync.title")} — {LABEL[sync.state]}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {t("tpl.sync.last")}: {sync.lastSyncAt
              ? new Date(sync.lastSyncAt).toLocaleString("pl-PL")
              : t("tpl.sync.never")}
            {" · "}
            {sync.smtpReady ? t("tpl.sync.smtpReady") : t("tpl.sync.smtpMissing")}
          </p>
        </div>
        <Button onClick={() => void run()} disabled={busy || !sync.tokenPresent}>
          {busy
            ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden />
            : <RefreshCw size={14} aria-hidden className="mr-2" />}
          {t("tpl.sync.button")}
        </Button>
      </div>

      {sync.state === "error" && sync.error && (
        <p className="mt-3 rounded-xl bg-[rgb(var(--danger)/0.1)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-danger">
          {sync.error}
        </p>
      )}
      {sync.state === "manual" && (
        <div className="mt-3 rounded-xl bg-[rgb(var(--warning)/0.1)] px-3.5 py-3 text-[12.5px] leading-relaxed text-warning">
          <p className="font-semibold">{t("tpl.sync.manualTitle")}</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4">
            <li>{t("tpl.sync.manual1")}</li>
            <li>{t("tpl.sync.manual2")}</li>
            <li>{t("tpl.sync.manual3")}</li>
          </ol>
          <p className="mt-2">{t("tpl.sync.manualAlt")}</p>
        </div>
      )}
    </Card>
  );
}

function TemplateTile({ entry, sync, onEdit }: {
  entry: TemplateListEntry;
  sync: AuthSyncView | null;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const Icon = entry.channel === "telegram" ? MessageCircle : Mail;
  const authSynced = entry.kind === "auth" && sync?.state === "synced";
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.12)] text-accent">
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{t(entry.nameKey)}</p>
          <p className="mt-0.5 text-[12px] text-muted">
            {entry.channel === "telegram" ? "Telegram" : "E-mail"}
            {entry.kind === "auth" ? ` · ${t("tpl.viaSupabase")}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {entry.kind === "auth" ? (
          authSynced
            ? <Badge tone="green">{t("tpl.authSynced")}</Badge>
            : <Badge tone="amber">{t("tpl.needsSync")}</Badge>
        ) : entry.publishedVersion > 0 ? (
          <Badge tone="green">{t("tpl.published")} v{entry.publishedVersion}</Badge>
        ) : (
          <Badge tone="neutral">{t("tpl.defaultActive")}</Badge>
        )}
        {entry.hasDraft && <Badge tone="neutral">{t("tpl.draft")}</Badge>}
        {!entry.hooked && <Badge tone="amber">{t("tpl.noHook")}</Badge>}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="truncate text-[11px] text-faint">
          {entry.updatedAt ? `${t("tpl.updated")}: ${new Date(entry.updatedAt).toLocaleDateString("pl-PL")}` : t("tpl.neverEdited")}
        </p>
        <Button size="sm" variant="secondary" onClick={onEdit}>
          <PencilLine size={13} aria-hidden className="mr-1.5" />
          {t("common.edit")}
        </Button>
      </div>
    </Card>
  );
}

/* ── the editor ─────────────────────────────────────────────────────────────*/

function TemplateEditor({ entry, onBack }: { entry: TemplateListEntry; onBack: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [def, setDef] = useState<TemplateDef>(() => startDef(entry));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | "reset" | null>(null);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [authHtml, setAuthHtml] = useState<{ subject: string; html: string } | null>(null);
  const focused = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const isAuth = entry.kind === "auth";

  // AUTH templates: fetch the GoTrue HTML once for preview + copy.
  useEffect(() => {
    if (!isAuth) return;
    void authTemplateHtmlAction(entry.key).then((res) => { if (res.ok) setAuthHtml(res); });
  }, [entry.key, isAuth]);

  // Debounced server-side preview for APP templates.
  useEffect(() => {
    if (isAuth) return;
    const id = setTimeout(() => {
      void previewTemplateAction(entry.key, def).then(setPreview);
    }, 450);
    return () => clearTimeout(id);
  }, [def, entry.key, isAuth]);

  const patch = useCallback((update: Partial<EmailDraft> & Partial<TgDraft>) => {
    setDef((prev) => prev.channel === "email"
      ? { channel: "email", email: { ...prev.email, ...update } }
      : { channel: "telegram", telegram: { ...prev.telegram, ...update } });
    setDirty(true);
  }, []);

  const insertPlaceholder = (name: string) => {
    const token = `{{${name}}}`;
    const el = focused.current;
    if (el && typeof el.selectionStart === "number") {
      const before = el.value.slice(0, el.selectionStart);
      const after = el.value.slice(el.selectionEnd ?? el.selectionStart);
      const fieldName = el.dataset.field as keyof (EmailDraft & TgDraft) | undefined;
      if (fieldName) { patch({ [fieldName]: `${before}${token}${after}` } as Partial<EmailDraft & TgDraft>); return; }
    }
    void navigator.clipboard?.writeText(token).then(() => toast.success(t("tpl.copied")));
  };

  const save = async () => {
    setBusy("save");
    const res = await saveTemplateDraftAction(entry.key, def);
    setBusy(null);
    if (res.ok) { setDirty(false); toast.success(t("tpl.draftSaved")); router.refresh(); }
    else toast.error(t("common.error"));
  };

  const publish = async () => {
    setConfirmPublish(false);
    setBusy("publish");
    // Publishing publishes the SAVED draft — save first so what the admin sees
    // is exactly what production will send.
    const saved = dirty ? await saveTemplateDraftAction(entry.key, def) : { ok: true as const };
    const res = saved.ok ? await publishTemplateAction(entry.key) : saved;
    setBusy(null);
    if (res.ok) { setDirty(false); toast.success(t("tpl.publishedToast")); router.refresh(); }
    else toast.error(t("common.error"));
  };

  const reset = async () => {
    setConfirmReset(false);
    setBusy("reset");
    const res = await resetTemplateAction(entry.key);
    setBusy(null);
    if (res.ok) {
      setDef(entry.defaults ?? startDef({ ...entry, draft: null, published: null }));
      setDirty(false);
      toast.success(t("tpl.resetDone"));
      router.refresh();
    } else toast.error(t("common.error"));
  };

  const copyAuthHtml = async () => {
    if (!authHtml) return;
    await navigator.clipboard.writeText(authHtml.html);
    toast.success(t("tpl.htmlCopied"));
  };

  const track = (el: HTMLInputElement | HTMLTextAreaElement | null) => { if (el) focused.current = el; };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>← {t("common.back")}</Button>
          <div>
            <h2 className="text-sm font-semibold text-ink">{t(entry.nameKey)}</h2>
            <p className="text-[12px] text-muted">
              {entry.channel === "telegram" ? "Telegram" : "E-mail"}
              {entry.publishedVersion > 0 ? ` · ${t("tpl.published")} v${entry.publishedVersion}` : ""}
              {entry.publishedAt ? ` · ${new Date(entry.publishedAt).toLocaleString("pl-PL")}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 lg:hidden">
          <Button size="sm" variant="secondary" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? t("tpl.hidePreview") : t("tpl.showPreview")}
          </Button>
        </div>
      </div>

      {isAuth && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-[rgb(var(--warning)/0.1)] px-3.5 py-3 text-[13px] leading-relaxed text-warning">
          <TriangleAlert size={15} aria-hidden className="mt-0.5 shrink-0" />
          {t("tpl.authNote")}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT — settings */}
        <Card className="p-5">
          {isAuth ? (
            <div className="space-y-4">
              <div>
                <Label>{t("tpl.subject")}</Label>
                <Input value={authHtml?.subject ?? "…"} readOnly className="mt-1.5" />
              </div>
              <Button onClick={() => void copyAuthHtml()} disabled={!authHtml}>
                <ClipboardCopy size={14} aria-hidden className="mr-2" />
                {t("tpl.copyHtml")}
              </Button>
              <p className="text-[12px] leading-relaxed text-faint">{t("tpl.authWhere")}</p>
            </div>
          ) : def.channel === "email" ? (
            <div className="space-y-3.5">
              <Field label={t("tpl.subject")} value={def.email.subject} field="subject" onChange={patch} track={track} />
              <Field label={t("tpl.heading")} value={def.email.heading} field="heading" onChange={patch} track={track} />
              <Area label={t("tpl.body")} value={def.email.body} field="body" rows={4} onChange={patch} track={track} />
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("tpl.ctaLabel")} value={def.email.ctaLabel} field="ctaLabel" onChange={patch} track={track} />
                <Field label={t("tpl.ctaUrl")} value={def.email.ctaUrl} field="ctaUrl" onChange={patch} track={track} />
              </div>
              <Field label={t("tpl.footer")} value={def.email.footer} field="footer" onChange={patch} track={track} />
              <div className="flex flex-wrap gap-x-6 gap-y-3 pt-1">
                <ToggleRow label={t("tpl.showLogo")} checked={def.email.showLogo} onChange={(v) => patch({ showLogo: v })} />
                <ToggleRow label={t("tpl.showFields")} checked={def.email.showFields} onChange={(v) => patch({ showFields: v })} />
                <ToggleRow label={t("tpl.showCta")} checked={def.email.showCta} onChange={(v) => patch({ showCta: v })} />
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="grid grid-cols-[80px_1fr] gap-3">
                <Field label={t("tpl.icon")} value={def.telegram.icon} field="icon" onChange={patch} track={track} />
                <Field label={t("tpl.title")} value={def.telegram.title} field="title" onChange={patch} track={track} />
              </div>
              <Area label={t("tpl.tgBody")} value={def.telegram.body} field="body" rows={9} mono onChange={patch} track={track} />
              <Field label={t("tpl.footer")} value={def.telegram.footer} field="footer" onChange={patch} track={track} />
            </div>
          )}

          {!isAuth && entry.placeholders.length > 0 && (
            <div className="mt-4 border-t border-line pt-3.5">
              <p className="mb-2 text-[12px] font-semibold text-muted">{t("tpl.placeholders")}</p>
              <div className="flex flex-wrap gap-1.5">
                {entry.placeholders.map((name) => (
                  <button key={name} type="button" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertPlaceholder(name)}
                    className="rounded-lg bg-raised px-2 py-1 font-mono text-[11px] text-ink transition-colors hover:bg-[rgb(var(--accent)/0.14)]">
                    {`{{${name}}}`}
                  </button>
                ))}
              </div>
              {preview?.ok && preview.unknown.length > 0 && (
                <p className="mt-2.5 flex items-center gap-1.5 text-[12px] font-medium text-warning">
                  <TriangleAlert size={13} aria-hidden />
                  {t("tpl.unknownVars", { list: preview.unknown.map((u) => `{{${u}}}`).join(", ") })}
                </p>
              )}
            </div>
          )}

          {!isAuth && (
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <Button variant="secondary" onClick={() => void save()} disabled={busy !== null || !dirty}>
                {busy === "save" ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden /> : null}
                {t("tpl.saveDraft")}
              </Button>
              <Button onClick={() => setConfirmPublish(true)} disabled={busy !== null}>
                <Send size={14} aria-hidden className="mr-2" />
                {t("tpl.publish")}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={busy !== null}>
                <RotateCcw size={14} aria-hidden className="mr-2" />
                {t("tpl.reset")}
              </Button>
            </div>
          )}
        </Card>

        {/* RIGHT — live preview */}
        <div className={showPreview ? "" : "hidden lg:block"}>
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="text-[12px] font-semibold text-muted">{t("tpl.preview")}</p>
              {preview?.ok && preview.channel === "email" && (
                <p className="max-w-[60%] truncate text-[12px] text-faint">{preview.subject}</p>
              )}
            </div>
            {isAuth ? (
              authHtml
                ? <iframe title="preview" sandbox="" srcDoc={authHtml.html} className="h-[560px] w-full bg-white" />
                : <div className="flex h-[300px] items-center justify-center text-muted"><Loader2 className="animate-spin" aria-hidden /></div>
            ) : preview?.ok && preview.channel === "email" ? (
              <iframe title="preview" sandbox="" srcDoc={preview.html} className="h-[560px] w-full bg-white" />
            ) : preview?.ok && preview.channel === "telegram" ? (
              <iframe title="preview" sandbox="" srcDoc={telegramPreviewDoc(preview.text, preview.buttons)} className="h-[420px] w-full" />
            ) : (
              <div className="flex h-[300px] items-center justify-center text-muted"><Loader2 className="animate-spin" aria-hidden /></div>
            )}
          </Card>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">{t("tpl.sampleNote")}</p>
        </div>
      </div>

      {(confirmReset || confirmPublish) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal>
          <Card className="w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-ink">
              {confirmReset ? t("tpl.resetConfirmTitle") : t("tpl.publishConfirmTitle")}
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              {confirmReset ? t("tpl.resetConfirmBody") : t("tpl.publishConfirmBody")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setConfirmReset(false); setConfirmPublish(false); }}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={() => void (confirmReset ? reset() : publish())}>
                <BadgeCheck size={14} aria-hidden className="mr-1.5" />
                {confirmReset ? t("tpl.reset") : t("tpl.publish")}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/** The Telegram bubble, rendered inside a SANDBOXED iframe: the text is our
 *  own server renderer's output (values escaped there), and the sandbox keeps
 *  even that at arm's length from the admin session. */
function telegramPreviewDoc(text: string, buttons: string[] = []): string {
  // Buttons are LABELS ONLY, and escaped: the preview shows what the inline
  // keyboard will look like without putting a live URL inside the admin page.
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const keys = buttons.length
    ? `<div class="keys">${buttons.map((b) => `<div class="key">${esc(b)}</div>`).join("")}</div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:20px;background:#0e1621;font-family:-apple-system,Segoe UI,Roboto,sans-serif;}
    .bubble{max-width:340px;background:#182533;border-radius:12px 12px 12px 4px;padding:10px 14px;color:#f1f1f4;
      font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}
    .bubble b{font-weight:700}.bubble i{font-style:italic}
    .bubble code{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#71baf2}
    .bubble blockquote{margin:6px 0;padding-left:8px;border-left:2px solid #4a9eda;color:#c9d6e2}
    .bubble pre{margin:6px 0;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#c9d6e2}
    .keys{max-width:340px;margin-top:2px}
    .key{background:#182533;border-top:1px solid #22303d;border-radius:0 0 8px 8px;padding:9px 12px;
      text-align:center;color:#71baf2;font-size:13px;font-weight:600}
    .meta{margin-top:6px;text-align:right;font-size:11px;color:#7d8b99;max-width:340px}
  </style></head><body><div class="bubble">${text}</div>${keys}<div class="meta">GrovBase Bot · 04:46</div></body></html>`;
}

/* ── little form primitives ─────────────────────────────────────────────────*/

function Field({ label, value, field, onChange, track }: {
  label: string; value: string; field: string;
  onChange: (patch: Record<string, string>) => void;
  track: (el: HTMLInputElement | null) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={value} data-field={field} className="mt-1.5"
        onFocus={(e) => track(e.currentTarget)}
        onChange={(e) => onChange({ [field]: e.target.value })} />
    </div>
  );
}

function Area({ label, value, field, rows, mono, onChange, track }: {
  label: string; value: string; field: string; rows: number; mono?: boolean;
  onChange: (patch: Record<string, string>) => void;
  track: (el: HTMLTextAreaElement | null) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <textarea value={value} data-field={field} rows={rows}
        onFocus={(e) => track(e.currentTarget)}
        onChange={(e) => onChange({ [field]: e.target.value })}
        className={`mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-[rgb(var(--accent)/0.6)] ${mono ? "font-mono text-[12.5px]" : ""}`} />
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 text-[13px] font-medium text-ink">
      <Switch checked={checked} onChange={onChange} label={label} />
      {label}
    </label>
  );
}
