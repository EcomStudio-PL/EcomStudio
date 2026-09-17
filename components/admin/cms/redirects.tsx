"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { saveRedirectAction, deleteRedirectAction } from "@/app/actions/cms";
import type { RedirectRow } from "@/lib/services/cms";
import { Button } from "@/components/ui/button";
import { Modal, ConfirmModal } from "@/components/ui/modal";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";

/**
 * THE REDIRECT MANAGER.
 *
 * One table, four columns, and the reason it exists in one sentence: an ad
 * that has been running for a week should not stop working because the
 * landing behind it was replaced. `grovbase.com/promocja` stays the address
 * in every campaign; where it goes is changed here.
 *
 * THE STATUS CODE IS A REAL CHOICE AND IS EXPLAINED AS ONE. 301 and 308 are
 * permanent and browsers cache them for as long as they like — which is
 * exactly what you do not want on a promotion you will re-point next month.
 * 307 is the default here for that reason.
 */

type Draft = {
  id?: string;
  source: string;
  target: string;
  statusCode: number;
  enabled: boolean;
  note: string;
};

const EMPTY: Draft = { source: "", target: "", statusCode: 307, enabled: true, note: "" };

export function RedirectManager({ rows, locale }: { rows: RedirectRow[]; locale: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<RedirectRow | null>(null);

  const run = (p: Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      const res = await p;
      if (res.ok) { done?.(); router.refresh(); }
      else toast.error(t(`cms.err.${res.error ?? "generic"}`));
    });

  function save() {
    if (!editing) return;
    run(saveRedirectAction({
      id: editing.id,
      source: editing.source,
      target: editing.target,
      statusCode: editing.statusCode,
      enabled: editing.enabled,
      note: editing.note || null,
    }), () => { setEditing(null); toast.success(t("common.saved")); });
  }

  return (
    <div data-redirects>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg font-semibold tracking-tight">{t("cms.redirects")}</h1>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("cms.redirectsSub")}</p>
        </div>
        <Button size="sm" onClick={() => setEditing({ ...EMPTY })} data-new-redirect>
          <Plus size={14} aria-hidden />{t("cms.newRedirect")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="panel rounded-2xl px-4 py-10 text-center text-[13px] text-muted">
          {t("cms.redirectsEmpty")}
        </p>
      ) : (
        <ul className="space-y-2" data-redirect-list>
          {rows.map((r) => (
            <li key={r.id} data-redirect={r.source}
              className={cn("panel rounded-2xl px-3 py-2.5", !r.enabled && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <button type="button" data-edit-redirect
                  onClick={() => setEditing({
                    id: r.id, source: r.source, target: r.target,
                    statusCode: r.statusCode, enabled: r.enabled, note: r.note ?? "",
                  })}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left">
                  <code className="truncate text-[12.5px] font-semibold">{r.source}</code>
                  <ArrowRight size={13} aria-hidden className="shrink-0 text-faint" />
                  <code className="min-w-0 truncate text-[12.5px] text-muted">{r.target}</code>
                </button>
                <Badge tone={r.statusCode === 301 || r.statusCode === 308 ? "warning" : "neutral"}>
                  {r.statusCode}
                </Badge>
                <Badge tone={r.enabled ? "success" : "neutral"}>
                  {t(r.enabled ? "cms.redirectOn" : "cms.redirectOff")}
                </Badge>
                <button type="button" onClick={() => setDeleting(r)} aria-label={t("common.delete")}
                  data-delete-redirect
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-danger">
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              {(r.note || r.hits > 0) && (
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-faint">
                  {r.note && <span className="truncate">{r.note}</span>}
                  {r.hits > 0 && (
                    <span className="tabular-nums">
                      {t("cms.redirectHits", { n: r.hits })}
                      {r.lastHitAt ? ` · ${formatDate(r.lastHitAt, locale)}` : ""}
                    </span>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)}
        title={t(editing?.id ? "cms.editRedirect" : "cms.newRedirect")}>
        {editing && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="rd-source">{t("cms.redirectFrom")}</Label>
              <Input id="rd-source" value={editing.source} spellCheck={false} autoFocus
                placeholder="/promocja"
                onChange={(e) => setEditing({ ...editing, source: e.target.value })} />
              <p className="mt-1.5 text-[11.5px] text-faint">{t("cms.redirectFromHint")}</p>
            </div>
            <div>
              <Label htmlFor="rd-target">{t("cms.redirectTo")}</Label>
              <Input id="rd-target" value={editing.target} spellCheck={false}
                placeholder="/promo/2x-kredyty"
                onChange={(e) => setEditing({ ...editing, target: e.target.value })} />
              <p className="mt-1.5 text-[11.5px] text-faint">{t("cms.redirectToHint")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="rd-status">{t("cms.redirectType")}</Label>
                <Select id="rd-status" value={String(editing.statusCode)}
                  onChange={(e) => setEditing({ ...editing, statusCode: Number(e.target.value) })}>
                  <option value="307">307 — {t("cms.redirectTemp")}</option>
                  <option value="302">302 — {t("cms.redirectTemp")}</option>
                  <option value="301">301 — {t("cms.redirectPerm")}</option>
                  <option value="308">308 — {t("cms.redirectPerm")}</option>
                </Select>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
                  {t("cms.redirectTypeHint")}
                </p>
              </div>
              <div>
                <Label htmlFor="rd-note">{t("cms.redirectNote")}</Label>
                <Input id="rd-note" value={editing.note}
                  onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={editing.enabled}
                className="h-4 w-4 accent-[rgb(var(--accent))]"
                onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
              {t("cms.redirectEnabled")}
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
              <Button disabled={pending || !editing.source.trim() || !editing.target.trim()}
                onClick={save} data-save-redirect>
                {t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          run(deleteRedirectAction(deleting.id), () => setDeleting(null));
        }}
        title={t("common.delete")} body={t("cms.redirectDeleteBody")}
        confirmLabel={t("common.delete")} danger pending={pending} />
    </div>
  );
}
