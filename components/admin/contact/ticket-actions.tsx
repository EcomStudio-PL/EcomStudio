"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { resendConfirmationAction, setTicketStatusAction } from "@/app/actions/contact-tickets";
import { TICKET_STATUSES } from "@/lib/contact-page";
import { cn } from "@/lib/utils";

/** The ticket's status as three buttons (Nowe / W trakcie / Zamknięte). */
export function TicketStatus({ id, status }: { id: string; status: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="group" aria-label={t("chat.tickets.status")} className="flex flex-wrap gap-1.5" data-ticket-status={status}>
      {TICKET_STATUSES.map((s) => (
        <Button key={s} size="sm" variant={s === status ? "primary" : "secondary"} disabled={pending || s === status}
          aria-pressed={s === status} className={cn(s === status && "pointer-events-none")}
          onClick={() => start(async () => {
            const res = await setTicketStatusAction(id, s);
            if (res.ok) {
              toast.success(t("chat.tickets.statusSaved"));
              router.refresh();
            } else toast.error(t("common.error"));
          })}>
          {t(`chat.tickets.st.${s}`)}
        </Button>
      ))}
    </div>
  );
}

/** "Wyślij potwierdzenie ponownie" — the same mail, through the same mailbox. */
export function ResendConfirmation({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="secondary" disabled={pending}
      onClick={() => start(async () => {
        const res = await resendConfirmationAction(id);
        if (res.ok) toast.success(t("chat.tickets.resent"));
        else toast.error(t(res.error === "mail_not_configured" ? "chat.tickets.mailNotConfigured" : "chat.tickets.resendFailed"));
        router.refresh();
      })}>
      {pending ? t("chat.tickets.resending") : t("chat.tickets.resend")}
    </Button>
  );
}
