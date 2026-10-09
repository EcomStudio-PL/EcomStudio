import { FeatureGate } from "@/components/feature-gate";
import { featureForPhotoTool, featureForToolSlug } from "@/lib/features";
import { isPhotoTool } from "@/lib/images/tools";

/**
 * The batch tools that still have a screen of their own (upscale, expand,
 * watermark) are switchable individually; anything else this dynamic route
 * serves belongs to the tools hub. The key comes from the slug through the
 * same helper the run API uses, so a page and its endpoint can never disagree
 * about which module they belong to. The four photo tools answer to their own
 * switches — the same ones /api/tools/photo checks.
 */
export default async function ToolSlugLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const feature = isPhotoTool(slug) ? featureForPhotoTool(slug) : featureForToolSlug(slug);
  return <FeatureGate feature={feature}>{children}</FeatureGate>;
}
