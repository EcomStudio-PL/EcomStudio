"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { ArrowRight, ExternalLink, Home } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { savePublicSiteAction } from "@/app/actions/public-pages";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

/**
 * SETTINGS THAT BELONG TO THE WHOLE PUBLIC SITE — the social profiles the
 * pages link to, and a statement of which page is currently the front door.
 *
 * THE HOMEPAGE IS SHOWN HERE AND CHANGED IN STRONY. That is the point of the
 * change, not a layout preference. This screen used to carry a two-button
 * switch — "Normalna strona" / "Strona premiery" — which was a SECOND place
 * where the homepage could be decided, spelled differently from the pages
 * themselves. Two settings for one fact is how the panel came to claim the
 * launch page was live while grovbase.com served the ordinary landing.
 *
 * So there is one control now, on the page it acts on, and this card reports
 * what that control produced. It is deliberately not clickable.
 */
export function SiteSettings({ homepageTitle, instagramUrl, facebookUrl, linkedinUrl, xUrl }: {
  /** The live homepage's name, or null when no CMS page is flagged and "/"
   *  falls back to the built-in default layout. */
  homepageTitle: string | null;
  instagramUrl: string;
  facebookUrl: string;
  linkedinUrl: string;
  xUrl: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [instagram, setInstagram] = useState(instagramUrl);
  const [facebook, setFacebook] = useState(facebookUrl);
  const [linkedin, setLinkedin] = useState(linkedinUrl);
  const [x, setX] = useState(xUrl);

  function saveSocial() {
    start(async () => {
      const res = await savePublicSiteAction({
        instagramUrl: instagram, facebookUrl: facebook, linkedinUrl: linkedin, xUrl: x,
      });
      if (res.ok) { toast.success(t("common.saved")); router.refresh(); }
      else toast.error(res.error === "invalid_url" ? t("cms.invalidUrl") : t("common.error"));
    });
  }

  return (
    <Card className="mb-5" data-site-settings>
      <CardHeader title={t("cms.globalTitle")} sub={t("cms.globalSub")} />
      <div className="space-y-5 p-5 pt-0">
        <div>
          <Label>{t("cms.activeHome")}</Label>
          <div data-active-homepage={homepageTitle ?? ""}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raised/40 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft/60 text-accent">
              <Home size={16} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold">
                {homepageTitle ?? t("cms.homepageDefault")}
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-faint">
                {homepageTitle ? t("cms.homepageServedAt") : t("cms.homepageDefaultHint")}
              </span>
            </span>
            <Link href="/admin/www"
              className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold text-accent transition-colors hover:bg-raised">
              {t("cms.homepageChangeIn")}<ArrowRight size={13} aria-hidden />
            </Link>
          </div>
          <a href="/" target="_blank" rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted transition-colors hover:text-ink">
            {t("cms.preview")}<ExternalLink size={12} aria-hidden />
          </a>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="social-ig">{t("cms.instagramUrl")}</Label>
            <Input id="social-ig" inputMode="url" placeholder="https://instagram.com/…"
              value={instagram} onChange={(e) => setInstagram(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="social-fb">{t("cms.facebookUrl")}</Label>
            <Input id="social-fb" inputMode="url" placeholder="https://facebook.com/…"
              value={facebook} onChange={(e) => setFacebook(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="social-li">{t("cms.linkedinUrl")}</Label>
            <Input id="social-li" inputMode="url" placeholder="https://linkedin.com/company/…"
              value={linkedin} onChange={(e) => setLinkedin(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="social-x">{t("cms.xUrl")}</Label>
            <Input id="social-x" inputMode="url" placeholder="https://x.com/…"
              value={x} onChange={(e) => setX(e.target.value)} />
          </div>
          <p className="text-[11.5px] text-faint sm:col-span-2">{t("cms.socialHint")}</p>
          <div className="sm:col-span-2">
            <Button size="sm" disabled={pending} onClick={saveSocial} data-social-save>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
