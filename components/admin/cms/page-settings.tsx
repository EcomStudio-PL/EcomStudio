"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { savePageSettingsAction } from "@/app/actions/cms";
import { slugProblem, type PageRow } from "@/lib/services/cms";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label, Select } from "@/components/ui/input";
import { MediaPicker } from "@/components/admin/media-picker";
import { LocaleTabs, type Locale } from "./fields";
import type { PageSeo, SeoText } from "@/lib/cms";

/**
 * USTAWIENIA STRONY — everything about a page that is not one of its sections.
 *
 * Name, address, which menu it belongs to, and what it tells a crawler. SEO is
 * per language because a Polish title on the German /cennik is worse than no
 * title at all; the placeholders show what each field falls back to when it is
 * left empty, so an admin can see that a page already announces itself
 * correctly rather than filling in three languages out of anxiety.
 *
 * Saved explicitly, not autosaved: changing a slug changes a URL people may
 * have bookmarked, and that is a decision, not a keystroke.
 */

const NAV_GROUPS = ["", "main", "product", "tools", "company", "help", "legal"];

export function PageSettings({ page }: { page: PageRow }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [locale, setLocale] = useState<Locale>("pl");

  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [navGroup, setNavGroup] = useState(page.navGroup ?? "");
  const [navOrder, setNavOrder] = useState(String(page.navOrder));
  const [seo, setSeo] = useState<PageSeo>(page.seo ?? {});

  // `home` and the launch page are addressed by name by the homepage switch;
  // renaming either would break the front door.
  const slugLocked = page.slug === "home" || page.kind === "launch";
  const problem = slugLocked || slug === page.slug ? null : slugProblem(slug);

  const text: SeoText = (seo as Record<string, SeoText | undefined>)[locale] ?? {};
  const setText = (part: Partial<SeoText>) =>
    setSeo({ ...seo, [locale]: { ...text, ...part } });

  function save() {
    start(async () => {
      const res = await savePageSettingsAction({
        pageId: page.id,
        title,
        slug,
        navGroup: navGroup || null,
        navOrder: Number(navOrder) || 100,
        seo,
      });
      if (!res.ok) { toast.error(t(`cms.err.${res.error}`)); return; }
      toast.success(t("common.saved"));
      // A renamed page lives at a new admin URL too.
      if (res.data && res.data.slug !== page.slug) router.replace(`/admin/www/${res.data.slug}/ustawienia`);
      else router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-3xl" data-page-settings-form>
      <div className="mb-4">
        <Link href={`/admin/www/${page.slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
          <ArrowLeft size={14} aria-hidden />{page.title}
        </Link>
      </div>

      <div className="space-y-5">
        {/* ── THE PAGE ITSELF ─────────────────────────────────────────── */}
        <section className="panel rounded-2xl p-5">
          <h2 className="mb-4 font-display text-sm font-semibold">{t("cms.settingsBasics")}</h2>
          <div className="space-y-4">
            <div>
              <Label htmlFor="ps-title">{t("cms.col.name")}</Label>
              <Input id="ps-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ps-slug">{t("cms.col.slug")}</Label>
              <Input id="ps-slug" value={slug} spellCheck={false} disabled={slugLocked}
                onChange={(e) => setSlug(e.target.value.toLowerCase())} />
              <p className="mt-1.5 text-[11.5px] text-faint">
                {slugLocked ? t("cms.slugLocked")
                  : problem ? t(`cms.err.${problem}`)
                  : `grovbase.com/${slug}`}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <div>
                <Label htmlFor="ps-nav">{t("cms.navGroup")}</Label>
                <Select id="ps-nav" value={navGroup} onChange={(e) => setNavGroup(e.target.value)}>
                  {NAV_GROUPS.map((g) => (
                    <option key={g || "none"} value={g}>
                      {g ? t(`cms.footerGroup.${g}`) : t("cms.navNone")}
                    </option>
                  ))}
                </Select>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t("cms.navGroupHint")}</p>
              </div>
              <div>
                <Label htmlFor="ps-order">{t("cms.navOrder")}</Label>
                <Input id="ps-order" value={navOrder} inputMode="numeric"
                  onChange={(e) => setNavOrder(e.target.value.replace(/\D/g, ""))} />
              </div>
            </div>
          </div>
        </section>

        {/* ── SEO ─────────────────────────────────────────────────────── */}
        <section className="panel rounded-2xl p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-sm font-semibold">{t("cms.settingsSeo")}</h2>
            <LocaleTabs locale={locale} onChange={setLocale} />
          </div>
          <div className="space-y-4">
            <div>
              <Label htmlFor="ps-seo-title" hint={locale.toUpperCase()}>{t("cms.seo.title")}</Label>
              <Input id="ps-seo-title" value={text.title ?? ""} placeholder={page.title}
                maxLength={70} onChange={(e) => setText({ title: e.target.value })} />
              <Counter value={text.title ?? ""} max={60} />
            </div>
            <div>
              <Label htmlFor="ps-seo-desc" hint={locale.toUpperCase()}>{t("cms.seo.description")}</Label>
              <Textarea id="ps-seo-desc" rows={3} value={text.description ?? ""} maxLength={200}
                onChange={(e) => setText({ description: e.target.value })} />
              <Counter value={text.description ?? ""} max={155} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ps-og-title" hint={locale.toUpperCase()}>{t("cms.seo.ogTitle")}</Label>
                <Input id="ps-og-title" value={text.ogTitle ?? ""}
                  placeholder={text.title || page.title}
                  onChange={(e) => setText({ ogTitle: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="ps-og-desc" hint={locale.toUpperCase()}>{t("cms.seo.ogDescription")}</Label>
                <Input id="ps-og-desc" value={text.ogDescription ?? ""}
                  placeholder={text.description ?? ""}
                  onChange={(e) => setText({ ogDescription: e.target.value })} />
              </div>
            </div>
            {/* One image for every language: a share card is a picture, and
                three copies of it would be three things to keep in step. */}
            <MediaPicker value={seo.ogImage ?? ""} kind="image" label={t("cms.seo.ogImage")}
              onChange={(url) => setSeo({ ...seo, ogImage: url || undefined })} />
            <div>
              <Label htmlFor="ps-canonical">{t("cms.seo.canonical")}</Label>
              <Input id="ps-canonical" value={seo.canonical ?? ""} spellCheck={false}
                placeholder={`/${page.slug === "home" ? "" : page.slug}`}
                onChange={(e) => setSeo({ ...seo, canonical: e.target.value || undefined })} />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2.5 text-[13px]">
                <input type="checkbox" checked={seo.noindex === true} data-seo-noindex
                  className="h-4 w-4 accent-[rgb(var(--accent))]"
                  onChange={(e) => setSeo({ ...seo, noindex: e.target.checked || undefined })} />
                {t("cms.seo.noindex")}
              </label>
              <label className="flex items-center gap-2.5 text-[13px]">
                <input type="checkbox" checked={seo.nofollow === true}
                  className="h-4 w-4 accent-[rgb(var(--accent))]"
                  onChange={(e) => setSeo({ ...seo, nofollow: e.target.checked || undefined })} />
                {t("cms.seo.nofollow")}
              </label>
              <p className="text-[11.5px] leading-relaxed text-faint">{t("cms.seo.robotsHint")}</p>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Link href={`/admin/www/${page.slug}`}
            className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-medium text-muted transition-colors hover:bg-raised">
            {t("common.cancel")}
          </Link>
          <Button disabled={pending || !title.trim() || !!problem} onClick={save} data-settings-save>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** How long a title or description is against what a search result shows. Not
 *  a limit — a longer one is truncated by Google, not rejected by us. */
function Counter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <p className={`mt-1.5 text-[11px] tabular-nums ${over ? "text-[rgb(var(--caution))]" : "text-faint"}`}>
      {value.length} / {max}
    </p>
  );
}
