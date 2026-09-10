import Link from "next/link";
import Image from "next/image";
import { AuthLink } from "@/components/auth/auth-link";
import { BarChart3, Gift, Percent, Sparkles, Zap } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { WaitlistForm } from "@/components/launch/waitlist-form";
import { FacebookIcon, InstagramIcon, LinkedinIcon, XIcon } from "@/components/launch/social-icons";
import { cn } from "@/lib/utils";
import type { LaunchField } from "@/lib/server/launch-page";
import type { WaitlistFieldConfig } from "@/lib/server/registration-config";

/**
 * PREMIERA GROVBASE — the pre-launch front door, in ONE screen.
 *
 * The page used to scroll through four marketing sections. It does not any
 * more: everything that earns an address — what this is, what you get, and
 * the field you type into — sits above the fold, with the artwork bleeding off
 * the right edge behind it. A visitor who has to scroll to find the form is a
 * visitor who does not fill it in.
 *
 * Every line still comes from `content`, which the admin edits in
 * /admin/www/premiera and which falls back to the shipped translation, so this
 * file holds layout and no copy.
 *
 * The page is dark at every theme setting (see `[data-launch-page]` in
 * globals.css). The artwork is a lit scene on near-black; a light palette
 * behind it would put white panels next to a black photograph.
 */

/** Icons for the three proof chips, in the order the copy fields are read. */
const FEATURE_ICONS = [Zap, Sparkles, BarChart3] as const;
/** Icons for the three sign-up perks. */
const PERK_ICONS = [Gift, Percent, Gift] as const;

export function LaunchPage({
  content, signedIn, loginLabel, privacyLabel, termsLabel, rightsLabel, social,
  waitlistFields, showAuthEntry,
}: {
  content: Record<LaunchField, string>;
  signedIn: boolean;
  loginLabel: string;
  /** "POKAŻ PRZYCISKI" from the access panel. Presentation only: hiding the
   *  entry point is not what closes the door — the routes do that. Someone
   *  already signed in always keeps their way back into the app. */
  showAuthEntry: boolean;
  privacyLabel: string;
  termsLabel: string;
  rightsLabel: string;
  /** Social profiles from the site settings; empty URLs render nothing. */
  social: { instagramUrl: string; facebookUrl: string; linkedinUrl: string; xUrl: string };
  /** Which name/phone fields the signup form asks for, from
   *  /admin/settings/registration. */
  waitlistFields: WaitlistFieldConfig;
}) {
  const c = content;
  const features = [
    { t: c["feature.1t"], b: c["feature.1b"] },
    { t: c["feature.2t"], b: c["feature.2b"] },
    { t: c["feature.3t"], b: c["feature.3b"] },
  ].filter((f) => f.t || f.b);
  const perks = [
    { t: c["benefit.1"], b: c["benefit.1sub"] },
    { t: c["benefit.2"], b: c["benefit.2sub"] },
    { t: c["benefit.3"], b: c["benefit.3sub"] },
  ].filter((p) => p.t || p.b);
  // Only profiles the admin actually configured. A social button that goes
  // nowhere is worse than a shorter row.
  const socials = [
    { key: "facebook", url: social.facebookUrl, Icon: FacebookIcon, label: "Facebook" },
    { key: "instagram", url: social.instagramUrl, Icon: InstagramIcon, label: "Instagram" },
    { key: "linkedin", url: social.linkedinUrl, Icon: LinkedinIcon, label: "LinkedIn" },
    { key: "x", url: social.xUrl, Icon: XIcon, label: "X" },
  ].filter((s) => Boolean(s.url));
  // An admin-uploaded image replaces the shipped artwork without a deploy.
  // Three crops of ONE scene, so each viewport shape gets the whole
  // composition rather than a zoom into whatever happens to be centred:
  // `wide` is short enough that a desktop cover-fit shows both dinosaurs,
  // `portrait` is narrow for phones. An admin-uploaded image replaces all of
  // them without a deploy.
  const art = c["hero.image"] || "/launch/hero-dino-wide.webp";
  const artPortrait = c["hero.image"] || "/launch/hero-dino-portrait.webp";

  return (
    <main data-launch-page className="relative flex min-h-[100svh] flex-col overflow-x-clip">
      {/* ── THE ARTWORK ────────────────────────────────────────────────────
          Desktop: bleeds off the top and right edges behind the content, with
          a left-to-right fade so it dissolves into the page instead of ending
          on a seam. Phones get the portrait crop as a band at the top — same
          scene, framed on the portal and the T-Rex so both dinosaurs survive
          the narrower viewport. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
        <Image src={art} alt="" fill priority sizes="100vw"
          className="object-cover object-[46%_center]" />
        {/* The left half goes almost to black so the headline and the form sit
            on their own ground, while the portal's glow still reaches under
            them. Right of ~62% the scene is untouched. */}
        <span className="absolute inset-0 bg-[linear-gradient(90deg,rgb(var(--bg))_0%,rgb(var(--bg)/0.93)_20%,rgb(var(--bg)/0.55)_34%,rgb(var(--bg)/0.14)_47%,transparent_58%)]" />
        <span className="absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(0deg,rgb(var(--bg)/0.85)_0%,transparent_100%)]" />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[46svh] min-h-[260px] lg:hidden">
        <Image src={artPortrait} alt="" fill priority sizes="100vw"
          className="object-cover object-[52%_38%]" />
        <span className="absolute inset-0 bg-[linear-gradient(180deg,rgb(var(--bg)/0.55)_0%,transparent_28%,rgb(var(--bg)/0.72)_74%,rgb(var(--bg))_100%)]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[1360px] flex-1 flex-col px-5 sm:px-8 lg:px-10">
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between gap-3 py-4 pt-[calc(1rem+env(safe-area-inset-top))] lg:py-3">
          <Brand href="/" height={30} forceDark />
          <div className="flex items-center gap-2.5">
            {/* Phones hide the follow row: the logo, four icons and the login
                button do not fit 390px without crowding, and the success state
                offers the same links right after someone signs up. */}
            {socials.length > 0 && (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="hidden text-[12.5px] font-medium text-muted sm:inline">
                  {c["social.heading"]}
                </span>
                <div className="flex items-center gap-1.5">
                  {socials.map(({ key, url, Icon, label }) => (
                    <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                      aria-label={label} data-launch-social={key}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-[rgb(var(--glass-border)/0.18)] bg-[rgb(var(--surface)/0.55)] text-muted backdrop-blur-md transition-colors hover:border-[rgb(var(--accent)/0.45)] hover:text-ink">
                      <Icon size={15} />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {/* The dialog opens over this page rather than navigating — a link
                to /login would server-redirect back to /?auth=login and the
                provider, living in the root layout, would never see the URL
                change. That is the bug where the button did nothing at all. */}
            {signedIn ? (
              <Link href="/dashboard" data-launch-login
                className="whitespace-nowrap rounded-xl border border-[rgb(var(--glass-border)/0.2)] bg-[rgb(var(--surface)/0.55)] px-3.5 py-2 text-[13px] font-semibold text-ink backdrop-blur-md transition-colors hover:border-[rgb(var(--accent)/0.45)]">
                {loginLabel}
              </Link>
            ) : showAuthEntry ? (
              <AuthLink mode="login" data-launch-login
                className="whitespace-nowrap rounded-xl border border-[rgb(var(--glass-border)/0.2)] bg-[rgb(var(--surface)/0.55)] px-3.5 py-2 text-[13px] font-semibold text-ink backdrop-blur-md transition-colors hover:border-[rgb(var(--accent)/0.45)]">
                {loginLabel}
              </AuthLink>
            ) : null}
          </div>
        </header>

        {/* ── THE ONE SCREEN ───────────────────────────────────────────────
            Left column carries the whole argument and the form; the right
            column is the artwork, which is painted behind everything, so its
            grid cell only has to reserve the space. The perks strip closes the
            right column at the bottom, exactly where the reference puts it. */}
        <div className="grid flex-1 items-center gap-7 pb-5 pt-[40svh] sm:pt-[38svh] lg:grid-cols-[minmax(0,455px)_minmax(0,1fr)] lg:gap-10 lg:pb-0 lg:pt-0">
          <div className="min-w-0 lg:py-1">
            {c["hero.badge"] && (
              <p data-launch-badge
                className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--accent)/0.35)] bg-[rgb(var(--accent)/0.10)] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-accent backdrop-blur-md">
                <Sparkles size={12} aria-hidden />
                {c["hero.badge"]}
              </p>
            )}
            <h1 data-launch-h1
              className="mt-4 text-balance font-display text-[2.5rem] font-semibold leading-[0.97] tracking-[-0.035em] sm:text-[3.2rem] lg:text-[3.75rem]">
              {c["hero.h1"]}{" "}
              {c["hero.h1Accent"] && (
                <span className="bg-[linear-gradient(96deg,rgb(var(--accent))_0%,rgb(var(--accent-glow))_58%,rgb(var(--violet))_105%)] bg-clip-text text-transparent">
                  {c["hero.h1Accent"]}
                </span>
              )}
            </h1>
            {/* The sub-headline is authored as two lines and stays two lines —
                `whitespace-pre-line` keeps the admin's break instead of
                reflowing it into one long sentence. */}
            <p className="mt-3.5 max-w-md whitespace-pre-line text-[14px] leading-[1.5] text-muted sm:text-[15px]">
              {c["hero.sub"]}
            </p>

            {features.length > 0 && (
              <ul data-launch-features className="mt-5 flex flex-wrap gap-2">
                {features.map((f, i) => {
                  const Icon = FEATURE_ICONS[i] ?? Sparkles;
                  return (
                    <li key={`${f.t}${f.b}`}
                      className="flex items-center gap-2 rounded-xl border border-[rgb(var(--glass-border)/0.16)] bg-[rgb(var(--surface)/0.5)] px-2.5 py-2 backdrop-blur-md">
                      <span aria-hidden
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--accent)/0.16)] text-accent">
                        <Icon size={13} />
                      </span>
                      <span className="min-w-0 leading-[1.25]">
                        <span className="block text-[11.5px] font-semibold text-ink">{f.t}</span>
                        <span className="block text-[10.5px] text-faint">{f.b}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* ── THE FORM ─────────────────────────────────────────────── */}
            <div data-launch-form-card
              className="glass mt-5 rounded-2xl border-[rgb(var(--accent)/0.22)] p-4 sm:p-5">
              <p className="font-display text-[17.5px] font-semibold tracking-tight sm:text-[18.5px]">
                {c["form.title"]}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{c["form.sub"]}</p>
              <div className="mt-4">
                <WaitlistForm placeholder={c["hero.placeholder"]} cta={c["hero.cta"]} source="hero"
                  consentLabel={c["hero.consent"]} id="waitlist-hero" fields={waitlistFields}
                  safetyNote={c["form.safety"]}
                  successTitle={c["success.title"]} successBody={c["success.body"]}
                  successFollow={c["success.follow"]} social={social} />
              </div>
            </div>
          </div>

          {/* Right column: the artwork lives behind it, so only the perks
              strip is real content here. `self-end` drops it to the bottom of
              the column, under the T-Rex. */}
          <div className="min-w-0 lg:self-end lg:pb-1">
            {perks.length > 0 && (
              <div data-launch-perks
                className="glass rounded-2xl p-4 sm:p-5">
                <p className="text-center text-[12.5px] font-medium text-muted">{c["perks.heading"]}</p>
                <ul className="mt-3 grid gap-2.5 sm:grid-cols-3">
                  {perks.map((p, i) => {
                    const Icon = PERK_ICONS[i] ?? Gift;
                    return (
                      <li key={`${p.t}${p.b}`}
                        className="flex items-center gap-2.5 rounded-xl border border-[rgb(var(--glass-border)/0.14)] bg-[rgb(var(--surface)/0.55)] px-3 py-2.5">
                        <span aria-hidden className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                          i === 1
                            ? "bg-[rgb(var(--violet)/0.18)] text-[rgb(var(--violet))]"
                            : "bg-[rgb(var(--accent)/0.16)] text-accent",
                        )}>
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0 leading-[1.3]">
                          <span className="block text-[13px] font-semibold text-ink">{p.t}</span>
                          <span className="block text-[12px] text-muted">{p.b}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* ── FOOTER ───────────────────────────────────────────────────────
            One line. A pre-launch page has nothing to put in columns. */}
        <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-1.5 text-center text-[11.5px] text-faint">
          <span>GrovBase © {new Date().getFullYear()} · {rightsLabel}</span>
          <span aria-hidden className="hidden sm:inline">·</span>
          <Link href="/polityka-prywatnosci" className="transition-colors hover:text-ink">{privacyLabel}</Link>
          <Link href="/regulamin" className="transition-colors hover:text-ink">{termsLabel}</Link>
        </footer>
      </div>
    </main>
  );
}
