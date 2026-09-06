import { FeatureGate } from "@/components/feature-gate";
import { featureForToolSlug } from "@/lib/features";

/**
 * The batch tools that still have a screen of their own (upscale, expand,
 * watermark) are switchable individually; anything else this dynamic route
 * serves belongs to the tools hub. The key comes from the slug through the
 * same helper the run API uses, so a page and its endpoint can never disagree
 * about which module they belong to.
 */
export default async function ToolSlugLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <FeatureGate feature={featureForToolSlug(slug)}>{children}</FeatureGate>;
}
