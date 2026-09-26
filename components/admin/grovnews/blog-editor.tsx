"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Eye, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { MediaPicker } from "@/components/admin/media-picker";
import { SeoPreview } from "@/components/admin/cms/seo-preview";
import { generatePublicSeoDraftAction, savePublicArticleAction } from "@/app/actions/grovnews-blog";
import { LANGUAGES, slugify, sourcesToText, type PostSource } from "@/lib/grovnews";
import {
  SCHEMA_TYPES, articleSeoChecks, blogPath, headlineWarnings, type FaqItem,
} from "@/lib/grovnews-blog";
import { SITE_ORIGIN } from "@/lib/site";
import { BLOG_ERROR_KEY, BlogRowActions } from "./blog-actions";

export type EditorArticle = {
  id: string | null;
  title: string; slug: string; excerpt: string; content: string; status: string;
  categoryId: string | null; tags: string[]; coverUrl: string | null; coverAlt: string | null;
  sources: PostSource[]; faq: FaqItem[]; relatedSlugs: string[];
  language: string; schemaType: string; noindex: boolean;
  seoTitle: string | null; seoDescription: string | null; canonicalUrl: string | null;
  ogTitle: string | null; ogDescription: string | null; internalNote: string | null;
  publishedAt: string | null;
  source: { id: string; title: string; status: string } | null;
};

/**
 * THE PUBLIC ARTICLE EDITOR — the premium post editor's primitives and
 * content format, plus what a public page needs: SEO and share texts, the
 * canonical override, noindex, the FAQ the page shows, related articles.
 *
 * The AI draft fills THIS FORM and saves nothing: the admin reads it, fixes
 * it and saves. What it stated that the material did not (numbers), and what
 * reads as bait in a headline, is listed next to the form, not hidden.
 */
export function BlogEditor({ article, categories }: {
  article: EditorArticle;
  categories: { id: string; name: string; is_active: boolean }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [drafting, startDraft] = useTransition();
  const [f, setF] = useState(() => ({
    title: article.title, slug: article.slug, excerpt: article.excerpt, content: article.content,
    categoryId: article.categoryId ?? "", tags: article.tags.join(", "), coverUrl: article.coverUrl ?? "",
    coverAlt: article.coverAlt ?? "", sources: sourcesToText(article.sources), language: article.language || "pl",
    schemaType: article.schemaType || "Article", noindex: article.noindex,
    seoTitle: article.seoTitle ?? "", seoDescription: article.seoDescription ?? "", canonicalUrl: article.canonicalUrl ?? "",
    ogTitle: article.ogTitle ?? "", ogDescription: article.ogDescription ?? "", internalNote: article.internalNote ?? "",
    relatedSlugs: article.relatedSlugs.join(", "),
  }));
  const [faq, setFaq] = useState<FaqItem[]>(article.faq);
  const [aiNumbers, setAiNumbers] = useState<string[]>([]);
  // Until an article has been published (its address is then a link people
  // have), the slug follows the title — so a draft made from a premium post
  // does not keep that post's headline in its public URL once the title is
  // rewritten. A slug the admin set by hand stays theirs.
  const [slugTouched, setSlugTouched] = useState(
    Boolean(article.publishedAt) || (article.id !== null && article.slug !== slugify(article.title)),
  );
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const checks = useMemo(() => articleSeoChecks(f), [f]);
  const warnings = useMemo(() => {
    const out = headlineWarnings(f.title).map((w) => t(`grovnewsAdm.blog.warn.${w}`));
    if (article.source && f.title.trim() === article.source.title.trim()) out.push(t("grovnewsAdm.blog.warn.sameTitle"));
    if (aiNumbers.length) out.push(t("grovnewsAdm.blog.warn.numbers", { list: aiNumbers.join(", ") }));
    return out;
  }, [f.title, article.source, aiNumbers, t]);

  const save = () => start(async () => {
    const res = await savePublicArticleAction(article.id, {
      ...f, faq, categoryId: f.categoryId || null, coverUrl: f.coverUrl || null,
    });
    if (!res.ok) { toast.error(t(BLOG_ERROR_KEY[res.error] ?? "common.error")); return; }
    toast.success(t("grovnewsAdm.saved"));
    if (!article.id) router.replace(`/admin/newsletter/grovnews/blog/${res.id}`);
    else router.refresh();
  });

  const draft = () => startDraft(async () => {
    if (!article.id) return;
    const res = await generatePublicSeoDraftAction(article.id);
    if (!res.ok) { toast.error(t(BLOG_ERROR_KEY[res.error] ?? "common.error")); return; }
    const d = res.draft;
    setF((prev) => ({
      ...prev, title: d.title, excerpt: d.excerpt, content: d.content, seoTitle: d.seoTitle,
      seoDescription: d.seoDescription, relatedSlugs: d.relatedSlugs.join(", "),
      ...(slugTouched ? {} : { slug: slugify(d.title) }),
    }));
    setFaq(d.faq);
    setAiNumbers(d.warnings.numbers);
    toast.success(t("grovnewsAdm.blog.aiApplied"));
  });

  const statusTone = article.status === "PUBLISHED" ? "success" : article.status === "ARCHIVED" ? "neutral" : "warning";
  const publicUrl = `${SITE_ORIGIN.host}${blogPath(f.slug || "…")}`;
  const setFaqItem = (i: number, part: Partial<FaqItem>) =>
    setFaq((prev) => prev.map((item, j) => (j === i ? { ...item, ...part } : item)));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" data-blog-editor>
      <div className="min-w-0 space-y-4">
        <Card className="space-y-4 p-4 sm:p-5">
          <div>
            <Label htmlFor="bl-title" hint={`${f.title.length}/200`}>{t("grovnewsAdm.fTitle")}</Label>
            <Input id="bl-title" value={f.title} maxLength={200}
              onChange={(e) => { set("title", e.target.value); if (!slugTouched) set("slug", slugify(e.target.value)); }} />
          </div>
          <div>
            <Label htmlFor="bl-slug" hint={blogPath(f.slug || "…")}>{t("grovnewsAdm.fSlug")}</Label>
            <Input id="bl-slug" value={f.slug} maxLength={120} spellCheck={false}
              onChange={(e) => { setSlugTouched(true); set("slug", e.target.value.toLowerCase()); }}
              onBlur={() => set("slug", slugify(f.slug) || slugify(f.title))} />
            {article.publishedAt && <p className="mt-1.5 text-[11.5px] text-faint">{t("grovnewsAdm.blog.slugRedirectHint")}</p>}
          </div>
          <div>
            <Label htmlFor="bl-excerpt" hint={`${f.excerpt.length}/600`}>{t("grovnewsAdm.fExcerpt")}</Label>
            <Textarea id="bl-excerpt" rows={3} maxLength={600} value={f.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bl-content">{t("grovnewsAdm.fContent")}</Label>
            <Textarea id="bl-content" rows={18} value={f.content} onChange={(e) => set("content", e.target.value)}
              className="font-mono text-[13px] leading-relaxed" />
            <p className="mt-1.5 text-[11.5px] leading-snug text-faint">{t("grovnewsAdm.contentHint")}</p>
          </div>
          <div>
            <Label htmlFor="bl-sources">{t("grovnewsAdm.fSources")}</Label>
            <Textarea id="bl-sources" rows={4} value={f.sources} spellCheck={false}
              placeholder={"Allegro — komunikat | https://…"} onChange={(e) => set("sources", e.target.value)} />
            <p className="mt-1.5 text-[11.5px] text-faint">{t("grovnewsAdm.sourcesHint")}</p>
          </div>
        </Card>

        <Card className="space-y-3 p-4 sm:p-5" data-blog-faq-editor>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-ink">{t("grovnewsAdm.blog.fFaq")}</p>
            <Button type="button" variant="secondary" size="sm" disabled={faq.length >= 10}
              onClick={() => setFaq((prev) => [...prev, { q: "", a: "" }])}>
              <Plus size={14} aria-hidden />{t("grovnewsAdm.blog.faqAdd")}
            </Button>
          </div>
          <p className="text-[11.5px] leading-snug text-faint">{t("grovnewsAdm.blog.faqHint")}</p>
          {faq.map((item, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-line p-3">
              <div>
                <Label htmlFor={`bl-faq-q-${i}`}>{t("grovnewsAdm.blog.faqQ")}</Label>
                <Input id={`bl-faq-q-${i}`} value={item.q} maxLength={300} onChange={(e) => setFaqItem(i, { q: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`bl-faq-a-${i}`}>{t("grovnewsAdm.blog.faqA")}</Label>
                <Textarea id={`bl-faq-a-${i}`} rows={3} maxLength={2000} value={item.a} onChange={(e) => setFaqItem(i, { a: e.target.value })} />
              </div>
              <button type="button" onClick={() => setFaq((prev) => prev.filter((_, j) => j !== i))}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-muted hover:bg-raised hover:text-ink">
                <Trash2 size={13} aria-hidden />{t("grovnewsAdm.blog.faqRemove")}
              </button>
            </div>
          ))}
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.fStatus")}</span>
            <Badge tone={statusTone}>{t(`grovnewsAdm.status.${article.status}`)}</Badge>
          </div>
          <Button onClick={save} disabled={pending} className="w-full">
            <Save size={15} aria-hidden />{article.id ? t("grovnewsAdm.save") : t("grovnewsAdm.saveDraft")}
          </Button>
          {article.id && (
            <>
              <BlogRowActions id={article.id} status={article.status} />
              <Link href={`/admin/newsletter/grovnews/blog/${article.id}/podglad`}
                className="inline-flex min-h-9 items-center gap-1.5 text-[12.5px] font-semibold text-accent hover:underline">
                <Eye size={14} aria-hidden />{t("grovnewsAdm.openPreview")}
              </Link>
              {article.status === "PUBLISHED" && (
                <a href={blogPath(article.slug)} target="_blank" rel="noopener noreferrer"
                  className="ml-3 inline-flex min-h-9 items-center gap-1.5 text-[12.5px] font-semibold text-accent hover:underline">
                  <ExternalLink size={14} aria-hidden />{t("grovnewsAdm.blog.viewLive")}
                </a>
              )}
            </>
          )}
          <p className="text-[11.5px] leading-snug text-faint">{t("grovnewsAdm.blog.publishHint")}</p>
        </Card>

        <Card className="space-y-2.5 p-4" data-blog-source>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.blog.source")}</p>
          {article.source ? (
            <Link href={`/admin/newsletter/grovnews/wpisy/${article.source.id}`}
              className="block break-words text-[13.5px] font-semibold text-ink hover:text-accent">{article.source.title}</Link>
          ) : (
            <p className="text-[13px] text-muted">{t("grovnewsAdm.blog.sourceNone")}</p>
          )}
          {article.id && article.source && (
            <div className="space-y-2 border-t border-line pt-3" data-blog-ai>
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <Sparkles size={14} aria-hidden className="text-accent" />{t("grovnewsAdm.blog.aiTitle")}
              </p>
              <p className="text-[11.5px] leading-snug text-faint">{t("grovnewsAdm.blog.aiHint")}</p>
              <Button type="button" variant="secondary" size="sm" onClick={draft} disabled={drafting || article.source.status !== "PUBLISHED"}
                className="w-full">
                <Sparkles size={14} aria-hidden />{drafting ? t("grovnewsAdm.blog.aiWorking") : t("grovnewsAdm.blog.aiGenerate")}
              </Button>
              {article.source.status !== "PUBLISHED" && (
                <p className="text-[11.5px] text-faint">{t("grovnewsAdm.blog.errNotPublished")}</p>
              )}
            </div>
          )}
        </Card>

        {warnings.length > 0 && (
          <Card className="space-y-2 p-4" data-blog-warnings>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--caution))]">
              <AlertTriangle size={14} aria-hidden />{t("grovnewsAdm.blog.warnings")}
            </p>
            <ul className="space-y-1.5">
              {warnings.map((w) => <li key={w} className="text-[12.5px] leading-snug text-ink">{w}</li>)}
            </ul>
          </Card>
        )}

        <Card className="space-y-3 p-4">
          <div>
            <Label htmlFor="bl-category">{t("grovnewsAdm.fCategory")}</Label>
            <Select id="bl-category" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">{t("grovnewsAdm.noCategory")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.is_active ? "" : ` (${t("grovnewsAdm.inactive")})`}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="bl-tags">{t("grovnewsAdm.fTags")}</Label>
            <Input id="bl-tags" value={f.tags} placeholder="allegro, prowizje" onChange={(e) => set("tags", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bl-lang">{t("grovnewsAdm.fLanguage")}</Label>
            <Select id="bl-lang" value={f.language} onChange={(e) => set("language", e.target.value)}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </Select>
          </div>
          <MediaPicker label={t("grovnewsAdm.fCover")} value={f.coverUrl} onChange={(url) => set("coverUrl", url)} />
          <div>
            <Label htmlFor="bl-alt" hint={`${f.coverAlt.length}/300`}>{t("grovnewsAdm.blog.fCoverAlt")}</Label>
            <Input id="bl-alt" value={f.coverAlt} maxLength={300} disabled={!f.coverUrl} onChange={(e) => set("coverAlt", e.target.value)} />
          </div>
        </Card>

        <Card className="space-y-3 p-4" data-blog-seo>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.blog.seo")}</p>
          <div>
            <Label htmlFor="bl-seo-title" hint={`${f.seoTitle.length}/60`}>{t("grovnewsAdm.fSeoTitle")}</Label>
            <Input id="bl-seo-title" value={f.seoTitle} maxLength={200} onChange={(e) => set("seoTitle", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bl-seo-desc" hint={`${f.seoDescription.length}/155`}>{t("grovnewsAdm.fSeoDescription")}</Label>
            <Textarea id="bl-seo-desc" rows={3} maxLength={400} value={f.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bl-og-title">{t("grovnewsAdm.blog.fOgTitle")}</Label>
            <Input id="bl-og-title" value={f.ogTitle} maxLength={200} onChange={(e) => set("ogTitle", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bl-og-desc">{t("grovnewsAdm.blog.fOgDescription")}</Label>
            <Textarea id="bl-og-desc" rows={2} maxLength={400} value={f.ogDescription} onChange={(e) => set("ogDescription", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bl-canonical">{t("grovnewsAdm.blog.fCanonical")}</Label>
            <Input id="bl-canonical" value={f.canonicalUrl} maxLength={2000} spellCheck={false} placeholder="https://…"
              onChange={(e) => set("canonicalUrl", e.target.value.trim())} />
            <p className="mt-1.5 text-[11.5px] text-faint">{t("grovnewsAdm.blog.fCanonicalHint", { path: blogPath(f.slug || "…") })}</p>
          </div>
          <div>
            <Label htmlFor="bl-related">{t("grovnewsAdm.blog.fRelated")}</Label>
            <Input id="bl-related" value={f.relatedSlugs} spellCheck={false} onChange={(e) => set("relatedSlugs", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bl-schema">{t("grovnewsAdm.blog.fSchema")}</Label>
            <Select id="bl-schema" value={f.schemaType} onChange={(e) => set("schemaType", e.target.value)}>
              {SCHEMA_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={f.noindex} onChange={(e) => set("noindex", e.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--accent))]" data-blog-noindex />
            {t("grovnewsAdm.blog.fNoindex")}
          </label>
          <SeoPreview url={publicUrl} title={f.seoTitle || f.title} description={f.seoDescription || f.excerpt}
            ogTitle={f.ogTitle} ogDescription={f.ogDescription} ogImage={f.coverUrl} checks={checks} />
        </Card>

        <Card className="space-y-2 p-4">
          <Label htmlFor="bl-note" hint={`${f.internalNote.length}/2000`}>{t("grovnewsAdm.blog.fNote")}</Label>
          <Textarea id="bl-note" rows={3} maxLength={2000} value={f.internalNote} onChange={(e) => set("internalNote", e.target.value)} />
        </Card>
      </div>
    </div>
  );
}
