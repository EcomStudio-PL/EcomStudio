"use client";
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

/**
 * ERROR BOUNDARY for the whole signed-in app.
 *
 * A server component that throws used to hand the browser Next's bare error
 * page — a dark, empty screen with no way out, which is exactly what the
 * session bug looked like from the user's side. This renders a real state
 * instead: what happened, a retry that re-runs the failed render, and two
 * escape hatches. It never blames the session or asks anyone to log in twice.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    // Both halves of the diagnosis, and never more than that.
    //
    // A crash thrown while a SERVER component rendered reaches the browser
    // stripped: React replaces the message with a `digest`, and the real stack
    // stays in the platform log. So the console gets the digest AND the route,
    // which is what turns "someone saw an error" into a single findable line;
    // the message and name are only ever populated for client-side throws,
    // where they are the actual diagnosis. No stack, no payloads, no tokens —
    // and nothing here is ever rendered except the digest, which is a hash.
    console.error("app-error", {
      digest: error.digest ?? null,
      name: error.name,
      message: error.digest ? null : error.message,
      path: typeof window === "undefined" ? null : window.location.pathname + window.location.search,
    });
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-[var(--page-x)] py-10">
      <div className="panel w-full max-w-md rounded-2xl p-6 text-center sm:p-8">
        <span aria-hidden className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgb(var(--warning)/0.14)] text-warning">
          <AlertTriangle size={22} />
        </span>
        <h1 className="mt-4 font-display text-lg font-semibold tracking-tight">{t("common.errorTitle")}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t("common.errorBody")}</p>
        {/* The digest is a hash Next also writes next to the full stack in the
            server log — safe to show, and it is what support quotes to find the
            crash. The stack itself never leaves the server. */}
        {error.digest ? (
          <p className="mt-2 font-mono text-[11px] text-faint">{t("common.errorRef", { code: error.digest })}</p>
        ) : null}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={reset}
            className="cta inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold">
            <RotateCw size={15} aria-hidden />
            {t("common.retry")}
          </button>
          <Link href="/home"
            className="plate inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-raised">
            <Home size={15} aria-hidden />
            {t("common.goHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}
