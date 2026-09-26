"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, Eye, Globe, Pencil, Send, Undo2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { createPublicFromPostAction, setPublicArticleStatusAction } from "@/app/actions/grovnews-blog";
import type { PostStatus } from "@/lib/grovnews";

const BASE = "/admin/newsletter/grovnews/blog";

/** Why a move was refused, as the key the admin reads. */
export const BLOG_ERROR_KEY: Record<string, string> = {
  forbidden: "grovnewsAdm.errForbidden",
  too_close: "grovnewsAdm.blog.errTooClose",
  incomplete: "grovnewsAdm.blog.errIncomplete",
  stale: "grovnewsAdm.blog.errStale",
  not_published: "grovnewsAdm.blog.errNotPublished",
  no_source: "grovnewsAdm.blog.errNoSource",
  noServerKey: "grovnewsAdm.research.err.noServerKey",
  aiUnavailable: "grovnewsAdm.research.err.aiUnavailable",
  aiFailed: "grovnewsAdm.blog.errAiFailed",
  title: "grovnewsAdm.errTitle",
  slug: "grovnewsAdm.errSlug",
  slug_taken: "grovnewsAdm.errSlugTaken",
  excerpt: "grovnewsAdm.errExcerpt",
  content: "grovnewsAdm.errContent",
  cover: "grovnewsAdm.errCover",
  canonical: "grovnewsAdm.blog.errCanonical",
  faq: "grovnewsAdm.blog.errFaq",
};

/** A public article's row actions: edit, admin preview, and the status moves
 *  that make sense from where it is. Every move is re-checked on the server. */
export function BlogRowActions({ id, status }: { id: string; status: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const move = (next: PostStatus, okKey: string) => start(async () => {
    const res = await setPublicArticleStatusAction(id, next);
    if (res.ok) { toast.success(t(okKey)); router.refresh(); }
    else toast.error(t(BLOG_ERROR_KEY[res.error] ?? "common.error"));
  });
  const btn = "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold transition-colors disabled:opacity-50";
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Link href={`${BASE}/${id}`} className={`${btn} text-muted hover:bg-raised hover:text-ink`}>
        <Pencil size={13} aria-hidden />{t("grovnewsAdm.edit")}
      </Link>
      <Link href={`${BASE}/${id}/podglad`} className={`${btn} text-muted hover:bg-raised hover:text-ink`}>
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

/**
 * "Utwórz wersję publiczną SEO" — from a PUBLISHED premium post. Makes a DRAFT
 * (or opens the one that already exists) and takes the admin to its editor.
 */
export function PublicVersionButton({ postId, publicId = null, compact = false }: {
  postId: string; publicId?: string | null; compact?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const cls = compact
    ? "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
    : "inline-flex min-h-9 items-center gap-1.5 text-[12.5px] font-semibold text-accent hover:underline disabled:opacity-50";
  if (publicId) {
    return (
      <Link href={`${BASE}/${publicId}`} className={cls} data-public-version={publicId}>
        <Globe size={14} aria-hidden />{t("grovnewsAdm.blog.openPublic")}
      </Link>
    );
  }
  const create = () => start(async () => {
    const res = await createPublicFromPostAction(postId);
    if (!res.ok) { toast.error(t(BLOG_ERROR_KEY[res.error] ?? "common.error")); return; }
    toast.success(t(res.existed ? "grovnewsAdm.blog.existed" : "grovnewsAdm.blog.created"));
    router.push(`${BASE}/${res.id}`);
  });
  return (
    <button type="button" onClick={create} disabled={pending} className={cls} data-create-public={postId}>
      <Globe size={14} aria-hidden />{t("grovnewsAdm.blog.createPublic")}
    </button>
  );
}
