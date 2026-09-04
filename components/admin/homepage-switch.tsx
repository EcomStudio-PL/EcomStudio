"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ExternalLink, Home, Megaphone } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { setHomepageModeAction } from "@/app/actions/launch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HomepageMode } from "@/lib/server/launch-page";

/**
 * WHICH FRONT DOOR IS OPEN.
 *
 * Two cards, one of them marked live. The choice is deliberately not a toggle
 * hidden in a settings list: switching the homepage of a production site is
 * something an admin should see the consequence of, so each option states what
 * a visitor would get and offers to show it before it is chosen.
 */
export function HomepageSwitch({ mode }: { mode: HomepageMode }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState<HomepageMode>(mode);

  function choose(next: HomepageMode) {
    if (next === current || pending) return;
    start(async () => {
      const res = await setHomepageModeAction(next);
      if (res.ok) {
        setCurrent(next);
        toast.success(t("launchAdmin.modeSaved"));
        router.refresh();
      } else {
        toast.error(t("common.error"));
      }
    });
  }

  const options = [
    {
      value: "full" as const, icon: Home,
      title: t("launchAdmin.modeFull"), sub: t("launchAdmin.modeFullSub"),
    },
    {
      value: "waitlist" as const, icon: Megaphone,
      title: t("launchAdmin.modeWaitlist"), sub: t("launchAdmin.modeWaitlistSub"),
    },
  ];

  return (
    <div data-homepage-switch className="grid gap-4 sm:grid-cols-2">
      {options.map((o) => {
        const active = current === o.value;
        return (
          <div key={o.value}
            data-homepage-option={o.value}
            data-active={active ? "true" : "false"}
            className={cn("panel flex flex-col rounded-2xl p-5 transition-shadow",
              active && "ring-1 ring-[rgb(var(--accent)/0.45)]")}>
            <div className="flex items-start justify-between gap-3">
              <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl",
                active ? "bg-accent-soft/60 text-accent" : "bg-raised text-muted")}>
                <o.icon size={18} aria-hidden />
              </span>
              {active && (
                <span data-homepage-active
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft/50 px-2.5 py-1 text-[11.5px] font-semibold text-accent">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {t("launchAdmin.active")}
                </span>
              )}
            </div>
            <p className="mt-4 text-[15px] font-semibold tracking-tight">{o.title}</p>
            <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-muted">{o.sub}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" variant={active ? "secondary" : "primary"}
                disabled={active || pending}
                onClick={() => choose(o.value)}>
                {active ? <><Check size={14} aria-hidden />{t("launchAdmin.active")}</> : t("common.save")}
              </Button>
              {/* The preview keeps the live setting untouched — it is an
                  admin-only query param the public page ignores. */}
              <a href={`/?preview=${o.value}`} target="_blank" rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
                {t("launchAdmin.preview")}
                <ExternalLink size={13} aria-hidden />
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
