import Link from "next/link";
import { ArrowUp } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { AuthLink } from "@/components/auth/auth-link";
import { FOOTER_GROUPS, lt, type CmsBlockContent, type CmsItem, type FooterGroup } from "@/lib/cms";
import type { GlobalSections, NavPage, PublicSite } from "@/lib/server/public-site";
import {
  InstagramIcon, FacebookIcon, LinkedinIcon, XIcon,
} from "@/components/launch/social-icons";
import { MobileNav } from "./mobile-nav";
import type { CmsT } from "./blocks";

/**
 * THE FRAME AROUND EVERY PUBLIC PAGE.
 *
 * Header, announcement bar and footer are edited once in Admin → CMS →
 * Sekcje globalne and shared by every page, so a link added to the footer
 * appears on all of them rather than in ten hardcoded places. The footer also
 * closes the premiere page and the public cennik (/plany).
 *
 * TWO LAYOUTS, DELIBERATELY SEPARATE. This is the PUBLIC site's chrome. The
 * signed-in dashboard and the admin panel have their own layouts and do not
 * import anything from this file — a CMS edit can change what a visitor sees
 * and can never change what a customer sees inside the product.
 *
 * The CTAs use the app's existing auth entry (AuthLink opens the dialog that
 * /login and /register already use). There is no second sign-up flow here.
 */

export type ShellProps = {
  global: GlobalSections;
  nav: NavPage[];
  site: PublicSite;
  locale: string;
  t: CmsT;
  /** Pre-launch hides the auth entry entirely; the switch already exists. */
  showAuth: boolean;
  /** A signed-in visitor is offered the app, not a sign-up. */
  signedIn: boolean;
};

const href = (value: string | undefined): string | null => {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (v.startsWith("/") || v.startsWith("#")) return v;
  return /^https:\/\//i.test(v) ? v : null;
};

/* ── ANNOUNCEMENT BAR ────────────────────────────────────────────────────── */

export function AnnouncementBar({ global, locale }: { global: GlobalSections; locale: string }) {
  const bar = global.announcement;
  if (!bar?.visible) return null;
  const text = lt(bar.content.title, locale);
  if (!text) return null;
  const link = href(bar.content.ctaUrl);
  const label = lt(bar.content.ctaLabel, locale);
  return (
    <div className="brand-gradient px-4 py-2 text-center text-[12.5px] font-medium text-white">
      <span>{text}</span>
      {link && label && (
        <Link href={link} className="ml-2 underline underline-offset-2 hover:opacity-90">{label}</Link>
      )}
    </div>
  );
}

/* ── HEADER ──────────────────────────────────────────────────────────────── */

export function SiteHeader({ global, nav, locale, t, showAuth, signedIn }: ShellProps) {
  const content: CmsBlockContent = global.header?.content ?? {};
  // Links typed into the global header win; otherwise the published pages
  // that asked to be in the main menu are the menu.
  const authored = (content.items ?? [])
    .map((it) => ({ label: lt(it.title, locale), url: href(it.url) }))
    .filter((l): l is { label: string; url: string } => Boolean(l.label && l.url));
  const links = authored.length > 0
    ? authored
    : nav.filter((p) => p.navGroup === "main").map((p) => ({ label: p.title, url: `/${p.slug}` }));

  const ctaLabel = lt(content.ctaLabel, locale);
  const ctaUrl = href(content.ctaUrl);

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-[60px] w-full max-w-[88rem] items-center gap-3 px-[var(--page-x,1rem)] sm:h-[68px]">
        <div className="shrink-0">
          <span className="sm:hidden"><Brand href="/" markOnly /></span>
          <span className="hidden sm:block"><Brand href="/" /></span>
        </div>

        <nav aria-label={t("cms.navMain")} className="ml-6 hidden items-center gap-6 lg:flex">
          {links.map((l) => (
            <Link key={l.url} href={l.url}
              className="text-[14px] font-medium text-muted transition-colors hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {signedIn ? (
            <Link href="/dashboard"
              className="brand-gradient whitespace-nowrap rounded-xl px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
              {t("landing.openApp")}
            </Link>
          ) : showAuth ? (
            <>
              <AuthLink mode="login"
                className="hidden whitespace-nowrap rounded-xl px-3 py-2.5 text-[13.5px] font-medium text-muted transition-colors hover:text-ink sm:inline-flex">
                {t("landing.ctaLogin")}
              </AuthLink>
              {ctaUrl && ctaLabel ? (
                <Link href={ctaUrl}
                  className="brand-gradient whitespace-nowrap rounded-xl px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
                  {ctaLabel}
                </Link>
              ) : (
                <AuthLink mode="register"
                  className="brand-gradient whitespace-nowrap rounded-xl px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
                  {t("landing.cta")}
                </AuthLink>
              )}
            </>
          ) : null}
          {links.length > 0 && (
            <MobileNav links={links} label={t("cms.navMain")} className="lg:hidden" />
          )}
        </div>
      </div>
    </header>
  );
}

/* ── MINIMAL CHROME ──────────────────────────────────────────────────────── */

/**
 * WHAT A CAMPAIGN LANDING WEARS.
 *
 * The brand, and nothing that carries the visitor somewhere else. This is not
 * a second header: it is the same `header_mode` switch as `none`, one notch
 * up — the logo stays so the page still says whose offer it is, the menu and
 * the auth entry go, because every one of those links leaves the offer.
 */
export function MinimalHeader() {
  return (
    <header data-chrome="minimal"
      className="border-b border-line/70 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-[60px] w-full max-w-[88rem] items-center px-[var(--page-x,1rem)] sm:h-[68px]">
        <Brand />
      </div>
    </header>
  );
}

/** The legal minimum: who is selling, and the documents that must be one
 *  click away from anything that takes money (the cookie policy with them). */
export function MinimalFooter({ t }: { t: CmsT }) {
  return (
    <footer data-chrome="minimal" className="mt-auto border-t border-line bg-sunken/40">
      <div className="mx-auto flex w-full max-w-[88rem] flex-wrap items-center justify-between gap-3 px-[var(--page-x,1rem)] py-6 text-[12px] text-muted">
        <span>© {new Date().getFullYear()} GrovBase</span>
        <span className="flex flex-wrap gap-4">
          <Link href="/regulamin" className="tap transition-colors hover:text-ink">{t("launch.terms")}</Link>
          <Link href="/polityka-prywatnosci" className="tap transition-colors hover:text-ink">{t("launch.privacyPage")}</Link>
          <Link href="/polityka-cookies" className="tap transition-colors hover:text-ink">{t("legal.cookiesShort")}</Link>
        </span>
      </div>
    </footer>
  );
}

/* ── FOOTER ──────────────────────────────────────────────────────────────── */

/** A link with an unknown group falls into "company", so a mistyped value is
 *  a misplaced link rather than an invisible one (FOOTER_GROUPS, lib/cms.ts). */
const groupOf = (value: string | undefined): FooterGroup =>
  (FOOTER_GROUPS as readonly string[]).includes(value ?? "") ? (value as FooterGroup) : "company";

/** The footer's hairline, from the theme's own token rather than `border-line`:
 *  the same footer closes the always-dark premiere page, where a visitor on a
 *  light theme would otherwise get the light ramp's full-strength lilac. */
const HAIRLINE = "border-[rgb(var(--hairline)/var(--hairline-alpha))]";

export type FooterLink = { label: string; url: string; group: FooterGroup };

/**
 * EVERY LINK THE FOOTER PRINTS, IN ONE LIST — exported for the tests.
 *
 * Three sources, in order of authority: links typed into Sekcje globalne →
 * Stopka, the three legal documents (they are routes, not CMS menu entries,
 * and have been one click away from every public page since before the CMS),
 * and every published page that named a footer group. One address appears
 * once: the first source that names it wins, so an admin who types "O nas"
 * with its English and German label replaces the page list's Polish-only
 * title rather than standing next to it.
 */
export function footerLinks(content: CmsBlockContent, nav: NavPage[], locale: string, t: CmsT): FooterLink[] {
  const authored: FooterLink[] = (content.items ?? [])
    .map((it: CmsItem) => ({
      label: lt(it.title, locale),
      url: href(it.url) ?? "",
      group: groupOf(it.value),
    }))
    .filter((l) => l.label && l.url);
  const legal: FooterLink[] = [
    { label: t("launch.terms"), url: "/regulamin", group: "legal" },
    { label: t("launch.privacyPage"), url: "/polityka-prywatnosci", group: "legal" },
    { label: t("legal.cookiesShort"), url: "/polityka-cookies", group: "legal" },
  ];
  const fromPages: FooterLink[] = nav
    .filter((p) => p.navGroup && p.navGroup !== "main")
    .map((p) => ({ label: p.title, url: `/${p.slug}`, group: groupOf(p.navGroup ?? undefined) }));
  const seen = new Set<string>();
  return [...authored, ...legal, ...fromPages].filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}

/**
 * THE FOOTER OF THE PUBLIC SITE — every CMS page, the legal documents, the
 * premiere page and the public cennik print this one.
 *
 * Brand column (logo, the tagline, the social profiles that are actually
 * configured), then one column per group that has links — on the live site
 * "GrovBase" (O nas, Kontakt, Cennik) and "Informacje" (the documents) —
 * then a bottom bar: the year, the brand line, the language switch and a way
 * back to the top. Every word is either typed in Sekcje globalne or comes
 * from the dictionary; a column heading typed there wins over the default.
 *
 * `forceDark` is the premiere page's: it is dark at every theme setting, so
 * the logo has to be the on-dark one there whatever the visitor chose.
 */
export function SiteFooter({ global, nav, site, locale, t, forceDark = false }:
  Pick<ShellProps, "global" | "nav" | "site" | "locale" | "t"> & { forceDark?: boolean }) {
  const content: CmsBlockContent = global.footer?.content ?? {};
  const tagline = lt(content.description, locale);
  const brandLine = lt(content.subtitle, locale);
  const heading = (group: FooterGroup) =>
    lt(content.fields?.[`group.${group}`], locale) || t(`cms.footerGroup.${group}`);

  const all = footerLinks(content, nav, locale, t);
  const groups = FOOTER_GROUPS
    .map((group) => ({ group, links: all.filter((l) => l.group === group) }))
    .filter((g) => g.links.length > 0);

  const socials = [
    { url: site.instagramUrl, Icon: InstagramIcon, name: "Instagram" },
    { url: site.facebookUrl, Icon: FacebookIcon, name: "Facebook" },
    { url: site.linkedinUrl, Icon: LinkedinIcon, name: "LinkedIn" },
    { url: site.xUrl, Icon: XIcon, name: "X" },
  ].filter((s) => s.url);

  return (
    <footer data-site-footer className={`relative mt-auto overflow-hidden border-t ${HAIRLINE} bg-sunken/40`}>
      {/* A lit edge and a low glow: the brand's magenta, kept to the seam. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgb(var(--accent)/0.45),transparent)]" />
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-40 w-full max-w-[52rem] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,rgb(var(--accent)/0.12),transparent)]" />

      <div className="relative mx-auto w-full max-w-[88rem] px-[var(--page-x,1rem)] pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-12 sm:pt-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,2fr)] lg:gap-16">
          <div className="max-w-sm">
            <Brand href="/" height={28} forceDark={forceDark} />
            {tagline && <p className="mt-4 text-[13.5px] leading-relaxed text-muted">{tagline}</p>}
            {socials.length > 0 && (
              <ul className="mt-5 flex gap-2" aria-label={t("cms.footerSocial")}>
                {socials.map(({ url, Icon, name }) => (
                  <li key={name}>
                    <a href={url} target="_blank" rel="noopener noreferrer" aria-label={name}
                      className={`flex h-10 w-10 items-center justify-center rounded-xl border ${HAIRLINE} bg-surface/50 text-muted transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50`}>
                      <Icon size={16} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {groups.length > 0 && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-9 sm:grid-cols-[repeat(var(--footer-cols),minmax(0,1fr))]"
              style={{ "--footer-cols": String(Math.min(groups.length, 4)) } as React.CSSProperties}>
              {groups.map(({ group, links }) => (
                <nav key={group} aria-label={heading(group)} data-footer-group={group}>
                  <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-faint">{heading(group)}</h2>
                  <ul className="mt-4 space-y-3">
                    {links.map((l) => (
                      <li key={`${group}-${l.url}`}>
                        <Link href={l.url}
                          className="tap rounded-md text-[14px] text-muted transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                          {l.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
          )}
        </div>

        <div className={`mt-12 flex flex-col gap-4 border-t ${HAIRLINE} pt-6 text-[12.5px] text-muted sm:flex-row sm:items-center sm:justify-between`}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>© {new Date().getFullYear()} GrovBase</span>
            {brandLine && (
              <>
                <span aria-hidden className="text-faint">·</span>
                <span>{brandLine}</span>
              </>
            )}
          </p>
          <div className="flex items-center gap-2.5">
            <span data-footer-locale><LocaleSwitcher align="right" side="top" /></span>
            {/* "#top" is the one fragment every browser scrolls to the top of
                the document for, with no element and no script behind it. */}
            <a href="#top"
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border ${HAIRLINE} px-3.5 text-[12.5px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50`}>
              <ArrowUp size={14} aria-hidden />
              {t("cms.backToTop")}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
