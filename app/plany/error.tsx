"use client";
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

/**
 * ERROR BOUNDARY for the public /plany.
 *
 * An unreadable catalogue throws (lib/server/pricing-page.ts) rather than
 * render a page of "not on sale" cards — that would be a false statement
 * about the offer. This is what the visitor sees instead: what happened and a
 * retry. /plan inside the app is covered by app/(app)/error.tsx.
 */
export default function PricingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    // The digest and the route only — the same line app/(app)/error.tsx logs.
    console.error("pricing-error", {
      digest: error.digest ?? null,
      name: error.name,
      message: error.digest ? null : error.message,
      path: typeof window === "undefined" ? null : window.location.pathname,
    });
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-[var(--page-x)] py-10">
      <div className="panel w-full max-w-md rounded-2xl p-6 text-center sm:p-8">
        <span aria-hidden className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgb(var(--warning)/0.14)] text-warning">
          <AlertTriangle size={22} />
        </span>
        <h1 className="mt-4 font-display text-lg font-semibold tracking-tight">{t("common.errorTitle")}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t("common.errorBody")}</p>
        {error.digest ? (
          <p className="mt-2 font-mono text-[11px] text-muted">{t("common.errorRef", { code: error.digest })}</p>
        ) : null}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={reset}
            className="cta inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold">
            <RotateCw size={15} aria-hidden />
            {t("common.retry")}
          </button>
          <Link href="/"
            className="plate inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-raised">
            {t("common.goHome")}
          </Link>
        </div>
      </div>
    </main>
  );
}
