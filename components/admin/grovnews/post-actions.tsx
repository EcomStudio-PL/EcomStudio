"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, Eye, Pencil, Send, Undo2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { setPostStatusAction } from "@/app/actions/grovnews";
import type { PostStatus } from "@/lib/grovnews";

/** The row's actions: edit, preview, and the status moves that make sense
 *  from where the post is. Every move is re-checked as admin on the server. */
export function PostRowActions({ id, status }: { id: string; status: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const move = (next: PostStatus, okKey: string) => start(async () => {
    const res = await setPostStatusAction(id, next);
    if (res.ok) { toast.success(t(okKey)); router.refresh(); }
    else toast.error(t(res.error === "forbidden" ? "grovnewsAdm.errForbidden" : "common.error"));
  });
  const btn = "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold transition-colors disabled:opacity-50";
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Link href={`/admin/newsletter/grovnews/wpisy/${id}`} className={`${btn} text-muted hover:bg-raised hover:text-ink`}>
        <Pencil size={13} aria-hidden />{t("grovnewsAdm.edit")}
      </Link>
      <Link href={`/admin/newsletter/grovnews/wpisy/${id}/podglad`} className={`${btn} text-muted hover:bg-raised hover:text-ink`}>
        <Eye size={13} aria-hidden />{t("grovnewsAdm.preview")}
      </Link>
      {status !== "PUBLISHED" && (
        <button type="button" disabled={pending} onClick={() => move("PUBLISHED", "grovnewsAdm.published")}
          className={`${btn} text-success hover:bg-[rgb(var(--success)/0.12)]`}>
          <Send size={13} aria-hidden />{t("grovnewsAdm.publish")}
        </button>
      )}
      {status !== "DRAFT" && (
        <button type="button" disabled={pending} onClick={() => move("DRAFT", "grovnewsAdm.movedToDraft")}
          className={`${btn} text-muted hover:bg-raised hover:text-ink`}>
          <Undo2 size={13} aria-hidden />{t("grovnewsAdm.toDraft")}
        </button>
      )}
      {status !== "ARCHIVED" && (
        <button type="button" disabled={pending} onClick={() => move("ARCHIVED", "grovnewsAdm.archived")}
          className={`${btn} text-muted hover:bg-raised hover:text-ink`}>
          <Archive size={13} aria-hidden />{t("grovnewsAdm.archive")}
        </button>
      )}
    </span>
  );
}
