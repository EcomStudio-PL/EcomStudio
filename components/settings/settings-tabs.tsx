"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { GROVNEWS_ANCHOR, SETTINGS_TABS, parseSettingsTab, type SettingsTab } from "./tabs";

const LABEL_KEY: Record<SettingsTab, string> = {
  profile: "settings.tabs.profile",
  account: "settings.tabs.account",
  subscriptions: "settings.tabs.subscriptions",
  preferences: "settings.tabs.preferences",
};

/**
 * THE SETTINGS TAB STRIP.
 *
 * Every panel is rendered once by the server page; this only decides which
 * one is visible. Switching is local state plus `window.history.replaceState`
 * — no navigation, no router call, no refetch — so a half-typed form on one
 * tab survives a look at another, and the address still says where you are
 * (Next 15 keeps `useSearchParams` in step with replaceState).
 *
 * `#grovnews` — the anchor the GrovNews screens and the checkout link to —
 * always lands on "Subskrypcje" with the card scrolled into view.
 */
export function SettingsTabs({ initialTab, panels }: {
  initialTab: SettingsTab;
  panels: Record<SettingsTab, ReactNode>;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const refs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  const strip = useRef<HTMLDivElement | null>(null);

  // A real navigation to /settings?tab=… (a link from elsewhere in the app,
  // Back/Forward) re-renders this same instance: follow the address.
  const urlTab = useSearchParams().get("tab");
  useEffect(() => {
    if (urlTab !== null) setTab(parseSettingsTab(urlTab));
  }, [urlTab]);

  // The GrovNews deep link. Read after mount — the server never sees a hash.
  useEffect(() => {
    const follow = () => {
      if (window.location.hash !== `#${GROVNEWS_ANCHOR}`) return;
      setTab("subscriptions");
      requestAnimationFrame(() => document.getElementById(GROVNEWS_ANCHOR)?.scrollIntoView({ block: "start" }));
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  // On a phone the strip scrolls sideways: keep the open tab in sight. Only
  // the strip moves — never the page (the #grovnews deep link scrolls it).
  useEffect(() => {
    const box = strip.current, el = refs.current[tab];
    if (!box || !el) return;
    const s = box.getBoundingClientRect(), b = el.getBoundingClientRect();
    if (b.left < s.left) box.scrollLeft -= s.left - b.left + 8;
    else if (b.right > s.right) box.scrollLeft += b.right - s.right + 8;
  }, [tab]);

  const select = useCallback((next: SettingsTab, focus = false) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    // A #grovnews left behind would pull the next reload back to Subskrypcje.
    if (next !== "subscriptions") url.hash = "";
    window.history.replaceState(window.history.state, "", url.toString());
    if (focus) refs.current[next]?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = SETTINGS_TABS.indexOf(tab);
    const last = SETTINGS_TABS.length - 1;
    const to = e.key === "ArrowRight" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (to === null) return;
    e.preventDefault();
    select(SETTINGS_TABS[to], true);
  };

  return (
    <div className="min-w-0">
      <div ref={strip} className="thin-scroll min-w-0 overflow-x-auto pb-1">
        <div role="tablist" aria-label={t("settings.tabs.label")}
          className="inline-flex min-w-max gap-1 rounded-xl bg-sunken/80 p-1">
          {SETTINGS_TABS.map((key) => {
            const active = key === tab;
            return (
              <button key={key} type="button" role="tab"
                ref={(el) => { refs.current[key] = el; }}
                id={`settings-tab-${key}`}
                aria-selected={active}
                aria-controls={`settings-panel-${key}`}
                tabIndex={active ? 0 : -1}
                data-settings-tab={key}
                onClick={() => select(key)}
                onKeyDown={onKeyDown}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  active ? "bg-surface text-ink shadow-e1" : "text-muted hover:text-ink",
                )}>
                {t(LABEL_KEY[key])}
              </button>
            );
          })}
        </div>
      </div>
      {SETTINGS_TABS.map((key) => (
        <div key={key} role="tabpanel" id={`settings-panel-${key}`}
          aria-labelledby={`settings-tab-${key}`} data-settings-panel={key}
          hidden={key !== tab} tabIndex={0}
          className="mt-5 min-w-0 space-y-5 focus-visible:outline-none">
          {panels[key]}
        </div>
      ))}
    </div>
  );
}
