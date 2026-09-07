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
  previewTemplateAction, publishTemplateAction,
  resetTemplateAction, saveTemplateDraftAction, configureAuthHookAction,
  type TemplateListEntry, type TemplatePreview,
} from "@/app/actions/templates";
import type { AuthDeliveryView } from "@/app/actions/templates";

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

export function TemplateStudio({ entries, delivery }: {
  entries: TemplateListEntry[];
  delivery: AuthDeliveryView | null;
}) {
  const { t } = useI18n();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pipe, setPipe] = useState<AuthDeliveryView | null>(delivery);
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
      <AuthDeliveryPanel view={pipe} onChange={setPipe} />
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-faint">{t(group.key)}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.items.map((entry) => (
              <TemplateTile key={entry.key} entry={entry} onEdit={() => setSelectedKey(entry.key)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ── AUTH E-MAIL DELIVERY ────────────────────────────────────────────────────
 * Three lines, and not one of them says something we have not verified.
 *
 *   GrovBase templates — always on: the published rows below ARE the source.
 *   GrovBase SMTP      — read from the mailbox integration, not assumed.
 *   Send Email Hook    — read back from Supabase when a management token lets
 *                        us ask. Without one we say "endpoint ready, awaiting
 *                        activation" rather than showing a green light we
 *                        cannot stand behind.
 */
function AuthDeliveryPanel({ view, onChange }: {
  view: AuthDeliveryView | null;
  onChange: (v: AuthDeliveryView) => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!view) return null;

  const hookState = view.hook.supabase;
  const hookTone = hookState === "ready" ? "ok"
    : hookState === "mismatch" ? "bad"
      : "wait";
  const hookLabel = hookState === "ready" ? t("tpl.pipe.hookReady")
    : hookState === "mismatch" ? t("tpl.pipe.hookMismatch")
      : hookState === "off" ? t("tpl.pipe.hookOff")
        : view.hook.endpoint === "ready" ? t("tpl.pipe.hookUnknownReady")
          : t("tpl.pipe.hookAwaiting");

  const run = async () => {
    setBusy(true);
    const res = await configureAuthHookAction();
    setBusy(false);
    if (res.view) onChange(res.view);
    if (res.ok) {
      toast.success(t("tpl.pipe.okToast"));
      router.refresh();
      return;
    }
    toast.error(
      res.reason === "no_token" ? t("tpl.pipe.noTokenToast")
        : res.reason === "no_key" ? t("tpl.pipe.noKeyToast")
          : t("tpl.pipe.failToast"),
    );
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{t("tpl.pipe.title")}</p>
          <div className="mt-2.5 space-y-1.5">
            <PipeLine tone="ok" label={t("tpl.pipe.templates")} value={t("tpl.pipe.templatesOn")} />
            <PipeLine tone={view.smtpReady ? "ok" : "bad"} label={t("tpl.pipe.smtp")}
              value={view.smtpReady ? t("tpl.pipe.smtpOn") : t("tpl.pipe.smtpOff")} />
            <PipeLine tone={hookTone} label={t("tpl.pipe.hook")} value={hookLabel} />
            {/* The number that capped production at two registrations an hour
                while every other line stayed green. Shown, not assumed — and
                flagged when it is too low to run a business on. */}
            {view.hook.emailRateLimit !== null && (
              <PipeLine
                tone={view.hook.emailRateLimit < 10 ? "bad" : "ok"}
                label={t("tpl.pipe.quota")}
                value={view.hook.emailRateLimit < 10
                  ? t("tpl.pipe.quotaLow", { n: view.hook.emailRateLimit })
                  : t("tpl.pipe.quotaOk", { n: view.hook.emailRateLimit })}
              />
            )}
            {/* Configuration above, OUTCOME here. Every line above was green
                through the outage that failed every registration; this is the
                one that would have said otherwise. */}
            <PipeLine
              tone={view.lastDelivery ? (view.lastDelivery.ok ? "ok" : "bad") : "wait"}
              label={t("tpl.pipe.last")}
              value={view.lastDelivery
                ? t(view.lastDelivery.ok ? "tpl.pipe.lastOk" : "tpl.pipe.lastFailed", {
                  action: view.lastDelivery.action,
                  when: new Date(view.lastDelivery.at).toLocaleString(locale, {
                    dateStyle: "short", timeStyle: "short", timeZone: "Europe/Warsaw",
                  }),
                  reason: view.lastDelivery.reason ?? "—",
                })
                : t("tpl.pipe.lastNone")}
            />
          </div>
        </div>
        {view.hook.canAutomate && (
          <Button onClick={() => void run()} disabled={busy}>
            {busy
              ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden />
              : <RefreshCw size={14} aria-hidden className="mr-2" />}
            {hookState === "ready" ? t("tpl.pipe.reconfigure") : t("tpl.pipe.configure")}
          </Button>
        )}
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-muted">{t("tpl.pipe.explainer")}</p>

      {view.hook.error && (
        <p className="mt-3 rounded-xl bg-[rgb(var(--danger)/0.1)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-danger">
          {view.hook.error}
        </p>
      )}

      {/* No management token: the ONE thing left for a person to do, spelled
          out exactly, with the URL to paste. */}
      {!view.hook.canAutomate && (
        <div className="mt-3 rounded-xl bg-[rgb(var(--warning)/0.1)] px-3.5 py-3 text-[12.5px] leading-relaxed text-warning">
          <p className="font-semibold">{t("tpl.pipe.manualTitle")}</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4">
            <li>{t("tpl.pipe.manual1")}</li>
            <li>{t("tpl.pipe.manual2")}</li>
            <li>{t("tpl.pipe.manual3")}</li>
          </ol>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          {t("tpl.pipe.endpoint")}
        </span>
        <code className="min-w-0 flex-1 truncate rounded-lg bg-raised px-2.5 py-1.5 font-mono text-[11.5px] text-muted">
          {view.endpointUrl}
        </code>
        <Button size="sm" variant="ghost"
          onClick={() => { void navigator.clipboard.writeText(view.endpointUrl); toast.success(t("tpl.copied")); }}>
          <ClipboardCopy size={13} aria-hidden className="mr-1.5" />
          {t("common.copy")}
        </Button>
      </div>
    </Card>
  );
}

function PipeLine({ tone, label, value }: {
  tone: "ok" | "wait" | "bad";
  label: string;
  value: string;
}) {
  const dot = tone === "ok" ? "bg-success" : tone === "wait" ? "bg-warning" : "bg-danger";
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-muted">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="font-medium text-ink">{label}</span>
      <span>{value}</span>
    </p>
  );
}

function TemplateTile({ entry, onEdit }: {
  entry: TemplateListEntry;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const Icon = entry.channel === "telegram" ? MessageCircle : Mail;
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
            {entry.kind === "auth" ? ` · ${t("tpl.viaHook")}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {entry.publishedVersion > 0 ? (
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
  const focused = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Every template previews the same way now — including the auth ones, which
  // GrovBase renders itself since the Send Email Hook took over.
  useEffect(() => {
    const id = setTimeout(() => {
      void previewTemplateAction(entry.key, def).then(setPreview);
    }, 450);
    return () => clearTimeout(id);
  }, [def, entry.key]);

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

      {entry.kind === "auth" && (
        <p className="mb-4 rounded-xl bg-[rgb(var(--accent)/0.08)] px-3.5 py-3 text-[13px] leading-relaxed text-muted">
          {t("tpl.authNote")}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT — settings */}
        <Card className="p-5">
          {def.channel === "email" ? (
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

          {entry.placeholders.length > 0 && (
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

          {(
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
            {preview?.ok && preview.channel === "email" ? (
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
