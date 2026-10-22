import type { Metadata } from "next";
import { LegalPage, type LegalSearchParams } from "@/components/cms/legal-page";
import { legalMetadata } from "@/lib/server/legal-metadata";

export const dynamic = "force-dynamic";

/** A public, indexed page: it names itself, not the homepage — and once the
 *  document is published, it names itself with the title an admin wrote. */
export function generateMetadata(): Promise<Metadata> {
  return legalMetadata("polityka-cookies", "legal.cookiesTitle");
}

export default function CookiesPolicyPage({ searchParams }: { searchParams: LegalSearchParams }) {
  return <LegalPage slug="polityka-cookies" titleKey="legal.cookiesTitle" searchParams={searchParams} />;
}
