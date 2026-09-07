"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, MailCheck, MoreHorizontal, Send, ShieldOff, ShieldCheck, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  bulkSetBlockedAction, deleteCustomerAction, resendVerificationAction,
  sendCustomerMessageAction, sendPasswordResetAction,
} from "@/app/actions/admin-crm";
import { Modal, ConfirmModal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * THE ⋯ MENU on a customer row.
 *
 * Six things, and each one is a real capability of this system:
 *
 *   · a password-reset link, sent to the customer — never shown to the admin,
 *     never typed by the admin (§32); there is no field for one anywhere,
 *   · a confirmation e-mail, offered only while the account is unverified,
 *   · a written message, on the GrovBase mailbox the product already uses —
 *     no SMS, no WhatsApp, because GrovBase does not have those,
 *   · suspend / reactivate, the reversible pair,
 *   · close the account, behind a typed confirmation that the server checks
 *     again for itself.
 */

type MenuItem = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
};

export function CustomerActions({ userId, email, blocked, verified, isSelf }: {
  userId: string; email: string; blocked: boolean; verified: boolean; isSelf: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "message" | "reset" | "resend" | "block" | "delete">(null);
  const [message, setMessage] = useState({ subject: "", body: "" });
  const [confirmEmail, setConfirmEmail] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  /**
   * The menu is portalled and positioned against the viewport.
   *
   * The customer table is a scroll container with `overflow: hidden` on its
   * panel, so an in-flow menu on the last row is clipped by the very card it
   * belongs to — the delete entry simply disappears. Fixed positioning against
   * the trigger, flipping up when there is no room below, is the fix.
   */
  const place = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 224;
    const estimated = 4 + 38 * 5;
    const below = window.innerHeight - r.bottom;
    setPos({
      top: below < estimated + 8 && r.top > below ? Math.max(8, r.top - 4 - estimated) : r.bottom + 4,
      left: Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8),
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrap.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // The row scrolls under the menu; follow the trigger rather than vanish.
    const onScroll = () => place();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  /** One place where an action's answer becomes a sentence the operator reads. */
  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        setDialog(null);
        router.refresh();
        return;
      }
      const messages: Record<string, string> = {
        rate_limited: t("crm.errRateLimited"),
        already_verified: t("crm.errAlreadyVerified"),
        mail_not_configured: t("crm.errMailNotConfigured"),
        send_failed: t("crm.errSendFailed"),
        confirmation_mismatch: t("crm.errConfirmMismatch"),
        self: t("crm.errSelf"),
        not_found: t("crm.errNotFound"),
      };
      toast.error(messages[res.error ?? ""] ?? t("common.error"));
    });
  }

  const items: MenuItem[] = [
    { key: "message", label: t("crm.sendMessage"), icon: Send, onSelect: () => setDialog("message") },
    { key: "reset", label: t("crm.resetPassword"), icon: KeyRound, onSelect: () => setDialog("reset") },
    // Offered only while it would do something: an account that confirmed
    // months ago has nothing to re-send.
    { key: "resend", label: t("crm.resendVerification"), icon: MailCheck, hidden: verified, onSelect: () => setDialog("resend") },
    {
      key: "block",
      label: blocked ? t("crm.unblock") : t("crm.block"),
      icon: blocked ? ShieldCheck : ShieldOff,
      hidden: isSelf,
      onSelect: () => setDialog("block"),
    },
    { key: "delete", label: t("crm.deleteAccount"), icon: Trash2, danger: true, hidden: isSelf, onSelect: () => setDialog("delete") },
  ];

  return (
    <div ref={wrap} className="relative inline-block">
      <button
        type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t("common.actions")}
        onClick={() => setOpen((v) => !v)} disabled={pending}
        className="grid size-9 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50">
        <MoreHorizontal size={16} aria-hidden />
      </button>

      {open && pos && createPortal(
        <div ref={panel} role="menu"
          style={{ position: "fixed", top: pos.top, left: pos.left, width: 224 }}
          className="overlay animate-pop z-[80] rounded-xl p-1 text-left">
          {items.filter((i) => !i.hidden).map((item) => (
            <button
              key={item.key} type="button" role="menuitem"
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={cn(
                "flex min-h-[38px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium transition-colors hover:bg-raised",
                item.danger && "text-danger",
              )}>
              <item.icon size={14} aria-hidden />
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}

      {/* WYŚLIJ WIADOMOŚĆ — one channel, the one that exists. */}
      <Modal open={dialog === "message"} onClose={() => setDialog(null)} title={t("crm.sendMessage")}>
        <div className="space-y-4">
          <p className="rounded-xl bg-raised px-4 py-2.5 text-sm text-muted">
            {t("crm.messageTo")} <span className="font-medium text-ink">{email}</span>
          </p>
          <div>
            <Label htmlFor={`sub-${userId}`}>{t("crm.messageSubject")}</Label>
            <Input id={`sub-${userId}`} value={message.subject} maxLength={200}
              onChange={(e) => setMessage({ ...message, subject: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`bod-${userId}`}>{t("crm.messageBody")}</Label>
            <Textarea id={`bod-${userId}`} rows={7} value={message.body} maxLength={5000}
              onChange={(e) => setMessage({ ...message, body: e.target.value })} />
            <p className="mt-1 text-xs text-faint">{t("crm.messageHint")}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>{t("common.cancel")}</Button>
            <Button
              disabled={pending || !message.subject.trim() || !message.body.trim()}
              onClick={() => run(
                () => sendCustomerMessageAction({ userId, subject: message.subject, body: message.body })
                  .then((r) => { if (r.ok) setMessage({ subject: "", body: "" }); return r; }),
                t("crm.messageSent"),
              )}>
              {pending ? t("crm.sending") : t("crm.send")}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={dialog === "reset"} onClose={() => setDialog(null)} pending={pending}
        title={t("crm.resetPassword")} body={t("crm.resetPasswordBody", { email })}
        confirmLabel={t("crm.sendLink")}
        onConfirm={() => run(() => sendPasswordResetAction(userId), t("crm.resetPasswordSent"))} />

      <ConfirmModal open={dialog === "resend"} onClose={() => setDialog(null)} pending={pending}
        title={t("crm.resendVerification")} body={t("crm.resendVerificationBody", { email })}
        confirmLabel={t("crm.sendLink")}
        onConfirm={() => run(() => resendVerificationAction(userId), t("crm.verificationSent"))} />

      <ConfirmModal open={dialog === "block"} onClose={() => setDialog(null)} pending={pending}
        danger={!blocked}
        title={blocked ? t("crm.unblock") : t("crm.block")}
        body={blocked ? t("crm.unblockBody") : t("crm.blockBody")}
        confirmLabel={blocked ? t("crm.unblock") : t("crm.block")}
        onConfirm={() => run(
          () => bulkSetBlockedAction([userId], !blocked),
          blocked ? t("crm.unblocked") : t("crm.blockedDone"),
        )} />

      {/* USUŃ KONTO — typed confirmation, and the server checks it again. */}
      <Modal open={dialog === "delete"} onClose={() => setDialog(null)} title={t("crm.deleteAccount")}>
        <div className="space-y-4">
          <p className="text-sm text-muted">{t("crm.deleteBody")}</p>
          <ul className="space-y-1 rounded-xl bg-raised px-4 py-3 text-[13px] text-muted">
            <li>• {t("crm.deleteKeepsLedger")}</li>
            <li>• {t("crm.deleteAnonymises")}</li>
            <li>• {t("crm.deleteLocksLogin")}</li>
          </ul>
          <div>
            <Label htmlFor={`del-${userId}`}>{t("crm.deleteConfirmLabel", { email })}</Label>
            <Input id={`del-${userId}`} value={confirmEmail} autoComplete="off"
              onChange={(e) => setConfirmEmail(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>{t("common.cancel")}</Button>
            <Button variant="danger"
              disabled={pending || confirmEmail.trim().toLowerCase() !== email.toLowerCase()}
              onClick={() => run(
                () => deleteCustomerAction(userId, confirmEmail.trim())
                  .then((r) => { if (r.ok) setConfirmEmail(""); return r; }),
                t("crm.deleted"),
              )}>
              {t("crm.deleteAccount")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
