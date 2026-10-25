"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { bellSeeded, useBell } from "@/lib/notifications/bell-store";
import { presentNotification, toolPath } from "@/lib/notifications/catalog";
import { notify } from "@/lib/notify";

/**
 * "MINIATURKA GOTOWA · ZOBACZ" — when a generation finishes while the
 * customer is somewhere else in the app.
 *
 * Only for results that arrive DURING this visit: everything already in the
 * bell when the page loaded is the baseline and never toasts, so a refresh or
 * an old result never brings one back. On the tool's own panel nothing is
 * shown — the panel already has the result. Activity only: the badge is
 * untouched.
 */
export function GenerationToast() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const bell = useBell();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!bellSeeded()) return;
    const done = bell.activity.filter((n) => n.type === "generation_done");
    if (seen.current === null) {
      seen.current = new Set(done.map((n) => n.id));
      return;
    }
    for (const n of done) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.read_at) continue;
      const panel = toolPath(n.meta.tool);
      if (panel && (pathname === panel || pathname.startsWith(`${panel}/`))) continue;
      const p = presentNotification(n, t, locale);
      const href = p.link && !p.link.external ? p.link.href : "/library";
      notify.success(p.title, {
        id: `generation-${n.id}`,
        action: { label: t("notif.v2.see"), onClick: () => router.push(href) },
      });
    }
  }, [bell, pathname, router, t, locale]);

  return null;
}
