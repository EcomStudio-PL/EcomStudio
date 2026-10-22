"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { rollbackPageAction } from "@/app/actions/cms";
import type { VersionRow } from "@/lib/services/cms";
import type { LegalVersionFacts } from "@/lib/server/legal/admin";
import { LEGAL_LOCALES } from "@/lib/legal/docs";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

/**
 * VERSION HISTORY.
 *
 * Restoring a version copies it back onto the DRAFT. It does not publish —
 * that stays a separate, deliberate act, so an admin can look at what they
 * restored before a visitor does. The draft being replaced is snapshotted
 * first, so a rollback is itself reversible and nothing is ever lost.
 *
 * That guarantee is why the legal documents live here: superseded terms have
 * to remain readable long after they stop being current. For a version that
 * holds one, the row says WHICH document it was — its version label, length
 * and digest per language ("PL v1.0 · 75 255 znaków · sha 151b56da0c3e…") —
 * so the right one is restored without opening each.
 */
export function VersionHistory({ pageId, slug, title, versions, authors, locale, docs = {} }: {
  pageId: string;
  slug: string;
  title: string;
  versions: VersionRow[];
  authors: Record<string, string>;
  locale: string;
  /** Per version id: the legal document its snapshot holds, if any
   *  (lib/server/legal/admin.ts legalVersionFacts). */
  docs?: Record<string, LegalVersionFacts>;
}) {
  const { t } = useI18n();
  const nf = useMemo(() => new Intl.NumberFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB"), [locale]);
  const plurals = useMemo(() => new Intl.PluralRules(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB"), [locale]);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [restoring, setRestoring] = useState<VersionRow | null>(null);

  function restore(version: VersionRow) {
    start(async () => {
      const res = await rollbackPageAction(pageId, version.id);
      if (!res.ok) { toast.error(t(`cms.err.${res.error}`)); return; }
      setRestoring(null);
      toast.success(t("cms.restored"));
      router.push(`/admin/www/${slug}`);
    });
  }

  return (
    <div className="mx-auto max-w-3xl" data-version-history>
      <div className="mb-4">
        <Link href={`/admin/www/${slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
          <ArrowLeft size={14} aria-hidden />{title}
        </Link>
      </div>

      {versions.length === 0 ? (
        <div className="panel rounded-2xl p-10 text-center">
          <p className="text-sm font-semibold">{t("cms.historyEmpty")}</p>
          <p className="mt-1 text-sm text-muted">{t("cms.historyEmptyBody")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {versions.map((v) => (
            <li key={v.id} className="panel flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3.5"
              data-version={v.version}>
              <span className="font-display text-sm font-semibold tabular-nums">v{v.version}</span>
              <Badge tone={v.reason === "rollback" ? "info" : "neutral"}>
                {t(`cms.versionReason.${v.reason}`)}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{formatDate(v.createdAt, locale)}</span>
                <span className="block text-[11.5px] text-faint">
                  {t("cms.versionBlocks", { n: v.blocks })}
                  {v.createdBy && authors[v.createdBy] ? ` · ${authors[v.createdBy]}` : ""}
                  {v.label ? ` · ${v.label}` : ""}
                </span>
                {docs[v.id] && LEGAL_LOCALES.map((l) => {
                  const f = docs[v.id]?.[l];
                  if (!f) return null;
                  return (
                    <span key={l} className="block text-[11.5px] tabular-nums text-muted" data-version-doc={l}
                      data-version-doc-sha={f.sha256 ?? ""}>
                      {t("cms.legalPanel.versionDoc", {
                        lang: l.toUpperCase(),
                        version: f.version || "—",
                        chars: t(`cms.legalDoc.chars.${plurals.select(f.chars)}`, { n: nf.format(f.chars) }),
                        sha: (f.sha256 ?? "").slice(0, 12),
                      })}
                    </span>
                  );
                })}
              </span>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => setRestoring(v)}>
                <RotateCcw size={13} aria-hidden />{t("cms.restore")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!restoring} onClose={() => setRestoring(null)} title={t("cms.restore")}>
        {restoring && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted">
              {t("cms.restoreBody", { v: restoring.version })}
            </p>
            <p className="rounded-xl border border-line bg-raised/50 px-3.5 py-3 text-[12.5px] leading-relaxed text-muted">
              {t("cms.restoreNote")}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRestoring(null)}>{t("common.cancel")}</Button>
              <Button disabled={pending} onClick={() => restore(restoring)}>{t("cms.restore")}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
