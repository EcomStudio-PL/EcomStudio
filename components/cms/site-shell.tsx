import Link from "next/link";
import { Brand } from "@/components/layout/brand";
import { AuthLink } from "@/components/auth/auth-link";
import { lt, type CmsBlockContent, type CmsItem } from "@/lib/cms";
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
 * appears on all seven of them rather than in ten hardcoded places.
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

/** The legal minimum: who is selling, and the two documents that must be one
 *  click away from anything that takes money. */
export function MinimalFooter({ t }: { t: CmsT }) {
  return (
    <footer data-chrome="minimal" className="mt-auto border-t border-line bg-sunken/40">
      <div className="mx-auto flex w-full max-w-[88rem] flex-wrap items-center justify-between gap-3 px-[var(--page-x,1rem)] py-6 text-[12px] text-muted">
        <span>© {new Date().getFullYear()} GrovBase</span>
        <span className="flex flex-wrap gap-4">
          <Link href="/regulamin" className="tap transition-colors hover:text-ink">{t("launch.terms")}</Link>
          <Link href="/polityka-prywatnosci" className="tap transition-colors hover:text-ink">{t("launch.privacyPage")}</Link>
        </span>
      </div>
    </footer>
  );
}

/* ── FOOTER ──────────────────────────────────────────────────────────────── */

/** The groups a footer link may belong to, in the order they are printed.
 *  A link with an unknown group falls into "company", so a mistyped value is
 *  a misplaced link rather than an invisible one. */
const FOOTER_GROUPS = ["product", "tools", "company", "help", "legal"] as const;
type FooterGroup = (typeof FOOTER_GROUPS)[number];

const groupOf = (value: string | undefined): FooterGroup =>
  (FOOTER_GROUPS as readonly string[]).includes(value ?? "") ? (value as FooterGroup) : "company";

export function SiteFooter({ global, nav, site, locale, t }: ShellProps) {
  const content: CmsBlockContent = global.footer?.content ?? {};
  const tagline = lt(content.description, locale);

  // Two sources, one list: links typed into the global footer, plus every
  // published page that named a footer group. Nothing is hardcoded here.
  const authored: { label: string; url: string; group: FooterGroup }[] = (content.items ?? [])
    .map((it: CmsItem) => ({
      label: lt(it.title, locale),
      url: href(it.url) ?? "",
      group: groupOf(it.value),
    }))
    .filter((l) => l.label && l.url);
  const fromPages = nav
    .filter((p) => p.navGroup && p.navGroup !== "main")
    .map((p) => ({ label: p.title, url: `/${p.slug}`, group: groupOf(p.navGroup ?? undefined) }));
  const all = [...authored, ...fromPages];

  const socials = [
    { url: site.instagramUrl, Icon: InstagramIcon, name: "Instagram" },
    { url: site.facebookUrl, Icon: FacebookIcon, name: "Facebook" },
    { url: site.linkedinUrl, Icon: LinkedinIcon, name: "LinkedIn" },
    { url: site.xUrl, Icon: XIcon, name: "X" },
  ].filter((s) => s.url);

  return (
    <footer className="mt-auto border-t border-line bg-sunken/40">
      <div className="mx-auto w-full max-w-[88rem] px-[var(--page-x,1rem)] py-12">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.3fr)_repeat(2,minmax(0,1fr))] lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
          <div>
            <Brand href="/" height={26} />
            {tagline && <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-muted">{tagline}</p>}
            {socials.length > 0 && (
              <div className="mt-5 flex gap-2">
                {socials.map(({ url, Icon, name }) => (
                  <a key={name} href={url} target="_blank" rel="noopener noreferrer" aria-label={name}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-line text-muted transition-colors hover:border-accent/40 hover:text-accent">
                    <Icon size={16} />
                  </a>
                ))}
              </div>
            )}
          </div>

          {FOOTER_GROUPS.map((group) => {
            const links = all.filter((l) => l.group === group);
            if (links.length === 0) return null;
            return (
              <nav key={group} aria-label={t(`cms.footerGroup.${group}`)}>
                <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                  {t(`cms.footerGroup.${group}`)}
                </h2>
                <ul className="mt-3.5 space-y-2.5">
                  {links.map((l) => (
                    <li key={`${group}-${l.url}`}>
                      <Link href={l.url} className="tap text-[13.5px] text-muted transition-colors hover:text-ink">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            );
          })}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-[12px] text-muted">
          <span>© {new Date().getFullYear()} GrovBase</span>
          <span className="flex flex-wrap gap-4">
            <Link href="/regulamin" className="tap transition-colors hover:text-ink">{t("launch.terms")}</Link>
            <Link href="/polityka-prywatnosci" className="tap transition-colors hover:text-ink">{t("launch.privacyPage")}</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
