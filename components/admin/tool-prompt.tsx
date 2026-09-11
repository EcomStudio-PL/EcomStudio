"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { Eye, History, Lock, RotateCcw, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  publishPromptVersionAction, readPromptBodyAction,
  restorePromptVersionAction, savePromptAction,
} from "@/app/actions/ai-tools";
import type { PromptVersionRow } from "@/lib/services/ai-tools";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";

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
 */
export function ToolPromptEditor({ toolKey, versions, locale, hasEngine }: {
  toolKey: string;
  versions: PromptVersionRow[];
  locale: string;
  /** False when the tool's mode is 'off' or 'user' — a stored body would not
   *  be used, and the editor says so rather than implying it would. */
  hasEngine: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ body: "", summary: "", reason: "" });
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
      else setDraft({ body: res.body, summary: row.summary ?? "", reason: "" });
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
        setDraft({ body: "", summary: "", reason: "" });
        router.refresh();
        return;
      }
      toast.error(
        res.error === "reason_required" ? t("aicc.err.reasonRequired")
        : res.error === "encryption_unavailable" ? t("aicc.err.encryption")
        : res.error === "too_long" ? t("aicc.err.tooLong")
        : t("common.error"),
      );
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
        toast.error(res.error === "reason_required" ? t("aicc.err.reasonRequired") : t("common.error"));
      }
    });
  }

  return (
    <div className="space-y-5">
      {!hasEngine && (
        <p className="rounded-xl bg-raised px-4 py-3 text-[13px] text-muted">{t("aicc.prompt.modeOff")}</p>
      )}

      <div className="panel rounded-2xl p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{t("aicc.prompt.editorTitle")}</p>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
            <Lock size={12} aria-hidden />
            {t("aicc.prompt.serverOnly")}
          </span>
        </div>
        <Textarea rows={12} value={draft.body} spellCheck={false}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          placeholder={t("aicc.prompt.placeholder")}
          className="font-mono text-[12.5px] leading-relaxed" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="summary">{t("aicc.prompt.summary")}</Label>
            <Input id="summary" value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="reason">{t("aicc.prompt.reason")}</Label>
            <Input id="reason" value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={pending || !draft.body.trim()} onClick={() => save(false)}>
            {t("aicc.prompt.saveDraft")}
          </Button>
          <Button disabled={pending || !draft.body.trim() || !draft.reason.trim()} onClick={() => save(true)}>
            <Upload size={14} aria-hidden />
            {pending ? t("common.saving") : t("aicc.prompt.publish")}
          </Button>
        </div>
        {!draft.reason.trim() && draft.body.trim() && (
          <p className="mt-2 text-right text-xs text-faint">{t("aicc.err.reasonRequired")}</p>
        )}
      </div>

      <div className="panel rounded-2xl">
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
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => loadInto(v, "view")}>
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
      </div>

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
