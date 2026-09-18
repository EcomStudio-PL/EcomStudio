import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, HelpCircle, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { MinimalHeader, MinimalFooter } from "@/components/cms/site-shell";
import { isUnsubscribeToken } from "@/lib/newsletter-consent";
import { Resubscribe } from "./resubscribe";

export const dynamic = "force-dynamic";

/**
 * WYPISZ SIĘ — the page a recipient reaches from the footer of a campaign.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT UNSUBSCRIBES ON ARRIVAL. THERE IS NO "ARE YOU SURE".
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Opening this page IS the second click — the first one was in the mail. A
 * confirmation screen here would mean somebody who has already decided to leave
 * has to decide again, on a page that (whatever it says) exists to talk them
 * out of it, and the reliable consequence of that is the spam button instead.
 * One report costs the sending reputation of the entire domain, which on this
 * deployment is also the domain that sends login codes — SMTP and IMAP share
 * one credential here. So: arrive, and you are out.
 *
 * WHAT PAYS FOR THAT. One-click means the occasional accident: a mis-tap, a
 * corporate link scanner that fetches every URL in every incoming message, a
 * newsletter forwarded to a colleague who opens the footer link out of
 * curiosity. The way back in is the answer, and it is the reason
 * `newsletter_resubscribe` was written — see supabase/migrations/0096. Without
 * that button, one-click is a trapdoor.
 *
 * NO CHROME THAT ASKS FOR ANYTHING. MinimalHeader and MinimalFooter, the same
 * pair a CMS page with `headerMode: "minimal"` wears, and deliberately not
 * SiteHeader: that one carries the sign-in entry, and somebody who arrived here
 * from an email to press one button is not being asked to log in. It also costs
 * three fewer queries (global sections, nav, site settings) on a page whose
 * whole job is to say one sentence.
 *
 * THE TOKEN IS NEVER CONFIRMED OR DENIED. An unknown token, a truncated one and
 * a fabricated one all print the same two lines. The page must not become an
 * oracle that answers "is this a real subscriber" to anybody who tries a uuid.
 */

export const metadata: Metadata = {
  // NEVER INDEXED, and not merely for tidiness: a crawler that indexed this URL
  // would be publishing somebody's unsubscribe token, and anything that fetched
  // the result would unsubscribe them again.
  robots: { index: false, follow: false },
};

type Params = { params: Promise<{ token: string }> };

/** What the visitor is told, and the only three things that can happen.
 *
 *  `unknown` and `failed` are kept apart on purpose. "This link is not valid"
 *  is a statement about the link; when the database is simply unreachable the
 *  link may be perfectly good, and telling somebody their unsubscribe link is
 *  broken — while pointing them at replying to an email for a manual removal —
 *  would be a lie that costs them a working exit. A reload fixes the second
 *  case and nothing fixes the first. */
type Outcome = "unsubscribed" | "unknown" | "failed";

async function unsubscribe(token: string): Promise<Outcome> {
  const value = token.trim();
  // The RPC's parameter is a `uuid`; PostgREST answers a malformed one with a
  // 22P02 cast error, not with "no such contact". Checking the shape first is
  // what turns "somebody's mail client wrapped the link" into the honest
  // "this link is not valid" screen instead of a 500.
  if (!isUnsubscribeToken(value)) return "unknown";

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("newsletter_unsubscribe", {
      p_token: value.toLowerCase(),
    });
    if (error) return "failed";
    // `newsletter_unsubscribe` is the security boundary and the only authority
    // on what happened: it answers 'unsubscribed' or 'unknown', and this page
    // repeats its answer rather than inferring one.
    const result = (data ?? {}) as { status?: string };
    return result.status === "unsubscribed" ? "unsubscribed" : "unknown";
  } catch {
    return "failed";
  }
}

export default async function UnsubscribePage({ params }: Params) {
  const { token } = await params;
  const { dict } = await getDictionary();
  const t = makeT(dict);

  const outcome = await unsubscribe(token);

  const copy = {
    unsubscribed: { title: t("newsletter.unsub.title"), body: t("newsletter.unsub.body") },
    unknown: { title: t("newsletter.unsub.unknown"), body: t("newsletter.unsub.unknownBody") },
    failed: { title: t("common.error"), body: t("newsletter.err.generic") },
  }[outcome];

  const Icon = outcome === "unsubscribed" ? CheckCircle2 : outcome === "unknown" ? HelpCircle : AlertTriangle;
  const tone = outcome === "unsubscribed"
    ? "bg-accent-soft/60 text-accent"
    : outcome === "failed"
      ? "bg-danger/10 text-danger"
      : "bg-sunken text-muted";

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <MinimalHeader />

      <main className="flex-1">
        {/* 320px-safe: the gutter is the site's own page inset, the card has no
            fixed width and nothing inside it can force a horizontal scroll. */}
        <div className="mx-auto w-full max-w-[34rem] px-[var(--page-x,1rem)] py-12 sm:py-20">
          <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
            <span aria-hidden
              className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}>
              <Icon size={22} />
            </span>

            <h1 className="mt-5 font-display text-[clamp(1.35rem,4.5vw,1.8rem)] font-semibold leading-tight tracking-tight">
              {copy.title}
            </h1>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted">{copy.body}</p>

            {/* THE WAY BACK IN, and only where it makes sense. Offering it on
                the "unknown link" screen would be offering to re-subscribe
                somebody we could not identify in the first place. */}
            {outcome === "unsubscribed" && <Resubscribe token={token.trim()} />}

            {/* A failure is the one case where the visitor can actually fix it
                themselves — the same URL, tried again. */}
            {outcome === "failed" && (
              <p className="mt-5">
                <Link href={`/wypisz-sie/${encodeURIComponent(token.trim())}`}
                  className="tap text-sm font-semibold text-accent transition-opacity hover:opacity-75">
                  {t("common.retry")}
                </Link>
              </p>
            )}

            <p className="mt-7 border-t border-line pt-5">
              <Link href="/"
                className="tap text-sm font-medium text-accent transition-opacity hover:opacity-75">
                ← {t("newsletter.unsub.back")}
              </Link>
            </p>
          </div>
        </div>
      </main>

      <MinimalFooter t={t} />
    </div>
  );
}
