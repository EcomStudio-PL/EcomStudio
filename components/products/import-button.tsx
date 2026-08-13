"use client";
import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { CsvImport } from "./csv-import";

/** Opens the CSV importer. Kept separate so the products page stays a
 *  server component. */
export function ImportButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="plate inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-muted transition-colors hover:border-[rgb(var(--accent)/0.35)] hover:text-ink sm:flex-none">
        <FileSpreadsheet size={16} aria-hidden />
        <span className="truncate">{t("products.importCsv")}</span>
      </button>
      <CsvImport open={open} onClose={() => setOpen(false)} />
    </>
  );
}
