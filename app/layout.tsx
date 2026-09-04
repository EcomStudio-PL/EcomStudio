import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n/provider";
import { getDictionary } from "@/lib/i18n/server";
import { SITE_ORIGIN } from "@/lib/site";
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
  icons: { apple: "/icons/apple-touch-icon.png?v=5" },
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
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF8FD" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1015" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dict } = await getDictionary();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="font-sans">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <I18nProvider locale={locale} dict={dict}>
            {children}
            <Toaster position="top-center" richColors />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
