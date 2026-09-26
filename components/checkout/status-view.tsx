"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { checkoutStatusAction } from "@/app/actions/checkout";
import type { StatusResult } from "@/lib/server/checkout";

/**
 * "POTWIERDZAMY PŁATNOŚĆ…" — AND THEN THE TRUTH, FROM THE SERVER.
 *
 * This screen is reached two ways: navigated to after a card confirmed without
 * leaving the page, or landed on by Stripe's redirect after BLIK or Przelewy24.
 * In both cases the browser arrives holding nothing but an id in a URL.
 *
 * ─── WHY IT POLLS INSTEAD OF JUST SAYING "DZIĘKUJEMY" ───────────────────────
 *
 * Because "the card was accepted" and "the credits are in the account" are two
 * different facts, minutes apart in the worst case. Credits are granted by the
 * signed webhook, and a webhook is delivered on Stripe's schedule, not the
 * customer's. A page that congratulated on arrival would routinely send people
 * to a wallet that has not moved yet — and they would reload, and buy again.
 *
 * So there are three states and the screen says which one it is in:
 *
 *   PROCESSING  Stripe has it, nothing is confirmed yet
 *   PAID        Stripe says the money moved; the ledger has not caught up
 *   CREDITED    the webhook landed, `payments` has the row, this is the
 *               only state that names a number of credits
 *
 * ─── AND IT GRANTS NOTHING ──────────────────────────────────────────────────
 *
 * `checkoutStatusAction` reads Stripe and reads the ledger. There is no
 * argument to it that writes. Anyone can type this URL with any reference; all
 * that produces is a question asked about a payment scoped to their own
 * workspace, and usually the answer "unknown".
 */

/** Backs off so a slow webhook does not become a tight loop on the server. */
const SCHEDULE = [1200, 1800, 2500, 3500, 5000, 7000, 9000, 12000];

export function StatusView({ reference }: { reference: string | null }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [tries, setTries] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!reference) return;
    let stopped = false;

    const poll = async (attempt: number) => {
      const res = await checkoutStatusAction(reference);
      if (stopped) return;
      setStatus(res);
      setTries(attempt + 1);
      // Stop once the ledger has moved, or once the payment is definitively
      // dead. "paid but not yet credited" keeps asking — that is the gap this
      // screen exists to cover.
      if (res.state === "credited" || res.state === "failed") return;
      if (attempt >= SCHEDULE.length - 1) return;
      timer.current = setTimeout(() => void poll(attempt + 1), SCHEDULE[attempt]);
    };

    void poll(0);
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reference]);

  if (!reference) return <Shell tone="fail" title={t("checkout.statusUnknownTitle")} body={t("checkout.statusUnknownBody")} />;

  const state = status?.state ?? "processing";
  const exhausted = tries >= SCHEDULE.length;

  if (state === "credited" && status?.kind === "grovnews") {
    return (
      <Shell tone="ok" title={t("checkout.statusDoneTitle")} body={t("checkout.statusGrovNewsActive")}
        cta={{ href: "/grovnews", label: t("checkout.statusGoGrovNews") }} />
    );
  }

  if (state === "credited") {
    const credits = status?.credits ?? 0;
    return (
      <Shell
        tone="ok"
        title={t("checkout.statusDoneTitle")}
        body={
          status?.kind === "subscription"
            ? t("checkout.statusPlanActive")
            : credits > 0
              ? t("checkout.statusCreditsAdded", { n: credits.toLocaleString(locale) })
              : t("checkout.statusPaid")
        }
        cta={{ href: status?.kind === "subscription" ? "/plan" : "/credits", label: t("checkout.statusGo") }}
      />
    );
  }

  if (state === "failed") {
    return (
      <Shell tone="fail" title={t("checkout.statusFailedTitle")} body={t("checkout.statusFailedBody")}
        cta={{ href: "/plan", label: t("checkout.statusRetry") }} />
    );
  }

  if (state === "paid") {
    // Money confirmed, ledger not yet. Said plainly, with the promise that it
    // needs no further action — which is the thing that stops a second attempt.
    return (
      <Shell
        tone="wait"
        title={t("checkout.statusPaidTitle")}
        body={exhausted ? t("checkout.statusSlowBody") : t("checkout.statusPaidBody")}
        cta={exhausted ? { href: "/credits", label: t("checkout.statusGo") } : undefined}
      />
    );
  }

  return (
    <Shell
      tone="wait"
      title={t("checkout.statusPendingTitle")}
      body={exhausted ? t("checkout.statusSlowBody") : t("checkout.statusPendingBody")}
      cta={exhausted ? { href: "/credits", label: t("checkout.statusGo") } : undefined}
    />
  );
}

function Shell({ tone, title, body, cta }: {
  tone: "ok" | "wait" | "fail";
  title: string; body: string;
  cta?: { href: string; label: string };
}) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "fail" ? XCircle : Clock;
  const ring =
    tone === "ok" ? "bg-[rgb(var(--success)/0.14)] text-success"
    : tone === "fail" ? "bg-[rgb(var(--danger)/0.14)] text-danger"
    : "bg-[rgb(var(--accent)/0.14)] text-accent";

  return (
    <div className="panel mx-auto max-w-md rounded-2xl p-6 text-center sm:p-8">
      <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${ring}`}>
        {tone === "wait"
          ? <Loader2 size={24} aria-hidden className="animate-spin" />
          : <Icon size={24} aria-hidden />}
      </span>
      <h1 className="mt-4 font-display text-[19px] font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{body}</p>
      {cta && (
        <Link
          href={cta.href}
          className="cta mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
