"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";

export function CommandPalette({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo(() => {
    const base = [
      { label: `+ ${t("products.new")}`, href: "/products/new" },
      { label: t("nav.dashboard"), href: "/dashboard" },
      { label: t("nav.products"), href: "/products" },
      { label: t("nav.prompts"), href: "/prompts" },
      { label: t("nav.generator"), href: "/generator" },
      { label: t("nav.library"), href: "/library" },
      { label: t("nav.history"), href: "/history" },
      { label: t("nav.credits"), href: "/credits" },
      { label: t("nav.plan"), href: "/plan" },
      { label: t("nav.settings"), href: "/settings" },
    ];
    const admin = isAdmin ? [
      { label: `Admin · ${t("admin.nav.dashboard")}`, href: "/admin" },
      { label: `Admin · ${t("admin.nav.users")}`, href: "/admin/users" },
      { label: `Admin · ${t("admin.nav.credits")}`, href: "/admin/credits" },
      { label: `Admin · ${t("admin.nav.providers")}`, href: "/admin/providers" },
      { label: `Admin · ${t("admin.nav.models")}`, href: "/admin/models" },
      { label: `Admin · ${t("admin.nav.templates")}`, href: "/admin/templates" },
      { label: `Admin · ${t("admin.nav.plans")}`, href: "/admin/plans" },
      { label: `Admin · ${t("admin.nav.system")}`, href: "/admin/system" },
    ] : [];
    return [...base, ...admin];
  }, [t, isAdmin]);

  const filtered = commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        aria-label={t("common.search")}
        className="hidden h-9 items-center gap-2 rounded-lg border border-line bg-surface/60 px-3 text-xs text-muted transition-colors hover:text-ink sm:flex">
        <span aria-hidden>⌕</span>
        {t("common.search")}
        <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-faint">⌘K</kbd>
      </button>
      <Modal open={open} onClose={() => { setOpen(false); setQ(""); }} title={t("common.search")}>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t("common.search")}…`} />
        <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto">
          {filtered.map((c) => (
            <li key={c.href + c.label}>
              <button type="button"
                className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-raised"
                onClick={() => { setOpen(false); setQ(""); router.push(c.href); }}>
                {c.label}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="px-3 py-4 text-sm text-muted">{t("admin.noData")}</li>}
        </ul>
      </Modal>
    </>
  );
}
