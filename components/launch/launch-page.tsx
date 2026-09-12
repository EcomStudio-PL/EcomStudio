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

/** The sign-in entry's chrome, shared by the signed-in link and the dialog
 *  trigger so the two can never drift apart. */
const ENTRY_CLASS = "whitespace-nowrap rounded-xl border border-[rgb(var(--glass-border)/0.2)] bg-[rgb(var(--surface)/0.55)] px-3.5 py-2 text-[13px] font-semibold text-ink backdrop-blur-md transition-colors hover:border-[rgb(var(--accent)/0.45)] lg:rounded-[clamp(12px,1vw,16px)] lg:px-[clamp(14px,1.1vw,22px)] lg:py-[clamp(8px,min(0.7vw,0.89vh),14px)] lg:text-[clamp(13px,min(0.95vw,1.44vh),16px)]";

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

  // `--hero-top` and `--hero-art` — the two numbers the band, the header wash
  // and the content pad are all derived from — live in globals.css under
  // `[data-launch-page]`, not in a style attribute here. They have to differ on
  // a tablet in portrait, and an inline style is the one declaration a media
  // query cannot reach: it outranks every stylesheet rule. The phone values are
  // unchanged to the character.
  return (
    <main data-launch-page className="relative flex min-h-[100svh] flex-col overflow-x-clip">
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
        className="pointer-events-none absolute right-0 top-0 hidden lg:block lg:w-[64%] xl:w-[61%] 2xl:w-[56%]">
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

      {/* DESKTOP SCALES WITH THE SCREEN. Everything below lg is untouched;
          from lg up the container, the columns, the type and every card are
          sized in vw between a 1280 floor and a cap, because the layout used
          to FREEZE at 1280 — a 1920 monitor got a 1280 design marooned in the
          middle with 280px of dead margin either side, which is what made the
          page read as a shrunken phone rather than a landing page. */}
        <div className="relative mx-auto flex w-full max-w-[1360px] flex-1 flex-col px-5 sm:px-8 lg:px-[clamp(48px,5vw,90px)] xl:max-w-[1760px]">
        {/* ── HEADER ───────────────────────────────────────────────────────
            Lifted OUT of the flow on phones and laid over the artwork, so the
            content below is positioned from the top of the page rather than
            from wherever the notch happened to push the logo. That is what
            lets the badge overlap the photograph by a known amount. */}
        <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-5 pb-4 pt-[calc(1.15rem+env(safe-area-inset-top))] sm:px-8 lg:static lg:px-0 lg:py-2 min-[1400px]:py-[clamp(12px,min(1.3vw,1.33vh),30px)]">
          <Brand href="/" height={30} forceDark imgClassName="min-[1400px]:!h-[clamp(32px,min(2.1vw,3.56vh),44px)] min-[1400px]:!w-auto" />
          <div className="flex items-center gap-2.5 lg:gap-[clamp(10px,1vw,18px)]">
            {/* Phones hide the follow row: the logo, four icons and the login
                button do not fit 390px without crowding, and the success state
                offers the same links right after someone signs up. */}
            {socials.length > 0 && (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="hidden text-[12.5px] font-medium text-muted sm:inline lg:text-[clamp(12.5px,min(0.95vw,1.39vh),16px)]">
                  {c["social.heading"]}
                </span>
                <div className="flex items-center gap-1.5">
                  {socials.map(({ key, url, Icon, label }) => (
                    <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                      aria-label={label} data-launch-social={key}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-[rgb(var(--glass-border)/0.18)] bg-[rgb(var(--surface)/0.55)] text-muted backdrop-blur-md transition-colors hover:border-[rgb(var(--accent)/0.45)] hover:text-ink lg:h-[clamp(36px,min(2.5vw,4.0vh),48px)] lg:w-[clamp(36px,min(2.5vw,4.0vh),48px)] lg:rounded-[clamp(12px,1vw,16px)]">
                      <Icon className="h-[15px] w-[15px] lg:h-[clamp(15px,min(1.1vw,1.67vh),20px)] lg:w-[clamp(15px,min(1.1vw,1.67vh),20px)]" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {/* THE SIGN-IN ENTRY STEPS ASIDE FOR THE FOLLOW ROW ON DESKTOP.
                The reference composition puts "Śledź nas" and the social icons
                where this button sits, and two clusters in one corner is what
                made the header feel cramped — so from lg the button is dropped
                whenever there is a follow row to put there instead.

                It is NOT dropped unconditionally: the profile URLs live in
                /admin/www and are still unset, so an unconditional rule would
                ship a desktop header with an empty right-hand side and no way
                for an existing customer to sign in from the front page. When
                the URLs are filled in, this resolves to exactly the reference.
                Phones keep the button either way — the follow row is hidden
                below sm, and that layout is settled.

                The dialog opens over this page rather than navigating — a link
                to /login would server-redirect back to /?auth=login and the
                provider, living in the root layout, would never see the URL
                change. That is the bug where the button did nothing at all. */}
            {signedIn ? (
              <Link href="/dashboard" data-launch-login
                className={cn(ENTRY_CLASS, socials.length > 0 && "lg:hidden")}>
                {loginLabel}
              </Link>
            ) : showAuthEntry ? (
              <AuthLink mode="login" data-launch-login
                className={cn(ENTRY_CLASS, socials.length > 0 && "lg:hidden")}>
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
        {/* WHY THERE IS A WRAPPER HERE, AND WHY IT DOES NOTHING ON PHONES.
            The two desktop columns have to end on the SAME line — the benefit
            island's bottom edge is the form panel's bottom edge — and that has
            to come out of the layout, not out of a margin that happens to be
            right on one monitor. Bottom-aligning them is one property
            (`lg:items-end`), but it only means anything if the grid row is as
            tall as its content: while the grid itself was the flex child that
            absorbed the leftover height, its row was the whole window, "bottom
            of the row" was the bottom of the screen, and the column that was
            centred and the column that was bottom-aligned could never meet.
            So the leftover height moves up one level: the wrapper absorbs it
            and centres the pair, the grid is content-height, and the two
            columns end together at every width and every zoom.

            Below lg the wrapper is a plain flex column whose single child is
            `flex-1` — exactly the box the grid itself used to be, so the phone
            layout is geometrically unchanged. Every part of this that moves
            anything is behind `lg:`. */}
        <div className="flex flex-1 flex-col lg:justify-center">
        <div className="grid flex-1 items-center gap-5 pb-5 pt-[calc(var(--hero-top)+var(--hero-art)-2.6rem)] sm:gap-6 lg:flex-none lg:grid-cols-[minmax(0,clamp(455px,34vw,640px))_minmax(0,1fr)] lg:items-end lg:gap-[clamp(40px,3.6vw,76px)] lg:pb-0 lg:pt-0">
          <div className="min-w-0 lg:py-1">
            {c["hero.badge"] && (
              <p data-launch-badge
                className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--accent)/0.35)] bg-[rgb(var(--accent)/0.14)] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-accent shadow-[0_8px_24px_-12px_rgb(0_0_0/0.9)] backdrop-blur-md lg:gap-2 lg:px-[clamp(12px,1vw,18px)] lg:py-[clamp(6px,min(0.5vw,0.67vh),10px)] lg:text-[clamp(10.5px,min(0.72vw,1.17vh),13px)]">
                <Sparkles aria-hidden className="h-3 w-3 lg:h-[clamp(12px,min(0.9vw,1.33vh),16px)] lg:w-[clamp(12px,min(0.9vw,1.33vh),16px)]" />
                {c["hero.badge"]}
              </p>
            )}
            <h1 data-launch-h1
              className="mt-3 font-display text-[2.35rem] font-semibold leading-[0.97] tracking-[-0.035em] sm:mt-4 sm:text-[3.1rem] lg:mt-2 lg:text-[3rem] xl:text-[3.6rem] min-[1400px]:mt-[clamp(10px,min(0.9vw,1.11vh),20px)] min-[1400px]:text-[clamp(3.6rem,min(4.7vw,6.4vh),4.8rem)]">
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
            <p className="mt-2.5 max-w-md whitespace-pre-line text-[13.5px] leading-[1.45] text-muted sm:mt-3 sm:text-[14.5px] sm:leading-[1.5] xl:text-[15px] lg:max-w-[42ch] min-[1400px]:mt-[clamp(14px,min(1.1vw,1.56vh),24px)] min-[1400px]:text-[clamp(16px,min(1.22vw,1.78vh),19px)] min-[1400px]:leading-[1.55]">
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
                className="mt-3.5 grid grid-cols-3 gap-1.5 sm:mt-4 sm:gap-2 lg:mt-3 min-[1400px]:mt-[clamp(16px,min(1.3vw,1.78vh),28px)] min-[1400px]:gap-[clamp(9px,0.8vw,16px)]">
                {features.map((f, i) => {
                  const Icon = FEATURE_ICONS[i] ?? Sparkles;
                  return (
                    <li key={`${f.t}${f.b}`}
                      className="flex flex-col items-center gap-2 rounded-2xl border border-[rgb(var(--glass-border)/0.16)] bg-[rgb(var(--surface)/0.5)] px-1.5 py-2.5 text-center backdrop-blur-md sm:flex-row sm:items-center sm:gap-2 sm:rounded-xl sm:px-2.5 sm:py-2 sm:text-left min-[1400px]:gap-[clamp(9px,0.7vw,14px)] min-[1400px]:rounded-[clamp(12px,1vw,18px)] min-[1400px]:px-[clamp(11px,0.9vw,16px)] min-[1400px]:py-[clamp(9px,min(0.7vw,1.0vh),14px)]">
                      <span aria-hidden
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.16)] text-accent sm:h-7 sm:w-7 sm:rounded-lg min-[1400px]:h-[clamp(29px,min(1.9vw,3.22vh),38px)] min-[1400px]:w-[clamp(29px,min(1.9vw,3.22vh),38px)] min-[1400px]:rounded-[clamp(8px,0.7vw,12px)]">
                        <Icon className="h-3.5 w-3.5 min-[1400px]:h-[clamp(15px,min(1vw,1.67vh),19px)] min-[1400px]:w-[clamp(15px,min(1vw,1.67vh),19px)]" />
                      </span>
                      {/* The name is sized off the VIEWPORT, not fixed, so it
                          stays on one line from a 360px Android to a Pro Max
                          instead of snapping in half on the narrow ones. */}
                      <span className="min-w-0 leading-[1.3] sm:leading-[1.25]">
                        {/* The desktop column is a fixed 455px, so a chip cell there is ~146px
                            wide whatever the screen measures — the size that keeps the
                            longest name on one line inside it is ~10px, and that is what
                            lg gets. Between sm and lg the chips have the full width. */}
                        {/* The base clamp is the PHONE's, and it is settled —
                            it stays a pure vw ramp. Only the lg value is
                            height-aware, because only the desktop layout has
                            to survive a short, wide monitor. */}
                        <span className="block text-[clamp(9.8px,2.75vw,11.5px)] font-semibold tracking-[-0.01em] text-ink sm:text-[11.5px] lg:text-[clamp(10px,min(0.66vw,1.11vh),13px)]">{f.t}</span>
                        <span className="mt-0.5 block text-[clamp(8.8px,2.45vw,10.5px)] text-faint sm:mt-0 sm:text-[10.5px] lg:text-[clamp(9.5px,min(0.6vw,1.06vh),12px)]">{f.b}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* ── THE FORM ─────────────────────────────────────────────── */}
            <div data-launch-form-card
              className="glass relative mt-4 rounded-2xl border-[rgb(var(--accent)/0.22)] p-4 sm:p-[18px] lg:mt-4 lg:rounded-2xl lg:p-[18px] min-[1400px]:mt-[clamp(18px,min(1.4vw,2.0vh),30px)] min-[1400px]:rounded-[clamp(20px,1.4vw,28px)] min-[1400px]:p-[clamp(21px,min(1.5vw,2.33vh),32px)]">
              {/* The same travelling light the auth dialog carries, on the one
                  card this page is asking people to use. A little slower than
                  the dialog's: this card's perimeter is shorter, so at 6s the
                  arc crosses a corner noticeably faster. Decorative and
                  CSS-only, and it stops moving entirely for anyone who asked
                  for reduced motion — see .orbit-ring in globals.css. */}
              <span aria-hidden data-launch-form-orbit
                className="orbit-ring"
                style={{ "--orbit-speed": "7.5s", "--orbit-inset": "-1px" } as React.CSSProperties} />
              <p className="relative font-display text-[17px] font-semibold tracking-tight lg:text-[clamp(18px,min(1.5vw,2.0vh),26px)]">
                {c["form.title"]}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted lg:mt-[clamp(4px,min(0.4vw,0.44vh),10px)] lg:text-[clamp(13px,min(1.02vw,1.44vh),17px)]">{c["form.sub"]}</p>
              <div className="mt-3.5 sm:mt-4 lg:mt-3 min-[1400px]:mt-[clamp(16px,min(1.3vw,1.78vh),26px)]">
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
                className="glass rounded-2xl p-4 sm:p-5 lg:rounded-[clamp(16px,1.4vw,28px)] lg:p-[clamp(18px,min(1.5vw,2.0vh),32px)]">
                <p className="text-center text-[12.5px] font-medium text-muted lg:text-[clamp(13px,min(1.02vw,1.44vh),17px)]">{c["perks.heading"]}</p>
                <ul className="mt-3 grid gap-2.5 sm:grid-cols-3 lg:mt-[clamp(12px,min(1.1vw,1.33vh),22px)] lg:gap-[clamp(10px,0.9vw,18px)]">
                  {perks.map((p, i) => {
                    const Icon = PERK_ICONS[i] ?? Gift;
                    return (
                      <li key={`${p.t}${p.b}`}
                        data-launch-perk
                        // ICON OVER TEXT ON A TABLET, ICON BESIDE TEXT ON A DESKTOP.
                        // The two-column composition starts at lg, but the right
                        // column does not get wide until xl: at 1024 it is 427px,
                        // three tiles are about 124px each, and the icon and the
                        // padding take 70 of them. Seventy per cent of a tile spent
                        // on chrome is how "Darmowe kredyty" came out broken as
                        // "Darmo / we / kredyty" — a word split down the middle,
                        // which is the one thing a benefit card must never do.
                        // Dropping the icon onto its own line hands the words the
                        // whole tile and keeps all three across, so the composition
                        // is the reference's at every width; from xl the column is
                        // wide enough that the row reads better and comes back.
                        className="flex items-center gap-2 rounded-xl border border-[rgb(var(--glass-border)/0.14)] bg-[rgb(var(--surface)/0.55)] px-2.5 py-2 sm:gap-2.5 sm:px-3 sm:py-2.5 lg:flex-col lg:gap-[clamp(8px,0.7vw,12px)] lg:rounded-[clamp(12px,1vw,18px)] lg:px-[clamp(10px,0.8vw,16px)] lg:py-[clamp(10px,min(0.9vw,1.11vh),18px)] lg:text-center xl:flex-row xl:gap-[clamp(10px,0.9vw,16px)] xl:px-[clamp(12px,1vw,20px)] xl:text-left">
                        <span aria-hidden className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-9 sm:w-9 lg:h-[clamp(36px,min(2.4vw,4.0vh),46px)] lg:w-[clamp(36px,min(2.4vw,4.0vh),46px)] lg:rounded-[clamp(12px,1vw,16px)]",
                          i === 1
                            ? "bg-[rgb(var(--violet)/0.18)] text-[rgb(var(--violet))]"
                            : "bg-[rgb(var(--accent)/0.16)] text-accent",
                        )}>
                          <Icon className="h-[15px] w-[15px] sm:h-4 sm:w-4 lg:h-[clamp(16px,min(1.15vw,1.78vh),22px)] lg:w-[clamp(16px,min(1.15vw,1.78vh),22px)]" />
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
                          {/* Same rule as the feature chips: the phone's clamp
                              is a pure vw ramp and is not to be touched. */}
                          <span className="text-[clamp(11.5px,3.4vw,13px)] font-semibold text-ink sm:block sm:text-[13px] lg:text-[clamp(13px,min(1.02vw,1.44vh),17px)]">{p.t}</span>{" "}
                          <span className="text-[clamp(10.5px,3.1vw,12px)] text-muted sm:block sm:text-[12px] lg:text-[clamp(12px,min(0.95vw,1.33vh),15px)]">{p.b}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
        </div>

        {/* ── FOOTER ───────────────────────────────────────────────────────
            One line. A pre-launch page has nothing to put in columns. */}
        <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-1.5 text-center text-[11.5px] text-faint lg:pb-1 lg:pt-0 min-[1400px]:gap-x-[clamp(14px,1vw,20px)] min-[1400px]:pb-[clamp(12px,min(1vw,1.33vh),24px)] min-[1400px]:pt-[clamp(8px,min(0.6vw,0.89vh),16px)] min-[1400px]:text-[clamp(12px,min(0.88vw,1.33vh),14px)]">
          <span>GrovBase © {new Date().getFullYear()} · {rightsLabel}</span>
          <span aria-hidden className="hidden sm:inline">·</span>
          <Link href="/polityka-prywatnosci" className="tap transition-colors hover:text-ink">{privacyLabel}</Link>
          <Link href="/regulamin" className="tap transition-colors hover:text-ink">{termsLabel}</Link>
        </footer>
      </div>
    </main>
  );
}
