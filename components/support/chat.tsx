"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createThreadAction, postMessageAction, staffReplyAction } from "@/app/actions/support";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChatMessage = { id: string; body: string; is_staff: boolean; created_at: string };

/** Message list + composer, shared by the customer view and admin view. */
export function ChatThread({ threadId, messages, staffSide, closed }: {
  threadId: string; messages: ChatMessage[]; staffSide?: boolean; closed?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");

  function send() {
    if (!body.trim()) return;
    start(async () => {
      const res = staffSide
        ? await staffReplyAction(threadId, body)
        : await postMessageAction(threadId, body);
      if (res.ok) { setBody(""); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => {
          const mine = staffSide ? m.is_staff : !m.is_staff;
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5",
                mine ? "brand-gradient text-white" : "bg-raised")}>
                <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                <p className={cn("mt-1 text-[10px]", mine ? "text-white/70" : "text-faint")}>
                  {m.is_staff ? t("chat.staff") : t("chat.you")} · {new Date(m.created_at).toLocaleString("pl-PL")}
                </p>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && <p className="py-8 text-center text-sm text-muted">{t("admin.noData")}</p>}
      </div>
      {closed ? (
        <p className="border-t border-line p-4 text-center text-sm text-muted">{t("chat.closed")}</p>
      ) : (
        <div className="flex items-end gap-2 border-t border-line p-3">
          <Textarea rows={2} value={body} placeholder={t("chat.placeholder")}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
          <Button disabled={pending || !body.trim()} onClick={send} aria-label={t("chat.send")}>
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </Button>
        </div>
      )}
    </div>
  );
}

export function NewThreadForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  function submit() {
    start(async () => {
      const res = await createThreadAction(subject, body);
      if (res.ok && res.threadId) { router.push(`/support?thread=${res.threadId}`); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }
  return (
    <div className="space-y-3">
      <div>
        <Label>{t("chat.subject")}</Label>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div>
        <Label>{t("chat.message")}</Label>
        <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <Button disabled={pending || !subject.trim() || !body.trim()} onClick={submit}>
        {pending ? t("common.loading") : t("chat.start")}
      </Button>
    </div>
  );
}
