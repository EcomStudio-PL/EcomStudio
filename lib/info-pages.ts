/**
 * THE INFORMATIONAL PAGES — the CMS pages a signed-in customer reads INSIDE
 * the app (its header, its navigation) rather than on the public site's.
 *
 * Decided by the page's own navigation group (Admin → Strony WWW, the
 * footer's columns): „O firmie” (O nas), „Pomoc” (FAQ, Kontakt) and „Prawne”
 * (Regulamin, the policies, the Umowa powierzenia). A page an admin adds to
 * one of these groups joins them without code. The marketing pages
 * (narzędzia, cennik), campaigns and the launch page keep the public site's
 * chrome for everyone.
 *
 * The content itself is the same component for a visitor and for a customer;
 * only what is around it changes (components/layout/app-chrome.tsx).
 */
export const APP_INFO_NAV_GROUPS: readonly string[] = ["company", "help", "legal"];

export function isAppInfoGroup(group: string | null | undefined): boolean {
  return typeof group === "string" && APP_INFO_NAV_GROUPS.includes(group);
}
