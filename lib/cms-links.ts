/**
 * WHERE A BUTTON ON A PAGE CAN GO.
 *
 * Every CTA in the builder used to be an empty text box, which meant every
 * CTA was a chance to type `/cennk` and find out three weeks later. The
 * destinations a page can actually point at are knowable — the pages that
 * exist, the anchors on the page being edited, and a short list of the app's
 * own public entrances — so they are offered instead of remembered.
 *
 * IT STAYS A TEXT BOX. The suggestions are a datalist, not a dropdown: an
 * admin still types an external https:// address, a UTM-tagged link or a
 * `mailto:` without fighting a picker that only knows about internal pages.
 *
 * THE LIST IS BUILT FROM WHAT EXISTS, never from a hardcoded sitemap that
 * drifts. The app links below are the four routes that are genuinely public;
 * everything else a visitor can reach is a CMS page and arrives through
 * `pages`.
 */

export type LinkTarget = {
  /** What is written into the field. */
  value: string;
  /** What the admin reads next to it — a page title, or a section name. */
  label: string;
};

/** Public routes that are not CMS pages. `/` is here because the homepage is
 *  served by a switch and may be a launch page rather than a `home` row. */
export const APP_LINKS: readonly { path: string; key: string }[] = [
  { path: "/", key: "home" },
  { path: "/register", key: "register" },
  { path: "/login", key: "login" },
];

export type LinkPage = { slug: string; title: string; status: string; kind?: string };

/* ── WHERE A PAGE LIVES ────────────────────────────────────────────────── */

export type Addressable = {
  slug: string;
  status: string;
  kind?: string;
  /** The single page that answers "/" (cms_pages.is_homepage). */
  isHomepage?: boolean;
  scheduledAt?: string | null;
};

/** Published, or scheduled for a moment that has already passed — the same
 *  rule lib/server/public-site.ts enforces on the read. */
export function pageIsLive(page: Addressable, now: number = Date.now()): boolean {
  if (page.status === "published") return true;
  if (page.status !== "scheduled") return false;
  const at = page.scheduledAt ? Date.parse(page.scheduledAt) : NaN;
  return Number.isFinite(at) && now >= at;
}

/**
 * THE ADDRESS A VISITOR WOULD TYPE, or null when the page has none.
 *
 * ONE FUNCTION, because two of them drifted. The page list and the builder each
 * decided this for themselves, and each decided it slightly differently — the
 * list printed "/" for any launch page whether or not it was live, while the
 * builder linked "Podgląd" at a draft route and called it the public page.
 *
 * Two pages never have an address of their own:
 *   a launch page, which only ever answers "/" and has no /premiera URL
 *   `home`, whose slug is the SIGNED-IN dashboard route, so the CMS never
 *          serves it and printing "/home" would be a link to someone else's page
 */
export function publicPathFor(page: Addressable, now: number = Date.now()): string | null {
  if (page.isHomepage && pageIsLive(page, now)) return "/";
  if (page.kind === "launch" || page.slug === "home") return null;
  return pageIsLive(page, now) ? `/${page.slug}` : null;
}

export function buildLinkTargets(
  pages: readonly LinkPage[],
  anchors: readonly { anchor: string; label: string }[],
  t: (key: string) => string,
): LinkTarget[] {
  const out: LinkTarget[] = APP_LINKS.map((l) => ({
    value: l.path,
    label: t(`cms.link.${l.key}`),
  }));

  for (const page of pages) {
    // The launch page answers "/" through the homepage switch and has no URL
    // of its own, so offering `/premiera` would offer a 404.
    if (page.kind === "launch") continue;
    const path = page.slug === "home" ? "/" : `/${page.slug}`;
    if (out.some((o) => o.value === path)) continue;
    out.push({
      value: path,
      // A draft is a real destination the moment it is published, and hiding
      // it would make the picker useless while a campaign is being built —
      // so it is offered, and marked.
      label: page.status === "published" ? page.title : `${page.title} · ${t("cms.status.draft")}`,
    });
  }

  for (const a of anchors) {
    if (!a.anchor) continue;
    out.push({ value: `#${a.anchor}`, label: a.label });
  }

  return out;
}
