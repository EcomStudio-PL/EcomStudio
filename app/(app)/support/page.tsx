import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChatThread, NewThreadForm } from "@/components/support/chat";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

/** Customer ↔ EcomStudio team message center. */
export default async function SupportPage({ searchParams }: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const { thread: threadParam } = await searchParams;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: threads } = await supabase.from("support_threads")
    .select("id, subject, status, last_message_at")
    .eq("user_id", user.id).order("last_message_at", { ascending: false }).limit(30);
  const active = (threads ?? []).find((x) => x.id === threadParam) ?? null;
  const { data: messages } = active
    ? await supabase.from("support_messages")
        .select("id, body, is_staff, created_at")
        .eq("thread_id", active.id).order("created_at").limit(200)
    : { data: [] };

  return (
    <div>
      <PageHeader title={t("support.title")} sub={t("chat.sub")} />
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-2">
          <Card className="p-4">
            <CardHeader title={t("chat.newTitle")} />
            <div className="pt-3"><NewThreadForm /></div>
          </Card>
          {(threads ?? []).length > 0 && (
            <ul className="space-y-1.5">
              {(threads ?? []).map((th) => (
                <li key={th.id}>
                  <Link href={`/support?thread=${th.id}`}
                    className={cn("panel block rounded-xl px-3.5 py-2.5 transition-colors",
                      active?.id === th.id ? "ring-1 ring-accent" : "hover:bg-raised")}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{th.subject}</p>
                      <Badge tone={th.status === "open" ? "green" : "neutral"}>{t(`chat.st.${th.status}`)}</Badge>
                    </div>
                    <p className="text-xs text-muted">{formatDate(th.last_message_at, locale)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card className="flex min-h-[420px] flex-col overflow-hidden">
          {active ? (
            <>
              <div className="border-b border-line px-4 py-3">
                <p className="text-sm font-semibold">{active.subject}</p>
              </div>
              <ChatThread threadId={active.id} messages={messages ?? []} closed={active.status === "closed"} />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <p className="max-w-sm text-sm text-muted">{t("chat.pickOrStart")}</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
