"use client";
import { ADMIN_NAV } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { NavLink } from "./nav-link";

export function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <nav className="flex flex-col gap-0.5">
      {ADMIN_NAV.map((g) => (
        <div key={g.key} className="mb-1.5">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
            {t(`admin.navGroups.${g.key}`)}
          </p>
          {g.items.map((i) => (
            <NavLink key={i.href} href={i.href} label={t(`admin.nav.${i.key}`)} icon={i.icon} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}
