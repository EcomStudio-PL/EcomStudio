"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cancelScheduleAction, savePageSettingsAction, schedulePageAction } from "@/app/actions/cms";
import { slugProblem, type PageRow } from "@/lib/services/cms";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label, Select } from "@/components/ui/input";
import { MediaPicker } from "@/components/admin/media-picker";
import { LocaleTabs, type Locale } from "./fields";
import { SeoPreview, type SeoCheck } from "./seo-preview";
import { CHROME_MODES, type ChromeMode, type PagePromo, type PageSeo, type SeoText } from "@/lib/cms";

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

export function PageSettings({ page, blocks = [] }: {
  page: PageRow;
  /** Only what the checklist needs: whether the page has a heading at all,
   *  and whether its pictures have alternative text. */
  blocks?: { type: string; hasHeading: boolean; images: number; alts: number }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [locale, setLocale] = useState<Locale>("pl");

  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [navGroup, setNavGroup] = useState(page.navGroup ?? "");
  const [navOrder, setNavOrder] = useState(String(page.navOrder));
  const [seo, setSeo] = useState<PageSeo>(page.seo ?? {});
  const [headerMode, setHeaderMode] = useState<ChromeMode>(page.headerMode);
  const [footerMode, setFooterMode] = useState<ChromeMode>(page.footerMode);
  const [promo, setPromo] = useState<PagePromo>(page.promo ?? {});
  const [scheduleAt, setScheduleAt] = useState(toLocalInput(page.scheduledAt ?? undefined));
  const scheduled = page.status === "scheduled";

  // `home` and the launch page are addressed by name by the homepage switch;
  // renaming either would break the front door.
  const slugLocked = page.slug === "home" || page.kind === "launch";
  const problem = slugLocked || slug === page.slug ? null : slugProblem(slug);

  /**
   * THE SIX THINGS. Each one is either there or it is not — no score, no
   * advice dressed up as a measurement. `title` and `description` fall back
   * to the page title and the global default, which is why the check is for
   * the page's OWN value: a fallback is a safety net, not an answer.
   */
  const publicUrl = `grovbase.com/${page.slug === "home" ? "" : page.slug}`;
  const currentText: SeoText = (seo as Record<string, SeoText | undefined>)[locale] ?? {};
  const images = blocks.reduce((n, b) => n + b.images, 0);
  const alts = blocks.reduce((n, b) => n + b.alts, 0);
  const checks: SeoCheck[] = [
    { key: "title", ok: Boolean(currentText.title?.trim()) },
    { key: "description", ok: Boolean(currentText.description?.trim()) },
    { key: "heading", ok: blocks.some((b) => b.hasHeading) },
    { key: "ogImage", ok: Boolean(seo.ogImage) },
    { key: "canonical", ok: Boolean(seo.canonical?.trim()) },
    { key: "alt", ok: images === 0 || alts >= images },
  ];

  const text: SeoText = currentText;
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
        headerMode,
        footerMode,
        promo,
      });
      if (!res.ok) { toast.error(t(`cms.err.${res.error}`)); return; }
      toast.success(t("common.saved"));
      // A renamed page lives at a new admin URL too.
      if (res.data && res.data.slug !== page.slug) router.replace(`/admin/www/${res.data.slug}/ustawienia`);
      else router.refresh();
    });
  }

  function schedule() {
    start(async () => {
      const iso = fromLocalInput(scheduleAt);
      if (!iso) { toast.error(t("cms.err.date")); return; }
      const res = await schedulePageAction(page.id, iso);
      if (!res.ok) { toast.error(t(`cms.err.${res.error}`)); return; }
      toast.success(t("cms.scheduleDone"));
      router.refresh();
    });
  }

  function cancelSchedule() {
    start(async () => {
      const res = await cancelScheduleAction(page.id);
      if (!res.ok) { toast.error(t(`cms.err.${res.error}`)); return; }
      toast.success(t("common.saved"));
      router.refresh();
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

            {/* The same values, where people actually meet them first. */}
            <div className="border-t border-line pt-4">
              <SeoPreview
                url={publicUrl}
                title={text.title || page.title}
                description={text.description ?? ""}
                ogTitle={text.ogTitle ?? ""}
                ogDescription={text.ogDescription ?? ""}
                ogImage={seo.ogImage ?? ""}
                checks={checks}
              />
            </div>
          </div>
        </section>

        {/* ── THE CHROME THIS PAGE WEARS ──────────────────────────────────
            A campaign landing usually wants less of the site around it: the
            brand stays, the navigation that would carry the visitor away does
            not. It is a deliberate choice per page, never a default. */}
        <section className="panel rounded-2xl p-5" data-page-chrome>
          <h2 className="mb-4 font-display text-sm font-semibold">{t("cms.settingsChrome")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ps-header">{t("cms.headerMode")}</Label>
              <Select id="ps-header" value={headerMode} data-header-mode
                onChange={(e) => setHeaderMode(e.target.value as ChromeMode)}>
                {CHROME_MODES.map((m) => (
                  <option key={m} value={m}>{t(`cms.chrome.${m}`)}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ps-footer">{t("cms.footerMode")}</Label>
              <Select id="ps-footer" value={footerMode} data-footer-mode
                onChange={(e) => setFooterMode(e.target.value as ChromeMode)}>
                {CHROME_MODES.map((m) => (
                  <option key={m} value={m}>{t(`cms.chrome.${m}`)}</option>
                ))}
              </Select>
            </div>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{t("cms.chromeHint")}</p>
        </section>

        {/* ── WHEN IT GOES LIVE ───────────────────────────────────────────
            Scheduling freezes the page as it is NOW and lets it appear by
            itself later. Deliberately offered only for a page that is not
            already live: putting a published page into "scheduled" would take
            it off the site until the chosen hour, which is the opposite of
            what anybody means by scheduling it. */}
        {page.kind !== "launch" && (
          <section className="panel rounded-2xl p-5" data-page-schedule>
            <h2 className="mb-1 font-display text-sm font-semibold">{t("cms.settingsSchedule")}</h2>
            {page.status === "published" ? (
              <p className="text-[12.5px] leading-relaxed text-muted">{t("cms.scheduleLiveAlready")}</p>
            ) : (
              <>
                <p className="mb-4 text-[11.5px] leading-relaxed text-faint">{t("cms.scheduleHint")}</p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[14rem] flex-1">
                    <Label htmlFor="ps-schedule">{t("cms.scheduleAt")}</Label>
                    <Input id="ps-schedule" type="datetime-local" data-schedule-at
                      value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
                  </div>
                  <Button variant="secondary" disabled={pending || !scheduleAt}
                    onClick={schedule} data-schedule-set>
                    {t("cms.scheduleSet")}
                  </Button>
                  {scheduled && (
                    <Button variant="ghost" disabled={pending}
                      onClick={cancelSchedule} data-schedule-cancel>
                      {t("cms.scheduleCancel")}
                    </Button>
                  )}
                </div>
                {scheduled && (
                  <p className="mt-2.5 text-[12.5px] text-muted" data-schedule-state>
                    {t("cms.scheduleActive")}
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {/* ── PROMOTION ───────────────────────────────────────────────────
            A page that ends. The window is not a second publishing system:
            the page stays exactly as published, and outside its dates the
            visitor is sent where the admin said to send them. */}
        <section className="panel rounded-2xl p-5" data-page-promo>
          <h2 className="mb-1 font-display text-sm font-semibold">{t("cms.settingsPromo")}</h2>
          <label className="mb-4 flex items-center gap-2.5 text-[13px]">
            <input type="checkbox" checked={promo.active === true} data-promo-active
              className="h-4 w-4 accent-[rgb(var(--accent))]"
              onChange={(e) => setPromo({ ...promo, active: e.target.checked || undefined })} />
            {t("cms.promoIsPromo")}
          </label>

          {promo.active && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ps-promo-start">{t("cms.promoStart")}</Label>
                  <Input id="ps-promo-start" type="datetime-local" data-promo-start
                    value={toLocalInput(promo.startAt)}
                    onChange={(e) => setPromo({ ...promo, startAt: fromLocalInput(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="ps-promo-end">{t("cms.promoEnd")}</Label>
                  <Input id="ps-promo-end" type="datetime-local" data-promo-end
                    value={toLocalInput(promo.endAt)}
                    onChange={(e) => setPromo({ ...promo, endAt: fromLocalInput(e.target.value) })} />
                </div>
              </div>
              <div>
                <Label htmlFor="ps-promo-redirect">{t("cms.promoAfterEnd")}</Label>
                <Input id="ps-promo-redirect" value={promo.afterEndRedirect ?? ""} spellCheck={false}
                  placeholder="/cennik" data-promo-redirect
                  onChange={(e) => setPromo({ ...promo, afterEndRedirect: e.target.value || undefined })} />
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t("cms.promoAfterEndHint")}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ps-promo-code">{t("cms.promoCode")}</Label>
                  <Input id="ps-promo-code" value={promo.code ?? ""} spellCheck={false}
                    onChange={(e) => setPromo({ ...promo, code: e.target.value || undefined })} />
                </div>
                <div>
                  <Label htmlFor="ps-promo-campaign">{t("cms.promoCampaign")}</Label>
                  <Input id="ps-promo-campaign" value={promo.campaignId ?? ""} spellCheck={false}
                    onChange={(e) => setPromo({ ...promo, campaignId: e.target.value || undefined })} />
                </div>
              </div>
            </div>
          )}
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

/** A stored instant → what a `datetime-local` input wants, in the admin's own
 *  clock. The reverse turns their local pick back into the moment it means. */
function toLocalInput(iso: string | undefined): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | undefined {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
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
