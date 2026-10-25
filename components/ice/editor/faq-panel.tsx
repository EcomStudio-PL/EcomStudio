"use client";
import { useRouter } from "next/navigation";
import { FaqManager } from "@/components/admin/faq/faq-manager";
import type { FaqPage } from "@/lib/faq";
import { Sheet, type EditorCtx } from "./shared";
import s from "./editor.module.css";

/**
 * "Edytuj stronę" → FAQ (FAQ V1): the shared base, on the page that shows it
 * (/faq, /plany, /o-nas). The same editor as Strony WWW → FAQ; it opens
 * filtered on this page's questions, and every save re-renders the page
 * underneath so the change can be seen where it lands.
 */
export function FaqPanel({ ctx, page, onClose }: { ctx: EditorCtx; page: FaqPage | null; onClose: () => void }) {
  const router = useRouter();
  const { t } = ctx;
  return (
    <Sheet t={t} wide title={t("ice.faq.title")} crumbs={t("ice.faq.crumbs")} onClose={onClose}>
      <FaqManager page={page ?? undefined} onChanged={() => router.refresh()} />
      <p className={s.meta}>
        {t("ice.faq.panelHint")} <a href="/admin/www/baza-faq" target="_blank" rel="noopener noreferrer">{t("ice.faq.openAdmin")}</a>
      </p>
    </Sheet>
  );
}
