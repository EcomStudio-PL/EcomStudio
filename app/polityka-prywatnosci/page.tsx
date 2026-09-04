import type { Metadata } from "next";
import { LegalPage } from "@/components/cms/legal-page";

export const dynamic = "force-dynamic";

/** A public, indexed page: it names itself, not the homepage. */
export const metadata: Metadata = {
  alternates: { canonical: "/polityka-prywatnosci" },
  openGraph: { url: "/polityka-prywatnosci" },
};

export default function PrivacyPage() {
  return <LegalPage slug="polityka-prywatnosci" titleKey="legal.privacyTitle" />;
}
