import Link from "next/link";
import Image from "next/image";
import { AuthLink } from "@/components/auth/auth-link";
import { BarChart3, Gift, Percent, Sparkles, Timer, Zap } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { WaitlistForm, type WaitlistSuccessCopy } from "@/components/launch/waitlist-form";
import { LaunchCountdown } from "@/components/launch/countdown";
import { GalleryPlaceholder, LaunchGallery } from "@/components/launch/gallery";
import { CostStrip, CreatorsTile } from "@/components/launch/sections";
import { StickyCta } from "@/components/launch/sticky-cta";
import { LaunchBeacon } from "@/components/launch/launch-beacon";
import { FacebookIcon, InstagramIcon, LinkedinIcon, XIcon } from "@/components/launch/social-icons";
import { cn } from "@/lib/utils";
import type { LaunchField } from "@/lib/server/launch-page";
import type { LaunchConsents } from "@/lib/server/prelaunch/public";
import type {
  LaunchCampaignView, LaunchGalleryView, LaunchPageOptions, LaunchPerk,
} from "@/lib/server/prelaunch/landing";
import type { WaitlistFieldConfig } from "@/lib/server/registration-config";

/**
 * PREMIERA GROVBASE — the pre-launch front door, now a LONG page.
 *
 * The first screen is the approved hero, unchanged in geometry: the artwork
 * bleeding off the right edge, the headline, the form card, the benefits
 * island closing the right column. Under it the page goes on to show the
 * product instead of describing it — three before/after galleries — then the
 * optional cost line and "who is behind it" tile, a final call to action with
 * the same form, the site's footer, and on a phone a sticky bar back to the form.
 *
 * NOTHING HERE DECIDES WHAT MAY BE PROMISED. Which offer line, which benefit
 * cards, whether a countdown runs, which galleries a visitor sees: all of it
 * arrives decided, as finished strings, from lib/server/prelaunch/landing.ts —
 * where an unapproved value hides its whole line instead of leaking as
 * "{credits}". This file is layout, and reads the section switches.
 *
 * Every word still comes from `content` (Strony WWW, then the shipped
 * translation), so this file holds no copy.
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
/** Icon per benefit card — by what the card IS, not by its position, since
 *  a hidden card must not shift the next one's icon. */
const PERK_ICONS: Record<LaunchPerk["key"], typeof Gift> = { credits: Gift, priceLock: Percent, earlyAccess: Timer };

/**
 * ONE PICTURE FOR EVERY VIEWPORT, AND ONE DOWNLOAD.
 *
 * The phone band and the desktop panel used to be two <Image priority>
 * elements toggled by CSS — two preloads, and on most devices two downloads
 * of the largest file on the page. It is one element now whose BOX moves:
 * below lg a band across the top (`--hero-top` / `--hero-art`, as before),
 * from lg a panel down the right edge at the artwork's own 1808:1152, so a
 * cover fit inside it crops nothing. `sizes` follows the box, so a phone gets
 * a phone-sized AVIF and a 1920 monitor the panel's width.
 */
const ART_SIZES = "(min-width: 1536px) 56vw, (min-width: 1280px) 61vw, (min-width: 1024px) 64vw, 100vw";

export function LaunchPage({
  content, signedIn, loginLabel, footer, social,
  waitlistFields, showAuthEntry, options, campaign, galleries, isAdmin, consents, serverNow, analytics,
}: {
  content: Record<LaunchField, string>;
  signedIn: boolean;
  loginLabel: string;
  /** "POKAŻ PRZYCISKI" from the access panel. Presentation only: hiding the
   *  entry point is not what closes the door — the routes do that. Someone
   *  already signed in always keeps their way back into the app. */
  showAuthEntry: boolean;
  /** The public site's footer (components/cms/site-shell.tsx SiteFooter) —
   *  the same one every CMS page, the documents and /plany close with, so the
   *  premiere page links O nas, Kontakt, Cennik and the documents like they do.
   *  It brings the language switch with it. */
  footer: React.ReactNode;
  /** Social profiles from the site settings; empty URLs render nothing. */
  social: { instagramUrl: string; facebookUrl: string; linkedinUrl: string; xUrl: string };
  /** Which optional fields the signup form asks for (/admin/settings/registration).
   *  Only the first name is ever asked here, and never as required. */
  waitlistFields: WaitlistFieldConfig;
  /** Section switches and the creators photo (lib/launch/fields.ts). */
  options: LaunchPageOptions;
  /** The approved campaign, already resolved into lines (landing.ts). */
  campaign: LaunchCampaignView;
  /** The galleries a visitor sees — plus, for an admin, placeholders. */
  galleries: LaunchGalleryView[];
  /** An admin looking at the live page (not a ?preview render). */
  isAdmin: boolean;
  /** The two consent sentences exactly as the signup route records them. */
  consents: Pick<LaunchConsents, "terms" | "marketing">;
  /** The server's clock at render — the countdown runs on it. */
  serverNow: number;
  /** The traffic source for the page_view funnel event. */
  analytics: { trafficSource: string };
}) {
  const c = content;
  const shown = options.shown;
  const features = [
    { t: c["feature.1t"], b: c["feature.1b"] },
    { t: c["feature.2t"], b: c["feature.2b"] },
    { t: c["feature.3t"], b: c["feature.3b"] },
  ].filter((f) => f.t || f.b);
  const perks = shown.benefits ? campaign.perks : [];
  // The reward condition goes wherever a credits number is on the page: on the
  // credits card when the island shows one, otherwise under the offer line.
  const noteInIsland = perks.some((p) => p.key === "credits") ? campaign.rewardNote : null;
  const noteUnderOffer = !noteInIsland && campaign.offerShowsCredits ? campaign.rewardNote : null;
  const countdown = shown.countdown ? campaign.countdown : null;
  // Only profiles the admin actually configured. A social button that goes
  // nowhere is worse than a shorter row.
  const socials = [
    { key: "facebook", url: social.facebookUrl, Icon: FacebookIcon, label: "Facebook" },
    { key: "instagram", url: social.instagramUrl, Icon: InstagramIcon, label: "Instagram" },
    { key: "linkedin", url: social.linkedinUrl, Icon: LinkedinIcon, label: "LinkedIn" },
    { key: "x", url: social.xUrl, Icon: XIcon, label: "X" },
  ].filter((s) => Boolean(s.url));
  // An admin-uploaded image replaces the shipped artwork without a deploy.
  const art = c["hero.image"] || "/launch/hero-dino.webp";

  const formConsents = {
    terms: { parts: consents.terms.parts, version: consents.terms.version },
    marketing: { parts: consents.marketing.parts, version: consents.marketing.version },
  };
  const success: WaitlistSuccessCopy = {
    title: c["success.title"],
    body: c["success.body"],
    resend: c["success.resend"],
    resendHint: c["success.resendHint"],
    channel: shown.channel ? {
      question: c["channel.q"],
      labels: {
        allegro: c["channel.allegro"], amazon: c["channel.amazon"],
        own_store: c["channel.own"], multi: c["channel.multi"],
      },
      thanks: c["channel.thanks"],
    } : null,
    referral: shown.referral ? {
      title: c["ref.title"], body: campaign.referral.body, copy: c["ref.copy"], rewardNote: campaign.referral.rewardNote,
    } : null,
  };
  const cost = [c["cost.left"], c["cost.leftValue"], c["cost.right"], c["cost.rightValue"]];
  const showCost = shown.cost && cost.every((part) => part.trim().length > 0);
  const showCreators = shown.creators && c["creators.title"].trim().length > 0;
  const galleryLabels = { before: c["gallery.before"], after: c["gallery.after"] };

  // `--hero-top` and `--hero-art` — the two numbers the band, the header wash
  // and the content pad are all derived from — live in globals.css under
  // `[data-launch-page]`, not in a style attribute here: a tablet in portrait
  // needs different ones, and an inline style is the one declaration a media
  // query cannot reach.
  return (
    <main data-launch-page className="relative flex min-h-[100svh] flex-col overflow-x-clip">
      <LaunchBeacon trafficSource={analytics.trafficSource} />
      {/* ── THE ARTWORK ────────────────────────────────────────────────────
          Desktop: a panel down the RIGHT of the screen at the artwork's own
          aspect, so a cover fit crops nothing and the scene starts clear of
          the text column. Phones: the same file as a band at the top, sized
          off the width so its proportions never depend on the phone's
          height. One element, one download — see ART_SIZES. */}
      <div aria-hidden data-launch-art
        className="pointer-events-none absolute inset-x-0 top-[var(--hero-top)] h-[var(--hero-art)] lg:left-auto lg:top-0 lg:aspect-[1808/1152] lg:h-auto lg:w-[64%] xl:w-[61%] 2xl:w-[56%]">
        <Image src={art} alt="" fill priority fetchPriority="high" sizes={ART_SIZES}
          className="object-cover object-[6%_center] md:object-[6%_12%] lg:object-center" />
        {/* Phone band: top AND bottom fade — it does not start at the screen
            edge, so its upper edge would otherwise be a seam across the page. */}
        <span className="absolute inset-0 bg-[linear-gradient(180deg,rgb(var(--bg))_0%,rgb(var(--bg)/0.55)_7%,transparent_22%,rgb(var(--bg)/0.30)_56%,rgb(var(--bg)/0.86)_84%,rgb(var(--bg))_100%)] lg:hidden" />
        {/* Desktop panel: only its own left edge fades, clearing before the
            pixel dinosaur, and the lit floor gets a real landing. */}
        <span className="absolute inset-0 hidden bg-[linear-gradient(90deg,rgb(var(--bg))_0%,rgb(var(--bg)/0.86)_5%,rgb(var(--bg)/0.42)_11%,rgb(var(--bg)/0.12)_17%,transparent_24%)] lg:block" />
        <span className="absolute inset-x-0 bottom-0 hidden h-2/5 bg-[linear-gradient(0deg,rgb(var(--bg))_0%,rgb(var(--bg)/0.72)_34%,transparent_100%)] lg:block" />
      </div>

      {/* THE HEADER'S OWN GROUND on phones — a wash from the page background
          into the artwork, with a little of the scene's magenta on the side
          the portal lights. */}
      <span aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[calc(var(--hero-top)+5rem)] lg:hidden"
        style={{
          background:
            "radial-gradient(90% 130% at 82% -10%, rgb(var(--accent) / 0.20), transparent 68%),"
            + "linear-gradient(180deg, rgb(var(--bg)) 0%, rgb(var(--bg)/0.88) 38%, rgb(var(--bg)/0.42) 68%, transparent 100%)",
        }} />

      <div className="relative mx-auto flex w-full max-w-[1360px] flex-1 flex-col px-5 sm:px-8 lg:px-[clamp(48px,5vw,90px)] xl:max-w-[1760px]">
        {/* ── THE FIRST SCREEN ─────────────────────────────────────────────
            From lg it is exactly one viewport tall, like the page it grew out
            of: the header, then the two columns centred in what is left, the
            benefits island bottom-aligned with the form. Below lg it is as
            tall as its content, and the next section simply follows. */}
        <div data-launch-hero className="relative flex flex-col lg:min-h-[100svh]">
          {/* ── HEADER ─────────────────────────────────────────────────────
              Out of the flow on phones, laid over the artwork, so the content
              below is positioned from the top of the page. */}
          <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 pb-4 pt-[calc(1.15rem+env(safe-area-inset-top))] lg:static lg:py-2 min-[1400px]:py-[clamp(12px,min(1.3vw,1.33vh),30px)]">
            <Brand href="/" height={30} forceDark imgClassName="min-[1400px]:!h-[clamp(32px,min(2.1vw,3.56vh),44px)] min-[1400px]:!w-auto" />
            <div className="flex items-center gap-2.5 lg:gap-[clamp(10px,1vw,18px)]">
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
              {/* The sign-in entry steps aside for the follow row on desktop
                  only when there IS a follow row; the dialog opens over this
                  page rather than navigating. */}
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

          <div className="flex flex-1 flex-col lg:justify-center">
            {/* The phone column starts ABOVE the artwork's bottom edge — the
                badge sits on the photograph — and the tablet overlaps a little
                deeper; the pad is derived from the band's own numbers and the
                overlap (`--hero-overlap`, globals.css) from the screen's. */}
            <div className="grid flex-1 items-center gap-5 pb-5 pt-[calc(var(--hero-top)+var(--hero-art)-var(--hero-overlap))] sm:gap-6 lg:flex-none lg:grid-cols-[minmax(0,clamp(455px,34vw,640px))_minmax(0,1fr)] lg:items-end lg:gap-[clamp(40px,3.6vw,76px)] lg:pb-[clamp(16px,2.4vh,40px)] lg:pt-0">
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
                <p className="mt-2.5 max-w-md whitespace-pre-line text-[13.5px] leading-[1.45] text-muted sm:mt-3 sm:text-[14.5px] sm:leading-[1.5] xl:text-[15px] lg:max-w-[42ch] min-[1400px]:mt-[clamp(14px,min(1.1vw,1.56vh),24px)] min-[1400px]:text-[clamp(16px,min(1.22vw,1.78vh),19px)] min-[1400px]:leading-[1.55]">
                  {c["hero.sub"]}
                </p>
                {/* THE OFFER LINE — the first variant whose values are all
                    approved: date and credits, date only, credits only, or
                    neither. Absent only if an admin emptied all four. */}
                {campaign.offer && (
                  <p data-launch-offer
                    className="mt-2 max-w-md text-[13.5px] font-semibold leading-[1.45] text-ink sm:text-[14.5px] lg:max-w-[44ch] min-[1400px]:mt-[clamp(8px,min(0.7vw,1vh),16px)] min-[1400px]:text-[clamp(15px,min(1.15vw,1.7vh),18px)]">
                    {campaign.offer}
                  </p>
                )}
                {campaign.offer && noteUnderOffer && (
                  <p data-launch-reward-note
                    className="mt-1 max-w-md text-[11.5px] leading-relaxed text-muted lg:max-w-[44ch] lg:text-[clamp(11.5px,min(0.85vw,1.2vh),13.5px)]">
                    {noteUnderOffer}
                  </p>
                )}

                {/* Three across at EVERY width — a grid, never a wrapping flex
                    row, so a longer chip name wraps inside its own cell instead
                    of dropping the third chip to a second line. */}
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
                          <span className="min-w-0 leading-[1.3] sm:leading-[1.25]">
                            <span className="block text-[clamp(9.8px,2.75vw,11.5px)] font-semibold tracking-[-0.01em] text-ink sm:text-[11.5px] lg:text-[clamp(10px,min(0.66vw,1.11vh),13px)]">{f.t}</span>
                            {f.b && (
                              <span className="mt-0.5 block text-[clamp(8.8px,2.45vw,10.5px)] text-muted sm:mt-0 sm:text-[10.5px] lg:text-[clamp(9.5px,min(0.6vw,1.06vh),12px)]">{f.b}</span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* ── THE FORM ─────────────────────────────────────────── */}
                <div id="zapis" data-launch-form-card
                  className="glass relative mt-4 scroll-mt-6 rounded-2xl border-[rgb(var(--accent)/0.22)] p-4 sm:p-[18px] lg:mt-4 lg:rounded-2xl lg:p-[18px] min-[1400px]:mt-[clamp(18px,min(1.4vw,2.0vh),30px)] min-[1400px]:rounded-[clamp(20px,1.4vw,28px)] min-[1400px]:p-[clamp(21px,min(1.5vw,2.33vh),32px)]">
                  {/* The travelling light the auth dialog carries — CSS only,
                      and still for anyone who asked for reduced motion. */}
                  <span aria-hidden data-launch-form-orbit
                    className="orbit-ring"
                    style={{ "--orbit-speed": "7.5s", "--orbit-inset": "-1px" } as React.CSSProperties} />
                  <h2 className="relative font-display text-[17px] font-semibold tracking-tight lg:text-[clamp(18px,min(1.5vw,2.0vh),26px)]">
                    {c["form.title"]}
                  </h2>
                  {c["form.sub"] && (
                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted lg:mt-[clamp(4px,min(0.4vw,0.44vh),10px)] lg:text-[clamp(13px,min(1.02vw,1.44vh),17px)]">{c["form.sub"]}</p>
                  )}
                  {countdown && (
                    <LaunchCountdown size="sm" launchAtMs={countdown.launchAtMs} serverNow={serverNow}
                      iso={countdown.iso} label={countdown.label} dateLabel={countdown.dateLabel} />
                  )}
                  <div className="mt-3.5 sm:mt-4 lg:mt-3 min-[1400px]:mt-[clamp(16px,min(1.3vw,1.78vh),26px)]">
                    <WaitlistForm variant="hero" id="waitlist-hero"
                      placeholder={c["hero.placeholder"]} cta={c["hero.cta"]}
                      firstNameLabel={waitlistFields.firstName === "hidden" ? null : c["form.firstName"]}
                      consents={formConsents} safetyNote={c["form.safety"]} success={success} />
                  </div>
                </div>
              </div>

              {/* Right column: the artwork lives behind it, so only the
                  benefits island is real content here, bottom-aligned with
                  the form card. It is not rendered at all when no card is
                  approved — an empty island would be a promise of nothing. */}
              <div className="min-w-0 lg:self-end lg:pb-1">
                {perks.length > 0 && (
                  <div data-launch-perks
                    className="glass rounded-2xl p-4 sm:p-5 lg:rounded-[clamp(16px,1.4vw,28px)] lg:p-[clamp(18px,min(1.5vw,2.0vh),32px)]">
                    {c["perks.heading"] && (
                      <p className="text-center text-[12.5px] font-medium text-muted lg:text-[clamp(13px,min(1.02vw,1.44vh),17px)]">{c["perks.heading"]}</p>
                    )}
                    <ul className={cn(
                      "mt-3 grid gap-2.5 lg:mt-[clamp(12px,min(1.1vw,1.33vh),22px)] lg:gap-[clamp(10px,0.9vw,18px)]",
                      perks.length === 3 ? "sm:grid-cols-3" : perks.length === 2 ? "sm:grid-cols-2" : "",
                    )}>
                      {perks.map((p) => {
                        const Icon = PERK_ICONS[p.key];
                        return (
                          <li key={p.key} data-launch-perk={p.key}
                            // Icon over text on a tablet, beside it on a desktop:
                            // at 1024 the right column is ~427px and three tiles
                            // cannot spend 70px each on chrome without splitting
                            // a word in half.
                            className="flex items-center gap-2 rounded-xl border border-[rgb(var(--glass-border)/0.14)] bg-[rgb(var(--surface)/0.55)] px-2.5 py-2 sm:gap-2.5 sm:px-3 sm:py-2.5 lg:flex-col lg:gap-[clamp(8px,0.7vw,12px)] lg:rounded-[clamp(12px,1vw,18px)] lg:px-[clamp(10px,0.8vw,16px)] lg:py-[clamp(10px,min(0.9vw,1.11vh),18px)] lg:text-center xl:flex-row xl:gap-[clamp(10px,0.9vw,16px)] xl:px-[clamp(12px,1vw,20px)] xl:text-left">
                            <span aria-hidden className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-9 sm:w-9 lg:h-[clamp(36px,min(2.4vw,4.0vh),46px)] lg:w-[clamp(36px,min(2.4vw,4.0vh),46px)] lg:rounded-[clamp(12px,1vw,16px)]",
                              p.key === "priceLock"
                                ? "bg-[rgb(var(--violet)/0.18)] text-[rgb(var(--violet))]"
                                : "bg-[rgb(var(--accent)/0.16)] text-accent",
                            )}>
                              <Icon className="h-[15px] w-[15px] sm:h-4 sm:w-4 lg:h-[clamp(16px,min(1.15vw,1.78vh),22px)] lg:w-[clamp(16px,min(1.15vw,1.78vh),22px)]" />
                            </span>
                            <span data-launch-perk-text className="min-w-0 leading-[1.3]">
                              <span className="block text-[clamp(11.5px,3.4vw,13px)] font-semibold text-ink sm:text-[13px] lg:text-[clamp(13px,min(1.02vw,1.44vh),17px)]">{p.t}</span>
                              {p.b && (
                                <span className="block text-[clamp(10.5px,3.1vw,12px)] text-muted sm:text-[12px] lg:text-[clamp(12px,min(0.95vw,1.33vh),15px)]">{p.b}</span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {/* Credits arrive with an ACCOUNT on the same address, not
                        with the e-mail — said wherever a number is promised. */}
                    {noteInIsland && (
                      <p data-launch-reward-note className="mt-3 text-center text-[11.5px] leading-relaxed text-muted lg:text-[clamp(11.5px,min(0.85vw,1.2vh),13.5px)]">
                        {noteInIsland}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── THE PRODUCT, SHOWN ─────────────────────────────────────────── */}
        {galleries.length > 0 && (
          <div data-launch-galleries>
            {galleries.map((g) => (g.placeholder === null
              ? (
                <LaunchGallery key={g.key} galleryKey={g.key} eyebrow={g.eyebrow} title={g.title}
                  tiles={g.tiles} labels={galleryLabels} cta={c["gallery.cta"]} />
              )
              : isAdmin ? (
                <GalleryPlaceholder key={g.key} galleryKey={g.key} eyebrow={g.eyebrow} title={g.title} reason={g.placeholder} />
              ) : null))}
          </div>
        )}

        {showCost && (
          <CostStrip left={c["cost.left"]} leftValue={c["cost.leftValue"]} right={c["cost.right"]} rightValue={c["cost.rightValue"]} />
        )}

        {showCreators && (
          <CreatorsTile eyebrow={c["creators.eyebrow"]} title={c["creators.title"]} body={c["creators.body"]}
            signature={c["creators.signature"]} image={options.creatorsImage} />
        )}

        {/* ── THE LAST ASK ───────────────────────────────────────────────── */}
        {shown.final && (
          <section id="zapis-koniec" data-launch-final aria-labelledby="launch-final-title"
            className="glass relative mx-auto my-10 w-full max-w-2xl scroll-mt-6 rounded-3xl px-5 py-8 text-center sm:my-16 sm:px-10 sm:py-10 lg:rounded-[clamp(22px,1.6vw,32px)]">
            <span aria-hidden className="orbit-ring" style={{ "--orbit-speed": "9s" } as React.CSSProperties} />
            <h2 id="launch-final-title" className="relative font-display text-[1.6rem] font-semibold leading-[1.12] tracking-[-0.025em] text-ink sm:text-[2.1rem]">
              {c["final.title"]}
            </h2>
            {c["final.sub"] && <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{c["final.sub"]}</p>}
            {countdown && (
              <LaunchCountdown launchAtMs={countdown.launchAtMs} serverNow={serverNow}
                iso={countdown.iso} label={countdown.label} dateLabel={countdown.dateLabel} />
            )}
            <div className="mt-6 text-left">
              <WaitlistForm variant="final" id="waitlist-final"
                placeholder={c["hero.placeholder"]} cta={c["hero.cta"]}
                consents={formConsents} success={success} />
            </div>
          </section>
        )}

      </div>

      {/* ── FOOTER ─────────────────────────────────────────────────────────
          The site's own footer, full width under the page's column. Still
          [data-launch-footer]: the sticky bar steps aside while it is on
          screen, and the geometry probe stacks it after the last section. */}
      <div data-launch-footer className="mt-auto">
        {footer}
      </div>

      {shown.sticky && <StickyCta label={c["sticky.cta"]} />}
    </main>
  );
}
