/**
 * PODSTRONY INFORMACYJNE W APLIKACJI — held without a browser.
 *
 *   A  which pages: the CMS navigation groups „O firmie”, „Pomoc”, „Prawne”
 *      (lib/info-pages.ts) — never the marketing pages
 *   B  who: the server's verified session (Supabase Auth) and the app's own
 *      checks (resolveAppViewer → "ok"), never a browser flag; a visitor, a
 *      guest preview, a gated device or a paused account get the public page
 *   C  the SAME content component in both frames (no copy), same URLs
 *   D  the app frame for a page writes nothing for the account and mounts no
 *      work-surface extras; the app layout still redirects as before
 *   E  „Wróć” in a legal document: the site's start for a visitor, /home in-app
 *
 * Run: npm run test:infopages
 */
import fs from "node:fs";
import { APP_INFO_NAV_GROUPS, isAppInfoGroup } from "@/lib/info-pages";
import { isProtectedPath } from "@/lib/supabase/middleware";

let failed = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || detail === "" ? "" : `\n       ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}
const read = (f: string) => fs.readFileSync(f, "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const slugPage = code("app/[slug]/page.tsx");
const legalPage = code("components/cms/legal-page.tsx");
const legalDoc = code("components/legal/legal-document.tsx");
const chrome = code("components/layout/app-chrome.tsx");
const appLayout = code("app/(app)/layout.tsx");

console.log("A. which pages");
{
  check("O nas (company), FAQ + Kontakt (help), the legal documents (legal)",
    ["company", "help", "legal"].every((g) => isAppInfoGroup(g)) && APP_INFO_NAV_GROUPS.length === 3);
  check("the marketing pages, campaigns and pages outside the navigation keep the public site",
    !isAppInfoGroup("main") && !isAppInfoGroup(null) && !isAppInfoGroup(undefined) && !isAppInfoGroup(""));
  check("the CMS page decides by the page's own navigation group",
    /const group = nav\.find\(\(p\) => p\.slug === slug\)\?\.navGroup \?\? null;/.test(slugPage)
    && /isAppInfoGroup\(group\) \? await infoPageViewer\(supabase, user\) : null/.test(slugPage));
  for (const route of ["regulamin", "polityka-prywatnosci", "polityka-cookies", "umowa-powierzenia-danych"]) {
    check(`/${route} is still its own public route, rendered by LegalPage`, /<LegalPage /.test(code(`app/${route}/page.tsx`)));
  }
  check("no second set of URLs (no /app/o-nas, no copy of a page under the app)",
    ["o-nas", "faq", "kontakt", "regulamin", "polityka-prywatnosci", "polityka-cookies", "umowa-powierzenia-danych"]
      .every((s) => !fs.existsSync(`app/(app)/${s}`) && !fs.existsSync(`app/app/${s}`)));
}

console.log("B. who");
{
  check("the viewer comes from the server's getUser() (the CMS page and the legal page)",
    /supabase\.auth\.getUser\(\)/.test(slugPage) && /supabase\.auth\.getUser\(\)/.test(legalPage));
  check("only an app viewer in state \"ok\" gets the app frame; a guest preview never does",
    /if \(!user \|\| \(await guestPreviewActive\(\)\)\) return null;/.test(chrome)
    && /viewer\?\.state === "ok" \?/.test(chrome) && /resolveAppViewer\(supabase, user\)\.catch\(\(\) => null\)/.test(chrome));
  check("the app's checks are the ones the app layout always ran: login security, records, block",
    chrome.indexOf("enforceLoginSecurity(supabase)") > 0
    && chrome.indexOf("enforceLoginSecurity(supabase)") < chrome.indexOf('rpc("bootstrap_current_user")')
    && chrome.indexOf('rpc("bootstrap_current_user")') < chrome.indexOf("blockStateOf("));
  const files = [slugPage, legalPage, legalDoc, chrome, code("lib/info-pages.ts")];
  check("no browser flag decides it (no localStorage, no isLoggedIn)", files.every((s) => !/localStorage|sessionStorage|isLoggedIn/.test(s)));
  check("both pages are rendered per request (the session is read, nothing is shared between users)",
    /export const dynamic = "force-dynamic"/.test(read("app/regulamin/page.tsx")) || /cookies\(\)|getUser\(\)/.test(legalPage));
}

console.log("C. one content, two frames");
{
  check("the CMS page renders ONE BlockRenderer, used by both frames",
    (slugPage.match(/<BlockRenderer/g) ?? []).length === 1 && (slugPage.match(/\{content\}/g) ?? []).length === 2);
  check("…the visitor's frame is the page's own setting, as before (header, announcement, footer)",
    /page\.headerMode === "global" && <SiteHeader \{\.\.\.shell\} \/>/.test(slugPage)
    && /page\.footerMode === "global" && <SiteFooter \{\.\.\.shell\} \/>/.test(slugPage));
  check("…in the app frame the public header is gone and the page's footer setting still applies",
    /<AppChrome [^>]*variant="page"[\s\S]*?footer=\{page\.footerMode === "global" \? <SiteFooter \{\.\.\.shell\} \/> : page\.footerMode === "minimal" \? <MinimalFooter t=\{t\} \/> : null\}>\s*\{content\}\s*<\/AppChrome>/.test(slugPage));
  check("the legal page renders ONE body (LegalDocument / LegalSoon / LegacyLegal) for both frames",
    (legalPage.match(/\{body\}/g) ?? []).length === 2
    && /<AppChrome [^>]*variant="page"[\s\S]*?footer=\{<SiteFooter \{\.\.\.shell\} \/>\}>\s*\{body\}\s*<\/AppChrome>/.test(legalPage));
  check("the legal page's viewer rides its existing batch (no serial await)",
    /getGlobalSections\(\), getNavPages\(\), getPublicSite\(supabase\), infoPageViewer\(supabase, user\),/.test(legalPage));
}

console.log("D. the app frame for a page");
{
  check("one chrome: the app layout wears AppChrome too (no second header/dock implementation)",
    /<AppChrome supabase=\{supabase\} user=\{user\}/.test(appLayout)
    && !/MegaTopbar|CustomerBottomNav|CustomerDrawer/.test(appLayout)
    && (chrome.match(/<MegaTopbar /g) ?? []).length === 1 && (chrome.match(/<CustomerBottomNav /g) ?? []).length === 1);
  check("a page writes nothing for the account (no bonus stamp, no pre-launch payout)",
    /const bonusOffer = !page && bonusConfig\.active/.test(chrome) && /page \? 0 : await ensurePrelaunchRewards/.test(chrome));
  const pageBranch = chrome.slice(chrome.indexOf("{page ? ("), chrome.indexOf(") : (", chrome.indexOf("{page ? (")));
  check("a page gets no work-surface extras (no „Zgłoś błąd”, no draft resume)",
    pageBranch.length > 0 && !/FeedbackCTA|DraftResume|HomeFooter/.test(pageBranch));
  check("its footer clears the phone navigation by /home's own rule", /data-home-footer=""/.test(pageBranch)
    && /\[data-home-footer\]/.test(read("app/globals.css")));
  check("the app layout still redirects a visitor to sign in and a gated device to the check",
    /if \(!user\) redirect\("\/login"\)/.test(appLayout) && /if \(viewer\.state === "gate"\) redirect\(viewer\.to\)/.test(appLayout));
  check("the middleware still lets a visitor read every informational page (no sign-in wall)",
    ["/o-nas", "/faq", "/kontakt", "/regulamin", "/polityka-prywatnosci", "/polityka-cookies", "/umowa-powierzenia-danych"]
      .every((p) => !isProtectedPath(p)));
}

console.log("E. „Wróć”");
{
  check("the legal page sends the in-app reader to /home, a visitor to /", /const homeHref = viewer \? "\/home" : "\/";/.test(legalPage)
    && (legalPage.match(/homeHref=\{homeHref\}/g) ?? []).length === 3);
  check("every „Wróć” in a document uses it (none hard-coded to /)",
    (legalDoc.match(/<BackLink t=\{t\} href=\{homeHref\} \/>/g) ?? []).length === 2 && !/<Link href="\/" data-legal-back/.test(legalDoc + legalPage));
}

console.log(failed ? `\n${failed} INFO-PAGE TEST(S) FAILED` : "\nAll info-page tests passed.");
process.exit(failed ? 1 : 0);
