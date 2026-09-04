import type { Metadata } from "next";
import { LegalPage } from "@/components/cms/legal-page";

export const dynamic = "force-dynamic";

/** A public, indexed page: it names itself, not the homepage. */
export const metadata: Metadata = {
  alternates: { canonical: "/regulamin" },
  openGraph: { url: "/regulamin" },
};

export default function TermsPage() {
  return <LegalPage slug="regulamin" titleKey="legal.termsTitle" />;
}
