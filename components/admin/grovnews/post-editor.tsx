"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, Save } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { MediaPicker } from "@/components/admin/media-picker";
import { savePostAction } from "@/app/actions/grovnews";
import { LANGUAGES, estimateReadMinutes, slugify, sourcesToText, type PostSource } from "@/lib/grovnews";
import { PostRowActions } from "./post-actions";

export type EditorPost = {
  id: string | null;
  title: string; slug: string; excerpt: string; content: string;
  categoryId: string | null; tags: string[]; coverUrl: string | null; sources: PostSource[];
  readMinutes: number | null; language: string; status: string;
  emailSummary: string | null; seoTitle: string | null; seoDescription: string | null;
};

const ERROR_KEY: Record<string, string> = {
  title: "grovnewsAdm.errTitle", slug: "grovnewsAdm.errSlug", slug_taken: "grovnewsAdm.errSlugTaken",
  excerpt: "grovnewsAdm.errExcerpt", content: "grovnewsAdm.errContent", cover: "grovnewsAdm.errCover",
  readMinutes: "grovnewsAdm.errReadMinutes", forbidden: "grovnewsAdm.errForbidden",
};

/**
 * THE POST EDITOR — the existing form primitives, no editor library. The body
 * is plain text with a few marks (see lib/grovnews.ts `parseContent`), which
 * is what keeps it safe to render and simple to write — for a person now, and
 * for an automated writer later.
 *
 * The slug follows the title until the admin edits it by hand, and then it is
 * theirs; a published post's slug is a link people have, so it is never
 * regenerated behind their back. Read time is estimated from the text unless
 * an admin sets it.
 */
export function PostEditor({ post, categories }: {
  post: EditorPost;
  categories: { id: string; name: string; is_active: boolean }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState(() => ({
    title: post.title, slug: post.slug, excerpt: post.excerpt, content: post.content,
    categoryId: post.categoryId ?? "", tags: post.tags.join(", "), coverUrl: post.coverUrl ?? "",
    sources: sourcesToText(post.sources), readMinutes: post.readMinutes ? String(post.readMinutes) : "",
    language: post.language || "pl", emailSummary: post.emailSummary ?? "", seoTitle: post.seoTitle ?? "",
    seoDescription: post.seoDescription ?? "",
  }));
  const [slugTouched, setSlugTouched] = useState(Boolean(post.id));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const estimated = useMemo(() => estimateReadMinutes(f.content), [f.content]);

  const save = () => start(async () => {
    const res = await savePostAction(post.id, {
      ...f, categoryId: f.categoryId || null, coverUrl: f.coverUrl || null,
      readMinutes: f.readMinutes ? Number(f.readMinutes) : null,
    });
    if (!res.ok) {
      toast.error(t(ERROR_KEY[res.error] ?? "common.error"));
      return;
    }
    toast.success(t("grovnewsAdm.saved"));
    if (!post.id) router.replace(`/admin/newsletter/grovnews/wpisy/${res.id}`);
    else router.refresh();
  });

  const statusTone = post.status === "PUBLISHED" ? "success" : post.status === "ARCHIVED" ? "neutral" : "warning";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]" data-grovnews-editor>
      <Card className="space-y-4 p-4 sm:p-5">
        <div>
          <Label htmlFor="gn-title">{t("grovnewsAdm.fTitle")}</Label>
          <Input id="gn-title" value={f.title} maxLength={200}
            onChange={(e) => { set("title", e.target.value); if (!slugTouched) set("slug", slugify(e.target.value)); }} />
        </div>
        <div>
          <Label htmlFor="gn-slug" hint={`/grovnews/${f.slug || "…"}`}>{t("grovnewsAdm.fSlug")}</Label>
          <Input id="gn-slug" value={f.slug} maxLength={120} spellCheck={false}
            onChange={(e) => { setSlugTouched(true); set("slug", e.target.value.toLowerCase()); }}
            onBlur={() => set("slug", slugify(f.slug) || slugify(f.title))} />
        </div>
        <div>
          <Label htmlFor="gn-excerpt" hint={`${f.excerpt.length}/600`}>{t("grovnewsAdm.fExcerpt")}</Label>
          <Textarea id="gn-excerpt" rows={3} maxLength={600} value={f.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="gn-content">{t("grovnewsAdm.fContent")}</Label>
          <Textarea id="gn-content" rows={18} value={f.content} onChange={(e) => set("content", e.target.value)}
            className="font-mono text-[13px] leading-relaxed" />
          <p className="mt-1.5 text-[11.5px] leading-snug text-faint">{t("grovnewsAdm.contentHint")}</p>
        </div>
        <div>
          <Label htmlFor="gn-sources">{t("grovnewsAdm.fSources")}</Label>
          <Textarea id="gn-sources" rows={4} value={f.sources} spellCheck={false}
            placeholder={"Allegro — komunikat | https://…"} onChange={(e) => set("sources", e.target.value)} />
          <p className="mt-1.5 text-[11.5px] text-faint">{t("grovnewsAdm.sourcesHint")}</p>
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.fStatus")}</span>
            <Badge tone={statusTone}>{t(`grovnewsAdm.status.${post.status}`)}</Badge>
          </div>
          <Button onClick={save} disabled={pending} className="w-full">
            <Save size={15} aria-hidden />{post.id ? t("grovnewsAdm.save") : t("grovnewsAdm.saveDraft")}
          </Button>
          {post.id && (
            <>
              <PostRowActions id={post.id} status={post.status} />
              <Link href={`/admin/newsletter/grovnews/wpisy/${post.id}/podglad`}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent hover:underline">
                <Eye size={14} aria-hidden />{t("grovnewsAdm.openPreview")}
              </Link>
            </>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <div>
            <Label htmlFor="gn-category">{t("grovnewsAdm.fCategory")}</Label>
            <Select id="gn-category" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">{t("grovnewsAdm.noCategory")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.is_active ? "" : ` (${t("grovnewsAdm.inactive")})`}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="gn-tags">{t("grovnewsAdm.fTags")}</Label>
            <Input id="gn-tags" value={f.tags} placeholder="allegro, prowizje" onChange={(e) => set("tags", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="gn-read">{t("grovnewsAdm.fReadTime")}</Label>
              <Input id="gn-read" type="number" min={1} max={240} inputMode="numeric" value={f.readMinutes}
                placeholder={String(estimated)} onChange={(e) => set("readMinutes", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="gn-lang">{t("grovnewsAdm.fLanguage")}</Label>
              <Select id="gn-lang" value={f.language} onChange={(e) => set("language", e.target.value)}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </Select>
            </div>
          </div>
          <MediaPicker label={t("grovnewsAdm.fCover")} value={f.coverUrl} onChange={(url) => set("coverUrl", url)} />
        </Card>

        <Card className="space-y-3 p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.advanced")}</p>
          <div>
            <Label htmlFor="gn-seo-title">{t("grovnewsAdm.fSeoTitle")}</Label>
            <Input id="gn-seo-title" value={f.seoTitle} maxLength={200} onChange={(e) => set("seoTitle", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="gn-seo-desc">{t("grovnewsAdm.fSeoDescription")}</Label>
            <Textarea id="gn-seo-desc" rows={2} maxLength={400} value={f.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="gn-email">{t("grovnewsAdm.fEmailSummary")}</Label>
            <Textarea id="gn-email" rows={3} maxLength={2000} value={f.emailSummary} onChange={(e) => set("emailSummary", e.target.value)} />
          </div>
        </Card>
      </div>
    </div>
  );
}
