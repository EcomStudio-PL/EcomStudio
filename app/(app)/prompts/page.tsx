import { GeneratorStudioPage } from "@/components/genv3/studio-page";
import { publicToolMetadata } from "@/lib/server/public-tool-meta";
import { publicToolByKey } from "@/lib/public-tools";

const TOOL = publicToolByKey("generator")!;

/** Title, description, canonical, robots — Public Tools V1. */
export function generateMetadata() {
  return publicToolMetadata(TOOL);
}

export const dynamic = "force-dynamic";

/** GOTOWY GENERATOR — GrovBase Shot 1.0: product photos + a scenario in,
 *  finished photos out (the hidden prompt engine stays server-side). Shares
 *  its screen with Stwórz zdjęcie (Generator UX V3): one panel, two modes. */
export default async function PromptsPage({ searchParams }: {
  searchParams: Promise<{ cat?: string; prompt?: string }>;
}) {
  return <GeneratorStudioPage tool={TOOL} initialTab="grovshot" searchParams={await searchParams} />;
}
