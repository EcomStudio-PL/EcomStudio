import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n/provider";
import { getDictionary } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "EcomStudio", template: "%s · EcomStudio" },
  description: "Professional e-commerce product content, faster.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dict } = await getDictionary();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <I18nProvider locale={locale} dict={dict}>
            {children}
            <Toaster position="top-center" richColors />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
