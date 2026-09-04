"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ExternalLink, Home, Megaphone } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { setHomepageModeAction } from "@/app/actions/launch";
import { savePublicSiteAction } from "@/app/actions/public-pages";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { HomepageMode } from "@/lib/server/launch-page";

/**
 * SETTINGS THAT BELONG TO THE WHOLE PUBLIC SITE, not to one page: which page
 * answers "/", and the social profiles the pages link to. They sit at the top
 * of the page list because that is where an admin looks for them — the old
 * build gave the homepage switch a menu entry of its own.
 */
export function SiteSettings({ mode, instagramUrl, facebookUrl }: {
  mode: HomepageMode;
  instagramUrl: string;
  facebookUrl: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState<HomepageMode>(mode);
  const [instagram, setInstagram] = useState(instagramUrl);
  const [facebook, setFacebook] = useState(facebookUrl);

  function choose(next: HomepageMode) {
    if (next === current || pending) return;
    start(async () => {
      const res = await setHomepageModeAction(next);
      if (res.ok) { setCurrent(next); toast.success(t("cms.modeSaved")); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  function saveSocial() {
    start(async () => {
      const res = await savePublicSiteAction({ instagramUrl: instagram, facebookUrl: facebook });
      if (res.ok) { toast.success(t("common.saved")); router.refresh(); }
      else toast.error(res.error === "invalid_url" ? t("cms.invalidUrl") : t("common.error"));
    });
  }

  const options = [
    { value: "full" as const, icon: Home, label: t("cms.activeHomeFull") },
    { value: "waitlist" as const, icon: Megaphone, label: t("cms.activeHomeWaitlist") },
  ];

  return (
    <Card className="mb-5" data-site-settings>
      <CardHeader title={t("cms.globalTitle")} sub={t("cms.globalSub")} />
      <div className="space-y-5 p-5 pt-0">
        <div>
          <Label>{t("cms.activeHome")}</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((o) => {
              const active = current === o.value;
              return (
                <button key={o.value} type="button" disabled={pending}
                  data-home-mode={o.value} data-active={active ? "true" : "false"}
                  onClick={() => choose(o.value)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                    active
                      ? "border-[rgb(var(--accent)/0.5)] bg-accent-soft/25"
                      : "border-line hover:bg-raised",
                  )}>
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    active ? "bg-accent-soft/60 text-accent" : "bg-raised text-muted")}>
                    <o.icon size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 text-[13.5px] font-semibold">{o.label}</span>
                  {active && (
                    <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent">
                      <Check size={13} aria-hidden />{t("cms.activeBadge")}
                    </span>
                  )}
                </button>
              );
            })}
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
