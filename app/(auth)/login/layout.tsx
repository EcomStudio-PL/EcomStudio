import type { Metadata } from "next";

/** The login page is a client component, so its canonical lives here — it is
 *  listed in the sitemap and should point at itself, not at the homepage. */
export const metadata: Metadata = {
  alternates: { canonical: "/login" },
  openGraph: { url: "/login" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
