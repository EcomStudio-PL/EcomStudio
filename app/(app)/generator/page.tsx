import { GeneratorStudioPage } from "@/components/genv3/studio-page";
import { publicToolMetadata } from "@/lib/server/public-tool-meta";
import { publicToolByKey } from "@/lib/public-tools";

const TOOL = publicToolByKey("custom")!;

/** Title, description, canonical, robots — Public Tools V1. */
export function generateMetadata() {
  return publicToolMetadata(TOOL);
}

export const dynamic = "force-dynamic";

/** WŁASNY PROMPT — Stwórz zdjęcie: the customer's own words drive the
 *  generation; product photos define the product, inspiration steers the
 *  scene. Shares its screen with GrovBase Shot 1.0 (Generator UX V3). */
export default async function GeneratorPage({ searchParams }: {
  searchParams: Promise<{ cat?: string; prompt?: string }>;
}) {
  return <GeneratorStudioPage tool={TOOL} initialTab="stworz" searchParams={await searchParams} />;
}
