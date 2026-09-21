import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import { ThemeProvider } from "next-themes";
import { AppToaster } from "@/components/ui/toaster";
import { I18nProvider } from "@/lib/i18n/provider";
import { getScopedDictionary } from "@/lib/i18n/server";
import { SITE_ORIGIN } from "@/lib/site";
import { AuthModalMount } from "@/components/auth/auth-modal-mount";
import { ViewportLock } from "@/components/layout/viewport-lock";
import { GoogleAnalytics } from "@/components/analytics/google-analytics";
import "./globals.css";

export const metadata: Metadata = {
  // Every relative URL in metadata — canonical tags, OG images, the sitemap
  // reference — is resolved against this, so the app describes itself with
  // one host instead of whichever one served the request.
  metadataBase: SITE_ORIGIN,
  title: { default: "GrovBase", template: "%s · GrovBase" },
  description: "Professional e-commerce product content, faster.",
  applicationName: "GrovBase",
  appleWebApp: { capable: true, title: "GrovBase", statusBarStyle: "black-translucent" },
  /**
   * THE TAB ICON — and why it is declared HERE and nowhere else.
   *
   * Setting `icons` in metadata REPLACES Next's file conventions: with only
   * `apple` listed, `app/icon.png` existed in the repo and was served at
   * /icon.png, but no `<link rel="icon">` was ever emitted and /favicon.ico
   * answered 404 — measured on production, not assumed. Every GrovBase tab
   * therefore showed the browser's blank placeholder.
   *
   * So the whole set is declared in this one object, and every file it names
   * is cut from the official master `public/brand/app-icon.png` by
   * `scripts/make-favicon.mjs` — the same artwork as the PWA and the Apple
   * icon, downscaled, never redrawn.
   *
   * `/favicon.ico` carries 16/32/48 for the browsers (and bookmark managers,
   * feed readers, link unfurlers) that ask for it by name before reading any
   * markup. The PNGs are what a modern browser picks up; both are the
   * gradient app icon, which stays legible on a light and a dark tab strip
   * without a box drawn around it.
   *
   * `?v=5` is this repo's icon generation, already on the Apple icon and on
   * every entry in `app/manifest.ts`; the new URLs join it so one bump moves
   * the whole set the next time the artwork changes. The FILE still sits at
   * a bare /favicon.ico, which is what a browser asks for on its own.
   */
  icons: {
    icon: [
      { url: "/favicon.ico?v=5", sizes: "48x48 32x32 16x16", type: "image/x-icon" },
      { url: "/icons/icon-32.png?v=5", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-16.png?v=5", sizes: "16x16", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png?v=5",
  },
  formatDetection: { telephone: false },
  // Deliberately no `url` here: it would be inherited by every route and each
  // page would announce itself as the homepage. Pages that are actually
  // public set their own canonical and og:url.
  openGraph: {
    siteName: "GrovBase",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};
/**
 * THE APP IS FIXED AT 1:1 ON A TOUCH DEVICE.
 *
 * GrovBase is a tool, not a document: a seller comparing a generation against
 * their reference photo double-taps a card and the whole interface jumps to
 * 180%, with the header off the top and the dock off the bottom. A native app
 * would never do that, so neither does this.
 *
 * ONE declaration, here. Next.js renders the single `<meta name="viewport">`
 * from this export — hand-writing another one in a `<head>` would leave two
 * tags fighting, and which one wins is browser-dependent.
 *
 * `maximumScale` + `userScalable` are honoured by Chrome and Firefox on
 * Android, and by iOS when the app runs from the home screen. Mobile SAFARI IN
 * A TAB DELIBERATELY IGNORES BOTH (it has since iOS 10, as an accessibility
 * decision), so on an iPhone or iPad these two lines do nothing on their own —
 * `touch-action: manipulation` in globals.css stops the double tap there, and
 * `components/layout/viewport-lock.tsx` stops the pinch.
 *
 * The cost is real and worth naming: WCAG 1.4.4 asks that a page survive 200%
 * zoom, and this removes browser zoom as the way to get it on a phone. What
 * replaces it is the OS — system text size still reflows the app (nothing here
 * pins a px font to the root), Zoom / Magnifier still magnifies the screen, and
 * every field stays at 16px so nothing is small by default.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF8FD" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1015" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // ONLY WHAT THE PUBLIC PAGES RENDER. This provider wraps every document
  // GrovBase serves, so whatever it receives is inlined into the HTML of the
  // landing page, the terms of service and the CMS pages alike. The signed-in
  // app and /admin add their own namespaces from their own layouts — see
  // lib/i18n/scopes.ts.
  const { locale, dict } = await getScopedDictionary("root");
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="font-sans">
        {/* Renders nothing. Cancels iOS Safari's pinch, which is the one part
            of the 1:1 lock the viewport meta cannot do — see the file. */}
        <ViewportLock />
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <I18nProvider locale={locale} dict={dict}>
            {/* One dialog for the whole site: `?auth=` opens sign-in, sign-up
                or password recovery OVER the page the visitor is reading,
                whichever page that is. It WRAPS the page because the links
                that open it live inside the page — and opening has to be a
                state change, not a navigation. */}
            <AuthModalMount>{children}</AuthModalMount>
            {/* One toaster for the whole app. Bottom-centred and, on a phone,
                lifted clear of the dock — see components/ui/toaster.tsx. */}
            <AppToaster />
            {/* GA4. Renders nothing and, without
                NEXT_PUBLIC_GOOGLE_ANALYTICS_ID, emits nothing either — so a
                local build and an unconfigured preview carry no tag at all.
                Last in the tree because it is the only child here that is
                purely a side effect. */}
            <GoogleAnalytics />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
