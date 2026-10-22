import type { Metadata } from "next";
import { LegalPage, type LegalSearchParams } from "@/components/cms/legal-page";
import { legalMetadata } from "@/lib/server/legal-metadata";

export const dynamic = "force-dynamic";

/** A public, indexed page: it names itself, not the homepage — and once the
 *  document is published, it names itself with the title an admin wrote.
 *  Załącznik nr 2 to the Regulamin, so it has its own address too. */
export function generateMetadata(): Promise<Metadata> {
  return legalMetadata("umowa-powierzenia-danych", "legal.dpaTitle");
}

export default function DataProcessingAgreementPage({ searchParams }: { searchParams: LegalSearchParams }) {
  return <LegalPage slug="umowa-powierzenia-danych" titleKey="legal.dpaTitle" searchParams={searchParams} />;
}
