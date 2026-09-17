"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { Megaphone, PanelTop, PanelBottom, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { saveGlobalSectionAction } from "@/app/actions/cms";
import type { CmsBlockContent } from "@/lib/cms";
import type { GlobalSections as Sections, GlobalSlot } from "@/lib/server/public-site";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { ItemsField, LocaleTabs, type Locale } from "./fields";
import { cn } from "@/lib/utils";

/**
 * SEKCJE GLOBALNE — the header, the footer, the announcement bar and the
 * closing CTA, edited once for the whole public site.
 *
 * This is what stops a link being hardcoded in ten page templates: the footer
 * is authored here and every public page prints the same one. Pages that name
 * a menu group are added automatically, so a new page appears in the footer
 * without anybody editing this screen at all.
 *
 * THE CLIENT PANEL IS NOT AFFECTED. Two independent layouts: the dashboard and
 * the admin have their own chrome and never read these rows.
 */

const SLOTS: { slot: GlobalSlot; icon: typeof PanelTop }[] = [
  { slot: "header", icon: PanelTop },
  { slot: "announcement", icon: Megaphone },
  { slot: "footer", icon: PanelBottom },
  { slot: "global_cta", icon: Sparkles },
];

export function GlobalSectionsEditor({ sections }: { sections: Sections }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [slot, setSlot] = useState<GlobalSlot>("header");
  const [locale, setLocale] = useState<Locale>("pl");
  const [state, setState] = useState<Record<string, { content: CmsBlockContent; visible: boolean }>>(
    () => Object.fromEntries(SLOTS.map(({ slot: s }) => [
      s, { content: sections[s]?.content ?? {}, visible: sections[s]?.visible ?? false },
    ])),
  );

  const current = state[slot];
  const setContent = (content: CmsBlockContent) =>
    setState((prev) => ({ ...prev, [slot]: { ...prev[slot], content } }));
  const setVisible = (visible: boolean) =>
    setState((prev) => ({ ...prev, [slot]: { ...prev[slot], visible } }));

  const localized = (key: "title" | "description" | "ctaLabel" | "subtitle") =>
    ((current.content[key] ?? {}) as Record<string, string | undefined>)[locale] ?? "";
  const setLocalized = (key: "title" | "description" | "ctaLabel" | "subtitle", value: string) =>
    setContent({
      ...current.content,
      [key]: { ...((current.content[key] ?? {}) as Record<string, string>), [locale]: value },
    });

  function save() {
    start(async () => {
      const res = await saveGlobalSectionAction({
        slot, content: current.content, visible: current.visible,
      });
      if (res.ok) { toast.success(t("common.saved")); router.refresh(); }
      else toast.error(t(`cms.err.${res.error}`));
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]" data-global-sections>
      {/* Which global section is being edited. */}
      <nav className="panel h-fit rounded-2xl p-2">
        <ul className="space-y-1">
          {SLOTS.map(({ slot: s, icon: Icon }) => (
            <li key={s}>
              <button type="button" onClick={() => setSlot(s)} aria-pressed={s === slot}
                data-global-slot={s}
                className={cn("flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-colors",
                  s === slot ? "bg-accent-soft/50 text-accent" : "text-muted hover:bg-raised hover:text-ink")}>
                <Icon size={15} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t(`cms.slot.${s}`)}</span>
                {state[s].visible && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="panel rounded-2xl p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-sm font-semibold">{t(`cms.slot.${slot}`)}</h2>
          <LocaleTabs locale={locale} onChange={setLocale} />
        </div>

        <p className="mb-4 text-[12.5px] leading-relaxed text-muted">{t(`cms.slotHint.${slot}`)}</p>

        <label className="mb-4 flex items-center gap-2.5 rounded-xl border border-line px-3.5 py-3 text-[13px]">
          <input type="checkbox" checked={current.visible} data-global-visible
            className="h-4 w-4 accent-[rgb(var(--accent))]"
            onChange={(e) => setVisible(e.target.checked)} />
          {t("cms.slotVisible")}
        </label>

        <div className="space-y-4">
          {slot === "header" && (
            <>
              <ItemsField label={t("cms.headerLinks")} hint={t("cms.headerLinksHint")}
                locale={locale} content={current.content} onChange={setContent} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="g-cta">{t("cms.label.ctaLabel")}</Label>
                  <Input id="g-cta" value={localized("ctaLabel")}
                    onChange={(e) => setLocalized("ctaLabel", e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="g-cta-url">{t("cms.label.ctaUrl")}</Label>
                  <Input id="g-cta-url" value={current.content.ctaUrl ?? ""} placeholder="/register"
                    onChange={(e) => setContent({ ...current.content, ctaUrl: e.target.value || undefined })} />
                </div>
              </div>
            </>
          )}

          {slot === "announcement" && (
            <>
              <div>
                <Label htmlFor="g-ann" hint={locale.toUpperCase()}>{t("cms.label.heading")}</Label>
                <Input id="g-ann" value={localized("title")}
                  onChange={(e) => setLocalized("title", e.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="g-ann-cta">{t("cms.label.ctaLabel")}</Label>
                  <Input id="g-ann-cta" value={localized("ctaLabel")}
                    onChange={(e) => setLocalized("ctaLabel", e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="g-ann-url">{t("cms.label.ctaUrl")}</Label>
                  <Input id="g-ann-url" value={current.content.ctaUrl ?? ""}
                    onChange={(e) => setContent({ ...current.content, ctaUrl: e.target.value || undefined })} />
                </div>
              </div>
            </>
          )}

          {slot === "footer" && (
            <>
              <div>
                <Label htmlFor="g-tagline" hint={locale.toUpperCase()}>{t("cms.footerTagline")}</Label>
                <Textarea id="g-tagline" rows={3} value={localized("description")}
                  onChange={(e) => setLocalized("description", e.target.value)} />
              </div>
              <ItemsField label={t("cms.footerLinks")} hint={t("cms.footerLinksHint")}
                locale={locale} content={current.content} onChange={setContent} />
            </>
          )}

          {slot === "global_cta" && (
            <>
              <div>
                <Label htmlFor="g-cta-title" hint={locale.toUpperCase()}>{t("cms.label.heading")}</Label>
                <Input id="g-cta-title" value={localized("title")}
                  onChange={(e) => setLocalized("title", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="g-cta-body" hint={locale.toUpperCase()}>{t("cms.label.body")}</Label>
                <Textarea id="g-cta-body" rows={3} value={localized("description")}
                  onChange={(e) => setLocalized("description", e.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="g-gcta">{t("cms.label.ctaLabel")}</Label>
                  <Input id="g-gcta" value={localized("ctaLabel")}
                    onChange={(e) => setLocalized("ctaLabel", e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="g-gcta-url">{t("cms.label.ctaUrl")}</Label>
                  <Input id="g-gcta-url" value={current.content.ctaUrl ?? ""}
                    onChange={(e) => setContent({ ...current.content, ctaUrl: e.target.value || undefined })} />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <Button disabled={pending} onClick={save} data-global-save>{t("common.save")}</Button>
        </div>
      </div>
    </div>
  );
}
