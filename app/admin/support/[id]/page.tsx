import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChatThread } from "@/components/support/chat";
import { ThreadStatusButton } from "@/components/support/thread-status";

export default async function AdminSupportThread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: thread } = await supabase.from("support_threads")
    .select("id, subject, status, user_id, profiles(email, full_name)")
    .eq("id", id).maybeSingle();
  if (!thread) notFound();
  const { data: messages } = await supabase.from("support_messages")
    .select("id, body, is_staff, created_at").eq("thread_id", id).order("created_at").limit(300);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/support" className="text-sm text-muted hover:text-ink">← {t("chat.adminTitle")}</Link>
        <ThreadStatusButton threadId={thread.id} status={thread.status} />
      </div>
      <Card className="flex min-h-[480px] flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <p className="text-sm font-semibold">{thread.subject}</p>
          <Badge tone={thread.status === "open" ? "green" : "neutral"}>{t(`chat.st.${thread.status}`)}</Badge>
          <Link href={`/admin/users/${thread.user_id}`} className="ml-auto truncate text-xs text-accent hover:underline">
            {thread.profiles?.full_name ?? thread.profiles?.email}
          </Link>
        </div>
        <ChatThread threadId={thread.id} messages={messages ?? []} staffSide closed={thread.status === "closed"} />
      </Card>
    </div>
  );
}
