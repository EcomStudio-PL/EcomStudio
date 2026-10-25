"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RotateCcw, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { GUEST_OWNER, cleanPath, type DraftMeta } from "@/lib/public-tools";
import { listDrafts } from "./draft-store";

/**
 * "MASZ PRZYGOTOWANE NARZĘDZIE — WRÓĆ."
 *
 * Signing up ends somewhere else than it started: the confirmation link opens
 * /auth/verified, a checkout comes back to its status page, a returning
 * customer lands on Start. The tool's own page restores the preparation the
 * moment it opens; this is the way back to it from anywhere else in the app.
 *
 * Only a preparation this account may take: a visitor's (which the tool page
 * then offers with "Przywróć / Odrzuć") or this account's own. Another
 * account's work in the same browser is not advertised.
 */
export function DraftResume({ viewerKey, labels }: {
  viewerKey: string;
  /** Catalogue key → the tool's name, from the server's dictionary. */
  labels: Readonly<Record<string, string>>;
}) {
  const { t } = useI18n();
  const pathname = cleanPath(usePathname() ?? "");
  const [draft, setDraft] = useState<DraftMeta | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let live = true;
    void listDrafts().then((all) => {
      if (!live) return;
      const mine = all.find((d) => (d.owner === GUEST_OWNER || d.owner === viewerKey)
        && cleanPath(d.path) !== pathname && labels[d.tool]);
      setDraft(mine ?? null);
    });
    return () => { live = false; };
  }, [pathname, viewerKey, labels]);

  if (!draft || hidden) return null;
  return (
    <div data-draft-resume={draft.tool} role="region" aria-label={t("publicTools.draft.label")}
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[rgb(var(--accent)/0.35)] bg-[rgb(var(--accent)/0.07)] px-3.5 py-2.5 text-[13px]">
      <RotateCcw size={15} className="shrink-0 text-accent" aria-hidden />
      <p className="min-w-0 flex-1">{t("publicTools.resume.title", { tool: labels[draft.tool], n: draft.fileCount })}</p>
      <Link href={draft.path} data-draft-resume-go
        className="cta inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-semibold">
        {t("publicTools.resume.cta")}
      </Link>
      <button type="button" onClick={() => setHidden(true)} aria-label={t("common.close")}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-raised">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
