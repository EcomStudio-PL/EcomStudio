import type { Metadata } from "next";

/** Same reason as the login layout: a client page cannot export metadata, and
 *  a sitemap entry should be self-canonical. */
export const metadata: Metadata = {
  alternates: { canonical: "/register" },
  openGraph: { url: "/register" },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
