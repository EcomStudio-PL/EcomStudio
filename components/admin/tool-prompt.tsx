"use client";
import { createContext, useContext, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { Eye, History, Lock, RotateCcw, ScanText, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  publishPromptVersionAction, readPromptBodyAction,
  restorePromptVersionAction, savePromptAction,
} from "@/app/actions/ai-tools";
import { compilePreviewAction, type CompilePreview } from "@/app/actions/ai-engine";
import type { PromptVersionRow } from "@/lib/services/ai-tools";
import { TOOL_VARIABLES } from "@/lib/ai/prompt-variables";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { RelativeTime } from "@/components/ui/relative-time";
import { VariableChips, insertAtCursor } from "@/components/admin/variable-chips";
import { cn, formatDate } from "@/lib/utils";

/**
 * THE HIDDEN PROMPT — editor and history.
 *
 * The body is never in the page unless an admin asked for it: the list is
 * versions, authors and reasons, and the text arrives only when somebody opens
 * one. Publishing needs a reason, because a version history of anonymous edits
 * answers no question anybody will ask of it later.
 *
 * Restoring copies an old version FORWARD into a new published one. Nothing in
 * the history is ever rewritten, so "what were we running in August" always
 * has an answer.
 *
 * The draft lives in this page only (React state — never localStorage): a
 * draft is not saved until the admin saves it, and a saved draft does not
 * reach production until it is published.
 */

export const PROMPT_LIMIT = 40000;

type Draft = { body: string; summary: string; reason: string; fromVersion: number | null };
const EMPTY: Draft = { body: "", summary: "", reason: "", fromVersion: null };

const DraftContext = createContext<{
  draft: Draft;
  setDraft: (d: Draft) => void;
  focusEditor: () => void;
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
} | null>(null);

/** Shares the draft between the editor (section 2) and the version list
 *  (section 6), so "Edytuj" on an old version fills the editor above. */
export function PromptDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const focusEditor = () => {
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    editorRef.current?.focus({ preventScroll: true });
  };
  return <DraftContext.Provider value={{ draft, setDraft, focusEditor, editorRef }}>{children}</DraftContext.Provider>;
}

function useDraft() {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error("PromptDraftProvider missing");
  return ctx;
}

function promptError(t: (k: string) => string, error?: string): string {
  return error === "reason_required" ? t("aicc.err.reasonRequired")
    : error === "encryption_unavailable" ? t("aicc.err.encryption")
    : error === "too_long" ? t("aicc.err.tooLong")
    : error === "variable_unknown" ? t("aicc.err.variableUnknown")
    : error === "decrypt_failed" ? t("aicc.err.decrypt")
    : t("common.error");
}

export function ToolPromptEditor({ toolKey, versions, locale, hasEngine }: {
  toolKey: string;
  versions: PromptVersionRow[];
  locale: string;
  /** False when the tool's mode does not read a published prompt — a stored
   *  body would not be used, and the editor says so rather than implying it would. */
  hasEngine: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { draft, setDraft, editorRef } = useDraft();
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<CompilePreview | null>(null);
  const published = versions.find((v) => v.status === "published");
  const chars = draft.body.length;
  const over = chars > PROMPT_LIMIT;

  function insert(token: string) {
    const next = insertAtCursor(editorRef.current, draft.body, token);
    setDraft({ ...draft, body: next.value });
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  function save(publish: boolean) {
    start(async () => {
      const res = await savePromptAction({
        toolKey, body: draft.body,
        summary: draft.summary || null,
        reason: draft.reason || null,
        publish,
      });
      if (res.ok) {
        toast.success(publish ? t("aicc.prompt.published", { n: res.version ?? 0 }) : t("aicc.prompt.drafted"));
        setDraft(EMPTY);
        router.refresh();
        return;
      }
      toast.error(promptError(t, res.error));
    });
  }

  function runPreview() {
    start(async () => {
      setPreview(await compilePreviewAction({ toolKey, body: draft.body }));
    });
  }

  return (
    <div className="space-y-4">
      {!hasEngine && (
        <p className="rounded-xl bg-raised px-4 py-3 text-[13px] text-muted">{t("aicc.prompt.modeOff")}</p>
      )}

      {/* Where production stands, before anyone types anything. */}
      <dl className="grid gap-x-4 gap-y-1.5 rounded-xl bg-raised px-4 py-3 text-[12.5px] sm:grid-cols-2" data-prompt-status>
        <div className="flex min-w-0 items-center gap-2">
          <dt className="shrink-0 text-muted">{t("aicc.prompt.statusLabel")}</dt>
          <dd className="min-w-0">
            {published
              ? <Badge tone="success">{t("aicc.prompt.status.published")} · v{published.version}</Badge>
              : <Badge tone="neutral">{t("aicc.prompt.nonePublished")}</Badge>}
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <dt className="shrink-0 text-muted">{t("aicc.prompt.draftLabel")}</dt>
          <dd className="min-w-0">
            {draft.body.trim()
              ? <Badge tone="info">{t("aicc.prompt.status.draft")}{draft.fromVersion ? ` · ${t("aicc.prompt.fromVersion", { n: draft.fromVersion })}` : ""}</Badge>
              : <span className="text-faint">—</span>}
          </dd>
        </div>
        {published && (
          <>
            <div className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-muted">{t("aicc.prompt.publishedAt")}</dt>
              <dd className="min-w-0 truncate">{formatDate(published.publishedAt ?? published.createdAt, locale)}</dd>
            </div>
            <div className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-muted">{t("aicc.prompt.lastEditor")}</dt>
              <dd className="min-w-0 truncate">{published.authorName ?? "—"}</dd>
            </div>
          </>
        )}
      </dl>

      <div className="panel rounded-2xl p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{t("aicc.prompt.editorTitle")}</p>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
            <Lock size={12} aria-hidden />
            {t("aicc.prompt.serverOnly")}
          </span>
        </div>
        <Textarea ref={editorRef} value={draft.body} spellCheck={false}
          aria-describedby="prompt-counter"
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          placeholder={t("aicc.prompt.placeholder")}
          // Tall enough to read a long prompt, resizable, and never covered
          // by a sticky bar: nothing in this card is sticky, and scroll-margin
          // keeps the caret above the phone keyboard's edge.
          className="h-[45dvh] min-h-[14rem] resize-y scroll-mb-40 font-mono text-[12.5px] leading-relaxed sm:h-[28rem]" />
        <p id="prompt-counter" data-prompt-counter
          className={cn("mt-1.5 text-right text-xs tabular-nums", over ? "text-danger" : chars > PROMPT_LIMIT * 0.9 ? "text-warning" : "text-faint")}>
          {t("aicc.prompt.counter", { n: chars.toLocaleString(locale), max: PROMPT_LIMIT.toLocaleString(locale) })}
        </p>

        <div className="mt-3">
          <VariableChips defs={TOOL_VARIABLES[toolKey] ?? []} onInsert={insert} />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="summary">{t("aicc.prompt.summary")}</Label>
            <Input id="summary" value={draft.summary} maxLength={300}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="reason">{t("aicc.prompt.reason")}</Label>
            <Input id="reason" value={draft.reason} maxLength={500}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={pending || !draft.body.trim()} onClick={runPreview}>
            <ScanText size={14} aria-hidden />
            {t("aicc.prompt.preview")}
          </Button>
          <Button variant="ghost" disabled={pending || !draft.body.trim() || over} onClick={() => save(false)}>
            {t("aicc.prompt.saveDraft")}
          </Button>
          <Button disabled={pending || !draft.body.trim() || !draft.reason.trim() || over} onClick={() => save(true)}>
            <Upload size={14} aria-hidden />
            {pending ? t("common.saving") : t("aicc.prompt.publish")}
          </Button>
        </div>
        {!draft.reason.trim() && draft.body.trim() && (
          <p className="mt-2 text-right text-xs text-faint">{t("aicc.err.reasonRequired")}</p>
        )}
      </div>

      <CompilePreviewModal preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/** "Podgląd kompilacji": the draft rendered with SAMPLE values. */
export function CompilePreviewModal({ preview, onClose }: { preview: CompilePreview | null; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal open={preview !== null} onClose={onClose} title={t("aicc.prompt.previewTitle")} wide>
      {preview && (
        <div className="space-y-3" data-compile-preview>
          <p className="text-xs text-muted">{t("aicc.prompt.previewNote")}</p>
          {preview.unknown.length > 0 && (
            <p className="rounded-lg bg-[rgb(var(--danger)/0.10)] px-3 py-2 text-xs text-danger">
              {t("aicc.prompt.previewUnknown", { names: preview.unknown.join(", ") })}
            </p>
          )}
          {preview.malformed.length > 0 && (
            <p className="rounded-lg bg-[rgb(var(--warning)/0.12)] px-3 py-2 text-xs text-warning">
              {t("aicc.prompt.previewMalformed", { list: preview.malformed.join("  ") })}
            </p>
          )}
          {preview.ok && preview.text !== undefined && (
            <pre className={cn(
              "thin-scroll max-h-[55dvh] overflow-auto rounded-xl bg-sunken p-4",
              "whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed",
            )}>{preview.text}</pre>
          )}
          {!preview.ok && preview.error !== "variable_unknown" && (
            <p className="text-xs text-danger">{t("common.error")}</p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Section 6 — every version, with view / edit / publish / rollback. */
export function ToolPromptHistory({ versions, locale }: { versions: PromptVersionRow[]; locale: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { setDraft, focusEditor } = useDraft();
  const [pending, start] = useTransition();
  const [loaded, setLoaded] = useState<{ version: number; body: string } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "publish" | "restore"; row: PromptVersionRow }>(null);
  const [reason, setReason] = useState("");
  const published = versions.find((v) => v.status === "published");

  function loadInto(row: PromptVersionRow, mode: "view" | "edit") {
    start(async () => {
      const res = await readPromptBodyAction(row.id);
      if (!res.ok || res.body === undefined) {
        toast.error(res.error === "decrypt_failed" ? t("aicc.err.decrypt") : t("common.error"));
        return;
      }
      if (mode === "view") setLoaded({ version: row.version, body: res.body });
      else {
        setDraft({ body: res.body, summary: row.summary ?? "", reason: "", fromVersion: row.version });
        focusEditor();
      }
    });
  }

  function runConfirm() {
    if (!confirm) return;
    start(async () => {
      const res = confirm.kind === "publish"
        ? await publishPromptVersionAction(confirm.row.id, reason)
        : await restorePromptVersionAction(confirm.row.id, reason);
      if (res.ok) {
        toast.success(t("common.saved"));
        setConfirm(null);
        setReason("");
        router.refresh();
      } else {
        toast.error(promptError(t, res.error));
      }
    });
  }

  return (
    <div className="panel rounded-2xl" data-prompt-history>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
        <History size={14} aria-hidden className="text-faint" />
        <p className="text-sm font-semibold">{t("aicc.prompt.history")}</p>
      </div>
      {versions.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">{t("aicc.prompt.noVersions")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {versions.map((v) => (
            <li key={v.id}
              // Stacked on a phone: a version, its badges and three actions
              // do not fit one 390px line without shredding the label.
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:px-5">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="shrink-0 font-mono text-[13px] font-semibold">v{v.version}</span>
                <Badge tone={v.status === "published" ? "success" : v.status === "draft" ? "info" : "neutral"}>
                  {t(`aicc.prompt.status.${v.status}`)}
                </Badge>
                {v.source === "knowledge" && <Badge tone="accent">{t("aicc.prompt.fromKnowledge")}</Badge>}
                <span className="min-w-0 truncate text-xs text-muted">
                  {v.summary || v.reason || "—"}
                </span>
              </span>
              <span className="shrink-0 text-xs text-faint">
                {v.authorName ? `${v.authorName} · ` : ""}
                <RelativeTime at={v.publishedAt ?? v.createdAt} locale={locale} t={t} />
              </span>
              <span className="flex shrink-0 flex-wrap gap-1">
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => loadInto(v, "view")}
                  aria-label={t("aicc.prompt.viewTitle", { n: v.version })}>
                  <Eye size={14} aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => loadInto(v, "edit")}>
                  {t("common.edit")}
                </Button>
                {v.status === "draft" && (
                  <Button size="sm" variant="secondary" disabled={pending}
                    onClick={() => { setReason(v.reason ?? ""); setConfirm({ kind: "publish", row: v }); }}>
                    {t("aicc.prompt.publish")}
                  </Button>
                )}
                {v.status === "superseded" && (
                  <Button size="sm" variant="secondary" disabled={pending}
                    onClick={() => { setReason(""); setConfirm({ kind: "restore", row: v }); }}>
                    <RotateCcw size={14} aria-hidden />
                    {t("aicc.prompt.restore")}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {published && (
        <p className="border-t border-line px-4 py-2.5 text-xs text-faint sm:px-5">
          {t("aicc.prompt.liveNote", { n: published.version })}
        </p>
      )}

      {/* Reading a version: the body arrives only for this dialog. */}
      <Modal open={loaded !== null} onClose={() => setLoaded(null)}
        title={t("aicc.prompt.viewTitle", { n: loaded?.version ?? 0 })} wide>
        <pre className={cn(
          "thin-scroll max-h-[60dvh] overflow-auto rounded-xl bg-sunken p-4",
          "whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed",
        )}>
          {loaded?.body}
        </pre>
      </Modal>

      <Modal open={confirm !== null} onClose={() => setConfirm(null)}
        title={confirm?.kind === "restore" ? t("aicc.prompt.restore") : t("aicc.prompt.publish")}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {confirm?.kind === "restore"
              ? t("aicc.prompt.restoreBody", { n: confirm.row.version })
              : t("aicc.prompt.publishBody", { n: confirm?.row.version ?? 0 })}
          </p>
          <div>
            <Label htmlFor="confirm-reason">{t("aicc.prompt.reason")}</Label>
            <Input id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
            <Button disabled={pending || (confirm?.kind === "publish" && !reason.trim())} onClick={runConfirm}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
