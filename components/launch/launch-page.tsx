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
  // ONE file for every viewport: the desktop panel and the phone band are both
  // close enough to the scene's own 1.57 aspect that a cover fit trims a
  // margin rather than zooming into the middle of it, so a second crop would
  // only be a second thing to keep in sync.
  const art = c["hero.image"] || "/launch/hero-dino.webp";

  return (
    <main data-launch-page className="relative flex min-h-[100svh] flex-col overflow-x-clip"
      style={{
        // Read by the phone band, the header wash and the content pad.
        "--hero-top": "calc(3.25rem + env(safe-area-inset-top))",
        "--hero-art": "min(62vw, 32svh)",
      } as React.CSSProperties}>
      {/* ── THE ARTWORK ────────────────────────────────────────────────────
          Desktop: a panel down the RIGHT of the screen rather than a full
          bleed. Stretched edge to edge, the scene's left third — where the
          pixel dinosaur stands — landed under the very part of the fade that
          has to be near-black for the headline to read, so the artwork was
          paying for the text's background with its own subject.

          The panel carries the ARTWORK'S OWN aspect ratio, so a cover fit
          inside it crops nothing: the box is the picture. Sized to the viewport
          HEIGHT instead, a 1.57 scene in a 1.77 window came out magnified to
          about 1136px wide — both dinosaurs enormous and the T-Rex's snout off
          the edge, which is the badly-cropped-wallpaper look. Held to a
          fraction of the WIDTH it sits at its own proportions, starts clear of
          the text column, and reaches the top edge the way the reference
          composition does.

          Phones get the same scene as a band at the top, sized off the width
          too, so its proportions never depend on how tall the phone is. */}
      <div aria-hidden
        className="pointer-events-none absolute right-0 top-0 hidden w-[66%] lg:block xl:w-[64%]">
        <div className="relative aspect-[1808/1152] w-full">
          <Image src={art} alt="" fill priority sizes="66vw" className="object-cover object-center" />
          {/* Only the panel's own left edge fades, and it clears before the
              pixel dinosaur — far enough to hide the seam, not far enough to
              swallow the subject. */}
          <span className="absolute inset-0 bg-[linear-gradient(90deg,rgb(var(--bg))_0%,rgb(var(--bg)/0.86)_5%,rgb(var(--bg)/0.42)_11%,rgb(var(--bg)/0.12)_17%,transparent_24%)]" />
          {/* The artwork ends on a lit floor, so it needs a real landing rather
              than a hairline where the picture stops and the page starts. */}
          <span className="absolute inset-x-0 bottom-0 h-2/5 bg-[linear-gradient(0deg,rgb(var(--bg))_0%,rgb(var(--bg)/0.72)_34%,transparent_100%)]" />
        </div>
      </div>
      {/* THE PHONE BAND, and the two numbers that place everything under it.
          `--hero-top` is how far down the artwork starts — far enough that the
          logo and the sign-in button get ground of their own instead of
          sitting on the T-Rex's jaw, which is what made the top of the page
          feel packed. `--hero-art` is its height, capped in svh so a short or
          landscape screen does not get a band taller than the viewport.

          The content's padding is derived from BOTH, so the badge keeps
          overlapping the picture by the same 2.6rem however tall the notch is
          and whatever the screen measures. */}
      <div aria-hidden data-launch-art-mobile
        className="pointer-events-none absolute inset-x-0 top-[var(--hero-top)] h-[var(--hero-art)] lg:hidden">
        <Image src={art} alt="" fill priority sizes="100vw"
          className="object-cover object-[6%_center]" />
        {/* Top AND bottom now: the band no longer starts at the screen edge,
            so its upper edge would otherwise be a visible seam across the
            page. It dissolves into the header's ground instead. */}
        <span className="absolute inset-0 bg-[linear-gradient(180deg,rgb(var(--bg))_0%,rgb(var(--bg)/0.55)_7%,transparent_22%,rgb(var(--bg)/0.30)_56%,rgb(var(--bg)/0.86)_84%,rgb(var(--bg))_100%)]" />
      </div>

      {/* THE HEADER'S OWN GROUND. A wash that starts as the page background and
          fades into the artwork, carrying a little of the scene's own magenta
          on the side the portal lights — so the logo and the button read as
          part of the composition rather than as two chips dropped on a photo. */}
      <span aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[calc(var(--hero-top)+5rem)] lg:hidden"
        style={{
          background:
            "radial-gradient(90% 130% at 82% -10%, rgb(var(--accent) / 0.20), transparent 68%),"
            + "linear-gradient(180deg, rgb(var(--bg)) 0%, rgb(var(--bg)/0.88) 38%, rgb(var(--bg)/0.42) 68%, transparent 100%)",
        }} />

      <div className="relative mx-auto flex w-full max-w-[1360px] flex-1 flex-col px-5 sm:px-8 lg:px-10">
        {/* ── HEADER ───────────────────────────────────────────────────────
            Lifted OUT of the flow on phones and laid over the artwork, so the
            content below is positioned from the top of the page rather than
            from wherever the notch happened to push the logo. That is what
            lets the badge overlap the photograph by a known amount. */}
        <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-5 pb-4 pt-[calc(1.15rem+env(safe-area-inset-top))] sm:px-8 lg:static lg:px-0 lg:py-2">
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
        {/* The phone column starts ABOVE the artwork's bottom edge — the badge
            is meant to sit on the photograph, which is what ties the two
            halves of the screen together instead of stacking them. The pad is
            width-derived like the band above it, so the overlap is the same
            fraction on every phone, and capped in svh for short screens. */}
        <div className="grid flex-1 items-center gap-5 pb-5 pt-[calc(var(--hero-top)+var(--hero-art)-2.6rem)] sm:gap-6 lg:grid-cols-[minmax(0,455px)_minmax(0,1fr)] lg:gap-10 lg:pb-0 lg:pt-0">
          <div className="min-w-0 lg:py-1">
            {c["hero.badge"] && (
              <p data-launch-badge
                className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--accent)/0.35)] bg-[rgb(var(--accent)/0.14)] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-accent shadow-[0_8px_24px_-12px_rgb(0_0_0/0.9)] backdrop-blur-md">
                <Sparkles size={12} aria-hidden />
                {c["hero.badge"]}
              </p>
            )}
            <h1 data-launch-h1
              className="mt-3 font-display text-[2.35rem] font-semibold leading-[0.97] tracking-[-0.035em] sm:mt-4 sm:text-[3.1rem] lg:mt-2 lg:text-[3rem] xl:text-[3.6rem]">
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
            <p className="mt-2.5 max-w-md whitespace-pre-line text-[13.5px] leading-[1.45] text-muted sm:mt-3 sm:text-[14.5px] sm:leading-[1.5] xl:text-[15px]">
              {c["hero.sub"]}
            </p>

            {/* Three across at EVERY width — a grid, never a wrapping flex row.
                Flex-wrap made the row's fit depend on how long the words happen
                to be: the moment a name grew by two characters the third chip
                dropped to a second line and pushed the form off the desktop
                screen. Three equal cells cannot do that; a long name wraps
                inside its own cell and the grid keeps all three level. Below sm
                the chip stacks its icon over its text; from sm it goes back to
                icon-beside-text. */}
            {features.length > 0 && (
              <ul data-launch-features
                className="mt-3.5 grid grid-cols-3 gap-1.5 sm:mt-4 sm:gap-2 lg:mt-3">
                {features.map((f, i) => {
                  const Icon = FEATURE_ICONS[i] ?? Sparkles;
                  return (
                    <li key={`${f.t}${f.b}`}
                      className="flex flex-col items-center gap-2 rounded-2xl border border-[rgb(var(--glass-border)/0.16)] bg-[rgb(var(--surface)/0.5)] px-1.5 py-2.5 text-center backdrop-blur-md sm:flex-row sm:items-center sm:gap-2 sm:rounded-xl sm:px-2.5 sm:py-2 sm:text-left">
                      <span aria-hidden
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.16)] text-accent sm:h-7 sm:w-7 sm:rounded-lg">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      {/* The name is sized off the VIEWPORT, not fixed, so it
                          stays on one line from a 360px Android to a Pro Max
                          instead of snapping in half on the narrow ones. */}
                      <span className="min-w-0 leading-[1.3] sm:leading-[1.25]">
                        {/* The desktop column is a fixed 455px, so a chip cell there is ~146px
                            wide whatever the screen measures — the size that keeps the
                            longest name on one line inside it is ~10px, and that is what
                            lg gets. Between sm and lg the chips have the full width. */}
                        <span className="block text-[clamp(9.8px,2.75vw,11.5px)] font-semibold tracking-[-0.01em] text-ink sm:text-[11.5px] lg:text-[10px]">{f.t}</span>
                        <span className="mt-0.5 block text-[clamp(8.8px,2.45vw,10.5px)] text-faint sm:mt-0 sm:text-[10.5px] lg:text-[9.5px]">{f.b}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* ── THE FORM ─────────────────────────────────────────────── */}
            <div data-launch-form-card
              className="glass relative mt-4 rounded-2xl border-[rgb(var(--accent)/0.22)] p-4 sm:p-[18px] lg:mt-3 lg:p-4 xl:mt-5 xl:p-5">
              {/* The same travelling light the auth dialog carries, on the one
                  card this page is asking people to use. A little slower than
                  the dialog's: this card's perimeter is shorter, so at 6s the
                  arc crosses a corner noticeably faster. Decorative and
                  CSS-only, and it stops moving entirely for anyone who asked
                  for reduced motion — see .orbit-ring in globals.css. */}
              <span aria-hidden data-launch-form-orbit
                className="orbit-ring"
                style={{ "--orbit-speed": "7.5s", "--orbit-inset": "-1px" } as React.CSSProperties} />
              <p className="relative font-display text-[17px] font-semibold tracking-tight lg:text-[17.5px] xl:text-[18.5px]">
                {c["form.title"]}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{c["form.sub"]}</p>
              <div className="mt-3.5 sm:mt-4 lg:mt-3">
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
                        data-launch-perk
                        className="flex items-center gap-2 rounded-xl border border-[rgb(var(--glass-border)/0.14)] bg-[rgb(var(--surface)/0.55)] px-2.5 py-2 sm:gap-2.5 sm:px-3 sm:py-2.5">
                        <span aria-hidden className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-9 sm:w-9",
                          i === 1
                            ? "bg-[rgb(var(--violet)/0.18)] text-[rgb(var(--violet))]"
                            : "bg-[rgb(var(--accent)/0.16)] text-accent",
                        )}>
                          <Icon className="h-[15px] w-[15px] sm:h-4 sm:w-4" />
                        </span>
                        {/* ONE LINE BESIDE THE ICON ON A PHONE.
                            The two halves are blocks from sm up — three narrow
                            columns there cannot hold "Darmowe kredyty na start"
                            on one line — but below sm the row is full width and
                            has room, so they are plain inline spans with a
                            space between them and wrapping switched off. The
                            size follows the viewport so the longest of the
                            three still fits at 320px without being clipped. */}
                        <span data-launch-perk-text
                          className="min-w-0 whitespace-nowrap leading-[1.3] sm:whitespace-normal">
                          <span className="text-[clamp(11.5px,3.4vw,13px)] font-semibold text-ink sm:block sm:text-[13px]">{p.t}</span>{" "}
                          <span className="text-[clamp(10.5px,3.1vw,12px)] text-muted sm:block sm:text-[12px]">{p.b}</span>
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
        <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-1.5 text-center text-[11.5px] text-faint lg:pb-1 lg:pt-0">
          <span>GrovBase © {new Date().getFullYear()} · {rightsLabel}</span>
          <span aria-hidden className="hidden sm:inline">·</span>
          <Link href="/polityka-prywatnosci" className="transition-colors hover:text-ink">{privacyLabel}</Link>
          <Link href="/regulamin" className="transition-colors hover:text-ink">{termsLabel}</Link>
        </footer>
      </div>
    </main>
  );
}
